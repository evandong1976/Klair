import type { PoolClient } from 'pg'
import { capabilities, deleteProjectRows, getPool, requirePool } from './db'
import * as local from './local'

// Copies a project from the Mac's SQLite store to TigerData, all or nothing, in one
// transaction: every row of its context plus its time spans. Each table goes up in a
// single insert (jsonb_to_recordset), with local ids carried along so foreign keys can
// be remapped to TigerData's ids. The earlier copy with the same local_key is replaced,
// so a project is never stored twice. Projects upload after each session they were
// worked in (and when retried); on success the local project records its TigerData id.

const running = new Map<number, Promise<boolean>>()
let sweep: Promise<void> | null = null

type Row = Record<string, unknown>
type IdMap = Map<number, number>

async function insertRows(client: PoolClient, sql: string, rows: Row[]): Promise<IdMap> {
  const map: IdMap = new Map()
  if (rows.length === 0) return map
  const res = await client.query(sql, [JSON.stringify(rows)])
  for (const r of res.rows) map.set(Number(r.local_id), Number(r.id))
  return map
}

const remap = (map: IdMap, id: unknown): number | null =>
  id == null ? null : (map.get(Number(id)) ?? null)

async function copy(client: PoolClient, data: local.ProjectExport): Promise<number> {
  const p = data.project
  await client.query(`delete from projects where local_key = $1`, [p.local_key])
  const { rows } = await client.query(
    `insert into projects (name, created_at, last_used_at, local_key)
     values ($1, $2, $3, $4) returning id`,
    [p.name, p.created_at, p.last_used_at ?? p.created_at, p.local_key]
  )
  const sid = Number(rows[0].id)

  // When the project was worked in, per session (sessions themselves hold no data).
  if (data.spans.length) {
    await client.query(
      `insert into project_spans (project_id, session_key, session_started_at, session_ended_at,
         started_at, ended_at)
       select ${sid}, session_key, session_started_at, session_ended_at, started_at, ended_at
       from jsonb_to_recordset($1::jsonb) as x(session_key text, session_started_at timestamptz,
         session_ended_at timestamptz, started_at timestamptz, ended_at timestamptz)`,
      [JSON.stringify(data.spans)]
    )
  }

  const pages = await insertRows(
    client,
    `insert into pages (project_id, captured_at, url, title, description, body, text_hash, truncated,
       note_path, index_status, local_id)
     select ${sid}, captured_at, url, title, description, body, text_hash, truncated,
       note_path, index_status, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, captured_at timestamptz, url text, title text,
       description text, body text, text_hash text, truncated boolean, note_path text,
       index_status text)
     returning id, local_id`,
    data.pages
  )

  const captures = await insertRows(
    client,
    `insert into captures (project_id, captured_at, screenshot_path, note, app_name, window_title,
       url, image_hash, status, index_status, note_path, page_id, source, local_id)
     select ${sid}, captured_at, screenshot_path, note, app_name, window_title,
       url, image_hash, status, index_status, note_path, page_id, coalesce(source, 'auto'), id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, captured_at timestamptz, screenshot_path text,
       note text, app_name text, window_title text, url text, image_hash text, status text,
       index_status text, note_path text, page_id bigint, source text)
     returning id, local_id`,
    data.captures.map((r) => ({ ...r, page_id: remap(pages, r.page_id) }))
  )

  const sets = await insertRows(
    client,
    `insert into suggestion_sets (project_id, capture_id, generation_id, created_at, status, topic,
       suggestions, local_id)
     select ${sid}, capture_id, generation_id, created_at, status, topic, suggestions, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, capture_id bigint, generation_id integer,
       created_at timestamptz, status text, topic text, suggestions jsonb)
     returning id, local_id`,
    data.suggestionSets.map((r) => ({ ...r, capture_id: remap(captures, r.capture_id) }))
  )

  const actions = await insertRows(
    client,
    `insert into actions (project_id, capture_id, suggestion_set_id, created_at, kind, prompt, result,
       status, blocks, sources, tokens_in, tokens_out, completed_at, local_id)
     select ${sid}, capture_id, suggestion_set_id, created_at, kind, prompt, result,
       status, blocks, sources, tokens_in, tokens_out, completed_at, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, capture_id bigint, suggestion_set_id bigint,
       created_at timestamptz, kind text, prompt text, result text, status text, blocks jsonb,
       sources jsonb, tokens_in integer, tokens_out integer, completed_at timestamptz)
     returning id, local_id`,
    data.actions.map((r) => ({
      ...r,
      capture_id: remap(captures, r.capture_id),
      suggestion_set_id: remap(sets, r.suggestion_set_id)
    }))
  )

  const files = await insertRows(
    client,
    `insert into files (project_id, added_at, name, kind, size, original_path, stored_path, sha1,
       body, extract_status, truncated, note_path, index_status, local_id)
     select ${sid}, added_at, name, kind, size, original_path, stored_path, sha1,
       body, extract_status, truncated, note_path, index_status, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, added_at timestamptz, name text, kind text,
       size bigint, original_path text, stored_path text, sha1 text, body text,
       extract_status text, truncated boolean, note_path text, index_status text)
     returning id, local_id`,
    data.files
  )

  await insertRows(
    client,
    `insert into notes (project_id, capture_id, action_id, file_id, provenance, topic, body,
       created_at, local_id)
     select ${sid}, capture_id, action_id, file_id, provenance, topic, body, created_at, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, capture_id bigint, action_id bigint,
       file_id bigint, provenance text, topic text, body text, created_at timestamptz)
     returning id, local_id`,
    data.notes.map((r) => ({
      ...r,
      capture_id: remap(captures, r.capture_id),
      action_id: remap(actions, r.action_id),
      file_id: remap(files, r.file_id)
    }))
  )

  // The activity time-series can be long (one row per capture tick), so it goes in chunks.
  const activity = data.activity.map((r) => ({ ...r, capture_id: remap(captures, r.capture_id) }))
  for (let i = 0; i < activity.length; i += 2000) {
    await client.query(
      `insert into screen_activity (time, project_id, capture_id, app_name, window_title, url, topic,
         changed, dwell_ms)
       select time, ${sid}, capture_id, app_name, window_title, url, topic, changed, dwell_ms
       from jsonb_to_recordset($1::jsonb) as x(time timestamptz, capture_id bigint, app_name text,
         window_title text, url text, topic text, changed boolean, dwell_ms integer)`,
      [JSON.stringify(activity.slice(i, i + 2000))]
    )
  }
  return sid
}

async function doUpload(localId: number): Promise<boolean> {
  const data = local.exportProject(localId)
  if (!data) return false
  local.setUploadStatus(localId, 'uploading')
  const t = Date.now()
  let client: PoolClient | null = null
  try {
    client = await requirePool().connect()
    await client.query('begin')
    const remoteId = await copy(client, data)
    await client.query('commit')
    if (!(await local.projectExists(localId))) {
      // Deleted on the Mac while uploading: don't leave a copy behind in TigerData.
      await removeRemote(remoteId)
      return false
    }
    local.setUploadStatus(localId, 'synced', { remoteId })
    console.log(
      `tigerdata: uploaded project ${localId} → ${remoteId} (${data.captures.length} captures, ` +
        `${data.pages.length} pages, ${data.files.length} files, ${data.notes.length} notes, ` +
        `${data.activity.length} activity rows, ${data.spans.length} spans, ${Date.now() - t} ms)`
    )
    if (capabilities.continuousAggregate) {
      // Uploaded activity is older than the aggregate's refresh window; materialize it now.
      void requirePool()
        .query(`call refresh_continuous_aggregate('activity_by_minute', $1::timestamptz, now())`, [
          data.project.created_at
        ])
        .catch(() => undefined)
    }
    return true
  } catch (err) {
    await client?.query('rollback').catch(() => undefined)
    const msg = (err as Error).message.slice(0, 200)
    console.warn(`tigerdata: upload of project ${localId} failed: ${msg}`)
    if (await local.projectExists(localId)) local.setUploadStatus(localId, 'failed', { error: msg })
    return false
  } finally {
    client?.release()
  }
}

/** Upload one project. Concurrent calls for the same project share one run. */
export function uploadProject(localId: number): Promise<boolean> {
  if (!getPool()) {
    local.setUploadStatus(localId, 'failed', { error: 'DATABASE_URL is not set' })
    return Promise.resolve(false)
  }
  let p = running.get(localId)
  if (!p) {
    p = doUpload(localId).finally(() => running.delete(localId))
    running.set(localId, p)
  }
  return p
}

async function removeRemote(remoteId: number): Promise<void> {
  try {
    await deleteProjectRows(remoteId)
    local.clearRemoteDelete(remoteId)
  } catch {
    local.queueRemoteDelete(remoteId)
  }
}

/** Delete a project's TigerData copy now, or queue it if TigerData can't be reached. */
export async function deleteRemote(remoteId: number): Promise<void> {
  if (!getPool()) return local.queueRemoteDelete(remoteId)
  await removeRemote(remoteId)
}

/** Retry everything outstanding: queued deletes, then projects changed since their upload. */
export function uploadPending(): Promise<void> {
  if (!getPool()) return Promise.resolve()
  sweep ??= (async () => {
    for (const id of local.pendingRemoteDeletes()) await removeRemote(id)
    for (const id of await local.projectsToUpload(null)) await uploadProject(id)
  })()
    .catch((err) => console.warn('tigerdata: upload sweep failed:', (err as Error).message))
    .finally(() => {
      sweep = null
    })
  return sweep
}
