import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import * as local from './local'

const dir = mkdtempSync(join(tmpdir(), 'klair-local-'))
local.useDatabaseFile(join(dir, 'klair.db'))
after(() => rmSync(dir, { recursive: true, force: true }))

async function sessionWithNotes(name: string): Promise<number> {
  const { id } = await local.createSession(name)
  const cap = await local.insertPendingCapture(id, `/tmp/${name}.png`, {
    imageHash: name,
    windowTitle: name
  })
  await local.setCaptureStatus(cap, 'committed')
  await local.insertNote({
    sessionId: id,
    captureId: cap,
    provenance: 'observed',
    body: `${name}: gradient descent learning rate`
  })
  await local.insertActivity([
    {
      time: new Date(),
      sessionId: id,
      captureId: cap,
      appName: 'Safari',
      windowTitle: name,
      url: null,
      topic: 'ML',
      changed: true,
      dwellMs: 0
    }
  ])
  return id
}

test('a session round-trips through the local store and its search', async () => {
  const id = await sessionWithNotes('alpha')
  const hits = await local.searchNotes('What is the learning rate?', { sessionId: id })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].origin, 'local')
  assert.match(hits[0].body, /alpha/)
  assert.deepEqual(await local.sessionStats(id), { captures: 1, answers: 0, tabs: 1 })
  assert.equal((await local.timeline(id))[0].kind, 'seen')
})

test('search skips other sessions once they are in TigerData', async () => {
  const current = await sessionWithNotes('beta')
  const earlier = await sessionWithNotes('gamma')
  const bodies = async (): Promise<string[]> =>
    (await local.searchNotes('gradient', { sessionId: current, limit: 20 })).map((h) => h.body)
  assert.ok((await bodies()).some((b) => b.startsWith('gamma')))
  await local.setSessionStatus(earlier, 'ended')
  local.setUploadStatus(earlier, 'synced', { remoteId: 99 })
  assert.ok(!(await bodies()).some((b) => b.startsWith('gamma')))
  assert.ok((await bodies()).some((b) => b.startsWith('beta')))
})

test('abandoned sessions are ended and queued for upload; export carries every row', async () => {
  const id = await sessionWithNotes('delta')
  const ended = await local.endAbandonedSessions(null)
  assert.ok(ended.includes(id))
  assert.ok((await local.sessionsToUpload()).includes(id))
  const data = local.exportSession(id)
  assert.ok(data)
  assert.equal(data.session.status, 'ended')
  assert.equal(data.captures.length, 1)
  assert.equal(data.notes.length, 1)
  assert.equal(data.activity.length, 1)
  assert.equal(data.activity[0].changed, true)
})

test('deleting a session removes its rows and search entries', async () => {
  const id = await sessionWithNotes('epsilon')
  await local.deleteSessionRows(id)
  assert.equal(await local.sessionExists(id), false)
  const hits = await local.searchNotes('epsilon', { sessionId: id })
  assert.equal(hits.length, 0)
})
