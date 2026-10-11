import { Pool, type PoolClient } from 'pg'
import { config } from './config'
import type { HealthReport, InsightRow, StuckSpot } from '../shared/types'
import type { NoteHit } from './local'

// TigerData (Postgres + TimescaleDB) keeps a copy of every project. Projects are saved
// on the Mac first (SQLite, local.ts); upload.ts copies each project here after the
// sessions it was worked in. From here come the activity_by_minute continuous
// aggregate for insights, the activity hypertable with retention, and BM25 search.
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
create table if not exists projects (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists captures (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  captured_at timestamptz not null default now(),
  screenshot_path text not null,
  note text
);
create index if not exists captures_project_idx on captures (project_id, captured_at);
create table if not exists actions (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  created_at timestamptz not null default now(),
  prompt text not null,
  result text
);
create index if not exists actions_project_idx on actions (project_id, created_at);

alter table projects add column if not exists name text not null default 'Project';

alter table captures add column if not exists app_name text;
alter table captures add column if not exists window_title text;
alter table captures add column if not exists url text;
alter table captures add column if not exists image_hash text;
alter table captures add column if not exists status text not null default 'pending';
alter table captures add column if not exists index_status text not null default 'pending';
alter table captures add column if not exists note_path text;

create table if not exists suggestion_sets (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  generation_id integer not null,
  created_at timestamptz not null default now(),
  status text not null default 'shown',
  topic text,
  suggestions jsonb not null
);
create index if not exists suggestion_sets_project_idx on suggestion_sets (project_id, created_at);

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
  project_id bigint not null references projects(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  action_id bigint references actions(id) on delete set null,
  provenance text not null check (provenance in ('observed', 'assistant')),
  topic text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_project_idx on notes (project_id, created_at);
create index if not exists notes_body_fts on notes using gin (to_tsvector('english', body));

create table if not exists screen_activity (
  time timestamptz not null,
  project_id bigint not null references projects(id) on delete cascade,
  capture_id bigint,
  app_name text,
  window_title text,
  url text,
  topic text,
  changed boolean not null default false,
  dwell_ms integer not null default 0
);
create index if not exists screen_activity_project_idx on screen_activity (project_id, time desc);

-- Uploads from the Mac's SQLite store. local_key identifies the local project, so a
-- re-upload replaces the earlier copy instead of duplicating it; local_id maps each
-- row back to its local row (and lets the upload remap ids in one round trip).
alter table projects add column if not exists local_key text;
create unique index if not exists projects_local_key_idx on projects (local_key);
alter table captures add column if not exists local_id bigint;
alter table suggestion_sets add column if not exists local_id bigint;
alter table actions add column if not exists local_id bigint;
alter table notes add column if not exists local_id bigint;

-- Full pages from the Chrome extension, and the page each screenshot shows.
create table if not exists pages (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
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
create index if not exists pages_project_idx on pages (project_id, captured_at);
alter table captures add column if not exists page_id bigint references pages(id) on delete set null;
-- 'auto' (capture loop) or 'selection' (an area the user selected).
alter table captures add column if not exists source text not null default 'auto';

-- Files the user added from Downloads: metadata and extracted text (the file stays on the Mac).
create table if not exists files (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
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
create index if not exists files_project_idx on files (project_id, added_at);
alter table notes add column if not exists file_id bigint references files(id) on delete set null;

-- Sessions hold no data: they are time. Which project was active when, per local session.
create table if not exists project_spans (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  session_key text not null,
  session_started_at timestamptz,
  session_ended_at timestamptz,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists project_spans_project_idx on project_spans (project_id, started_at);
create index if not exists project_spans_session_idx on project_spans (session_key);
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

const CONTEXT_TABLES = [
  'captures',
  'suggestion_sets',
  'actions',
  'notes',
  'screen_activity',
  'pages',
  'files'
]

/**
 * Databases from before projects: "sessions" held the context. Rename them to
 * projects (and session_id → project_id) in one transaction. The activity_by_minute
 * aggregate is derived, so it is dropped here and rebuilt by migrate().
 */
async function migrateSessionsToProjects(client: PoolClient): Promise<void> {
  const { rows } = await client.query(
    `select
       exists (select 1 from information_schema.columns
               where table_schema = current_schema() and table_name = 'sessions'
                 and column_name = 'local_key') as old,
       to_regclass('projects') is not null as new`
  )
  if (!rows[0].old || rows[0].new) return
  await client.query('begin')
  try {
    await client.query(`drop materialized view if exists activity_by_minute cascade`)
    await client.query(`alter table sessions rename to projects`)
    await client.query(`alter table projects rename column started_at to created_at`)
    await client.query(`alter table projects rename column ended_at to last_used_at`)
    await client.query(
      `alter index if exists sessions_local_key_idx rename to projects_local_key_idx`
    )
    for (const t of CONTEXT_TABLES) {
      const col = await client.query(
        `select 1 from information_schema.columns
         where table_schema = current_schema() and table_name = $1 and column_name = 'session_id'`,
        [t]
      )
      if (col.rows.length)
        await client.query(`alter table ${t} rename column session_id to project_id`)
      await client.query(`alter index if exists ${t}_session_idx rename to ${t}_project_idx`)
    }
    await client.query('commit')
    console.log('tigerdata: renamed sessions to projects')
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

/** Create or extend the schema, then enable TimescaleDB / search features one by one. */
export async function migrate(): Promise<HealthReport['capabilities']> {
  const client = await requirePool().connect()
  try {
    await migrateSessionsToProjects(client)
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
                  project_id,
                  coalesce(topic, '') as topic,
                  coalesce(app_name, '') as app_name,
                  count(*) as ticks,
                  sum(case when changed then 1 else 0 end) as changes,
                  max(dwell_ms) as max_dwell_ms
           from screen_activity
           group by bucket, project_id, coalesce(topic, ''), coalesce(app_name, '')
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

// ---------------------------------------------------------------- projects (by TigerData id)

export async function deleteProjectRows(id: number): Promise<void> {
  await requirePool().query(`delete from projects where id = $1`, [id])
  if (capabilities.continuousAggregate) {
    // Best effort: re-materialize so the aggregate forgets the deleted project now.
    await requirePool()
      .query(`call refresh_continuous_aggregate('activity_by_minute', null, null)`)
      .catch(() => undefined)
  }
}

// ---------------------------------------------------------------- search

/**
 * Keyword search over every uploaded note, across projects (BM25 via pg_textsearch when
 * available, else Postgres FTS). Answers don't use it: they stay within the active
 * project, searched locally. It's here for tools and a future cross-project view.
 */
export async function searchNotes(
  query: string,
  opts: { limit?: number } = {}
): Promise<NoteHit[]> {
  const q = query.trim()
  if (!q) return []
  const limit = opts.limit ?? 6
  const p = requirePool()
  const cols = `n.id, n.project_id, n.capture_id, n.provenance, n.topic, n.body, n.created_at, f.name as file_name`
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
    projectId: Number(r.project_id),
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

/** Where a session's time went: its projects' activity within the session's time range. */
export async function insightsByTopic(
  projectIds: number[],
  range: { from: string; to: string },
  captureMs: number
): Promise<{ rows: InsightRow[]; source: 'aggregate' | 'raw' }> {
  const p = requirePool()
  const source = capabilities.continuousAggregate ? 'aggregate' : 'raw'
  const sql =
    source === 'aggregate'
      ? `select topic, sum(ticks)::bigint as ticks, max(max_dwell_ms) as max_dwell
         from activity_by_minute
         where project_id = any($1::bigint[])
           and bucket >= time_bucket('1 minute', $2::timestamptz) and bucket <= $3::timestamptz
         group by topic order by ticks desc limit 6`
      : `select coalesce(topic, '') as topic, count(*)::bigint as ticks, max(dwell_ms) as max_dwell
         from screen_activity
         where project_id = any($1::bigint[]) and time between $2::timestamptz and $3::timestamptz
         group by 1 order by ticks desc limit 6`
  const { rows } = await p.query(sql, [projectIds, range.from, range.to])
  return {
    source,
    rows: rows.map((r) => ({
      topic: r.topic || 'Unlabelled',
      seconds: Math.round((Number(r.ticks) * captureMs) / 1000),
      maxDwellMs: Number(r.max_dwell ?? 0)
    }))
  }
}

export async function stuckSpots(
  projectIds: number[],
  range: { from: string; to: string },
  minDwellMs: number
): Promise<StuckSpot[]> {
  const { rows } = await requirePool().query(
    `select s.created_at, coalesce(s.topic, '') as topic, s.suggestions,
            (select max(a.dwell_ms) from screen_activity a
              where a.project_id = s.project_id
                and a.time between s.created_at - interval '10 minutes' and s.created_at) as dwell
     from suggestion_sets s
     where s.project_id = any($1::bigint[]) and s.created_at between $2::timestamptz and $3::timestamptz
     order by s.created_at desc limit 5`,
    [projectIds, range.from, range.to]
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
