import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireStaff } from '../middleware/auth';

const router = Router();
const adminClient = isSupabaseConfigured && env.supabaseServiceRoleKey
  ? createClient(env.supabaseUrl!, env.supabaseServiceRoleKey)
  : undefined;

router.get('/public', async (_req, res, next) => {
  try {
    if (!adminClient) return res.json({ data: [] });
    const now = new Date().toISOString();
    const { data, error } = await adminClient.from('announcements').select('id,title,body,category,template,status,audience,starts_at,ends_at,priority,cta_label,cta_url,animation,countdown,image_url,created_at,updated_at')
      .eq('status', 'active').in('audience', ['all', 'customer'])
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('priority', { ascending: false }).order('starts_at', { ascending: false });
    if (error) return next(error);
    res.json({ data: data ?? [] });
  } catch (error) { next(error); }
});

router.use(requireStaff);
router.get('/', async (_req, res, next) => {
  try {
    if (!adminClient) return res.json({ data: [] });
    const result = await adminClient.from('announcements').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false });
    if (result.error) return next(result.error);
    res.json({ data: result.data ?? [] });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    if (!adminClient) return res.status(503).json({ error: 'Announcements are not configured.' });
    const result = await adminClient.from('announcements').insert({ ...req.body, created_by: req.user?.id }).select().single();
    if (result.error) return next(result.error);
    res.status(201).json({ data: result.data });
  } catch (error) { next(error); }
});
router.patch('/:id', async (req, res, next) => {
  try {
    if (!adminClient) return res.status(503).json({ error: 'Announcements are not configured.' });
    const result = await adminClient.from('announcements').update(req.body).eq('id', req.params.id).select().single();
    if (result.error) return next(result.error);
    res.json({ data: result.data });
  } catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    if (!adminClient) return res.status(503).json({ error: 'Announcements are not configured.' });
    const result = await adminClient.from('announcements').delete().eq('id', req.params.id);
    if (result.error) return next(result.error);
    res.status(204).send();
  } catch (error) { next(error); }
});
export const announcementsRouter = router;
