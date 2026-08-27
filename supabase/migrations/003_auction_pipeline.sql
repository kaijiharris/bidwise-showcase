-- Mobile auction pipeline — replaces the web dashboard's localStorage `bw_pipeline`
-- with a cross-device Supabase-backed table. Web continues to use localStorage
-- for now; this is consumed by the mobile app and can be adopted by web later.

create table if not exists public.auction_pipeline (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  county text not null,
  parcel_id text not null,
  address text not null,
  city text,
  zip text,
  auction_date date,
  roi numeric,
  deal_score numeric,
  status text not null default 'watchlist'
    check (status in ('watchlist', 'diligence', 'bidding', 'pass')),
  notes text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, parcel_id)
);

create index if not exists auction_pipeline_user_status_idx
  on public.auction_pipeline (user_id, status);

create index if not exists auction_pipeline_user_added_idx
  on public.auction_pipeline (user_id, added_at desc);

-- Keep updated_at fresh on UPDATE.
create or replace function public.touch_auction_pipeline_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_auction_pipeline_touch_updated_at on public.auction_pipeline;
create trigger trg_auction_pipeline_touch_updated_at
  before update on public.auction_pipeline
  for each row execute function public.touch_auction_pipeline_updated_at();

-- RLS — users may only see/mutate their own rows.
alter table public.auction_pipeline enable row level security;

drop policy if exists "auction_pipeline_select_own"  on public.auction_pipeline;
drop policy if exists "auction_pipeline_insert_own"  on public.auction_pipeline;
drop policy if exists "auction_pipeline_update_own"  on public.auction_pipeline;
drop policy if exists "auction_pipeline_delete_own"  on public.auction_pipeline;

create policy "auction_pipeline_select_own" on public.auction_pipeline
  for select using (auth.uid() = user_id);

create policy "auction_pipeline_insert_own" on public.auction_pipeline
  for insert with check (auth.uid() = user_id);

create policy "auction_pipeline_update_own" on public.auction_pipeline
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "auction_pipeline_delete_own" on public.auction_pipeline
  for delete using (auth.uid() = user_id);
