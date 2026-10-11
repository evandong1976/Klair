import type { PoolClient } from 'pg'
import { capabilities, deleteSessionRows, getPool, requirePool } from './db'
import * as local from './local'

// Copies an ended session from the Mac's SQLite store to TigerData, all or nothing,
// in one transaction. Each table goes up in a single insert (jsonb_to_recordset), with
// local ids carried along so foreign keys can be remapped to TigerData's ids.
// A retry first removes any earlier copy with the same local_key, so a session is
// never stored twice. On success the local session records its TigerData id.

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

async function copy(client: PoolClient, data: local.SessionExport): Promise<number> {
  const s = data.session
  await client.query(`delete from sessions where local_key = $1`, [s.local_key])
  const { rows } = await client.query(
    `insert into sessions (name, status, started_at, ended_at, local_key)
     values ($1, 'ended', $2, $3, $4) returning id`,
    [s.name, s.started_at, s.ended_at ?? s.started_at, s.local_key]
  )
  const sid = Number(rows[0].id)

  const pages = await insertRows(
    client,
    `insert into pages (session_id, captured_at, url, title, description, body, text_hash, truncated,
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
    `insert into captures (session_id, captured_at, screenshot_path, note, app_name, window_title,
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
    `insert into suggestion_sets (session_id, capture_id, generation_id, created_at, status, topic,
       suggestions, local_id)
     select ${sid}, capture_id, generation_id, created_at, status, topic, suggestions, id
     from jsonb_to_recordset($1::jsonb) as x(id bigint, capture_id bigint, generation_id integer,
       created_at timestamptz, status text, topic text, suggestions jsonb)
     returning id, local_id`,
    data.suggestionSets.map((r) => ({ ...r, capture_id: remap(captures, r.capture_id) }))
  )

  const actions = await insertRows(
    client,
    `insert into actions (session_id, capture_id, suggestion_set_id, created_at, kind, prompt, result,
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
    `insert into files (session_id, added_at, name, kind, size, original_path, stored_path, sha1,
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
    `insert into notes (session_id, capture_id, action_id, file_id, provenance, topic, body,
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
      `insert into screen_activity (time, session_id, capture_id, app_name, window_title, url, topic,
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
  const data = local.exportSession(localId)
  if (!data) return false
  if (data.session.status !== 'ended') return false
  local.setUploadStatus(localId, 'uploading')
  const t = Date.now()
  let client: PoolClient | null = null
  try {
    client = await requirePool().connect()
    await client.query('begin')
    const remoteId = await copy(client, data)
    await client.query('commit')
    if (!(await local.sessionExists(localId))) {
      // Deleted on the Mac while uploading: don't leave a copy behind in TigerData.
      await removeRemote(remoteId)
      return false
    }
    local.setUploadStatus(localId, 'synced', { remoteId })
    console.log(
      `tigerdata: uploaded session ${localId} → ${remoteId} (${data.captures.length} captures, ` +
        `${data.pages.length} pages, ${data.files.length} files, ` +
        `${data.notes.length} notes, ${data.activity.length} activity rows, ${Date.now() - t} ms)`
    )
    if (capabilities.continuousAggregate) {
      // Uploaded activity is older than the aggregate's refresh window; materialize it now.
      void requirePool()
        .query(`call refresh_continuous_aggregate('activity_by_minute', $1::timestamptz, now())`, [
          data.session.started_at
        ])
        .catch(() => undefined)
    }
    return true
  } catch (err) {
    await client?.query('rollback').catch(() => undefined)
    const msg = (err as Error).message.slice(0, 200)
    console.warn(`tigerdata: upload of session ${localId} failed: ${msg}`)
    if (await local.sessionExists(localId)) local.setUploadStatus(localId, 'failed', { error: msg })
    return false
  } finally {
    client?.release()
  }
}

/** Upload one ended session. Concurrent calls for the same session share one run. */
export function uploadSession(localId: number): Promise<boolean> {
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
    await deleteSessionRows(remoteId)
    local.clearRemoteDelete(remoteId)
  } catch {
    local.queueRemoteDelete(remoteId)
  }
}

/** Delete a session's TigerData copy now, or queue it if TigerData can't be reached. */
export async function deleteRemote(remoteId: number): Promise<void> {
  if (!getPool()) return local.queueRemoteDelete(remoteId)
  await removeRemote(remoteId)
}

/** Retry everything outstanding: queued deletes, then ended sessions not yet uploaded. */
export function uploadPending(): Promise<void> {
  if (!getPool()) return Promise.resolve()
  sweep ??= (async () => {
    for (const id of local.pendingRemoteDeletes()) await removeRemote(id)
    for (const id of await local.sessionsToUpload()) await uploadSession(id)
  })()
    .catch((err) => console.warn('tigerdata: upload sweep failed:', (err as Error).message))
    .finally(() => {
      sweep = null
    })
  return sweep
}
