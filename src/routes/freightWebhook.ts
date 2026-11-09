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
type ForwarderAccount = {
  first_name?: string;
  last_name?: string;
  email: string;
  mailboxNumber: string;
  pickupLocation?: string;
};

export const freightWebhookRouter = Router();

freightWebhookRouter.post(['/accounts', '/customers'], async (req, res) => {
  const authorization = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.freightWebhookSecret || authorization !== env.freightWebhookSecret) {
    return res.status(401).json({ error: 'Invalid freight-forwarder webhook bearer token.' });
  }
  if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
    return res.status(503).json({ error: 'Supabase service access is not configured.' });
  }
  const body = req.body as Partial<ForwarderAccount>;
  if (!body.email || !body.mailboxNumber) {
    return res.status(400).json({ error: 'email and mailboxNumber are required.' });
  }
  const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
  const { data: authUsers, error: authError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) return res.status(502).json({ error: authError.message });
  const authUser = authUsers.users.find(user => user.email?.toLowerCase() === body.email!.toLowerCase());
  if (!authUser) {
    const { data: pending, error: pendingError } = await client.from('forwarder_customer_registrations').upsert({
      email: body.email.toLowerCase(),
      mailbox_number: body.mailboxNumber,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      phone: (body as ForwarderAccount & { phone?: string }).phone ?? null,
      pickup_location: body.pickupLocation ?? 'Top Hill, St Elizabeth',
    }, { onConflict: 'email' }).select().single();
    if (pendingError) return res.status(422).json({ error: pendingError.message });
    return res.status(202).json({ message: 'Customer registration stored pending JetSpeed signup.', pending_account: pending });
  }
  const fullName = [body.first_name, body.last_name].filter(Boolean).join(' ').trim();
  const { data, error } = await client.from('profiles').upsert({
    id: authUser.id,
    email: authUser.email,
    full_name: fullName || authUser.user_metadata?.full_name || authUser.email,
    identifier_code: body.mailboxNumber,
    pickup_location: body.pickupLocation ?? 'Top Hill, St Elizabeth',
  }).select('id,full_name,email,identifier_code,pickup_location').single();
  if (error) return res.status(422).json({ error: error.message });
  return res.status(200).json({ message: 'Account linked.', account: data });
});

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
  if (!profile) {
    const { data: pending, error: pendingError } = await client.from('pending_forwarder_packages').upsert({
      tracking_number: body.tracking_number,
      mailbox_number: body.mailboxNumber,
      air_way_bill: body.airWayBill ?? null,
      weight: body.weight ?? null,
      description: body.description ?? null,
      package_value: body.package_value ?? null,
      consignee: body.consignee ?? null,
      vendor: body.vendor ?? null,
      forwarder_status: body.status ?? null,
      payload: body,
    }, { onConflict: 'tracking_number' }).select().single();
    if (pendingError) return res.status(422).json({ error: pendingError.message });
    return res.status(202).json({ message: 'Package received and queued pending customer mailbox matching.', pending_package: pending });
  }
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
