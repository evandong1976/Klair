import { Pool, type PoolClient } from 'pg'
import { config } from './config'
import type { HealthReport, InsightRow, StuckSpot } from '../shared/types'
import type { NoteHit } from './local'

// TigerData (Postgres + TimescaleDB) is where ended sessions are kept. A running
// session writes to SQLite on the Mac (local.ts); upload.ts copies it here when it
// ends. From here come search over earlier sessions, the activity_by_minute
// continuous aggregate for insights, and retention.
// Screenshot image files stay on the Mac; rows store their paths.
// Every schema change is additive: teammates may already have these tables.

let pool: Pool | null = null

export function getPool(): Pool | null {
  if (!config.databaseUrl) return null
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 8000 })
    pool.on('error', (err) => console.error('pg pool error:', err.message))
  }
  return pool
}

export function requirePool(): Pool {
  const p = getPool()
  if (!p) throw new Error('DATABASE_URL is not set')
  return p
}

export const capabilities: HealthReport['capabilities'] = {
  timescale: false,
  textsearch: 'none',
  continuousAggregate: false,
  retentionPolicy: false
}

const baseSchema = `
create table if not exists sessions (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists captures (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  screenshot_path text not null,
  note text
);
create index if not exists captures_session_idx on captures (session_id, captured_at);
create table if not exists actions (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  created_at timestamptz not null default now(),
  prompt text not null,
  result text
);
create index if not exists actions_session_idx on actions (session_id, created_at);

alter table sessions add column if not exists name text not null default 'Session';
alter table sessions add column if not exists status text not null default 'active';

alter table captures add column if not exists app_name text;
alter table captures add column if not exists window_title text;
alter table captures add column if not exists url text;
alter table captures add column if not exists image_hash text;
alter table captures add column if not exists status text not null default 'pending';
alter table captures add column if not exists index_status text not null default 'pending';
alter table captures add column if not exists note_path text;

create table if not exists suggestion_sets (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  generation_id integer not null,
  created_at timestamptz not null default now(),
  status text not null default 'shown',
  topic text,
  suggestions jsonb not null
);
create index if not exists suggestion_sets_session_idx on suggestion_sets (session_id, created_at);

alter table actions add column if not exists kind text;
alter table actions add column if not exists status text not null default 'pending';
alter table actions add column if not exists suggestion_set_id bigint references suggestion_sets(id) on delete set null;
alter table actions add column if not exists blocks jsonb;
alter table actions add column if not exists sources jsonb;
alter table actions add column if not exists tokens_in integer;
alter table actions add column if not exists tokens_out integer;
alter table actions add column if not exists completed_at timestamptz;

create table if not exists notes (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  action_id bigint references actions(id) on delete set null,
  provenance text not null check (provenance in ('observed', 'assistant')),
  topic text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_session_idx on notes (session_id, created_at);
create index if not exists notes_body_fts on notes using gin (to_tsvector('english', body));

create table if not exists screen_activity (
  time timestamptz not null,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint,
  app_name text,
  window_title text,
  url text,
  topic text,
  changed boolean not null default false,
  dwell_ms integer not null default 0
);
create index if not exists screen_activity_session_idx on screen_activity (session_id, time desc);

-- Uploads from the Mac's SQLite store. local_key identifies the local session, so a
-- retried upload replaces the earlier copy instead of duplicating it; local_id maps
-- each row back to its local row (and lets the upload remap ids in one round trip).
alter table sessions add column if not exists local_key text;
create unique index if not exists sessions_local_key_idx on sessions (local_key);
alter table captures add column if not exists local_id bigint;
alter table suggestion_sets add column if not exists local_id bigint;
alter table actions add column if not exists local_id bigint;
alter table notes add column if not exists local_id bigint;

-- Full pages from the Chrome extension, and the page each screenshot shows.
create table if not exists pages (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  url text not null,
  title text,
  description text,
  body text not null,
  text_hash text,
  truncated boolean not null default false,
  note_path text,
  index_status text not null default 'pending',
  local_id bigint
);
create index if not exists pages_session_idx on pages (session_id, captured_at);
alter table captures add column if not exists page_id bigint references pages(id) on delete set null;
-- 'auto' (capture loop) or 'selection' (an area the user selected).
alter table captures add column if not exists source text not null default 'auto';

-- Files the user added from Downloads: metadata and extracted text (the file stays on the Mac).
create table if not exists files (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  added_at timestamptz not null default now(),
  name text not null,
  kind text not null,
  size bigint not null,
  original_path text,
  stored_path text,
  sha1 text,
  body text not null default '',
  extract_status text not null,
  truncated boolean not null default false,
  note_path text,
  index_status text not null default 'pending',
  local_id bigint
);
create index if not exists files_session_idx on files (session_id, added_at);
alter table notes add column if not exists file_id bigint references files(id) on delete set null;
`

async function tryStep(client: PoolClient, label: string, sql: string): Promise<boolean> {
  try {
    await client.query(sql)
    return true
  } catch (err) {
    console.warn(`tigerdata: ${label} unavailable: ${(err as Error).message}`)
    return false
  }
}

/** Create or extend the schema, then enable TimescaleDB / search features one by one. */
export async function migrate(): Promise<HealthReport['capabilities']> {
  const client = await requirePool().connect()
  try {
    await client.query(baseSchema)

    capabilities.timescale =
      (await tryStep(client, 'timescaledb', 'create extension if not exists timescaledb')) &&
      ((await tryStep(
        client,
        'hypertable',
        `select create_hypertable('screen_activity', by_range('time'), if_not_exists => true)`
      )) ||
        (await tryStep(
          client,
          'hypertable (legacy)',
          `select create_hypertable('screen_activity', 'time', if_not_exists => true)`
        )))

    if (capabilities.timescale) {
      capabilities.continuousAggregate =
        (await tryStep(
          client,
          'continuous aggregate',
          `create materialized view if not exists activity_by_minute
           with (timescaledb.continuous) as
           select time_bucket('1 minute', time) as bucket,
                  session_id,
                  coalesce(topic, '') as topic,
                  coalesce(app_name, '') as app_name,
                  count(*) as ticks,
                  sum(case when changed then 1 else 0 end) as changes,
                  max(dwell_ms) as max_dwell_ms
           from screen_activity
           group by bucket, session_id, coalesce(topic, ''), coalesce(app_name, '')
           with no data`
        )) &&
        (await tryStep(
          client,
          'real-time aggregate',
          `alter materialized view activity_by_minute set (timescaledb.materialized_only = false)`
        ))
      if (capabilities.continuousAggregate) {
        await tryStep(
          client,
          'aggregate policy',
          `select add_continuous_aggregate_policy('activity_by_minute',
             start_offset => interval '1 day', end_offset => interval '1 minute',
             schedule_interval => interval '1 minute', if_not_exists => true)`
        )
      }
      capabilities.retentionPolicy = await tryStep(
        client,
        'retention policy',
        `select add_retention_policy('screen_activity',
           drop_after => interval '${Math.round(config.retentionDays)} days', if_not_exists => true)`
      )
    }

    const bm25 =
      (await tryStep(client, 'pg_textsearch', 'create extension if not exists pg_textsearch')) &&
      (await tryStep(
        client,
        'bm25 index',
        `create index if not exists notes_body_bm25 on notes using bm25(body) with (text_config='english')`
      ))
    capabilities.textsearch = bm25 ? 'bm25' : 'fts'
    return { ...capabilities }
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------- sessions (by TigerData id)

export async function deleteSessionRows(id: number): Promise<void> {
  await requirePool().query(`delete from sessions where id = $1`, [id])
  if (capabilities.continuousAggregate) {
    // Best effort: re-materialize so the aggregate forgets the deleted session now.
    await requirePool()
      .query(`call refresh_continuous_aggregate('activity_by_minute', null, null)`)
      .catch(() => undefined)
  }
}

export async function expiredSessionIds(days: number): Promise<number[]> {
  const { rows } = await requirePool().query(
    `select id from sessions where started_at < now() - make_interval(days => $1) and status = 'ended'`,
    [Math.round(days)]
  )
  return rows.map((r) => Number(r.id))
}

// ---------------------------------------------------------------- search

/**
 * Keyword search over uploaded notes, i.e. earlier sessions (BM25 via pg_textsearch
 * when available, else Postgres FTS). The running session is searched locally.
 */
export async function searchNotes(
  query: string,
  opts: { limit?: number } = {}
): Promise<NoteHit[]> {
  const q = query.trim()
  if (!q) return []
  const limit = opts.limit ?? 6
  const p = requirePool()
  const cols = `n.id, n.session_id, n.capture_id, n.provenance, n.topic, n.body, n.created_at, f.name as file_name`
  const from = `notes n left join files f on f.id = n.file_id`
  let rows: Record<string, unknown>[] = []
  if (capabilities.textsearch === 'bm25') {
    try {
      const res = await p.query(
        `select ${cols} from ${from}
         order by n.body <@> to_bm25query($1, 'notes_body_bm25') limit $2`,
        [q, limit]
      )
      rows = res.rows
    } catch (err) {
      console.warn('bm25 search failed, using FTS:', (err as Error).message)
    }
  }
  if (rows.length === 0) {
    const res = await p.query(
      `select ${cols} from ${from}
       where to_tsvector('english', n.body) @@ websearch_to_tsquery('english', $1)
       order by ts_rank(to_tsvector('english', n.body), websearch_to_tsquery('english', $1)) desc
       limit $2`,
      [q, limit]
    )
    rows = res.rows
  }
  return rows.map((r) => ({
    id: Number(r.id),
    sessionId: Number(r.session_id),
    captureId: r.capture_id == null ? null : Number(r.capture_id),
    provenance: r.provenance as NoteHit['provenance'],
    topic: (r.topic as string) ?? null,
    body: r.body as string,
    createdAt: (r.created_at as Date).toISOString(),
    origin: 'remote' as const,
    fileName: (r.file_name as string) ?? null
  }))
}

// ---------------------------------------------------------------- activity (hypertable)

export async function insightsByTopic(
  sessionId: number,
  captureMs: number
): Promise<{ rows: InsightRow[]; source: 'aggregate' | 'raw' }> {
  const p = requirePool()
  const source = capabilities.continuousAggregate ? 'aggregate' : 'raw'
  const sql =
    source === 'aggregate'
      ? `select topic, sum(ticks)::bigint as ticks, max(max_dwell_ms) as max_dwell
         from activity_by_minute where session_id = $1 group by topic order by ticks desc limit 6`
      : `select coalesce(topic, '') as topic, count(*)::bigint as ticks, max(dwell_ms) as max_dwell
         from screen_activity where session_id = $1 group by 1 order by ticks desc limit 6`
  const { rows } = await p.query(sql, [sessionId])
  return {
    source,
    rows: rows.map((r) => ({
      topic: r.topic || 'Unlabelled',
      seconds: Math.round((Number(r.ticks) * captureMs) / 1000),
      maxDwellMs: Number(r.max_dwell ?? 0)
    }))
  }
}

export async function stuckSpots(sessionId: number, minDwellMs: number): Promise<StuckSpot[]> {
  const { rows } = await requirePool().query(
    `select s.created_at, coalesce(s.topic, '') as topic, s.suggestions,
            (select max(a.dwell_ms) from screen_activity a
              where a.session_id = s.session_id and a.time between s.created_at - interval '10 minutes' and s.created_at) as dwell
     from suggestion_sets s where s.session_id = $1 order by s.created_at desc limit 5`,
    [sessionId]
  )
  return rows
    .filter((r) => Number(r.dwell ?? 0) >= minDwellMs)
    .map((r) => ({
      at: r.created_at.toISOString(),
      topic: r.topic || 'Unlabelled',
      dwellMs: Number(r.dwell ?? 0),
      offered: ((r.suggestions?.ideas as { title: string }[]) ?? []).map((i) => i.title)
    }))
}

// ---------------------------------------------------------------- health

export async function ping(): Promise<number> {
  const t = Date.now()
  await requirePool().query('select 1')
  return Date.now() - t
}

export async function timescaleVersion(): Promise<string | null> {
  try {
    const { rows } = await requirePool().query(
      `select extversion from pg_extension where extname = 'timescaledb'`
    )
    return rows[0]?.extversion ?? null
  } catch {
    return null
  }
}
