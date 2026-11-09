import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';

type ForwarderPackage = {
  tracking_number: string;
  mailboxNumber: string;
  airWayBill?: string;
  weight?: number;
  description?: string;
  package_value?: number;
  consignee?: string;
  vendor?: string;
  status?: string;
};

export const freightWebhookRouter = Router();

const statusMap: Record<string, string> = {
  RECEIVED_AT_WAREHOUSE: 'received_at_miami',
  PREALERT: 'label_created',
  INVOICE_NEEDED: 'received_at_miami',
  SHIPPED: 'in_transit',
  IN_TRANSIT_TO_JM: 'in_transit',
  AT_CUSTOMS_IN_KIN: 'in_transit',
  HELD_BY_CUSTOMS: 'in_transit',
  IN_TRANSIT_TO_BRANCH: 'in_transit',
  READY_FOR_PICKUP: 'ready_for_pickup',
  OUT_FOR_DELIVERY: 'ready_for_pickup',
};

freightWebhookRouter.post(['/', '/package-received'], async (req, res) => {
  const authorization = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.freightWebhookSecret || authorization !== env.freightWebhookSecret) {
    return res.status(401).json({ error: 'Invalid freight-forwarder webhook bearer token.' });
  }
  if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
    return res.status(503).json({ error: 'Supabase service access is not configured.' });
  }
  const body = req.body as Partial<ForwarderPackage>;
  if (!body.tracking_number || !body.mailboxNumber) {
    return res.status(400).json({ error: 'tracking_number and mailboxNumber are required.' });
  }
  const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
  const { data: profile, error: profileError } = await client.from('profiles').select('id,full_name,email,phone').eq('identifier_code', body.mailboxNumber).maybeSingle();
  if (profileError) return res.status(502).json({ error: profileError.message });
  if (!profile) return res.status(422).json({ error: 'No JetSpeed customer matches mailboxNumber.' });
  const existing = await client.from('packages').select('id,status').eq('tracking_number', body.tracking_number).maybeSingle();
  const rawStatus = body.status ?? 'RECEIVED_AT_WAREHOUSE';
  const packageRecord = {
    tracking_number: body.tracking_number,
    customer_id: profile.id,
    origin: 'Miami',
    destination: 'Jamaica',
    status: statusMap[rawStatus] ?? 'received_at_miami',
    weight_kg: body.weight ?? null,
    service_level: rawStatus === 'SHIPPED' || rawStatus.includes('IN_TRANSIT') ? 'air' : null,
    customer_name: profile.full_name ?? body.consignee ?? null,
    customer_email: profile.email ?? null,
    customer_phone: profile.phone ?? null,
    mailbox_number: body.mailboxNumber,
    air_way_bill: body.airWayBill ?? null,
    vendor: body.vendor ?? null,
    package_value: body.package_value ?? null,
    freight_forwarder_status: rawStatus,
  };
  const { data, error } = await client.from('packages').upsert(packageRecord, { onConflict: 'tracking_number' }).select().single();
  if (error) return res.status(422).json({ error: error.message });
  if (existing.data?.status !== packageRecord.status) {
    const eventResult = await client.from('tracking_events').insert({ package_id: data.id, status: packageRecord.status, description: body.description ?? rawStatus, location: rawStatus === 'RECEIVED_AT_WAREHOUSE' ? 'Miami hub' : 'Freight-forwarder network' });
    if (eventResult.error) return res.status(500).json({ error: eventResult.error.message });
  }
  return res.status(201).json({ data });
});
