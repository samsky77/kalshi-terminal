-- Sigmaline 0002: edge log (append-only), feed cache, junk-row accounting, price timestamps,
-- Whop trial states, snapshot retention. Safe to run more than once. Apply after 0001_init.sql.

-- ── Price timestamps and fair-price source on the price board ──────────────────
alter table market_prices add column if not exists price_ts timestamptz;          -- best book's own last_update
alter table market_prices add column if not exists fair_source text not null default 'blend'; -- 'blend' | 'consensus'
create index if not exists market_prices_graded on market_prices (grade) where grade <> 'none';

-- ── Edge log: every edge the moment it is first shown in the feed ───────────────
-- One row per (event, market, selection, line, book) on first appearance (edge_key). The original
-- fields can never change; closing/CLV and result/units are filled exactly once, later.
create table if not exists edges_log (
  id uuid primary key default gen_random_uuid(),
  edge_key text not null unique,            -- event_id|market|selection|line|book (idempotency key)
  first_shown_at timestamptz not null default now(),
  sport text not null,
  league text,
  event_id text not null references events(id),
  event_name text not null,
  start_time timestamptz not null,
  market text not null,                     -- ml | spread | total | prop
  selection text not null,                  -- selection key
  selection_label text not null,
  line numeric,
  player text,
  stat text,
  book text not null,
  price_taken numeric not null,             -- decimal
  fair_price numeric not null,              -- decimal
  edge_pct numeric not null,
  grade text not null check (grade in ('A', 'B')),
  model_version text not null,
  fair_source text not null default 'blend',
  price_ts timestamptz,                     -- provider last_update of price_taken
  -- filled once after the start
  closing_price numeric,
  closing_p numeric,
  clv numeric,
  closing_at timestamptz,
  -- filled once after settlement
  result text check (result in ('win', 'loss', 'push', 'half_win', 'half_loss', 'void')),
  units numeric,
  settled_at timestamptz,
  check (first_shown_at < start_time)
);
create index if not exists edges_log_start on edges_log (start_time);
create index if not exists edges_log_open on edges_log (start_time) where result is null;

create table if not exists edge_price_updates (
  id bigserial primary key,
  edge_key text not null references edges_log(edge_key),
  seen_at timestamptz not null default now(),
  price numeric not null,
  fair_price numeric,
  edge_pct numeric,
  grade text,
  price_ts timestamptz
);
create index if not exists edge_price_updates_key on edge_price_updates (edge_key, seen_at);

-- The server clock stamps first_shown_at; nobody can backdate or pre-date a row.
create or replace function edges_log_stamp() returns trigger language plpgsql as $$
begin
  new.first_shown_at := now();
  new.closing_price := null; new.closing_p := null; new.clv := null; new.closing_at := null;
  new.result := null; new.units := null; new.settled_at := null;
  if new.start_time <= now() then
    raise exception 'edges_log: event has already started';
  end if;
  return new;
end $$;
drop trigger if exists edges_log_stamp on edges_log;
create trigger edges_log_stamp before insert on edges_log for each row execute function edges_log_stamp();

-- Original fields are immutable; settlement fields can be written once (null -> value), never changed.
create or replace function edges_log_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'edges_log is append-only: DELETE is not allowed'; end if;
  if (new.id, new.edge_key, new.first_shown_at, new.sport, new.league, new.event_id, new.event_name, new.start_time, new.market,
      new.selection, new.selection_label, new.line, new.player, new.stat, new.book, new.price_taken, new.fair_price, new.edge_pct,
      new.grade, new.model_version, new.fair_source, new.price_ts)
     is distinct from
     (old.id, old.edge_key, old.first_shown_at, old.sport, old.league, old.event_id, old.event_name, old.start_time, old.market,
      old.selection, old.selection_label, old.line, old.player, old.stat, old.book, old.price_taken, old.fair_price, old.edge_pct,
      old.grade, old.model_version, old.fair_source, old.price_ts) then
    raise exception 'edges_log: original fields cannot be changed';
  end if;
  if (old.closing_price is not null and new.closing_price is distinct from old.closing_price)
     or (old.closing_p is not null and new.closing_p is distinct from old.closing_p)
     or (old.clv is not null and new.clv is distinct from old.clv)
     or (old.closing_at is not null and new.closing_at is distinct from old.closing_at)
     or (old.result is not null and new.result is distinct from old.result)
     or (old.units is not null and new.units is distinct from old.units)
     or (old.settled_at is not null and new.settled_at is distinct from old.settled_at) then
    raise exception 'edges_log: closing and settlement fields can only be filled once';
  end if;
  if new.closing_at is not null and new.closing_at < old.start_time - interval '30 minutes' then
    raise exception 'edges_log: closing line must be taken at or near the start';
  end if;
  return new;
end $$;
drop trigger if exists edges_log_guard on edges_log;
create trigger edges_log_guard before update or delete on edges_log for each row execute function edges_log_guard();
drop trigger if exists edges_log_no_truncate on edges_log;
create trigger edges_log_no_truncate before truncate on edges_log for each statement execute function forbid_change();
drop trigger if exists edge_price_updates_no_change on edge_price_updates;
create trigger edge_price_updates_no_change before update or delete on edge_price_updates for each row execute function forbid_change();
drop trigger if exists edge_price_updates_no_truncate on edge_price_updates;
create trigger edge_price_updates_no_truncate before truncate on edge_price_updates for each statement execute function forbid_change();

-- ── Junk-row accounting and anomalies ──────────────────────────────────────────
create table if not exists data_anomalies (
  id bigserial primary key,
  detected_at timestamptz not null default now(),
  sport text not null,
  event_id text not null,
  market text not null,
  selection text not null,
  line numeric,
  book text,
  price numeric,
  fair_price numeric,
  edge_pct numeric,
  books int,
  price_ts timestamptz,
  reason text not null
);
create index if not exists data_anomalies_detected on data_anomalies (detected_at desc);

create table if not exists feed_filter_log (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  job text not null default 'tick',
  rows_in int not null,
  rows_kept int not null,
  counts jsonb not null                     -- {"no_price":n,"no_fair":n,"started":n,"duplicate":n,"suspended":n,"sanity":n,"stale":n}
);

-- ── Feed cache: what the app reads (one row per slate / edge list) ──────────────
create table if not exists feed_cache (
  key text primary key,                     -- 'slate:nba', 'edges'
  payload jsonb not null,
  built_at timestamptz not null default now()
);

-- ── Whop membership states (trial) ─────────────────────────────────────────────
alter table members add column if not exists membership_id text;
alter table members add column if not exists cancel_at_period_end boolean not null default false;
alter table members add column if not exists trial_ends_at timestamptz;
alter table members add column if not exists first_trial_at timestamptz;   -- set once; a second trial is not honoured
alter table members add column if not exists last_event_at timestamptz;    -- newest Whop event applied (older ones are ignored)
comment on column members.status is 'trialing | active | past_due | canceled | expired | trial_used | none';

-- ── Snapshot retention (keeps the database inside the free tier) ───────────────
-- Keeps every pre-game and closing snapshot (needed for picks, CLV and grading) and, for refresh
-- snapshots, only each event's first pull (the open, for line movement) and its latest pull.
-- Refresh snapshots of games that started more than a day ago are removed.
create or replace function prune_snapshots(max_rows int default 500000) returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int;
begin
  with doomed as (
    select s.id from odds_snapshots s join events e on e.id = s.event_id
    where s.kind = 'refresh' and e.commence_time < now() - interval '1 day' limit max_rows)
  delete from odds_snapshots where id in (select id from doomed);
  get diagnostics m = row_count; n := n + m;
  with k as (select event_id, min(pulled_at) first_p, max(pulled_at) last_p from odds_snapshots where kind = 'refresh' group by event_id),
  doomed as (select s.id from odds_snapshots s join k using (event_id)
    where s.kind = 'refresh' and s.pulled_at > k.first_p + interval '2 minutes' and s.pulled_at < k.last_p - interval '2 minutes' limit max_rows)
  delete from odds_snapshots where id in (select id from doomed);
  get diagnostics m = row_count; n := n + m;
  delete from feed_filter_log where run_at < now() - interval '30 days';
  return n;
end $$;

-- ── Row-level security and grants ──────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['edges_log','edge_price_updates','data_anomalies','feed_filter_log','feed_cache'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  -- The app/worker role may insert and read the edge log, and may only write the settle-once columns.
  if exists (select 1 from pg_roles where rolname = 'sigmaline_app') then
    revoke all on edges_log, edge_price_updates from sigmaline_app;
    grant select, insert on edges_log, edge_price_updates to sigmaline_app;
    grant update (closing_price, closing_p, clv, closing_at, result, units, settled_at) on edges_log to sigmaline_app;
    grant usage on sequence edge_price_updates_id_seq to sigmaline_app;
    grant select, insert, update on data_anomalies, feed_filter_log, feed_cache to sigmaline_app;
    grant delete on feed_filter_log to sigmaline_app;
    grant usage on sequence data_anomalies_id_seq, feed_filter_log_id_seq to sigmaline_app;
    grant execute on function prune_snapshots(int) to sigmaline_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on edges_log, edge_price_updates, data_anomalies, feed_filter_log, feed_cache from anon, authenticated;
  end if;
end $$;
