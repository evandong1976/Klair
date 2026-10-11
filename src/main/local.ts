import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type {
  InsightRow,
  SessionListItem,
  StuckSpot,
  TimelineItem,
  UploadStatus
} from '../shared/types'

// The live session store: SQLite on this Mac (<userData>/klair.db). Everything a
// running session writes lands here first. When the session ends, upload.ts copies
// it to TigerData in one transaction and records the TigerData id (remote_id), which
// a later "resume" can use to pull a session back. Local rows are kept until the
// retention sweep, so the Sessions window works offline.
//
// Functions are async so callers treat this store and TigerData the same way.

export interface CaptureMeta {
  appName?: string | null
  windowTitle?: string | null
  url?: string | null
  imageHash: string
}

/** 'auto': taken by the capture loop. 'selection': an area the user selected. */
export type CaptureSource = 'auto' | 'selection'

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

export interface NoteHit {
  id: number
  sessionId: number
  captureId: number | null
  provenance: 'observed' | 'assistant'
  topic: string | null
  body: string
  createdAt: string
  /** local: this Mac's SQLite store (ids are local); remote: TigerData (ids are TigerData's). */
  origin: 'local' | 'remote'
  /** Set when the note is a file the user added from Downloads. */
  fileName?: string | null
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

const schema = `
create table if not exists sessions (
  id integer primary key autoincrement,
  local_key text not null unique,
  name text not null default 'Session',
  status text not null default 'active',
  started_at text not null default (${NOW}),
  ended_at text,
  remote_id integer,
  upload_status text not null default 'local',
  upload_error text,
  uploaded_at text
);
create table if not exists captures (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  captured_at text not null default (${NOW}),
  screenshot_path text not null,
  note text,
  app_name text,
  window_title text,
  url text,
  image_hash text,
  status text not null default 'pending',
  index_status text not null default 'pending',
  note_path text
);
create index if not exists captures_session_idx on captures (session_id, captured_at);
create table if not exists suggestion_sets (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  generation_id integer not null,
  created_at text not null default (${NOW}),
  status text not null default 'shown',
  topic text,
  suggestions text not null
);
create index if not exists suggestion_sets_session_idx on suggestion_sets (session_id, created_at);
create table if not exists actions (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  suggestion_set_id integer references suggestion_sets(id) on delete set null,
  created_at text not null default (${NOW}),
  kind text,
  prompt text not null,
  result text,
  status text not null default 'pending',
  blocks text,
  sources text,
  tokens_in integer,
  tokens_out integer,
  completed_at text
);
create index if not exists actions_session_idx on actions (session_id, created_at);
create table if not exists notes (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  action_id integer references actions(id) on delete set null,
  provenance text not null check (provenance in ('observed', 'assistant')),
  topic text,
  body text not null,
  created_at text not null default (${NOW})
);
create index if not exists notes_session_idx on notes (session_id, created_at);
create virtual table if not exists notes_fts using fts5(
  body, content='notes', content_rowid='id', tokenize='porter unicode61'
);
create trigger if not exists notes_ai after insert on notes begin
  insert into notes_fts(rowid, body) values (new.id, new.body);
end;
create trigger if not exists notes_ad after delete on notes begin
  insert into notes_fts(notes_fts, rowid, body) values ('delete', old.id, old.body);
end;
create table if not exists screen_activity (
  time text not null,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer,
  app_name text,
  window_title text,
  url text,
  topic text,
  changed integer not null default 0,
  dwell_ms integer not null default 0
);
create index if not exists screen_activity_session_idx on screen_activity (session_id, time);
-- Full pages sent by the Chrome extension (extension/, bridge.ts): the whole rendered text,
-- not just what a screenshot shows. One row per distinct version of a page.
create table if not exists pages (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  captured_at text not null default (${NOW}),
  url text not null,
  title text,
  description text,
  body text not null,
  text_hash text not null,
  truncated integer not null default 0,
  note_path text,
  index_status text not null default 'pending'
);
create index if not exists pages_session_idx on pages (session_id, captured_at);
create unique index if not exists pages_hash_idx on pages (session_id, text_hash);
-- Files the user chose to add from Downloads (downloads.ts, files.ts). The file is
-- copied into the session folder; body is its extracted text (or an image description).
create table if not exists files (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  added_at text not null default (${NOW}),
  name text not null,
  kind text not null,
  size integer not null,
  original_path text not null,
  stored_path text,
  sha1 text,
  body text not null default '',
  extract_status text not null,
  truncated integer not null default 0,
  note_path text,
  index_status text not null default 'pending'
);
create index if not exists files_session_idx on files (session_id, added_at);
-- TigerData sessions deleted here while TigerData was unreachable; removed on the next upload run.
create table if not exists pending_remote_deletes (remote_id integer primary key);
`

/** Columns added after a table first shipped (SQLite has no "add column if not exists"). */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  // The Chrome page a screenshot shows, when the note model matched them.
  ['captures', 'page_id', 'integer references pages(id) on delete set null'],
  // 'auto' (the capture loop) or 'selection' (an area the user selected with ⌘S).
  ['captures', 'source', "text not null default 'auto'"],
  // The added file a note is about (files).
  ['notes', 'file_id', 'integer references files(id) on delete set null']
]

function addColumns(d: DatabaseSync): void {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = d.prepare(`pragma table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column))
      d.exec(`alter table ${table} add column ${column} ${type}`)
  }
}

let sqlite: DatabaseSync | null = null
let openError: string | null = null
let file: string | null = null

/** Use another database file (tests). Must be called before the first query. */
export function useDatabaseFile(path: string): void {
  sqlite?.close()
  sqlite = null
  file = path
}

function open(): DatabaseSync {
  if (sqlite) return sqlite
  try {
    const d = new DatabaseSync(file ?? join(app.getPath('userData'), 'klair.db'))
    d.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;')
    d.exec(schema)
    addColumns(d)
    sqlite = d
    openError = null
    return d
  } catch (err) {
    openError = (err as Error).message
    throw err
  }
}

const q = (sql: string): ReturnType<DatabaseSync['prepare']> => open().prepare(sql)
type Row = Record<string, unknown>
const all = (sql: string, ...p: unknown[]): Row[] => q(sql).all(...(p as never[])) as Row[]
const one = (sql: string, ...p: unknown[]): Row | undefined =>
  q(sql).get(...(p as never[])) as Row | undefined
const run = (sql: string, ...p: unknown[]): number =>
  Number(q(sql).run(...(p as never[])).lastInsertRowid)
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : (v ?? null))

/** True when the store opens; the error explains why it didn't. */
export function localStatus(): { ok: boolean; detail: string } {
  try {
    open()
    return { ok: true, detail: 'SQLite ready: sessions are saved on this Mac first' }
  } catch {
    return { ok: false, detail: `Local session store unavailable: ${openError ?? 'unknown error'}` }
  }
}

export function transaction<T>(fn: () => T): T {
  const d = open()
  d.exec('begin')
  try {
    const out = fn()
    d.exec('commit')
    return out
  } catch (err) {
    d.exec('rollback')
    throw err
  }
}

// ---------------------------------------------------------------- sessions

function sessionItem(r: Row): SessionListItem {
  return {
    id: Number(r.id),
    name: String(r.name),
    startedAt: String(r.started_at),
    endedAt: (r.ended_at as string) ?? null,
    status: r.status as SessionListItem['status'],
    upload: {
      status: r.upload_status as UploadStatus,
      error: (r.upload_error as string) ?? null,
      remoteId: r.remote_id == null ? null : Number(r.remote_id)
    }
  }
}

export async function createSession(name: string): Promise<{ id: number; startedAt: string }> {
  const id = run(
    `insert into sessions (local_key, name, status) values (?, ?, 'active')`,
    randomUUID(),
    name
  )
  return {
    id,
    startedAt: String(one(`select started_at from sessions where id = ?`, id)?.started_at)
  }
}

export async function setSessionStatus(
  id: number,
  status: 'active' | 'paused' | 'ended'
): Promise<void> {
  run(
    `update sessions set status = ?, ended_at = case when ? = 'ended' then ${NOW} else ended_at end where id = ?`,
    status,
    status,
    id
  )
}

export async function listSessions(): Promise<SessionListItem[]> {
  return all(`select * from sessions order by started_at desc limit 50`).map(sessionItem)
}

export async function getSession(id: number): Promise<SessionListItem | null> {
  const r = one(`select * from sessions where id = ?`, id)
  return r ? sessionItem(r) : null
}

export async function sessionExists(id: number): Promise<boolean> {
  return !!one(`select 1 from sessions where id = ?`, id)
}

export async function deleteSessionRows(id: number): Promise<void> {
  transaction(() => {
    // FTS rows go through the notes delete trigger; cascade alone would skip it.
    run(`delete from notes where session_id = ?`, id)
    run(`delete from sessions where id = ?`, id)
  })
}

export async function expiredSessionIds(days: number): Promise<number[]> {
  return all(
    `select id from sessions where status = 'ended'
       and started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
    `-${Math.round(days)} days`
  ).map((r) => Number(r.id))
}

/** Sessions left active or paused by a crash or quit: end them where their activity stops. */
export async function endAbandonedSessions(exceptId: number | null): Promise<number[]> {
  const rows = all(`select id from sessions where status <> 'ended' and id is not ?`, exceptId).map(
    (r) => Number(r.id)
  )
  for (const id of rows) {
    run(
      `update sessions set status = 'ended', ended_at = coalesce(
         (select max(time) from screen_activity where session_id = sessions.id),
         (select max(captured_at) from captures where session_id = sessions.id),
         started_at)
       where id = ?`,
      id
    )
  }
  return rows
}

// ---------------------------------------------------------------- upload bookkeeping

export async function sessionsToUpload(): Promise<number[]> {
  return all(
    `select id from sessions where status = 'ended' and upload_status <> 'synced' order by id`
  ).map((r) => Number(r.id))
}

export function setUploadStatus(
  id: number,
  status: UploadStatus,
  f: { remoteId?: number; error?: string | null } = {}
): void {
  run(
    `update sessions set upload_status = ?, upload_error = ?,
       remote_id = coalesce(?, remote_id),
       uploaded_at = case when ? = 'synced' then ${NOW} else uploaded_at end
     where id = ?`,
    status,
    f.error ?? null,
    f.remoteId ?? null,
    status,
    id
  )
}

export function queueRemoteDelete(remoteId: number): void {
  run(`insert or ignore into pending_remote_deletes (remote_id) values (?)`, remoteId)
}

export function pendingRemoteDeletes(): number[] {
  return all(`select remote_id from pending_remote_deletes`).map((r) => Number(r.remote_id))
}

export function clearRemoteDelete(remoteId: number): void {
  run(`delete from pending_remote_deletes where remote_id = ?`, remoteId)
}

export interface SessionExport {
  session: Row
  captures: Row[]
  suggestionSets: Row[]
  actions: Row[]
  notes: Row[]
  activity: Row[]
  pages: Row[]
  files: Row[]
}

/** Every row of one session, read in a single snapshot, for the TigerData upload. */
export function exportSession(id: number): SessionExport | null {
  return transaction(() => {
    const session = one(`select * from sessions where id = ?`, id)
    if (!session) return null
    return {
      session,
      captures: all(`select * from captures where session_id = ? order by id`, id),
      suggestionSets: all(`select * from suggestion_sets where session_id = ? order by id`, id).map(
        (r) => ({ ...r, suggestions: json(r.suggestions) })
      ),
      actions: all(`select * from actions where session_id = ? order by id`, id).map((r) => ({
        ...r,
        blocks: json(r.blocks),
        sources: json(r.sources)
      })),
      notes: all(`select * from notes where session_id = ? order by id`, id),
      activity: all(`select * from screen_activity where session_id = ? order by time`, id).map(
        (r) => ({ ...r, changed: Number(r.changed) === 1 })
      ),
      pages: all(`select * from pages where session_id = ? order by id`, id).map((r) => ({
        ...r,
        truncated: Number(r.truncated) === 1
      })),
      files: all(`select * from files where session_id = ? order by id`, id).map((r) => ({
        ...r,
        truncated: Number(r.truncated) === 1
      }))
    }
  })
}

// ---------------------------------------------------------------- pages (Chrome extension)

export interface PageRow {
  id: number
  sessionId: number
  capturedAt: string
  url: string
  title: string
  body: string
  truncated: boolean
}

function pageRow(r: Row): PageRow {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    capturedAt: String(r.captured_at),
    url: String(r.url),
    title: (r.title as string) || String(r.url),
    body: String(r.body),
    truncated: Number(r.truncated) === 1
  }
}

export async function insertPage(p: {
  sessionId: number
  url: string
  title: string
  description: string
  body: string
  textHash: string
  truncated: boolean
}): Promise<number> {
  return run(
    `insert into pages (session_id, url, title, description, body, text_hash, truncated) values (?, ?, ?, ?, ?, ?, ?)`,
    p.sessionId,
    p.url,
    p.title,
    p.description,
    p.body,
    p.textHash,
    p.truncated ? 1 : 0
  )
}

export async function findPageByHash(sessionId: number, textHash: string): Promise<PageRow | null> {
  const r = one(`select * from pages where session_id = ? and text_hash = ?`, sessionId, textHash)
  return r ? pageRow(r) : null
}

export async function getPage(id: number): Promise<PageRow | null> {
  const r = one(`select * from pages where id = ?`, id)
  return r ? pageRow(r) : null
}

export async function setPageNotePath(id: number, notePath: string): Promise<void> {
  run(`update pages set note_path = ? where id = ?`, notePath, id)
}

export async function linkCaptureToPage(captureId: number, pageId: number): Promise<void> {
  run(`update captures set page_id = ? where id = ?`, pageId, captureId)
}

export async function pendingIndexPages(sessionId: number): Promise<number[]> {
  return all(
    `select id from pages where session_id = ? and note_path is not null and index_status <> 'indexed'`,
    sessionId
  ).map((r) => Number(r.id))
}

export async function setPageIndexStatus(
  ids: number[],
  status: 'pending' | 'indexed' | 'failed'
): Promise<void> {
  if (ids.length === 0) return
  run(
    `update pages set index_status = ? where id in (select value from json_each(?))`,
    status,
    JSON.stringify(ids)
  )
}

// ---------------------------------------------------------------- files (from Downloads)

export interface FileRow {
  id: number
  sessionId: number
  addedAt: string
  name: string
  kind: string
  size: number
  storedPath: string | null
  body: string
  extractStatus: string
  truncated: boolean
}

function fileRow(r: Row): FileRow {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    addedAt: String(r.added_at),
    name: String(r.name),
    kind: String(r.kind),
    size: Number(r.size),
    storedPath: (r.stored_path as string) ?? null,
    body: String(r.body ?? ''),
    extractStatus: String(r.extract_status),
    truncated: Number(r.truncated) === 1
  }
}

export async function insertFile(f: {
  sessionId: number
  name: string
  kind: string
  size: number
  originalPath: string
  storedPath: string | null
  sha1: string | null
  body: string
  extractStatus: string
  truncated: boolean
}): Promise<number> {
  return run(
    `insert into files (session_id, name, kind, size, original_path, stored_path, sha1, body, extract_status, truncated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.sessionId,
    f.name,
    f.kind,
    f.size,
    f.originalPath,
    f.storedPath,
    f.sha1,
    f.body,
    f.extractStatus,
    f.truncated ? 1 : 0
  )
}

export async function getFile(id: number): Promise<FileRow | null> {
  const r = one(`select * from files where id = ?`, id)
  return r ? fileRow(r) : null
}

/** The file most recently added to a session, if it was added after `sinceIso`. */
export async function latestFile(sessionId: number, sinceIso: string): Promise<FileRow | null> {
  const r = one(
    `select * from files where session_id = ? and added_at >= ? order by id desc limit 1`,
    sessionId,
    sinceIso
  )
  return r ? fileRow(r) : null
}

export async function setFileNotePath(id: number, notePath: string): Promise<void> {
  run(`update files set note_path = ? where id = ?`, notePath, id)
}

export async function pendingIndexFiles(sessionId: number): Promise<number[]> {
  return all(
    `select id from files where session_id = ? and note_path is not null and index_status <> 'indexed'`,
    sessionId
  ).map((r) => Number(r.id))
}

export async function setFileIndexStatus(
  ids: number[],
  status: 'pending' | 'indexed' | 'failed'
): Promise<void> {
  if (ids.length === 0) return
  run(
    `update files set index_status = ? where id in (select value from json_each(?))`,
    status,
    JSON.stringify(ids)
  )
}

// ---------------------------------------------------------------- captures

export async function insertPendingCapture(
  sessionId: number,
  path: string,
  meta: CaptureMeta,
  source: CaptureSource = 'auto'
): Promise<number> {
  return run(
    `insert into captures (session_id, screenshot_path, app_name, window_title, url, image_hash, status, source)
     values (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    sessionId,
    path,
    meta.appName ?? null,
    meta.windowTitle ?? null,
    meta.url ?? null,
    meta.imageHash,
    source
  )
}

export async function setCaptureStatus(id: number, status: 'committed' | 'failed'): Promise<void> {
  run(`update captures set status = ? where id = ?`, status, id)
}

export async function setCaptureNote(id: number, note: string, notePath: string): Promise<void> {
  run(`update captures set note = ?, note_path = ? where id = ?`, note, notePath, id)
}

export async function setIndexStatus(
  ids: number[],
  status: 'pending' | 'indexed' | 'failed'
): Promise<void> {
  if (ids.length === 0) return
  run(
    `update captures set index_status = ? where id in (select value from json_each(?))`,
    status,
    JSON.stringify(ids)
  )
}

export async function pendingIndexCaptures(sessionId: number): Promise<number[]> {
  return all(
    `select id from captures where session_id = ? and status = 'committed'
       and note_path is not null and index_status <> 'indexed' order by id`,
    sessionId
  ).map((r) => Number(r.id))
}

export async function capturePaths(
  sessionId: number
): Promise<{ id: number; path: string; status: string }[]> {
  return all(
    `select id, screenshot_path, status from captures where session_id = ?`,
    sessionId
  ).map((r) => ({ id: Number(r.id), path: String(r.screenshot_path), status: String(r.status) }))
}

export async function captureHashes(sessionId: number): Promise<string[]> {
  return all(
    `select distinct image_hash from captures where session_id = ? and image_hash is not null`,
    sessionId
  ).map((r) => String(r.image_hash))
}

export async function getCapture(id: number): Promise<{
  id: number
  sessionId: number
  path: string
  note: string | null
  capturedAt: string
  pageId: number | null
  source: CaptureSource
} | null> {
  const r = one(
    `select id, session_id, screenshot_path, note, captured_at, page_id, source from captures where id = ? and status = 'committed'`,
    id
  )
  return r
    ? {
        id: Number(r.id),
        sessionId: Number(r.session_id),
        path: String(r.screenshot_path),
        note: (r.note as string) ?? null,
        capturedAt: String(r.captured_at),
        pageId: r.page_id == null ? null : Number(r.page_id),
        source: r.source as CaptureSource
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
  fileId?: number | null
}): Promise<number> {
  return run(
    `insert into notes (session_id, capture_id, action_id, provenance, topic, body, file_id) values (?, ?, ?, ?, ?, ?, ?)`,
    n.sessionId,
    n.captureId ?? null,
    n.actionId ?? null,
    n.provenance,
    n.topic ?? null,
    n.body,
    n.fileId ?? null
  )
}

/** Free text → an FTS5 query: each word quoted (no operators), any word may match. */
function ftsQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
  return [...new Set(words)]
    .slice(0, 24)
    .map((w) => `"${w}"`)
    .join(' OR ')
}

/**
 * BM25 keyword search over local notes: the given session plus any session not yet
 * in TigerData (uploaded sessions are searched there instead, so nothing is counted twice).
 */
export async function searchNotes(
  query: string,
  opts: { sessionId: number; excludeCaptureId?: number | null; limit?: number }
): Promise<NoteHit[]> {
  const match = ftsQuery(query)
  if (!match) return []
  return all(
    `select n.id, n.session_id, n.capture_id, n.provenance, n.topic, n.body, n.created_at,
            fl.name as file_name
     from notes_fts f join notes n on n.id = f.rowid join sessions s on s.id = n.session_id
       left join files fl on fl.id = n.file_id
     where notes_fts match ?
       and (n.session_id = ? or s.upload_status <> 'synced')
       and (? is null or n.capture_id is not ?)
     order by bm25(notes_fts) limit ?`,
    match,
    opts.sessionId,
    opts.excludeCaptureId ?? null,
    opts.excludeCaptureId ?? null,
    opts.limit ?? 6
  ).map((r) => ({
    id: Number(r.id),
    sessionId: Number(r.session_id),
    captureId: r.capture_id == null ? null : Number(r.capture_id),
    provenance: r.provenance as NoteHit['provenance'],
    topic: (r.topic as string) ?? null,
    body: String(r.body),
    createdAt: String(r.created_at),
    origin: 'local' as const,
    fileName: (r.file_name as string) ?? null
  }))
}

// ---------------------------------------------------------------- activity

export async function insertActivity(rows: ActivityRow[]): Promise<void> {
  if (rows.length === 0) return
  const stmt = q(
    `insert into screen_activity (time, session_id, capture_id, app_name, window_title, url, topic, changed, dwell_ms)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.time.toISOString(),
        r.sessionId,
        r.captureId,
        r.appName,
        r.windowTitle,
        r.url,
        r.topic,
        r.changed ? 1 : 0,
        r.dwellMs
      )
    }
  })
}

export async function insightsByTopic(
  sessionId: number,
  captureMs: number
): Promise<{ rows: InsightRow[]; source: 'raw' }> {
  const rows = all(
    `select coalesce(topic, '') as topic, count(*) as ticks, max(dwell_ms) as max_dwell
     from screen_activity where session_id = ? group by 1 order by ticks desc limit 6`,
    sessionId
  )
  return {
    source: 'raw',
    rows: rows.map((r) => ({
      topic: (r.topic as string) || 'Unlabelled',
      seconds: Math.round((Number(r.ticks) * captureMs) / 1000),
      maxDwellMs: Number(r.max_dwell ?? 0)
    }))
  }
}

export async function stuckSpots(sessionId: number, minDwellMs: number): Promise<StuckSpot[]> {
  const rows = all(
    `select s.created_at, coalesce(s.topic, '') as topic, s.suggestions,
            (select max(a.dwell_ms) from screen_activity a
              where a.session_id = s.session_id
                and a.time between strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at, '-10 minutes') and s.created_at) as dwell
     from suggestion_sets s where s.session_id = ? order by s.created_at desc limit 5`,
    sessionId
  )
  return rows
    .filter((r) => Number(r.dwell ?? 0) >= minDwellMs)
    .map((r) => ({
      at: String(r.created_at),
      topic: (r.topic as string) || 'Unlabelled',
      dwellMs: Number(r.dwell ?? 0),
      offered: (
        ((json(r.suggestions) as { ideas?: { title: string }[] })?.ideas ?? []) as {
          title: string
        }[]
      ).map((i) => i.title)
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
  return run(
    `insert into suggestion_sets (session_id, capture_id, generation_id, topic, suggestions) values (?, ?, ?, ?, ?)`,
    s.sessionId,
    s.captureId,
    s.generationId,
    s.topic,
    JSON.stringify(s.suggestions)
  )
}

export async function setSuggestionStatus(
  id: number,
  status: 'shown' | 'dismissed' | 'stale' | 'selected'
): Promise<void> {
  run(`update suggestion_sets set status = ? where id = ?`, status, id)
}

export async function insertAction(a: {
  sessionId: number
  captureId: number | null
  suggestionSetId: number | null
  kind: string
  prompt: string
}): Promise<number> {
  return run(
    `insert into actions (session_id, capture_id, suggestion_set_id, kind, prompt, status) values (?, ?, ?, ?, ?, 'pending')`,
    a.sessionId,
    a.captureId,
    a.suggestionSetId,
    a.kind,
    a.prompt
  )
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
  run(
    `update actions set status = ?, result = coalesce(?, result), blocks = coalesce(?, blocks),
       sources = coalesce(?, sources), tokens_in = coalesce(?, tokens_in), tokens_out = coalesce(?, tokens_out),
       completed_at = case when ? in ('complete', 'failed', 'cancelled') then ${NOW} else completed_at end
     where id = ?`,
    f.status,
    f.result ?? null,
    f.blocks === undefined ? null : JSON.stringify(f.blocks),
    f.sources === undefined ? null : JSON.stringify(f.sources),
    f.tokensIn ?? null,
    f.tokensOut ?? null,
    f.status,
    id
  )
}

export async function timeline(sessionId: number): Promise<TimelineItem[]> {
  const seen = all(
    `select min(captured_at) as at, coalesce(window_title, app_name, 'Screen') as title,
            coalesce(url, app_name, '') as detail, count(*) as n
     from captures where session_id = ? and status = 'committed' and source = 'auto'
     group by 2, 3 order by at limit 40`,
    sessionId
  )
  const selected = all(
    `select id, captured_at, coalesce(substr(note, 1, 90), '') as note from captures
     where session_id = ? and status = 'committed' and source = 'selection' order by id limit 40`,
    sessionId
  )
  const asked = all(
    `select id, created_at, kind, prompt, status from actions where session_id = ? order by created_at limit 40`,
    sessionId
  )
  const pages = all(
    `select captured_at, title, url, length(body) as chars from pages where session_id = ? order by id limit 40`,
    sessionId
  )
  const added = all(
    `select added_at, name, kind, extract_status from files where session_id = ? order by id limit 40`,
    sessionId
  )
  const items: TimelineItem[] = [
    ...seen.map((r, i) => {
      const n = Number(r.n)
      return {
        at: String(r.at),
        kind: (i === 0 ? 'seen' : 'switched') as TimelineItem['kind'],
        title: i === 0 ? `Read "${r.title}"` : `Switched to "${r.title}"`,
        detail: `${n} capture${n === 1 ? '' : 's'}${r.detail ? ` · ${r.detail}` : ''}`
      }
    }),
    ...selected.map((r) => ({
      at: String(r.captured_at),
      kind: 'seen' as const,
      title: 'You selected an area of the screen',
      detail: String(r.note)
    })),
    ...added.map((r) => ({
      at: String(r.added_at),
      kind: 'switched' as const,
      title: `Added "${r.name}" from Downloads`,
      detail:
        r.extract_status === 'ok'
          ? `${r.kind} · contents read`
          : `${r.kind} · ${r.extract_status === 'unsupported' ? 'kept by name only' : 'contents not readable'}`
    })),
    ...pages.map((r) => ({
      at: String(r.captured_at),
      kind: 'switched' as const,
      title: `Opened "${r.title || r.url}" in Chrome`,
      detail: `Full page · ${Math.round(Number(r.chars) / 1000)}k characters · ${r.url}`
    })),
    ...asked.map((r) => ({
      at: String(r.created_at),
      kind: 'asked' as const,
      title: `You asked: ${String(r.prompt).slice(0, 80)}`,
      detail: (r.kind as string) ?? '',
      actionId: Number(r.id),
      status: r.status as TimelineItem['status']
    }))
  ]
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

export async function sentToClaudeCount(sessionId: number): Promise<number> {
  const r = one(
    `select (select count(*) from suggestion_sets where session_id = $sid)
          + (select count(*) from actions where session_id = $sid)
          + (select count(*) from captures where session_id = $sid and note is not null) as n`,
    { sid: sessionId }
  )
  return Number(r?.n ?? 0)
}

export async function sessionStats(
  sessionId: number
): Promise<{ captures: number; answers: number; tabs: number }> {
  const r = one(
    `select (select count(*) from captures where session_id = $sid and status = 'committed') as captures,
            (select count(*) from actions where session_id = $sid and status = 'complete') as answers,
            (select count(distinct coalesce(url, window_title)) from captures where session_id = $sid) as tabs`,
    { sid: sessionId }
  )
  return {
    captures: Number(r?.captures ?? 0),
    answers: Number(r?.answers ?? 0),
    tabs: Number(r?.tabs ?? 0)
  }
}
