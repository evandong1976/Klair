import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import * as local from './local'

// A database from before projects, where a "session" held the context, becomes one
// where each such session is a project (same id, name, slot and data), its time is a
// session with one project span, and its folder moves from sessions/ to projects/.

const dir = mkdtempSync(join(tmpdir(), 'klair-migrate-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('sessions that held context become projects; their time becomes sessions', async () => {
  const dbPath = join(dir, 'klair.db')
  const shot = join(dir, 'sessions', 'local-1', 'shots', 'a.png')
  mkdirSync(join(dir, 'sessions', 'local-1', 'shots'), { recursive: true })
  writeFileSync(shot, 'png')

  const old = new DatabaseSync(dbPath)
  old.exec(readFileSync(join(__dirname, 'testdata', 'sessions-era-schema.sql'), 'utf8'))
  old.exec(`insert into sessions (local_key, name, status, started_at, ended_at, slot, upload_status)
            values ('k1', 'ML study', 'ended', '2026-10-10T10:00:00.000Z', '2026-10-10T11:00:00.000Z', 3, 'synced')`)
  old
    .prepare(
      `insert into captures (session_id, screenshot_path, status, note) values (1, ?, 'committed', 'x')`
    )
    .run(shot)
  old.exec(`insert into notes (session_id, capture_id, provenance, body)
            values (1, 1, 'observed', 'gradient descent notes')`)
  old.exec(
    `insert into screen_activity (time, session_id, changed) values ('2026-10-10T10:30:00.000Z', 1, 1)`
  )
  old.close()

  local.openForMigrationTest(dbPath, dir)

  const p = await local.getProject(1)
  assert.equal(p?.name, 'ML study')
  assert.equal(p?.slot, 3)
  assert.equal(p?.createdAt, '2026-10-10T10:00:00.000Z')
  assert.equal(p?.upload.status, 'local') // re-uploaded under the new shape
  // Its context came along, and search finds it in the project.
  const hits = await local.searchNotes('gradient', { projectId: 1 })
  assert.equal(hits.length, 1)
  // Its time is now a session with one span on that project.
  const sessions = await local.listSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].startedAt, '2026-10-10T10:00:00.000Z')
  assert.deepEqual(
    sessions[0].projects.map((x) => x.name),
    ['ML study']
  )
  // The folder moved and the stored path points to it.
  const moved = join(dir, 'projects', 'local-1', 'shots', 'a.png')
  assert.ok(existsSync(moved))
  assert.equal((await local.getCapture(1))?.path, moved)
  // Opening again doesn't migrate twice.
  local.setDatabaseFile(dbPath)
  assert.equal((await local.listProjects()).length, 1)
})
