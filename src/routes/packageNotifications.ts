import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireStaff } from '../middleware/auth';
import { createShippingInvoicePdf } from '../services/shippingInvoicePdf';

export const packageNotificationsRouter = Router();

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]!);

packageNotificationsRouter.post('/:packageId/warehouse-email', requireStaff, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey || !env.resendApiKey) {
      return res.status(503).json({ error: 'Branded email delivery is not configured.' });
    }
    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: packageRecord, error } = await client.from('packages').select('tracking_number,customer_id,customer_name').eq('id', req.params.packageId).single();
    if (error || !packageRecord) return res.status(404).json({ error: 'Package not found.' });
    const [{ data: authUser }, { data: profile }] = await Promise.all([
      client.auth.admin.getUserById(packageRecord.customer_id),
      client.from('profiles').select('full_name,shipment_status_emails').eq('id', packageRecord.customer_id).single(),
    ]);
    if (profile?.shipment_status_emails === false) return res.status(202).json({ sent: false, skipped: true, reason: 'Customer disabled shipment status emails.' });
    const email = authUser.user?.email;
    if (!email) return res.status(422).json({ error: 'Customer email is not available.' });
    const firstName = (profile?.full_name || packageRecord.customer_name || 'Customer').split(/\s+/)[0];
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26354c"><div style="background:#071A38;padding:24px;text-align:center"><img src="${env.emailLogoUrl}" alt="Global Xend JA" style="max-width:220px;background:#fff;border-radius:8px;padding:8px"></div><div style="padding:30px"><h1 style="color:#071A38">Package received at our warehouse</h1><p>Hi ${firstName},</p><p>Your Global Xend JA package has arrived at our Miami warehouse and is now being prepared for shipment to Jamaica.</p><div style="background:#f5f7fb;padding:18px;border-radius:10px"><p><strong>Tracking number:</strong> ${packageRecord.tracking_number}</p><p><strong>Status:</strong> Received at Miami hub</p></div><p>We will notify you as your package moves through the delivery process.</p><p>Thank you for choosing Global Xend JA.</p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.emailFrom, to: [email], subject: `Your package ${packageRecord.tracking_number} has arrived`, html }) });
    if (!response.ok) return res.status(502).json({ error: 'Email provider rejected the warehouse notification.' });
    return res.status(202).json({ sent: true });
  } catch (error) {
    return next(error);
  }
});

packageNotificationsRouter.post('/:packageId/ready-email', requireStaff, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey || !env.resendApiKey) {
      return res.status(503).json({ error: 'Branded email delivery is not configured.' });
    }
    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: packageRecord, error } = await client.from('packages')
      .select('id,tracking_number,status,customer_id,customer_name,weight_lb,freight_type,collection_amount_jmd,custom_collection_amount_jmd,item_description,service_fee_override_jmd,customs_fee_jmd,delivery_fee_jmd,courier_tracking_number,pricing_breakdown')
      .eq('id', req.params.packageId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Package not found.' });
      throw error;
    }
    if (!packageRecord) return res.status(404).json({ error: 'Package not found.' });
    if (packageRecord.status !== 'ready_for_pickup') {
      return res.status(409).json({ error: 'Save the package as ready for pickup before sending this email.' });
    }
    if (packageRecord.collection_amount_jmd == null) {
      return res.status(409).json({ error: 'A collection amount is required before sending this email.' });
    }
    const [authResult, profileResult] = await Promise.all([
      client.auth.admin.getUserById(packageRecord.customer_id),
      client.from('profiles').select('full_name,identifier_code,shipment_status_emails').eq('id', packageRecord.customer_id).single(),
    ]);
    if (authResult.error) throw authResult.error;
    if (profileResult.error) throw profileResult.error;
    if (profileResult.data?.shipment_status_emails === false) {
      return res.status(202).json({ sent: false, skipped: true, reason: 'Customer disabled shipment status emails.' });
    }
    const email = authResult.data.user?.email;
    if (!email) return res.status(422).json({ error: 'Customer email is not available.' });
    const [{ data: invoice, error: invoiceError }, { data: settings, error: settingsError }] = await Promise.all([
      client.from('invoices').select('invoice_number,amount,created_at').eq('shipping_for_package_id', packageRecord.id).eq('shipping_invoice_current', true).maybeSingle(),
      client.from('site_settings').select('key,value').in('key', ['support_email', 'whatsapp_phone']),
    ]);
    if (invoiceError) throw invoiceError;
    if (settingsError) throw settingsError;
    if (!invoice) return res.status(409).json({ error: 'The shipping invoice has not been generated yet.' });
    const settingValues = Object.fromEntries((settings ?? []).map(setting => [setting.key, setting.value]));
    const settingText = (value: any, fallback: string) => String(value?.value ?? value ?? fallback).trim() || fallback;
    const pricing = (packageRecord.pricing_breakdown || {}) as Record<string, unknown>;
    const amount = (value: unknown) => `JMD $${Number(value || 0).toLocaleString('en-JM')}`;
    const name = escapeHtml(profileResult.data?.full_name || packageRecord.customer_name || 'Customer');
    const tracking = escapeHtml(packageRecord.tracking_number);
    const weight = Number(pricing.chargeable_weight_lb ?? packageRecord.weight_lb ?? 0);
    const freight = packageRecord.freight_type === 'sea' ? 'Sea freight' : 'Air freight';
    const discount = Number(pricing.referral_discount_jmd || 0);
    const courierCode = escapeHtml(profileResult.data?.identifier_code || 'Not available');
    const itemDescription = escapeHtml(packageRecord.item_description || 'Not provided');
    const courierTrackingLine = packageRecord.courier_tracking_number
      ? `<p><strong>Courier tracking number:</strong> ${escapeHtml(packageRecord.courier_tracking_number)}</p>`
      : '';
    const deliveryFee = Number(packageRecord.delivery_fee_jmd || 0);
    const serviceFee = Number(pricing.service_fee_jmd ?? packageRecord.service_fee_override_jmd ?? pricing.normal_shipping_charge_jmd ?? 0);
    const customsFee = Number(packageRecord.customs_fee_jmd ?? pricing.customs_fee_jmd ?? 0);
    const customFee = packageRecord.custom_collection_amount_jmd == null
      ? 0
      : Number(packageRecord.custom_collection_amount_jmd) - Math.max(0, serviceFee + customsFee + deliveryFee - discount);
    const invoicePdf = await createShippingInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.created_at,
      customerName: profileResult.data?.full_name || packageRecord.customer_name || 'Customer',
      courierCode: profileResult.data?.identifier_code || 'Not available',
      trackingNumber: packageRecord.tracking_number,
      itemDescription: packageRecord.item_description,
      freightType: freight,
      weightLb: weight,
      serviceFeeJmd: serviceFee,
      customFeeJmd: Number(pricing.custom_fee_adjustment_jmd ?? customFee),
      customsFeeJmd: customsFee,
      deliveryFeeJmd: deliveryFee,
      discountJmd: discount,
      totalJmd: Number(invoice.amount),
      supportEmail: settingText(settingValues.support_email, 'info@globalxendja.com'),
      whatsappNumber: settingText(settingValues.whatsapp_phone, '+1 876 336 4724'),
    });
    const invoiceFilename = `${String(packageRecord.tracking_number).replace(/[^a-zA-Z0-9._-]/g, '_')}-invoice.pdf`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26354c"><div style="background:#071A38;padding:24px;text-align:center"><img src="${escapeHtml(env.emailLogoUrl)}" alt="Global Xend JA" style="max-width:220px;background:#fff;border-radius:8px;padding:8px"></div><div style="padding:30px"><h1 style="color:#071A38">Your package is ready!</h1><p>Hi ${name},</p><p>Package <strong>${tracking}</strong> is ready for collection or delivery.</p><div style="background:#f5f7fb;padding:18px;border-radius:10px"><p><strong>Courier code:</strong> ${courierCode}</p>${courierTrackingLine}<p><strong>Item description:</strong> ${itemDescription}</p><p><strong>Package weight:</strong> ${weight} lb</p><p><strong>Shipping type:</strong> ${freight}</p><p style="font-size:18px"><strong>Total amount due:</strong> ${amount(packageRecord.collection_amount_jmd)}</p></div><p>Your PDF invoice is attached to this email.</p><p>Please contact Global Xend JA for payment and collection instructions.</p><p>Thank you for shipping with Global Xend JA.<br><strong>You Shop. We Ship.</strong></p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom, to: [email], subject: `Your package ${packageRecord.tracking_number} is ready`, html, attachments: [{ filename: invoiceFilename, content: invoicePdf.toString('base64'), content_type: 'application/pdf' }] }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Email provider rejected the ready-for-pickup notification.' });
    return res.status(202).json({ sent: true });
  } catch (error) {
    return next(error);
  }
});
