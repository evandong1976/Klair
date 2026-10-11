import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type {
  InsightRow,
  ProjectItem,
  SessionListItem,
  StuckSpot,
  TimelineItem,
  UploadStatus
} from '../shared/types'

// The local store: SQLite on this Mac (<userData>/klair.db).
//
// A PROJECT ("ML", "SW") holds everything Klair gathers: captures, notes, ideas,
// answers, activity, Chrome pages and added files all belong to the project that was
// active when they arrived. Each project has its own Graphify graph and its own
// context, and upload.ts copies it to TigerData (replacing the earlier copy).
// A SESSION holds no data: it is only a span of time (sessions), and project_spans
// records which project was active when, so a session can cover several projects.
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
  projectId: number
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
  projectId: number
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
create table if not exists projects (
  id integer primary key autoincrement,
  local_key text not null unique,
  name text not null default 'Project',
  created_at text not null default (${NOW}),
  last_used_at text,
  slot integer,
  remote_id integer,
  upload_status text not null default 'local',
  upload_error text,
  uploaded_at text
);
-- Time only: a session is a span during which the user worked in one or more projects.
create table if not exists sessions (
  id integer primary key autoincrement,
  local_key text not null unique,
  started_at text not null default (${NOW}),
  ended_at text,
  status text not null default 'active'
);
create table if not exists project_spans (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  project_id integer not null references projects(id) on delete cascade,
  started_at text not null default (${NOW}),
  ended_at text
);
create index if not exists project_spans_session_idx on project_spans (session_id, started_at);
create index if not exists project_spans_project_idx on project_spans (project_id, started_at);
-- The projects pulled into a session, in order: position 1–9 is fn N / ⌃⌥N in it.
create table if not exists session_projects (
  session_id integer not null references sessions(id) on delete cascade,
  project_id integer not null references projects(id) on delete cascade,
  position integer not null,
  added_at text not null default (${NOW}),
  primary key (session_id, project_id)
);
create table if not exists captures (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
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
create index if not exists captures_project_idx on captures (project_id, captured_at);
create table if not exists suggestion_sets (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  generation_id integer not null,
  created_at text not null default (${NOW}),
  status text not null default 'shown',
  topic text,
  suggestions text not null
);
create index if not exists suggestion_sets_project_idx on suggestion_sets (project_id, created_at);
create table if not exists actions (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
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
create index if not exists actions_project_idx on actions (project_id, created_at);
create table if not exists notes (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  action_id integer references actions(id) on delete set null,
  provenance text not null check (provenance in ('observed', 'assistant')),
  topic text,
  body text not null,
  created_at text not null default (${NOW})
);
create index if not exists notes_project_idx on notes (project_id, created_at);
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
  project_id integer not null references projects(id) on delete cascade,
  capture_id integer,
  app_name text,
  window_title text,
  url text,
  topic text,
  changed integer not null default 0,
  dwell_ms integer not null default 0
);
create index if not exists screen_activity_project_idx on screen_activity (project_id, time);
create index if not exists screen_activity_time_idx on screen_activity (time);
-- Full pages sent by the Chrome extension (extension/, bridge.ts): the whole rendered text,
-- not just what a screenshot shows. One row per distinct version of a page.
create table if not exists pages (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
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
create index if not exists pages_project_idx on pages (project_id, captured_at);
create unique index if not exists pages_hash_idx on pages (project_id, text_hash);
-- Files the user chose to add from Downloads (downloads.ts, files.ts). The file is
-- copied into the project folder; body is its extracted text (or an image description).
create table if not exists files (
  id integer primary key autoincrement,
  project_id integer not null references projects(id) on delete cascade,
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
create index if not exists files_project_idx on files (project_id, added_at);
-- TigerData projects deleted here while TigerData was unreachable; removed on the next upload run.
create table if not exists pending_remote_deletes (remote_id integer primary key);
`

/** Columns added after a table first shipped (SQLite has no "add column if not exists"). */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  // 1–9: the project's place on the fn 1–9 / ⌃⌥1–9 switcher (older databases lack it).
  ['projects', 'slot', 'integer'],
  // The Chrome page a screenshot shows, when the note model matched them.
  ['captures', 'page_id', 'integer references pages(id) on delete set null'],
  // 'auto' (the capture loop) or 'selection' (an area the user selected with ⌘S).
  ['captures', 'source', "text not null default 'auto'"],
  // The added file a note is about (files).
  ['notes', 'file_id', 'integer references files(id) on delete set null'],
  // What the project is, in a few sentences, and how many notes that was written from
  // (brief.ts). Kept on this Mac only: it is a working summary, rebuilt from the notes.
  ['projects', 'brief', 'text'],
  ['projects', 'brief_notes', 'integer not null default 0']
]

const CONTEXT_TABLES = [
  'captures',
  'suggestion_sets',
  'actions',
  'notes',
  'screen_activity',
  'pages',
  'files'
]

const columns = (d: DatabaseSync, table: string): string[] =>
  (d.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

function addColumns(d: DatabaseSync): void {
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!columns(d, table).includes(column))
      d.exec(`alter table ${table} add column ${column} ${type}`)
  }
}

/**
 * Databases from before projects: a "session" held the context. Each such session
 * becomes a project with the same id, name, slot and data, and keeps its time as a
 * session with one project span. Runs once, before the schema is applied.
 */
function migrateSessionsToProjects(d: DatabaseSync, dataDir: string | null): void {
  const old = columns(d, 'sessions')
  if (!old.includes('name')) return // a new database, or already migrated
  d.exec('pragma foreign_keys = off')
  d.exec('begin')
  try {
    d.exec(`alter table sessions rename to projects`)
    for (const t of CONTEXT_TABLES) {
      if (columns(d, t).includes('session_id'))
        d.exec(`alter table ${t} rename column session_id to project_id`)
      d.exec(`drop index if exists ${t}_session_idx`)
    }
    d.exec(`alter table projects rename column started_at to created_at`)
    d.exec(`alter table projects rename column ended_at to last_used_at`)
    // Each former session's time becomes a session with one project span.
    // Same definitions (and defaults) as a new database's.
    d.exec(`create table sessions (
      id integer primary key autoincrement, local_key text not null unique,
      started_at text not null default (${NOW}), ended_at text,
      status text not null default 'active')`)
    d.exec(`create table project_spans (
      id integer primary key autoincrement,
      session_id integer not null references sessions(id) on delete cascade,
      project_id integer not null references projects(id) on delete cascade,
      started_at text not null default (${NOW}), ended_at text)`)
    const rows = d.prepare(`select id, created_at, last_used_at from projects`).all() as {
      id: number
      created_at: string
      last_used_at: string | null
    }[]
    for (const r of rows) {
      const end = r.last_used_at ?? r.created_at
      const sid = Number(
        d
          .prepare(
            `insert into sessions (local_key, started_at, ended_at, status) values (?, ?, ?, 'ended')`
          )
          .run(randomUUID(), r.created_at, end).lastInsertRowid
      )
      d.prepare(
        `insert into project_spans (session_id, project_id, started_at, ended_at) values (?, ?, ?, ?)`
      ).run(sid, r.id, r.created_at, end)
    }
    // Projects re-upload under the new shape.
    d.exec(`update projects set upload_status = 'local', upload_error = null`)
    d.exec('commit')
  } catch (err) {
    d.exec('rollback')
    throw err
  } finally {
    d.exec('pragma foreign_keys = on')
  }
  // Their folders move from sessions/local-<id> to projects/local-<id>.
  if (!dataDir) return
  const from = join(dataDir, 'sessions')
  const to = join(dataDir, 'projects')
  if (existsSync(from)) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) {
      if (!existsSync(join(to, name))) renameSync(join(from, name), join(to, name))
    }
  }
  const swap = (table: string, col: string): void => {
    d.prepare(`update ${table} set ${col} = replace(${col}, ?, ?) where ${col} like ?`).run(
      `${from}/`,
      `${to}/`,
      `${from}/%`
    )
  }
  swap('captures', 'screenshot_path')
  swap('captures', 'note_path')
  if (columns(d, 'pages').includes('note_path')) swap('pages', 'note_path')
  if (columns(d, 'files').includes('stored_path')) {
    swap('files', 'stored_path')
    swap('files', 'note_path')
  }
}

export const SLOTS = 9

function freeSlot(d: DatabaseSync): number | null {
  const used = new Set(
    (d.prepare(`select slot from projects where slot is not null`).all() as { slot: number }[]).map(
      (r) => Number(r.slot)
    )
  )
  for (let n = 1; n <= SLOTS; n++) if (!used.has(n)) return n
  return null
}

/** Projects without a slot get the free ones, most recently used first. */
function backfillSlots(d: DatabaseSync): void {
  const rows = d
    .prepare(
      `select id from projects where slot is null order by coalesce(last_used_at, created_at) desc`
    )
    .all() as { id: number }[]
  for (const r of rows) {
    const slot = freeSlot(d)
    if (slot === null) return
    d.prepare(`update projects set slot = ? where id = ?`).run(slot, r.id)
  }
}

/** Sessions from before session_projects: their projects are the ones they have spans for. */
function backfillSessionProjects(d: DatabaseSync): void {
  d.exec(`insert or ignore into session_projects (session_id, project_id, position, added_at)
    select s.session_id, s.project_id,
           row_number() over (partition by s.session_id order by min(s.started_at)),
           min(s.started_at)
    from project_spans s
    where not exists (select 1 from session_projects x where x.session_id = s.session_id)
    group by s.session_id, s.project_id`)
}

let sqlite: DatabaseSync | null = null
let openError: string | null = null
let file: string | null = null

/** Use another database file (tests). Must be called before the first query. */
export function setDatabaseFile(path: string): void {
  sqlite?.close()
  sqlite = null
  file = path
}

function open(): DatabaseSync {
  if (sqlite) return sqlite
  try {
    const path = file ?? join(app.getPath('userData'), 'klair.db')
    const d = new DatabaseSync(path)
    d.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;')
    migrateSessionsToProjects(d, file ? null : dirname(path))
    d.exec(schema)
    addColumns(d)
    backfillSlots(d)
    backfillSessionProjects(d)
    sqlite = d
    openError = null
    return d
  } catch (err) {
    openError = (err as Error).message
    throw err
  }
}

/** Tests: migrate an old database whose folders live under `dataDir`. */
export function openForMigrationTest(path: string, dataDir: string): void {
  setDatabaseFile(path)
  const d = new DatabaseSync(path)
  d.exec('pragma foreign_keys = on')
  migrateSessionsToProjects(d, dataDir)
  d.close()
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
    return { ok: true, detail: 'SQLite ready: projects are saved on this Mac first' }
  } catch {
    return { ok: false, detail: `Local store unavailable: ${openError ?? 'unknown error'}` }
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

// ---------------------------------------------------------------- projects

function projectItem(r: Row): ProjectItem {
  return {
    id: Number(r.id),
    name: String(r.name),
    slot: r.slot == null ? null : Number(r.slot),
    createdAt: String(r.created_at),
    lastUsedAt: (r.last_used_at as string) ?? null,
    notes: r.notes == null ? 0 : Number(r.notes),
    upload: {
      status: r.upload_status as UploadStatus,
      error: (r.upload_error as string) ?? null,
      remoteId: r.remote_id == null ? null : Number(r.remote_id)
    }
  }
}

export async function createProject(name: string): Promise<ProjectItem> {
  const id = run(
    `insert into projects (local_key, name, slot, last_used_at) values (?, ?, ?, ${NOW})`,
    randomUUID(),
    name,
    freeSlot(open())
  )
  return (await getProject(id)) as ProjectItem
}

const PROJECT_COLS = `p.*, (select count(*) from notes n where n.project_id = p.id) as notes`

export async function listProjects(): Promise<ProjectItem[]> {
  return all(
    `select ${PROJECT_COLS} from projects p order by coalesce(p.last_used_at, p.created_at) desc`
  ).map(projectItem)
}

export async function getProject(id: number): Promise<ProjectItem | null> {
  const r = one(`select ${PROJECT_COLS} from projects p where p.id = ?`, id)
  return r ? projectItem(r) : null
}

export async function projectBySlot(slot: number): Promise<ProjectItem | null> {
  const r = one(`select ${PROJECT_COLS} from projects p where p.slot = ?`, slot)
  return r ? projectItem(r) : null
}

export async function projectExists(id: number): Promise<boolean> {
  return !!one(`select 1 from projects where id = ?`, id)
}

/** The project was worked in: it's recent, and it needs uploading again. */
export async function touchProject(id: number): Promise<void> {
  run(
    `update projects set last_used_at = ${NOW}, upload_status = 'local', upload_error = null where id = ?`,
    id
  )
}

/** The project's brief and how many observed notes it was last written from. */
export function getBrief(projectId: number): { brief: string; notes: number } {
  const r = one(`select brief, brief_notes from projects where id = ?`, projectId)
  return { brief: String(r?.brief ?? ''), notes: Number(r?.brief_notes ?? 0) }
}

export function setBrief(projectId: number, brief: string, notes: number): void {
  run(`update projects set brief = ?, brief_notes = ? where id = ?`, brief, notes, projectId)
}

/** How many screens have been noted into the project (answers Klair wrote don't count). */
export function observedNoteCount(projectId: number): number {
  return Number(
    one(
      `select count(*) as n from notes where project_id = ? and provenance = 'observed'`,
      projectId
    )?.n ?? 0
  )
}

/** The latest notes in a project, newest first: what the user has been working on in it. */
export async function recentNotes(
  projectId: number,
  limit: number
): Promise<{ topic: string | null; body: string }[]> {
  return all(
    `select topic, body from notes where project_id = ? order by id desc limit ?`,
    projectId,
    limit
  ).map((r) => ({ topic: (r.topic as string) ?? null, body: String(r.body) }))
}

export async function deleteProjectRows(id: number): Promise<void> {
  transaction(() => {
    // FTS rows go through the notes delete trigger; cascade alone would skip it.
    run(`delete from notes where project_id = ?`, id)
    run(`delete from projects where id = ?`, id)
  })
}

// ---------------------------------------------------------------- sessions (time only)

export async function startSession(): Promise<{ id: number; startedAt: string }> {
  // Every column set explicitly: databases migrated by an earlier build created this
  // table without defaults (and with 'ended' as the default status).
  const id = run(
    `insert into sessions (local_key, started_at, status) values (?, ${NOW}, 'active')`,
    randomUUID()
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
  if (status === 'ended') await closeSpan(id)
}

/**
 * Start working in a project within a session (closes the span that was open). A
 * project worked in is always one of the session's projects.
 */
export async function openSpan(sessionId: number, projectId: number): Promise<void> {
  await addSessionProject(sessionId, projectId)
  transaction(() => {
    run(
      `update project_spans set ended_at = ${NOW} where session_id = ? and ended_at is null`,
      sessionId
    )
    run(
      `insert into project_spans (session_id, project_id, started_at) values (?, ?, ${NOW})`,
      sessionId,
      projectId
    )
  })
  await touchProject(projectId)
}

export async function closeSpan(sessionId: number): Promise<void> {
  const open = all(
    `select project_id from project_spans where session_id = ? and ended_at is null`,
    sessionId
  )
  run(
    `update project_spans set ended_at = ${NOW} where session_id = ? and ended_at is null`,
    sessionId
  )
  for (const r of open) await touchProject(Number(r.project_id))
}

/**
 * A session's projects in the order they were pulled in (position = fn N), each with
 * the time it was active. Projects with nothing captured yet are included.
 */
export async function sessionProjects(
  sessionId: number
): Promise<{ id: number; name: string; ms: number; position: number }[]> {
  return all(
    `select p.id, p.name, m.position,
            coalesce((select sum((julianday(coalesce(s.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
                                  - julianday(s.started_at)) * 86400000)
                      from project_spans s where s.session_id = m.session_id and s.project_id = p.id), 0) as ms
     from session_projects m join projects p on p.id = m.project_id
     where m.session_id = ? order by m.position`,
    sessionId
  ).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    ms: Math.round(Number(r.ms ?? 0)),
    position: Number(r.position)
  }))
}

/** Pull a project into a session (no-op if it's already in). Returns its position. */
export async function addSessionProject(sessionId: number, projectId: number): Promise<number> {
  const had = one(
    `select position from session_projects where session_id = ? and project_id = ?`,
    sessionId,
    projectId
  )
  if (had) return Number(had.position)
  const next = Number(
    one(
      `select coalesce(max(position), 0) + 1 as n from session_projects where session_id = ?`,
      sessionId
    )?.n ?? 1
  )
  run(
    `insert into session_projects (session_id, project_id, position, added_at) values (?, ?, ?, ${NOW})`,
    sessionId,
    projectId,
    next
  )
  return next
}

/** The project at position N (fn N) in a session. */
export async function sessionProjectAt(
  sessionId: number,
  position: number
): Promise<ProjectItem | null> {
  const r = one(
    `select project_id from session_projects where session_id = ? and position = ?`,
    sessionId,
    position
  )
  return r ? getProject(Number(r.project_id)) : null
}

async function sessionItem(r: Row): Promise<SessionListItem> {
  return {
    id: Number(r.id),
    startedAt: String(r.started_at),
    endedAt: (r.ended_at as string) ?? null,
    status: r.status as SessionListItem['status'],
    projects: await sessionProjects(Number(r.id))
  }
}

export async function listSessions(): Promise<SessionListItem[]> {
  const rows = all(`select * from sessions order by started_at desc limit 50`)
  return Promise.all(rows.map(sessionItem))
}

export async function getSession(id: number): Promise<SessionListItem | null> {
  const r = one(`select * from sessions where id = ?`, id)
  return r ? sessionItem(r) : null
}

/**
 * Removes the session only (its time, spans and project list); every project keeps
 * all the context it was given in it.
 */
export async function deleteSession(id: number): Promise<void> {
  transaction(() => {
    run(`delete from session_projects where session_id = ?`, id)
    run(`delete from project_spans where session_id = ?`, id)
    run(`delete from sessions where id = ?`, id)
  })
}

export async function expiredSessionIds(days: number): Promise<number[]> {
  return all(
    `select id from sessions where status = 'ended'
       and coalesce(ended_at, started_at) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
    `-${Math.round(days)} days`
  ).map((r) => Number(r.id))
}

/**
 * Sessions left open by a crash or quit: end them (and their spans) where their
 * project's activity stops. Returns the projects worked in, so they can be uploaded.
 */
export async function endAbandonedSessions(exceptId: number | null): Promise<number[]> {
  const ids = all(`select id from sessions where status <> 'ended' and id is not ?`, exceptId).map(
    (r) => Number(r.id)
  )
  const touched = new Set<number>()
  for (const id of ids) {
    const last = one(
      `select max(a.time) as t from screen_activity a join project_spans s on s.project_id = a.project_id
       where s.session_id = ? and a.time >= s.started_at`,
      id
    )?.t as string | null
    run(
      `update project_spans set ended_at = coalesce(?, started_at) where session_id = ? and ended_at is null`,
      last ?? null,
      id
    )
    run(
      `update sessions set status = 'ended', ended_at = coalesce(?, started_at) where id = ?`,
      last ?? null,
      id
    )
    for (const p of await sessionProjects(id)) touched.add(p.id)
  }
  return [...touched]
}

/** The session's time range, for reading what happened in it across projects. */
async function sessionRange(
  sessionId: number
): Promise<{ from: string; to: string; projects: number[] } | null> {
  const s = one(`select started_at, ended_at from sessions where id = ?`, sessionId)
  if (!s) return null
  const projects = all(
    `select distinct project_id from project_spans where session_id = ?`,
    sessionId
  ).map((r) => Number(r.project_id))
  return {
    from: String(s.started_at),
    to: (s.ended_at as string) ?? new Date(Date.now() + 1000).toISOString(),
    projects
  }
}

/**
 * Old context: rows older than `days`, in every project. The projects stay. Returns
 * what to remove on disk and which projects need their graph rebuilt.
 */
export async function pruneOlderThan(days: number): Promise<{
  projects: number[]
  paths: string[]
  hashes: string[]
}> {
  const cutoff = `-${Math.round(days)} days`
  const before = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
  const paths: string[] = []
  const hashes: string[] = []
  const projects = new Set<number>()
  transaction(() => {
    for (const r of all(
      `select project_id, screenshot_path, note_path, image_hash from captures where captured_at < ${before}`,
      cutoff
    )) {
      projects.add(Number(r.project_id))
      paths.push(String(r.screenshot_path))
      if (r.note_path) paths.push(String(r.note_path))
      if (r.image_hash) hashes.push(String(r.image_hash))
    }
    for (const r of all(
      `select project_id, note_path from pages where captured_at < ${before}`,
      cutoff
    )) {
      projects.add(Number(r.project_id))
      if (r.note_path) paths.push(String(r.note_path))
    }
    for (const r of all(
      `select project_id, stored_path, note_path from files where added_at < ${before}`,
      cutoff
    )) {
      projects.add(Number(r.project_id))
      if (r.stored_path) paths.push(String(r.stored_path))
      if (r.note_path) paths.push(String(r.note_path))
    }
    run(`delete from notes where created_at < ${before}`, cutoff)
    run(`delete from actions where created_at < ${before}`, cutoff)
    run(`delete from suggestion_sets where created_at < ${before}`, cutoff)
    run(`delete from captures where captured_at < ${before}`, cutoff)
    run(`delete from pages where captured_at < ${before}`, cutoff)
    run(`delete from files where added_at < ${before}`, cutoff)
    run(`delete from screen_activity where time < ${before}`, cutoff)
  })
  for (const p of projects) await touchProject(p)
  return { projects: [...projects], paths, hashes }
}

// ---------------------------------------------------------------- upload bookkeeping

/** Projects changed since their last upload, and not in use right now. */
export async function projectsToUpload(exceptId: number | null): Promise<number[]> {
  return all(
    `select id from projects where upload_status <> 'synced' and id is not ? order by id`,
    exceptId
  ).map((r) => Number(r.id))
}

export function setUploadStatus(
  id: number,
  status: UploadStatus,
  f: { remoteId?: number; error?: string | null } = {}
): void {
  run(
    `update projects set upload_status = ?, upload_error = ?,
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

export interface ProjectExport {
  project: Row
  spans: Row[]
  captures: Row[]
  suggestionSets: Row[]
  actions: Row[]
  notes: Row[]
  activity: Row[]
  pages: Row[]
  files: Row[]
}

/** Every row of one project, read in a single snapshot, for the TigerData upload. */
export function exportProject(id: number): ProjectExport | null {
  return transaction(() => {
    const project = one(`select * from projects where id = ?`, id)
    if (!project) return null
    return {
      project,
      spans: all(
        `select s.started_at, s.ended_at, x.local_key as session_key,
                x.started_at as session_started_at, x.ended_at as session_ended_at
         from project_spans s join sessions x on x.id = s.session_id
         where s.project_id = ? order by s.started_at`,
        id
      ),
      captures: all(`select * from captures where project_id = ? order by id`, id),
      suggestionSets: all(`select * from suggestion_sets where project_id = ? order by id`, id).map(
        (r) => ({ ...r, suggestions: json(r.suggestions) })
      ),
      actions: all(`select * from actions where project_id = ? order by id`, id).map((r) => ({
        ...r,
        blocks: json(r.blocks),
        sources: json(r.sources)
      })),
      notes: all(`select * from notes where project_id = ? order by id`, id),
      activity: all(`select * from screen_activity where project_id = ? order by time`, id).map(
        (r) => ({ ...r, changed: Number(r.changed) === 1 })
      ),
      pages: all(`select * from pages where project_id = ? order by id`, id).map((r) => ({
        ...r,
        truncated: Number(r.truncated) === 1
      })),
      files: all(`select * from files where project_id = ? order by id`, id).map((r) => ({
        ...r,
        truncated: Number(r.truncated) === 1
      }))
    }
  })
}

// ---------------------------------------------------------------- pages (Chrome extension)

export interface PageRow {
  id: number
  projectId: number
  capturedAt: string
  url: string
  title: string
  body: string
  truncated: boolean
}

function pageRow(r: Row): PageRow {
  return {
    id: Number(r.id),
    projectId: Number(r.project_id),
    capturedAt: String(r.captured_at),
    url: String(r.url),
    title: (r.title as string) || String(r.url),
    body: String(r.body),
    truncated: Number(r.truncated) === 1
  }
}

export async function insertPage(p: {
  projectId: number
  url: string
  title: string
  description: string
  body: string
  textHash: string
  truncated: boolean
}): Promise<number> {
  return run(
    `insert into pages (project_id, url, title, description, body, text_hash, truncated) values (?, ?, ?, ?, ?, ?, ?)`,
    p.projectId,
    p.url,
    p.title,
    p.description,
    p.body,
    p.textHash,
    p.truncated ? 1 : 0
  )
}

export async function findPageByHash(projectId: number, textHash: string): Promise<PageRow | null> {
  const r = one(`select * from pages where project_id = ? and text_hash = ?`, projectId, textHash)
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

export async function pendingIndexPages(projectId: number): Promise<number[]> {
  return all(
    `select id from pages where project_id = ? and note_path is not null and index_status <> 'indexed'`,
    projectId
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
  projectId: number
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
    projectId: Number(r.project_id),
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
  projectId: number
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
    `insert into files (project_id, name, kind, size, original_path, stored_path, sha1, body, extract_status, truncated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.projectId,
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

/** The file most recently added to a project, if it was added after `sinceIso`. */
export async function latestFile(projectId: number, sinceIso: string): Promise<FileRow | null> {
  const r = one(
    `select * from files where project_id = ? and added_at >= ? order by id desc limit 1`,
    projectId,
    sinceIso
  )
  return r ? fileRow(r) : null
}

export async function setFileNotePath(id: number, notePath: string): Promise<void> {
  run(`update files set note_path = ? where id = ?`, notePath, id)
}

export async function pendingIndexFiles(projectId: number): Promise<number[]> {
  return all(
    `select id from files where project_id = ? and note_path is not null and index_status <> 'indexed'`,
    projectId
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
  projectId: number,
  path: string,
  meta: CaptureMeta,
  source: CaptureSource = 'auto'
): Promise<number> {
  return run(
    `insert into captures (project_id, screenshot_path, app_name, window_title, url, image_hash, status, source)
     values (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    projectId,
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

/** `notePath` is null for a capture kept out of the project's context (never indexed). */
export async function setCaptureNote(
  id: number,
  note: string,
  notePath: string | null
): Promise<void> {
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

export async function pendingIndexCaptures(projectId: number): Promise<number[]> {
  return all(
    `select id from captures where project_id = ? and status = 'committed'
       and note_path is not null and index_status <> 'indexed' order by id`,
    projectId
  ).map((r) => Number(r.id))
}

export async function capturePaths(
  projectId: number
): Promise<{ id: number; path: string; status: string }[]> {
  return all(
    `select id, screenshot_path, status from captures where project_id = ?`,
    projectId
  ).map((r) => ({ id: Number(r.id), path: String(r.screenshot_path), status: String(r.status) }))
}

export async function captureHashes(projectId: number): Promise<string[]> {
  return all(
    `select distinct image_hash from captures where project_id = ? and image_hash is not null`,
    projectId
  ).map((r) => String(r.image_hash))
}

export async function getCapture(id: number): Promise<{
  id: number
  projectId: number
  path: string
  note: string | null
  capturedAt: string
  pageId: number | null
  source: CaptureSource
} | null> {
  const r = one(
    `select id, project_id, screenshot_path, note, captured_at, page_id, source from captures where id = ? and status = 'committed'`,
    id
  )
  return r
    ? {
        id: Number(r.id),
        projectId: Number(r.project_id),
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
  projectId: number
  captureId?: number | null
  actionId?: number | null
  provenance: 'observed' | 'assistant'
  topic?: string | null
  body: string
  fileId?: number | null
}): Promise<number> {
  return run(
    `insert into notes (project_id, capture_id, action_id, provenance, topic, body, file_id) values (?, ?, ?, ?, ?, ?, ?)`,
    n.projectId,
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
 * BM25 keyword search over one project's notes. Projects are kept apart: nothing from
 * another project is ever offered as context.
 */
export async function searchNotes(
  query: string,
  opts: { projectId: number; excludeCaptureId?: number | null; limit?: number }
): Promise<NoteHit[]> {
  const match = ftsQuery(query)
  if (!match) return []
  return all(
    `select n.id, n.project_id, n.capture_id, n.provenance, n.topic, n.body, n.created_at,
            fl.name as file_name
     from notes_fts f join notes n on n.id = f.rowid
       left join files fl on fl.id = n.file_id
     where notes_fts match ?
       and n.project_id = ?
       and (? is null or n.capture_id is not ?)
     order by bm25(notes_fts) limit ?`,
    match,
    opts.projectId,
    opts.excludeCaptureId ?? null,
    opts.excludeCaptureId ?? null,
    opts.limit ?? 6
  ).map((r) => ({
    id: Number(r.id),
    projectId: Number(r.project_id),
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
    `insert into screen_activity (time, project_id, capture_id, app_name, window_title, url, topic, changed, dwell_ms)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.time.toISOString(),
        r.projectId,
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

/** Where a session's time went (by topic), across the projects worked in it. */
export async function insightsByTopic(
  sessionId: number,
  captureMs: number
): Promise<{ rows: InsightRow[]; source: 'raw' }> {
  const r = await sessionRange(sessionId)
  if (!r) return { source: 'raw', rows: [] }
  const rows = all(
    `select coalesce(topic, '') as topic, count(*) as ticks, max(dwell_ms) as max_dwell
     from screen_activity where time between ? and ?
       and project_id in (select value from json_each(?))
     group by 1 order by ticks desc limit 6`,
    r.from,
    r.to,
    JSON.stringify(r.projects)
  )
  return {
    source: 'raw',
    rows: rows.map((x) => ({
      topic: (x.topic as string) || 'Unlabelled',
      seconds: Math.round((Number(x.ticks) * captureMs) / 1000),
      maxDwellMs: Number(x.max_dwell ?? 0)
    }))
  }
}

export async function stuckSpots(sessionId: number, minDwellMs: number): Promise<StuckSpot[]> {
  const r = await sessionRange(sessionId)
  if (!r) return []
  const rows = all(
    `select s.created_at, coalesce(s.topic, '') as topic, s.suggestions,
            (select max(a.dwell_ms) from screen_activity a
              where a.project_id = s.project_id
                and a.time between strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at, '-10 minutes') and s.created_at) as dwell
     from suggestion_sets s where s.created_at between ? and ?
       and s.project_id in (select value from json_each(?))
     order by s.created_at desc limit 5`,
    r.from,
    r.to,
    JSON.stringify(r.projects)
  )
  return rows
    .filter((x) => Number(x.dwell ?? 0) >= minDwellMs)
    .map((x) => ({
      at: String(x.created_at),
      topic: (x.topic as string) || 'Unlabelled',
      dwellMs: Number(x.dwell ?? 0),
      offered: (
        ((json(x.suggestions) as { ideas?: { title: string }[] })?.ideas ?? []) as {
          title: string
        }[]
      ).map((i) => i.title)
    }))
}

// ---------------------------------------------------------------- suggestions & actions

export async function insertSuggestionSet(s: {
  projectId: number
  captureId: number | null
  generationId: number
  topic: string
  suggestions: unknown
}): Promise<number> {
  return run(
    `insert into suggestion_sets (project_id, capture_id, generation_id, topic, suggestions) values (?, ?, ?, ?, ?)`,
    s.projectId,
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
  projectId: number
  captureId: number | null
  suggestionSetId: number | null
  kind: string
  prompt: string
}): Promise<number> {
  return run(
    `insert into actions (project_id, capture_id, suggestion_set_id, kind, prompt, status) values (?, ?, ?, ?, ?, 'pending')`,
    a.projectId,
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

/** What happened during a session, across the projects worked in it (each item tagged). */
export async function timeline(sessionId: number): Promise<TimelineItem[]> {
  const r = await sessionRange(sessionId)
  if (!r) return []
  const range = [r.from, r.to, JSON.stringify(r.projects)]
  const inRange = (col: string, alias = 'x'): string =>
    `${alias}.${col} between ? and ? and ${alias}.project_id in (select value from json_each(?))`
  const names = new Map(
    all(`select id, name from projects`).map((p) => [Number(p.id), String(p.name)])
  )
  const project = (id: unknown): string | undefined => names.get(Number(id))
  const seen = all(
    `select min(x.captured_at) as at, x.project_id, coalesce(x.window_title, x.app_name, 'Screen') as title,
            coalesce(x.url, x.app_name, '') as detail, count(*) as n
     from captures x where ${inRange('captured_at')} and x.status = 'committed' and x.source = 'auto'
     group by x.project_id, 3, 4 order by at limit 40`,
    ...range
  )
  const selected = all(
    `select x.id, x.project_id, x.captured_at, coalesce(substr(x.note, 1, 90), '') as note from captures x
     where ${inRange('captured_at')} and x.status = 'committed' and x.source = 'selection' order by x.id limit 40`,
    ...range
  )
  const asked = all(
    `select x.id, x.project_id, x.created_at, x.kind, x.prompt, x.status from actions x
     where ${inRange('created_at')} order by x.created_at limit 40`,
    ...range
  )
  const pages = all(
    `select x.project_id, x.captured_at, x.title, x.url, length(x.body) as chars from pages x
     where ${inRange('captured_at')} order by x.id limit 40`,
    ...range
  )
  const added = all(
    `select x.project_id, x.added_at, x.name, x.kind, x.extract_status from files x
     where ${inRange('added_at')} order by x.id limit 40`,
    ...range
  )
  const items: TimelineItem[] = [
    ...seen.map((x, i) => {
      const n = Number(x.n)
      return {
        at: String(x.at),
        kind: (i === 0 ? 'seen' : 'switched') as TimelineItem['kind'],
        title: i === 0 ? `Read "${x.title}"` : `Switched to "${x.title}"`,
        detail: `${n} capture${n === 1 ? '' : 's'}${x.detail ? ` · ${x.detail}` : ''}`,
        project: project(x.project_id)
      }
    }),
    ...selected.map((x) => ({
      at: String(x.captured_at),
      kind: 'seen' as const,
      title: 'You selected an area of the screen',
      detail: String(x.note),
      project: project(x.project_id)
    })),
    ...added.map((x) => ({
      at: String(x.added_at),
      kind: 'switched' as const,
      title: `Added "${x.name}" from Downloads`,
      detail:
        x.extract_status === 'ok'
          ? `${x.kind} · contents read`
          : `${x.kind} · ${x.extract_status === 'unsupported' ? 'kept by name only' : 'contents not readable'}`,
      project: project(x.project_id)
    })),
    ...pages.map((x) => ({
      at: String(x.captured_at),
      kind: 'switched' as const,
      title: `Opened "${x.title || x.url}" in Chrome`,
      detail: `Full page · ${Math.round(Number(x.chars) / 1000)}k characters · ${x.url}`,
      project: project(x.project_id)
    })),
    ...asked.map((x) => ({
      at: String(x.created_at),
      kind: 'asked' as const,
      title: `You asked: ${String(x.prompt).slice(0, 80)}`,
      detail: (x.kind as string) ?? '',
      actionId: Number(x.id),
      status: x.status as TimelineItem['status'],
      project: project(x.project_id)
    }))
  ]
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

/** Model calls made during a session: notes for new screens, ideas and answers. */
export async function sentToClaudeCount(sessionId: number): Promise<number> {
  const r = await sessionRange(sessionId)
  if (!r) return 0
  const p = { from: r.from, to: r.to, ids: JSON.stringify(r.projects) }
  const scope = `project_id in (select value from json_each($ids))`
  const n = one(
    `select (select count(*) from suggestion_sets where ${scope} and created_at between $from and $to)
          + (select count(*) from actions where ${scope} and created_at between $from and $to)
          + (select count(*) from captures where ${scope} and captured_at between $from and $to
               and note is not null) as n`,
    p
  )
  return Number(n?.n ?? 0)
}

/** Counts for the active project, shown in the menu bar popover. */
export async function projectStats(
  projectId: number
): Promise<{ captures: number; answers: number; tabs: number }> {
  const r = one(
    `select (select count(*) from captures where project_id = $pid and status = 'committed') as captures,
            (select count(*) from actions where project_id = $pid and status = 'complete') as answers,
            (select count(distinct coalesce(url, window_title)) from captures where project_id = $pid) as tabs`,
    { pid: projectId }
  )
  return {
    captures: Number(r?.captures ?? 0),
    answers: Number(r?.answers ?? 0),
    tabs: Number(r?.tabs ?? 0)
  }
}
