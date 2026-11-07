import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireAdmin } from '../middleware/auth';

export const paymentReceiptRouter = Router();

paymentReceiptRouter.post('/:id/receipt', requireAdmin, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey || !env.resendApiKey) {
      return res.status(503).json({ error: 'Payment email delivery is not configured.' });
    }
    const adminClient = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: payment, error: paymentError } = await adminClient.from('payments').select('id,amount,payment_type,customer_id,package_id').eq('id', req.params.id).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found.' });
    const [{ data: authUser }, { data: packageRecord }] = await Promise.all([
      adminClient.auth.admin.getUserById(payment.customer_id),
      adminClient.from('packages').select('tracking_number').eq('id', payment.package_id).single(),
    ]);
    const email = authUser.user?.email;
    if (!email) return res.status(422).json({ error: 'Customer email is not available.' });
    const tracking = packageRecord?.tracking_number ?? 'your package';
    const amount = `JMD $${Number(payment.amount).toLocaleString('en-JM')}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26354c"><div style="background:#071A38;padding:24px;text-align:center"><img src="${env.emailLogoUrl}" alt="JetSpeed Couriers" style="max-width:220px;background:#fff;border-radius:8px;padding:8px"></div><div style="padding:30px"><h1 style="color:#071A38">Payment received</h1><p>We have received your payment for package <strong>${tracking}</strong>.</p><div style="background:#f5f7fb;padding:18px;border-radius:10px"><p><strong>Status:</strong> Paid</p><p><strong>Payment type:</strong> ${payment.payment_type === 'card' ? 'Card' : 'Cash'}</p><p><strong>Amount received:</strong> ${amount}</p></div><p>Thank you for choosing JetSpeed Couriers.</p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.emailFrom, to: [email], subject: `Payment received for ${tracking}`, html }) });
    if (!response.ok) return res.status(502).json({ error: 'Email provider rejected the receipt.' });
    return res.status(202).json({ sent: true });
  } catch (error) {
    return next(error);
  }
});
