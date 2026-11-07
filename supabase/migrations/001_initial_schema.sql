create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, role text not null default 'customer' check (role in ('customer','driver','admin')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(), customer_id uuid references auth.users(id), tracking_number text unique not null,
  origin text not null, destination text not null, status text not null default 'label_created',
  weight_kg numeric, service_level text, estimated_delivery date, created_at timestamptz not null default now()
);
create table if not exists public.tracking_events (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references public.packages(id) on delete cascade,
  status text not null, location text, description text, occurred_at timestamptz not null default now()
);
create table if not exists public.prealerts (
  id uuid primary key default gen_random_uuid(), customer_id uuid references auth.users(id), tracking_number text not null,
  carrier text, description text, status text not null default 'received', created_at timestamptz not null default now()
);
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), customer_id uuid references auth.users(id), invoice_number text unique not null,
  amount numeric(12,2) not null, currency text not null default 'USD', status text not null default 'open',
  due_date date, created_at timestamptz not null default now()
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid references public.invoices(id), customer_id uuid references auth.users(id),
  amount numeric(12,2) not null, provider text, provider_reference text, status text not null default 'pending', created_at timestamptz not null default now()
);
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(), package_id uuid references public.packages(id), driver_id uuid references auth.users(id),
  status text not null default 'assigned', scheduled_at timestamptz, delivered_at timestamptz, proof_url text, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  type text not null, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), action text not null,
  entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(), name text not null, origin_zone text, destination_zone text,
  service_level text not null, price numeric(12,2) not null, currency text not null default 'USD', active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.packages enable row level security;
alter table public.tracking_events enable row level security;
alter table public.prealerts enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.deliveries enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.shipping_rates enable row level security;

create policy "users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "customers read own packages" on public.packages for select using (auth.uid() = customer_id);
create policy "public tracking lookup" on public.packages for select using (true);
create policy "customers read package events" on public.tracking_events for select using (exists (select 1 from public.packages p where p.id = package_id and p.customer_id = auth.uid()));
create policy "customers manage prealerts" on public.prealerts for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);
create policy "customers read invoices" on public.invoices for select using (auth.uid() = customer_id);
create policy "customers read payments" on public.payments for select using (auth.uid() = customer_id);
create policy "customers read deliveries" on public.deliveries for select using (exists (select 1 from public.packages p where p.id = package_id and p.customer_id = auth.uid()));
create policy "users read notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "users update notifications" on public.notifications for update using (auth.uid() = user_id);
create policy "admins read audit logs" on public.audit_logs for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "anyone read active shipping rates" on public.shipping_rates for select using (active = true);
