import { createClient } from '@supabase/supabase-js';
import { RequestHandler } from 'express';
import { env, isSupabaseConfigured } from '../config/env';

declare global {
  namespace Express {
    interface Request { user?: { id: string; email?: string }; }
  }
}

const supabase = isSupabaseConfigured
  ? createClient(env.supabaseUrl!, env.supabaseServiceRoleKey ?? env.supabaseAnonKey!)
  : undefined;

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (token && supabase) {
    const { data } = await supabase.auth.getUser(token);
    if (data.user) req.user = { id: data.user.id, email: data.user.email };
  }
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!isSupabaseConfigured) return next();
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isSupabaseConfigured) return next();
  if (!req.user?.email || !env.adminEmails.includes(req.user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
};

export const requireStaff: RequestHandler = async (req, res, next) => {
  if (!isSupabaseConfigured) return next();
  if (!req.user) return res.status(403).json({ error: 'Staff access required' });
  if (env.adminEmails.includes((req.user.email ?? '').toLowerCase())) return next();
  const { data: profile } = supabase ? await supabase.from('profiles').select('role').eq('id', req.user.id).maybeSingle() : { data: null };
  if (profile?.role !== 'support' && profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};
