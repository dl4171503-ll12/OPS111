-- 在 Supabase SQL Editor 执行一次
-- AI一人学校：账号档案表（绑定 auth.users）

create table if not exists public.school_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  email text,
  display_name text not null default '',
  avatar text not null default '',
  grade_year int not null default 2,
  edition_prefs jsonb not null default '{"chinese":"TongBian","math":"RJ","english":"PEP"}'::jsonb,
  school_id text,
  iqe_result jsonb,
  profile_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists school_accounts_phone_idx on public.school_accounts (phone);
create index if not exists school_accounts_email_idx on public.school_accounts (email);

alter table public.school_accounts enable row level security;

drop policy if exists "school_accounts_select_own" on public.school_accounts;
create policy "school_accounts_select_own"
  on public.school_accounts for select
  using (auth.uid() = id);

drop policy if exists "school_accounts_insert_own" on public.school_accounts;
create policy "school_accounts_insert_own"
  on public.school_accounts for insert
  with check (auth.uid() = id);

drop policy if exists "school_accounts_update_own" on public.school_accounts;
create policy "school_accounts_update_own"
  on public.school_accounts for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
