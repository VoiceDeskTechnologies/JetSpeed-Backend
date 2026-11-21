# Database

Run migrations in `supabase/migrations` with the Supabase CLI or SQL editor. The schema uses Supabase Auth UUIDs, PostgreSQL RLS, and separate operational tables for tracking, billing, delivery, notifications, audit history, and rates.

The service role key must remain server-side and must never be exposed to the frontend. RLS policies are the baseline authorization layer; production deployments should add role-specific policies and payment-provider webhook verification.

Migration `025_authorized_pickup.sql` adds owner/staff-protected authorized pickup records. Identification files are stored in the private `authorized-pickup-ids` bucket with a 10 MB limit; only the account owner and staff can read the records or files.

Migration `026_invoice_reminder_announcement.sql` allows the invoice reminder popup template while retaining the existing announcement audience and scheduling rules.
