import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { createShippingInvoicePdf } from '../services/shippingInvoicePdf';

export const packageInvoicesRouter = Router();

packageInvoicesRouter.get('/:packageId/pdf', requireAuth, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
      return res.status(503).json({ error: 'Invoice delivery is not configured.' });
    }
    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: packageRecord, error: packageError } = await client.from('packages')
      .select('id,status,customer_id,customer_name,tracking_number,weight_lb,freight_type,collection_amount_jmd,custom_collection_amount_jmd,item_description,service_fee_override_jmd,customs_fee_jmd,delivery_fee_jmd,pricing_breakdown,profiles:customer_id(full_name,identifier_code)')
      .eq('id', req.params.packageId)
      .single();
    if (packageError) {
      if (packageError.code === 'PGRST116') return res.status(404).json({ error: 'Package not found.' });
      throw packageError;
    }
    if (!packageRecord) return res.status(404).json({ error: 'Package not found.' });
    if (packageRecord.customer_id !== req.user!.id) {
      if (!env.adminEmails.includes((req.user!.email ?? '').toLowerCase())) {
        const { data: profile, error } = await client.from('profiles').select('role').eq('id', req.user!.id).maybeSingle();
        if (error) throw error;
        if (profile?.role !== 'admin' && profile?.role !== 'support') {
          return res.status(403).json({ error: 'You do not have access to this package invoice.' });
        }
      }
    }
    if (packageRecord.status !== 'ready_for_pickup' && packageRecord.status !== 'delivered') {
      return res.status(409).json({ error: 'The shipping invoice is available when the package is ready for pickup.' });
    }

    const { data: invoice, error: invoiceError } = await client.from('invoices')
      .select('invoice_number,amount,created_at')
      .eq('shipping_for_package_id', packageRecord.id)
      .eq('shipping_invoice_current', true)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return res.status(409).json({ error: 'The shipping invoice has not been generated yet.' });
    const { data: settings, error: settingsError } = await client.from('site_settings')
      .select('key,value')
      .in('key', ['support_email', 'whatsapp_phone']);
    if (settingsError) throw settingsError;
    const settingValues = Object.fromEntries((settings ?? []).map(setting => [setting.key, setting.value]));
    const settingText = (value: any, fallback: string) => String(value?.value ?? value ?? fallback).trim() || fallback;
    const pricing = (packageRecord.pricing_breakdown || {}) as Record<string, unknown>;
    const serviceFee = Number(pricing.service_fee_jmd ?? packageRecord.service_fee_override_jmd ?? pricing.normal_shipping_charge_jmd ?? 0);
    const customsFee = Number(packageRecord.customs_fee_jmd ?? pricing.customs_fee_jmd ?? 0);
    const discount = Number(pricing.referral_discount_jmd || 0);
    const deliveryFee = Number(packageRecord.delivery_fee_jmd || 0);
    const customFee = packageRecord.custom_collection_amount_jmd == null
      ? 0
      : Number(packageRecord.custom_collection_amount_jmd) - Math.max(0, serviceFee + customsFee + deliveryFee - discount);
    const customerProfile = (packageRecord as any).profiles || {};
    const filename = `${String(packageRecord.tracking_number).replace(/[^a-zA-Z0-9._-]/g, '_')}-invoice.pdf`;
    const pdf = await createShippingInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.created_at,
      customerName: customerProfile.full_name || packageRecord.customer_name || 'Customer',
      courierCode: customerProfile.identifier_code || 'Not available',
      trackingNumber: packageRecord.tracking_number,
      itemDescription: packageRecord.item_description,
      freightType: packageRecord.freight_type === 'sea' ? 'Sea freight' : 'Air freight',
      weightLb: Number(pricing.chargeable_weight_lb ?? packageRecord.weight_lb ?? 0),
      serviceFeeJmd: serviceFee,
      customFeeJmd: Number(pricing.custom_fee_adjustment_jmd ?? customFee),
      customsFeeJmd: customsFee,
      deliveryFeeJmd: deliveryFee,
      discountJmd: discount,
      totalJmd: Number(invoice.amount),
      supportEmail: settingText(settingValues.support_email, 'info@globalxendja.com'),
      whatsappNumber: settingText(settingValues.whatsapp_phone, '+1 876 336 4724'),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
});
