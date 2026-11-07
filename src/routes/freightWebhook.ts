import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';

type ForwarderPackage = {
  tracking_number: string;
  customer_id: string;
  origin: string;
  destination: string;
  status?: string;
  weight_kg?: number;
  service_level?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
};

export const freightWebhookRouter = Router();

freightWebhookRouter.post('/package-received', async (req, res) => {
  if (!env.freightWebhookSecret || req.header('x-freight-webhook-secret') !== env.freightWebhookSecret) {
    return res.status(401).json({ error: 'Invalid freight-forwarder webhook secret.' });
  }
  if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
    return res.status(503).json({ error: 'Supabase service access is not configured.' });
  }
  const body = req.body as Partial<ForwarderPackage>;
  if (!body.tracking_number || !body.customer_id || !body.origin || !body.destination) {
    return res.status(400).json({ error: 'tracking_number, customer_id, origin, and destination are required.' });
  }
  const packageRecord = {
    tracking_number: body.tracking_number,
    customer_id: body.customer_id,
    origin: body.origin,
    destination: body.destination,
    status: body.status ?? 'received',
    weight_kg: body.weight_kg ?? null,
    service_level: body.service_level ?? null,
    customer_name: body.customer_name ?? null,
    customer_email: body.customer_email ?? null,
    customer_phone: body.customer_phone ?? null,
  };
  const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
  const { data, error } = await client.from('packages').upsert(packageRecord, { onConflict: 'tracking_number' }).select().single();
  if (error) return res.status(422).json({ error: error.message });
  return res.status(201).json({ data });
});
