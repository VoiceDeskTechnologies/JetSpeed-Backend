import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { registerForwarderAccount } from '../services/freightForwarder.service';

export const freightAccountRouter = Router();

freightAccountRouter.post('/register', requireAuth, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
      return res.status(503).json({ error: 'Supabase service access is not configured.' });
    }
    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: profile, error } = await client.from('profiles').select('full_name,email,phone,identifier_code,pickup_location').eq('id', req.user!.id).single();
    if (error || !profile?.email || !profile.identifier_code) {
      return res.status(422).json({ error: 'Your JetSpeed profile is missing an email or mailbox identifier.' });
    }
    const names = String(profile.full_name || 'JetSpeed Customer').trim().split(/\s+/);
    const result = await registerForwarderAccount({
      first_name: names[0],
      last_name: names.slice(1).join(' ') || names[0],
      email: profile.email,
      mailboxNumber: profile.identifier_code,
      pickupLocation: profile.pickup_location || 'Top Hill, St Elizabeth',
    });
    return res.status(200).json({ data: result });
  } catch (error) {
    return next(error);
  }
});
