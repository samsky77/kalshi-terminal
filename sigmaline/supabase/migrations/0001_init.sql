-- Sigmaline schema (spec §13). Apply with `supabase db push` or paste into the SQL editor.
-- All tables have row-level security ON with no policies: the anon/authenticated roles can read
-- nothing. Every read goes through the Next.js server (service role) after a membership check.

create extension if not exists pgcrypto;

-- ── Reference data ──────────────────────────────────────────────────────────
create table if not exists sports (
  id text primary key,
  label text not null
);

create table if not exists leagues (
  id text primary key,
  sport_id text not null references sports(id),
  label text not null
);

create table if not exists teams (
  id bigserial primary key,
  sport_id text not null references sports(id),
  name text not null,
  short_name text,
  unique (sport_id, name)
);

create table if not exists players (
  id bigserial primary key,
  sport_id text not null references sports(id),
  team text,
  name text not null,
  unique (sport_id, name)
);

-- ── Events and prices ───────────────────────────────────────────────────────
create table if not exists events (
  id text primary key,                      -- sigmaline id: sha of sport/league/date/teams
  sport_id text not null references sports(id),
  league_id text not null references leagues(id),
  home text not null,
  away text not null,
  commence_time timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'final', 'void', 'postponed')),
  home_score int,
  away_score int,
  winner smallint,                          -- 1 home, -1 away, 0 draw
  final_at timestamptz,
  provider_ids jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,  -- tennis tour/best-of, neutral site, rest days
  source text not null default 'live' check (source in ('live', 'history')),
  updated_at timestamptz not null default now()
);
create index if not exists events_commence on events (commence_time);
create index if not exists events_sport_status on events (sport_id, status, commence_time);

create table if not exists odds_snapshots (
  id bigserial primary key,
  event_id text not null references events(id),
  provider text not null,
  book text not null,
  market text not null check (market in ('ml', 'spread', 'total', 'prop')),
  line numeric,
  player text,
  stat text,
  prices jsonb not null,                    -- decimal price per side {"home":1.91,"away":1.95}
  ts timestamptz not null,                  -- book's own last-update time
  kind text not null check (kind in ('pregame', 'closing', 'refresh', 'history')),
  pulled_at timestamptz not null default now()
);
create index if not exists odds_snapshots_event on odds_snapshots (event_id, pulled_at);

create table if not exists consensus_lines (
  id bigserial primary key,
  event_id text not null references events(id),
  market text not null,
  line numeric,
  player text,
  stat text,
  probs jsonb not null,                     -- no-vig consensus per side
  books int not null,
  kind text not null,
  ts timestamptz not null default now()
);
create index if not exists consensus_lines_event on consensus_lines (event_id, ts);

create table if not exists model_versions (
  id text primary key,                      -- e.g. "nba-2026-11-17-1"
  sport_id text not null references sports(id),
  created_at timestamptz not null default now(),
  params jsonb not null,                    -- blend weights, half-life, thresholds
  parent text references model_versions(id),
  notes text
);

create table if not exists sim_runs (
  id bigserial primary key,
  event_id text not null references events(id),
  model_version text not null references model_versions(id),
  seed bigint not null,
  n_sims int not null check (n_sims >= 10000),
  inputs jsonb not null,
  summary jsonb not null,                   -- margin/total pmfs, win probabilities
  histogram jsonb,
  snapshot_ts timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sim_runs_event on sim_runs (event_id, created_at desc);

-- Latest price per selection (overwritten each simulation; history lives in sim_runs).
create table if not exists market_prices (
  event_id text not null references events(id),
  selection_key text not null,
  sim_run_id bigint not null references sim_runs(id),
  market text not null,
  selection jsonb not null,
  line numeric,
  fair_decimal numeric,
  fair_probs jsonb not null,
  model_probs jsonb not null,
  consensus_p numeric,
  best_decimal numeric,
  best_book text,
  books int not null,
  ev numeric,
  model_ev numeric,
  consensus_ev numeric,
  grade text not null check (grade in ('A', 'B', 'none')),
  snapshot_ts timestamptz,
  updated_at timestamptz not null default now(),
  primary key (event_id, selection_key)
);

-- ── The track record (append-only) ─────────────────────────────────────────
create table if not exists picks (
  id uuid primary key,
  seq bigint not null unique,
  created_at timestamptz not null,
  sport text not null,
  league text not null,
  event_id text not null references events(id),
  event_name text not null,
  commence_time timestamptz not null,
  market text not null,
  selection text not null,                  -- selection key
  label text not null,
  line numeric,
  book text not null,
  price_decimal numeric not null,
  fair_decimal numeric not null,
  ev numeric not null,
  grade text not null check (grade in ('A', 'B')),
  model_version text not null references model_versions(id),
  stake_units numeric not null,
  snapshot_ts timestamptz not null,
  writeup jsonb,
  prev_hash text not null,
  hash text not null unique,
  check (created_at < commence_time)        -- logged before the game starts, always
);
create index if not exists picks_commence on picks (commence_time);
create unique index if not exists picks_one_per_selection on picks (event_id, selection);

create table if not exists closing_lines (
  event_id text not null references events(id),
  selection_key text not null,
  closing_decimal numeric,                  -- best bettable price at close
  closing_p numeric,                        -- no-vig consensus, no-push scale
  push_p numeric not null default 0,
  books int not null,
  ts timestamptz not null,
  primary key (event_id, selection_key)
);

create table if not exists pick_results (
  pick_id uuid primary key references picks(id),
  result text not null check (result in ('win', 'loss', 'push', 'half_win', 'half_loss', 'void')),
  profit_units numeric not null,
  final_home int,
  final_away int,
  closing_decimal numeric,
  closing_p numeric,
  clv numeric,
  graded_at timestamptz not null default now()
);

-- Picks and their results can never be edited or deleted.
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'table % is append-only: % is not allowed', tg_table_name, tg_op;
end $$;

drop trigger if exists picks_no_update on picks;
create trigger picks_no_update before update or delete on picks for each row execute function forbid_change();
drop trigger if exists picks_no_truncate on picks;
create trigger picks_no_truncate before truncate on picks for each statement execute function forbid_change();
drop trigger if exists pick_results_no_update on pick_results;
create trigger pick_results_no_update before update or delete on pick_results for each row execute function forbid_change();
drop trigger if exists pick_results_no_truncate on pick_results;
create trigger pick_results_no_truncate before truncate on pick_results for each statement execute function forbid_change();

-- Append one pick, enforcing the chain: seq = last + 1 and prev_hash = last hash.
create or replace function append_pick(p jsonb) returns picks language plpgsql security definer set search_path = public as $$
declare
  last_seq bigint;
  last_hash text;
  row picks;
begin
  perform pg_advisory_xact_lock(4242);
  select seq, hash into last_seq, last_hash from picks order by seq desc limit 1;
  if last_seq is null then last_seq := 0; last_hash := repeat('0', 64); end if;
  if (p->>'seq')::bigint <> last_seq + 1 then
    raise exception 'chain: expected seq %, got %', last_seq + 1, p->>'seq';
  end if;
  if p->>'prev_hash' <> last_hash then
    raise exception 'chain: prev_hash mismatch';
  end if;
  if (p->>'created_at')::timestamptz > now() + interval '2 minutes' then
    raise exception 'chain: created_at in the future';
  end if;
  if (p->>'commence_time')::timestamptz <= now() then
    raise exception 'chain: game has already started';
  end if;
  insert into picks select * from jsonb_populate_record(null::picks, p) returning * into row;
  return row;
end $$;

-- ── Models, calibration, backtests ─────────────────────────────────────────
create table if not exists calibration_reports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('live', 'backtest')),
  sport text not null,
  market text not null,
  window_days int not null,
  n int not null,
  brier numeric,
  log_loss numeric,
  buckets jsonb,
  avg_clv numeric,
  roi numeric,
  model_version text
);

create table if not exists model_changes (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  sport text not null,
  param text not null,
  old_value numeric,
  new_value numeric,
  holdout_before numeric,
  holdout_after numeric,
  n int,
  model_version text references model_versions(id)
);

create table if not exists backtest_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  label text not null default 'Backtest (simulated)',
  sport text not null,
  kind text not null check (kind in ('accuracy', 'price')),
  from_date date,
  to_date date,
  games int not null,
  games_with_odds int not null default 0,
  metrics jsonb not null,
  curve jsonb,
  source text not null
);

-- ── Budget, members, alerts, settings, jobs ────────────────────────────────
create table if not exists provider_usage (
  provider text not null,
  day date not null,
  used int not null default 0,
  last_remaining int,
  updated_at timestamptz not null default now(),
  primary key (provider, day)
);

create table if not exists members (
  whop_user_id text primary key,
  email text,
  username text,
  status text not null default 'none',      -- active | canceled | expired | none
  expires_at timestamptz,
  checked_at timestamptz,
  push_enabled boolean not null default false,
  quiet_start text,                         -- "22:00"
  quiet_end text,                           -- "08:00"
  time_zone text not null default 'America/New_York',
  age_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id bigserial primary key,
  whop_user_id text not null references members(whop_user_id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists alert_log (
  id bigserial primary key,
  pick_id uuid not null references picks(id),
  channel text not null check (channel in ('push', 'discord')),
  target text not null,
  status text not null,
  sent_at timestamptz not null default now(),
  unique (pick_id, channel, target)          -- at most one alert per pick per destination
);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists job_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  detail jsonb
);
create index if not exists job_runs_job on job_runs (job, started_at desc);

create table if not exists webhook_events (
  id text primary key,                      -- webhook-id header (idempotency)
  type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists injuries (
  sport text not null,
  player text not null,
  team text,
  status text not null,
  updated_at timestamptz not null default now(),
  primary key (sport, player)
);

create table if not exists player_logs (
  sport text not null,
  player text not null,
  stat text not null,
  game_date date not null,
  value numeric not null,
  minutes numeric,
  primary key (sport, player, stat, game_date)
);

-- ── Row-level security: deny everything to client roles ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['sports','leagues','teams','players','events','odds_snapshots','consensus_lines','model_versions',
    'sim_runs','market_prices','picks','closing_lines','pick_results','calibration_reports','model_changes','backtest_runs',
    'provider_usage','members','push_subscriptions','alert_log','settings','job_runs','webhook_events','injuries','player_logs']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ── Seed ────────────────────────────────────────────────────────────────────
insert into sports (id, label) values
  ('nba', 'NBA'), ('nhl', 'NHL'), ('nfl', 'NFL'), ('cbb', 'College Basketball'), ('cfb', 'College Football'),
  ('soccer', 'Soccer'), ('tennis', 'Tennis')
on conflict do nothing;

insert into leagues (id, sport_id, label) values
  ('nba', 'nba', 'NBA'), ('nhl', 'nhl', 'NHL'), ('nfl', 'nfl', 'NFL'), ('ncaab', 'cbb', 'NCAAB'), ('ncaaf', 'cfb', 'NCAAF'),
  ('epl', 'soccer', 'EPL'), ('laliga', 'soccer', 'La Liga'), ('seriea', 'soccer', 'Serie A'), ('bundesliga', 'soccer', 'Bundesliga'),
  ('ligue1', 'soccer', 'Ligue 1'), ('mls', 'soccer', 'MLS'), ('ucl', 'soccer', 'Champions League'), ('tennis', 'tennis', 'ATP/WTA')
on conflict do nothing;

insert into settings (key, value) values
  ('thresholds', '{"a": 0.05, "b": 0.02}'),
  ('alert_ev', '0.04'),
  ('publish_min_grade', '"B"'),
  ('bettable_books', '["draftkings","fanduel","betmgm","williamhill_us","betrivers","espnbet","fanatics","hardrockbet","ballybet","betparx","fliff"]'),
  ('quotas', '{"oddsapi": {"period": "month", "limit": 500}, "propline": {"period": "day", "limit": 1000}, "sharpapi": {"period": "day", "limit": 5000}}'),
  ('refresh_hours', '6')
on conflict do nothing;
