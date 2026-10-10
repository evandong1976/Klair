# How Klair uses TigerData

TigerData is Klair's canonical database. It does work Klair couldn't do as well with plain local storage: a time-series of what's on screen, live rollups that power **Session insights**, automatic retention, ranked keyword search across sessions (and the fallback when Graphify is unavailable), and per-developer forks.

Every feature below is created by `migrate()` in `src/main/db.ts`, one step at a time. A feature the service lacks is skipped, logged, and reported on the Start window.

## 1. Canonical records

`sessions`, `captures`, `suggestion_sets`, `actions` and `notes` hold every session, screenshot reference, idea set, picked action and result, with provenance. Screenshot image files stay on the Mac; rows store their path.

**Save order:** PNG file → `captures` row (`status = 'pending'`) → `committed`. Only committed captures get notes and are indexed. On startup `reconcileLocal()` deletes orphan files and resolves half-written rows.

## 2. Activity time-series: `screen_activity` hypertable

Every capture tick is written here, changed or not, with app, window, URL, topic and how long the screen has been still.

```sql
create table if not exists screen_activity (
  time timestamptz not null,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint, app_name text, window_title text, url text, topic text,
  changed boolean not null default false,
  dwell_ms integer not null default 0
);
select create_hypertable('screen_activity', by_range('time'), if_not_exists => true);
```

`captures` stays a regular table because `actions` references it, and a hypertable needs the time column in every unique key. Writes are batched every 10 s and never block the overlay.

## 3. Session insights: `activity_by_minute` continuous aggregate

```sql
create materialized view if not exists activity_by_minute
with (timescaledb.continuous) as
select time_bucket('1 minute', time) as bucket, session_id,
       coalesce(topic, '') as topic, coalesce(app_name, '') as app_name,
       count(*) as ticks, sum(case when changed then 1 else 0 end) as changes,
       max(dwell_ms) as max_dwell_ms
from screen_activity
group by bucket, session_id, coalesce(topic, ''), coalesce(app_name, '')
with no data;

alter materialized view activity_by_minute set (timescaledb.materialized_only = false); -- real-time
select add_continuous_aggregate_policy('activity_by_minute',
  start_offset => interval '1 day', end_offset => interval '1 minute',
  schedule_interval => interval '1 minute', if_not_exists => true);
```

The Sessions window's **Session insights** card reads it:

```sql
-- where the time went (seconds = ticks × capture interval)
select topic, sum(ticks) as ticks, max(max_dwell_ms) as max_dwell
from activity_by_minute where session_id = $1 group by topic order by ticks desc limit 6;
```

"Stuck spots" join each idea set with the longest dwell before it:

```sql
select s.created_at, s.topic, s.suggestions,
       (select max(a.dwell_ms) from screen_activity a
         where a.session_id = s.session_id
           and a.time between s.created_at - interval '10 minutes' and s.created_at) as dwell
from suggestion_sets s where s.session_id = $1 order by s.created_at desc limit 5;
```

## 4. Retention

```sql
select add_retention_policy('screen_activity', drop_after => interval '14 days', if_not_exists => true);
```

`KLAIR_RETENTION_DAYS` sets the interval. A database policy can't delete files on the Mac, so `retentionSweep()` (on start, then hourly) deletes each expired session everywhere: rows (cascade), screenshots, notes, the Graphify index and cache entries. Deleting a session by hand does the same and also cancels queued Graphify work, so retries can't bring deleted context back.

## 5. Search over notes: BM25 via `pg_textsearch`

Observed notes (one per changed screen) and Klair's own answers (marked `provenance = 'assistant'`) go in `notes`.

```sql
create extension if not exists pg_textsearch;
create index if not exists notes_body_bm25 on notes using bm25(body) with (text_config='english');

select id, session_id, capture_id, provenance, topic, body, created_at
from notes
where ($2::bigint is null or capture_id is distinct from $2)
order by body <@> to_bm25query($1, 'notes_body_bm25')
limit 6;
```

If `pg_textsearch` isn't available, Klair uses Postgres full-text search instead (`to_tsvector` GIN index + `websearch_to_tsquery`); the Start window says which one is active. `retrieve.ts` merges these hits, across this and earlier sessions, with Graphify's graph context. When Graphify fails or hasn't indexed yet, TigerData search alone supplies "Earlier tab" context.

## 6. Forks for building and the demo

Each developer and Claude Code session works on its own fork, and the demo is rehearsed on a fork seeded with a realistic session:

```bash
tiger service fork <team-service-id> --now --name klair-<who>
tiger db uri <fork-id> --with-password   # → DATABASE_URL
```

## 7. Tiger MCP for builders

`tiger mcp install claude-code` lets Claude Code sessions inspect the schema and test the queries above while building.
