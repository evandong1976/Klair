import { Pool, type PoolClient } from 'pg'
import { config } from './config'
import type {
  HealthReport,
  InsightRow,
  SessionListItem,
  StuckSpot,
  TimelineItem
} from '../shared/types'

// TigerData (Postgres + TimescaleDB) holds Klair's canonical records.
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

function requirePool(): Pool {
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

// ---------------------------------------------------------------- sessions

export async function createSession(name: string): Promise<{ id: number; startedAt: string }> {
  const { rows } = await requirePool().query(
    `insert into sessions (name, status) values ($1, 'active') returning id, started_at`,
    [name]
  )
  return { id: Number(rows[0].id), startedAt: rows[0].started_at.toISOString() }
}

export async function setSessionStatus(
  id: number,
  status: 'active' | 'paused' | 'ended'
): Promise<void> {
  await requirePool().query(
    `update sessions set status = $2, ended_at = case when $2 = 'ended' then now() else ended_at end where id = $1`,
    [id, status]
  )
}

export async function listSessions(): Promise<SessionListItem[]> {
  const { rows } = await requirePool().query(
    `select id, name, started_at, ended_at, status from sessions order by started_at desc limit 50`
  )
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    status: r.status
  }))
}

export async function getSession(id: number): Promise<SessionListItem | null> {
  const { rows } = await requirePool().query(
    `select id, name, started_at, ended_at, status from sessions where id = $1`,
    [id]
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: Number(r.id),
    name: r.name,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    status: r.status
  }
}

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

// ---------------------------------------------------------------- captures

export interface CaptureMeta {
  appName?: string | null
  windowTitle?: string | null
  url?: string | null
  imageHash: string
}

export async function insertPendingCapture(
  sessionId: number,
  path: string,
  meta: CaptureMeta
): Promise<number> {
  const { rows } = await requirePool().query(
    `insert into captures (session_id, screenshot_path, app_name, window_title, url, image_hash, status)
     values ($1, $2, $3, $4, $5, $6, 'pending') returning id`,
    [
      sessionId,
      path,
      meta.appName ?? null,
      meta.windowTitle ?? null,
      meta.url ?? null,
      meta.imageHash
    ]
  )
  return Number(rows[0].id)
}

export async function setCapturePath(id: number, path: string): Promise<void> {
  await requirePool().query(`update captures set screenshot_path = $2 where id = $1`, [id, path])
}

export async function setCaptureStatus(id: number, status: 'committed' | 'failed'): Promise<void> {
  await requirePool().query(`update captures set status = $2 where id = $1`, [id, status])
}

export async function setCaptureNote(id: number, note: string, notePath: string): Promise<void> {
  await requirePool().query(`update captures set note = $2, note_path = $3 where id = $1`, [
    id,
    note,
    notePath
  ])
}

export async function setIndexStatus(
  ids: number[],
  status: 'pending' | 'indexed' | 'failed'
): Promise<void> {
  if (ids.length === 0) return
  await requirePool().query(`update captures set index_status = $2 where id = any($1::bigint[])`, [
    ids,
    status
  ])
}

export async function pendingIndexCaptures(sessionId: number): Promise<number[]> {
  const { rows } = await requirePool().query(
    `select id from captures where session_id = $1 and status = 'committed'
       and note_path is not null and index_status <> 'indexed' order by id`,
    [sessionId]
  )
  return rows.map((r) => Number(r.id))
}

export async function capturePaths(
  sessionId: number
): Promise<{ id: number; path: string; status: string }[]> {
  const { rows } = await requirePool().query(
    `select id, screenshot_path, status from captures where session_id = $1`,
    [sessionId]
  )
  return rows.map((r) => ({ id: Number(r.id), path: r.screenshot_path, status: r.status }))
}

export async function captureHashes(sessionId: number): Promise<string[]> {
  const { rows } = await requirePool().query(
    `select distinct image_hash from captures where session_id = $1 and image_hash is not null`,
    [sessionId]
  )
  return rows.map((r) => r.image_hash as string)
}

export async function sessionExists(id: number): Promise<boolean> {
  const { rows } = await requirePool().query(`select 1 from sessions where id = $1`, [id])
  return rows.length > 0
}

export async function getCapture(id: number): Promise<{
  id: number
  sessionId: number
  path: string
  note: string | null
  capturedAt: string
} | null> {
  const { rows } = await requirePool().query(
    `select id, session_id, screenshot_path, note, captured_at from captures where id = $1 and status = 'committed'`,
    [id]
  )
  const r = rows[0]
  return r
    ? {
        id: Number(r.id),
        sessionId: Number(r.session_id),
        path: r.screenshot_path,
        note: r.note,
        capturedAt: r.captured_at.toISOString()
      }
    : null
}

// ---------------------------------------------------------------- notes & search

export async function insertNote(n: {
  sessionId: number
  captureId?: number | null
  actionId?: number | null
  provenance: 'observed' | 'assistant'
  topic?: string | null
  body: string
}): Promise<number> {
  const { rows } = await requirePool().query(
    `insert into notes (session_id, capture_id, action_id, provenance, topic, body)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [n.sessionId, n.captureId ?? null, n.actionId ?? null, n.provenance, n.topic ?? null, n.body]
  )
  return Number(rows[0].id)
}

export interface NoteHit {
  id: number
  sessionId: number
  captureId: number | null
  provenance: 'observed' | 'assistant'
  topic: string | null
  body: string
  createdAt: string
}

/** Keyword search over notes (BM25 via pg_textsearch when available, else Postgres FTS). */
export async function searchNotes(
  query: string,
  opts: { excludeCaptureId?: number | null; limit?: number } = {}
): Promise<NoteHit[]> {
  const q = query.trim()
  if (!q) return []
  const limit = opts.limit ?? 6
  const exclude = opts.excludeCaptureId ?? null
  const p = requirePool()
  const cols = `id, session_id, capture_id, provenance, topic, body, created_at`
  let rows: Record<string, unknown>[] = []
  if (capabilities.textsearch === 'bm25') {
    try {
      const res = await p.query(
        `select ${cols} from notes
         where ($2::bigint is null or capture_id is distinct from $2)
         order by body <@> to_bm25query($1, 'notes_body_bm25') limit $3`,
        [q, exclude, limit]
      )
      rows = res.rows
    } catch (err) {
      console.warn('bm25 search failed, using FTS:', (err as Error).message)
    }
  }
  if (rows.length === 0) {
    const res = await p.query(
      `select ${cols} from notes
       where to_tsvector('english', body) @@ websearch_to_tsquery('english', $1)
         and ($2::bigint is null or capture_id is distinct from $2)
       order by ts_rank(to_tsvector('english', body), websearch_to_tsquery('english', $1)) desc
       limit $3`,
      [q, exclude, limit]
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
    createdAt: (r.created_at as Date).toISOString()
  }))
}

// ---------------------------------------------------------------- activity (hypertable)

export interface ActivityRow {
  time: Date
  sessionId: number
  captureId: number | null
  appName: string | null
  windowTitle: string | null
  url: string | null
  topic: string | null
  changed: boolean
  dwellMs: number
}

export async function insertActivity(rows: ActivityRow[]): Promise<void> {
  if (rows.length === 0) return
  const values: unknown[] = []
  const tuples = rows.map((r, i) => {
    values.push(
      r.time,
      r.sessionId,
      r.captureId,
      r.appName,
      r.windowTitle,
      r.url,
      r.topic,
      r.changed,
      r.dwellMs
    )
    const b = i * 9
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`
  })
  await requirePool().query(
    `insert into screen_activity (time, session_id, capture_id, app_name, window_title, url, topic, changed, dwell_ms)
     values ${tuples.join(', ')}`,
    values
  )
}

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

// ---------------------------------------------------------------- suggestions & actions

export async function insertSuggestionSet(s: {
  sessionId: number
  captureId: number | null
  generationId: number
  topic: string
  suggestions: unknown
}): Promise<number> {
  const { rows } = await requirePool().query(
    `insert into suggestion_sets (session_id, capture_id, generation_id, topic, suggestions)
     values ($1, $2, $3, $4, $5) returning id`,
    [s.sessionId, s.captureId, s.generationId, s.topic, JSON.stringify(s.suggestions)]
  )
  return Number(rows[0].id)
}

export async function setSuggestionStatus(
  id: number,
  status: 'shown' | 'dismissed' | 'stale' | 'selected'
): Promise<void> {
  await requirePool().query(`update suggestion_sets set status = $2 where id = $1`, [id, status])
}

export async function insertAction(a: {
  sessionId: number
  captureId: number | null
  suggestionSetId: number | null
  kind: string
  prompt: string
}): Promise<number> {
  const { rows } = await requirePool().query(
    `insert into actions (session_id, capture_id, suggestion_set_id, kind, prompt, status)
     values ($1, $2, $3, $4, $5, 'pending') returning id`,
    [a.sessionId, a.captureId, a.suggestionSetId, a.kind, a.prompt]
  )
  return Number(rows[0].id)
}

export async function finishAction(
  id: number,
  f: {
    status: 'complete' | 'failed' | 'cancelled' | 'streaming'
    result?: string | null
    blocks?: unknown
    sources?: unknown
    tokensIn?: number | null
    tokensOut?: number | null
  }
): Promise<void> {
  await requirePool().query(
    `update actions set status = $2, result = coalesce($3, result), blocks = coalesce($4, blocks),
       sources = coalesce($5, sources), tokens_in = coalesce($6, tokens_in), tokens_out = coalesce($7, tokens_out),
       completed_at = case when $2 in ('complete', 'failed', 'cancelled') then now() else completed_at end
     where id = $1`,
    [
      id,
      f.status,
      f.result ?? null,
      f.blocks === undefined ? null : JSON.stringify(f.blocks),
      f.sources === undefined ? null : JSON.stringify(f.sources),
      f.tokensIn ?? null,
      f.tokensOut ?? null
    ]
  )
}

export async function timeline(sessionId: number): Promise<TimelineItem[]> {
  const p = requirePool()
  const seen = await p.query(
    `select min(captured_at) as at, coalesce(window_title, app_name, 'Screen') as title,
            coalesce(url, app_name, '') as detail, count(*)::int as n
     from captures where session_id = $1 and status = 'committed'
     group by coalesce(window_title, app_name, 'Screen'), coalesce(url, app_name, '')
     order by at limit 40`,
    [sessionId]
  )
  const asked = await p.query(
    `select id, created_at, kind, prompt, status from actions where session_id = $1 order by created_at limit 40`,
    [sessionId]
  )
  const items: TimelineItem[] = [
    ...seen.rows.map((r, i) => ({
      at: r.at.toISOString(),
      kind: (i === 0 ? 'seen' : 'switched') as TimelineItem['kind'],
      title: i === 0 ? `Read "${r.title}"` : `Switched to "${r.title}"`,
      detail: `${r.n} capture${r.n === 1 ? '' : 's'}${r.detail ? ` · ${r.detail}` : ''}`
    })),
    ...asked.rows.map((r) => ({
      at: r.created_at.toISOString(),
      kind: 'asked' as const,
      title: `You asked: ${String(r.prompt).slice(0, 80)}`,
      detail: r.kind ?? '',
      actionId: Number(r.id),
      status: r.status
    }))
  ]
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

export async function sentToClaudeCount(sessionId: number): Promise<number> {
  const { rows } = await requirePool().query(
    `select (select count(*) from suggestion_sets where session_id = $1)
          + (select count(*) from actions where session_id = $1)
          + (select count(*) from captures where session_id = $1 and note is not null) as n`,
    [sessionId]
  )
  return Number(rows[0].n)
}

export async function sessionStats(
  sessionId: number
): Promise<{ captures: number; answers: number; tabs: number }> {
  const { rows } = await requirePool().query(
    `select (select count(*) from captures where session_id = $1 and status = 'committed')::int as captures,
            (select count(*) from actions where session_id = $1 and status = 'complete')::int as answers,
            (select count(distinct coalesce(url, window_title)) from captures where session_id = $1)::int as tabs`,
    [sessionId]
  )
  return rows[0]
}

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
