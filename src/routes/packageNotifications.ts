import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireStaff } from '../middleware/auth';

export const packageNotificationsRouter = Router();

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
      client.from('profiles').select('full_name').eq('id', packageRecord.customer_id).single(),
    ]);
    const email = authUser.user?.email;
    if (!email) return res.status(422).json({ error: 'Customer email is not available.' });
    const firstName = (profile?.full_name || packageRecord.customer_name || 'Customer').split(/\s+/)[0];
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26354c"><div style="background:#071A38;padding:24px;text-align:center"><img src="${env.emailLogoUrl}" alt="JetSpeed Couriers" style="max-width:220px;background:#fff;border-radius:8px;padding:8px"></div><div style="padding:30px"><h1 style="color:#071A38">Package received at our warehouse</h1><p>Hi ${firstName},</p><p>Your JetSpeed package has arrived at our Miami warehouse and is now being prepared for shipment to Jamaica.</p><div style="background:#f5f7fb;padding:18px;border-radius:10px"><p><strong>Tracking number:</strong> ${packageRecord.tracking_number}</p><p><strong>Status:</strong> Received at Miami hub</p></div><p>We will notify you as your package moves through the delivery process.</p><p>Thank you for choosing JetSpeed Couriers.</p></div></div>`;
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.emailFrom, to: [email], subject: `Your package ${packageRecord.tracking_number} has arrived`, html }) });
    if (!response.ok) return res.status(502).json({ error: 'Email provider rejected the warehouse notification.' });
    return res.status(202).json({ sent: true });
  } catch (error) {
    return next(error);
  }
});
