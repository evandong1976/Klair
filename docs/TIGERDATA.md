# How Klair uses TigerData

Klair keeps **projects** (all the context: screens, notes, ideas, answers, pages, files, activity) and **sessions** (only time: when the user worked, and in which projects). Everything is saved on the Mac first, in SQLite (`src/main/local.ts`), so capturing never waits on the network. After each session, `src/main/upload.ts` copies every project worked in to TigerData in full (replacing its earlier copy), so TigerData always holds a complete copy of each project. It does work Klair couldn't do as well with plain local storage: a time-series of what's on screen, live rollups that power **Session insights**, automatic retention, a ranked keyword-search index over every uploaded note, and per-developer forks.

Every feature below is created by `migrate()` in `src/main/db.ts`, one step at a time. A feature the service lacks is skipped, logged, and reported on the Start window.

## 1. Projects and their records, uploaded after each session

`projects` holds each project (name, `local_key`). `captures`, `suggestion_sets`, `actions` and `notes` hold every screenshot reference, idea set, picked action and result, with provenance; `pages` holds the full text of Chrome pages the extension sent, and `files` the extracted text of files the user added from Downloads. Every one of them has `project_id`. Screenshot images and added files stay on the Mac; rows store their path.

Sessions hold no data, so TigerData only records the time: `project_spans` has one row per stretch a project was active (`session_key`, the session's start and end, the span's start and end).

Columns added for the newer features (all additive): `captures.source` (`'auto'` or `'selection'`, an area the user selected), `captures.page_id` (the Chrome page a screenshot shows), `notes.file_id` (the added file a note is about), and `local_id` on every uploaded table.

**On the Mac** these rows (and `screen_activity`) are written to the same tables in SQLite, against the active project. Save order: PNG file → `captures` row (`status = 'pending'`) → `committed`. Only committed captures get notes and are indexed. On startup `reconcileLocal()` deletes orphan files and resolves half-written rows.

**After each session** `uploadProject()` copies every row of each project worked in, in one transaction: one `insert … select from jsonb_to_recordset($1)` per table, with local ids carried in `local_id` so foreign keys are remapped to TigerData ids. `projects.local_key` (unique) identifies the local project, so the upload replaces the earlier copy instead of duplicating it. On success the local project records `remote_id`; a failure is marked and retried on start, hourly and on **Check again**. Sessions left open by a quit or crash are ended on the next start, and their projects uploaded.

**Older databases** (from before projects, where `sessions` held the context) are migrated once by `migrate()`: the derived `activity_by_minute` aggregate is dropped, `sessions` is renamed to `projects` and every `session_id` to `project_id` (indexes too), and the aggregate is rebuilt on the new columns.

## 2. Activity time-series: `screen_activity` hypertable

Every capture tick is written here, changed or not, with app, window, URL, topic and how long the screen has been still.

```sql
create table if not exists screen_activity (
  time timestamptz not null,
  project_id bigint not null references projects(id) on delete cascade,
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
select time_bucket('1 minute', time) as bucket, project_id,
       coalesce(topic, '') as topic, coalesce(app_name, '') as app_name,
       count(*) as ticks, sum(case when changed then 1 else 0 end) as changes,
       max(dwell_ms) as max_dwell_ms
from screen_activity
group by bucket, project_id, coalesce(topic, ''), coalesce(app_name, '')
with no data;

alter materialized view activity_by_minute set (timescaledb.materialized_only = false); -- real-time
select add_continuous_aggregate_policy('activity_by_minute',
  start_offset => interval '1 day', end_offset => interval '1 minute',
  schedule_interval => interval '1 minute', if_not_exists => true);
```

Uploaded activity is older than the policy's refresh window, so each upload refreshes the aggregate for that project's time range. The Sessions window's **Session insights** card reads it once every project in the session is uploaded (otherwise it reads SQLite). A session is time, so the query takes its projects and its time range:

```sql
-- where the session's time went (seconds = ticks × capture interval)
select topic, sum(ticks) as ticks, max(max_dwell_ms) as max_dwell
from activity_by_minute
where project_id = any($1::bigint[])
  and bucket >= time_bucket('1 minute', $2::timestamptz) and bucket <= $3::timestamptz
group by topic order by ticks desc limit 6;
```

"Stuck spots" join each idea set with the longest dwell before it:

```sql
select s.created_at, s.topic, s.suggestions,
       (select max(a.dwell_ms) from screen_activity a
         where a.project_id = s.project_id
           and a.time between s.created_at - interval '10 minutes' and s.created_at) as dwell
from suggestion_sets s
where s.project_id = any($1::bigint[]) and s.created_at between $2 and $3
order by s.created_at desc limit 5;
```

## 4. Retention

```sql
select add_retention_policy('screen_activity', drop_after => interval '14 days', if_not_exists => true);
```

`KLAIR_RETENTION_DAYS` sets the interval. A database policy can't delete files on the Mac, so `retentionSweep()` (on start, then hourly) prunes context older than that from every project (rows, screenshots, added files, note files, cache entries) and drops old session time records; the projects themselves stay, their graphs are rebuilt, and their next upload replaces the TigerData copy. Deleting a project removes it everywhere (its TigerData copy cascades) and cancels queued Graphify work, so retries can't bring deleted context back. A delete made while TigerData is unreachable is queued and retried.

## 5. Search over notes: BM25 via `pg_textsearch`

Observed notes (one per changed screen) and Klair's own answers (marked `provenance = 'assistant'`) go in `notes`. Answers draw only on the active project, so the context for ideas and answers comes from SQLite FTS5 (BM25) on the Mac and that project's Graphify graph. The TigerData index below makes uploaded notes searchable across projects (`searchNotes()` in `db.ts`), for tooling and a future cross-project feature.

```sql
create extension if not exists pg_textsearch;
create index if not exists notes_body_bm25 on notes using bm25(body) with (text_config='english');

select id, project_id, capture_id, provenance, topic, body, created_at
from notes
order by body <@> to_bm25query($1, 'notes_body_bm25')
limit 4;
```

If `pg_textsearch` isn't available, Klair uses Postgres full-text search instead (`to_tsvector` GIN index + `websearch_to_tsquery`); the Start window says which one is active.

## 6. Forks for building and the demo

Each developer and Claude Code session works on its own fork, and the demo is rehearsed on a fork seeded with a realistic session:

```bash
tiger service fork <team-service-id> --now --name klair-<who>
tiger db uri <fork-id> --with-password   # → DATABASE_URL
```

## 7. Tiger MCP for builders

`tiger mcp install claude-code` lets Claude Code sessions inspect the schema and test the queries above while building.
