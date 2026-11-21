import { Router } from 'express';
import { isSupabaseConfigured } from '../config/env';
export const healthRouter = Router();
healthRouter.get('/', (_req, res) => res.json({ status: 'ok', service: 'global-xend-ja-api', supabase: isSupabaseConfigured }));
