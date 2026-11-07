import { RequestHandler } from 'express';
import { env } from '../config/env';

const hits = new Map<string, { count: number; reset: number }>();
export const rateLimiter: RequestHandler = (req, res, next) => {
  const key = req.ip ?? 'unknown';
  const current = hits.get(key);
  const now = Date.now();
  if (!current || current.reset <= now) hits.set(key, { count: 1, reset: now + env.rateLimitWindowMs });
  else current.count += 1;
  const updated = hits.get(key)!;
  res.setHeader('X-RateLimit-Limit', env.rateLimitMax);
  if (updated.count > env.rateLimitMax) return res.status(429).json({ error: 'Too many requests' });
  next();
};
