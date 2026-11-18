import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireStaff } from '../middleware/auth';

export const packageProcessingRouter = Router();

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]!);

packageProcessingRouter.patch('/:packageId', requireStaff, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
      return res.status(503).json({ error: 'Package processing is not configured.' });
    }
    const { status, weight_lb: weightLb, freight_type: freightType } = req.body as {
      status?: unknown;
      weight_lb?: unknown;
      freight_type?: unknown;
    };
    if (typeof status !== 'string' || typeof freightType !== 'string'
      || (weightLb !== null && weightLb !== undefined && (typeof weightLb !== 'number' || !Number.isFinite(weightLb)))) {
      return res.status(400).json({ error: 'A valid package status, weight, and freight type are required.' });
    }

    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: result, error } = await client.rpc('admin_update_package', {
      p_package_id: req.params.packageId,
      p_status: status,
      p_weight_lb: weightLb ?? null,
      p_freight_type: freightType,
      p_actor_id: req.user!.id,
    });
    if (error) return res.status(400).json({ error: error.message });

    const previousStatus = result.previous_status as string;
    const warnings: string[] = [];
    let invoiceReady = true;
    if (status === 'ready_for_pickup') {
      const { error: invoiceError } = await client.rpc('ensure_current_shipping_invoice', {
        p_package_id: req.params.packageId,
      });
      if (invoiceError) {
        invoiceReady = false;
        warnings.push(`Package is ready, but its shipping invoice could not be saved: ${invoiceError.message}`);
      }
    }
    const statusLabels: Record<string, string> = {
      label_created: 'Label created',
      received_at_miami: 'Received at Miami hub',
      in_transit: 'In transit',
      ready_for_pickup: 'Ready for pickup/Delivery',
      delivered: 'Delivered',
    };
    if (status !== previousStatus) {
      const { error: eventError } = await client.from('tracking_events').insert({
        package_id: req.params.packageId,
        status,
        description: statusLabels[status],
        location: status === 'received_at_miami' ? 'Miami hub' : status === 'in_transit' ? 'In transit' : 'JetSpeed network',
      });
      if (eventError) warnings.push(`Package updated, but tracking history could not be saved: ${eventError.message}`);
    }

    let emailResult: { sent: boolean; error?: string } = { sent: false };
    if (status === 'ready_for_pickup' && invoiceReady) {
      const claim = await client.from('package_email_notifications')
        .insert({ package_id: req.params.packageId, notification_type: 'package_ready', status: 'sending' })
        .select('id')
        .single();
      if (claim.error && claim.error.code !== '23505') {
        emailResult = { sent: false, error: 'Ready notification could not be reserved for delivery.' };
      } else if (!claim.error) {
        try {
          if (!env.resendApiKey) throw new Error('Branded email delivery is not configured.');
          const { data: packageRecord, error: packageError } = await client.from('packages')
            .select('tracking_number,customer_id,customer_name,weight_lb,freight_type,collection_amount_jmd,pricing_breakdown')
            .eq('id', req.params.packageId)
            .single();
          if (packageError || !packageRecord) throw new Error('Package details could not be loaded for the ready notification.');
          const [authResult, profileResult] = await Promise.all([
            client.auth.admin.getUserById(packageRecord.customer_id),
            client.from('profiles').select('full_name,shipment_status_emails').eq('id', packageRecord.customer_id).single(),
          ]);
          if (authResult.error) throw authResult.error;
          if (profileResult.error) throw profileResult.error;
          const profile = profileResult.data;
          if (profile?.shipment_status_emails === false) {
            emailResult = { sent: false };
            const { error: markError } = await client.from('package_email_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', claim.data.id);
            if (markError) console.error('Unable to record skipped package-ready notification', markError);
          } else {
            const email = authResult.data.user?.email;
            if (!email) throw new Error('Customer email is not available.');
            const pricing = (packageRecord.pricing_breakdown || {}) as Record<string, unknown>;
            const amount = (value: unknown) => `JMD $${Number(value || 0).toLocaleString('en-JM')}`;
            const name = escapeHtml(profile?.full_name || packageRecord.customer_name || 'Customer');
            const tracking = escapeHtml(packageRecord.tracking_number);
            const weight = Number(pricing.chargeable_weight_lb ?? packageRecord.weight_lb ?? 0);
            const freight = packageRecord.freight_type === 'sea' ? 'Sea freight' : 'Air freight';
            const discount = Number(pricing.referral_discount_jmd || 0);
            const delivery = pricing.local_delivery_free === true ? 'FREE' : 'Standard delivery charges may apply';
            const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26354c"><div style="background:#071A38;padding:24px;text-align:center"><img src="${escapeHtml(env.emailLogoUrl)}" alt="JetSpeed Couriers" style="max-width:220px;background:#fff;border-radius:8px;padding:8px"></div><div style="padding:30px"><h1 style="color:#071A38">Your package is ready!</h1><p>Hi ${name},</p><p>Package <strong>${tracking}</strong> is ready for collection or delivery.</p><div style="background:#f5f7fb;padding:18px;border-radius:10px"><p><strong>Package weight:</strong> ${weight} lb</p><p><strong>Shipping type:</strong> ${freight}</p><p><strong>Shipping cost:</strong> ${amount(pricing.normal_shipping_charge_jmd)}</p>${discount > 0 ? `<p><strong>JetSpeed referral discount:</strong> -${amount(discount)}</p>` : ''}<p><strong>Local delivery:</strong> ${delivery}</p><p style="font-size:18px"><strong>Total amount due:</strong> ${amount(packageRecord.collection_amount_jmd)}</p></div><p>Please contact JetSpeed Couriers for payment and collection instructions.</p><p>Thank you for shipping with JetSpeed Couriers.<br><strong>You Shop. We Ship.</strong></p></div></div>`;
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: env.emailFrom, to: [email], subject: `Your package ${packageRecord.tracking_number} is ready`, html }),
            });
            if (!response.ok) throw new Error('Email provider rejected the package-ready notification.');
            emailResult = { sent: true };
            const { error: markError } = await client.from('package_email_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', claim.data.id);
            if (markError) console.error('Unable to record sent package-ready notification', markError);
          }
        } catch (emailError) {
          const message = emailError instanceof Error ? emailError.message : 'Package-ready email could not be sent.';
          emailResult = { sent: false, error: message };
          const { error: markError } = await client.from('package_email_notifications').update({ status: 'failed' }).eq('id', claim.data.id);
          if (markError) console.error('Unable to record failed package-ready notification', markError);
        }
      }
    }

    return res.json({ data: result, email: emailResult, warnings });
  } catch (error) {
    return next(error);
  }
});
