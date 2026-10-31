-- Thinkora plugin marketplace schema
-- Run this in Supabase SQL Editor. Keep Row Level Security enabled.
create extension if not exists pgcrypto;

create table if not exists public.plugins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  version text not null default '1.0.0',
  category text not null default 'Utilities',
  manifest jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create table if not exists public.plugin_installs (
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin_id uuid not null references public.plugins(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, plugin_id)
);

alter table public.plugins enable row level security;
alter table public.plugin_installs enable row level security;

drop policy if exists "Anyone can read approved plugins" on public.plugins;
create policy "Anyone can read approved plugins"
  on public.plugins for select using (status = 'approved' or owner_id = auth.uid());

drop policy if exists "Users can submit own plugins" on public.plugins;
create policy "Users can submit own plugins"
  on public.plugins for insert with check (owner_id = auth.uid() and status = 'pending');

drop policy if exists "Users can view own installs" on public.plugin_installs;
create policy "Users can view own installs"
  on public.plugin_installs for select using (user_id = auth.uid());

drop policy if exists "Users can install approved plugins" on public.plugin_installs;
create policy "Users can install approved plugins"
  on public.plugin_installs for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.plugins p where p.id = plugin_id and p.status = 'approved'
  ));

drop policy if exists "Users can uninstall own plugins" on public.plugin_installs;
create policy "Users can uninstall own plugins"
  on public.plugin_installs for delete using (user_id = auth.uid());
