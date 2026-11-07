import 'dotenv/config';

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: number(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  rateLimitWindowMs: number(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: number(process.env.RATE_LIMIT_MAX, 100),
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && (env.supabaseServiceRoleKey || env.supabaseAnonKey));
