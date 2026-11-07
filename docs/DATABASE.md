# Database

Run migrations in `supabase/migrations` with the Supabase CLI or SQL editor. The schema uses Supabase Auth UUIDs, PostgreSQL RLS, and separate operational tables for tracking, billing, delivery, notifications, audit history, and rates.

The service role key must remain server-side and must never be exposed to the frontend. RLS policies are the baseline authorization layer; production deployments should add role-specific policies and payment-provider webhook verification.
