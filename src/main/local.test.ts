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

test("search never returns another session's notes", async () => {
  const current = await sessionWithNotes('beta')
  await sessionWithNotes('gamma')
  const bodies = (await local.searchNotes('gradient', { sessionId: current, limit: 20 })).map(
    (h) => h.body
  )
  assert.ok(bodies.some((b) => b.startsWith('beta')))
  assert.ok(!bodies.some((b) => b.startsWith('gamma')))
})

test('sessions get switcher slots, and an ended one can be continued', async () => {
  const { id } = await local.createSession('slotted')
  const slot = (await local.getSession(id))?.slot
  assert.ok(slot && slot >= 1 && slot <= local.SLOTS)
  assert.equal((await local.sessionBySlot(slot))?.id, id)

  await local.setSessionStatus(id, 'ended')
  local.setUploadStatus(id, 'synced', { remoteId: 7 })
  await local.reopenSession(id)
  const s = await local.getSession(id)
  assert.equal(s?.status, 'active')
  assert.equal(s?.endedAt, null)
  assert.equal(s?.upload.status, 'local') // changed since upload, so it uploads again
  assert.equal(s?.slot, slot)

  // Only nine sessions hold a slot; the rest have none until one is freed.
  for (let i = 0; i < local.SLOTS + 1; i++) await local.createSession(`extra-${i}`)
  const slots = (await local.listSessions()).map((x) => x.slot).filter((x) => x !== null)
  assert.equal(new Set(slots).size, slots.length)
  assert.equal(slots.length, local.SLOTS)
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

test('Chrome pages are stored once, linked to captures and exported', async () => {
  const id = await sessionWithNotes('zeta')
  const page = {
    sessionId: id,
    url: 'https://en.wikipedia.org/wiki/Learning_rate',
    title: 'Learning rate',
    description: '',
    body: 'In machine learning, the learning rate is a tuning parameter…',
    textHash: 'h-zeta',
    truncated: false
  }
  const pid = await local.insertPage(page)
  await assert.rejects(local.insertPage(page)) // same version twice: unique per session
  assert.equal((await local.findPageByHash(id, 'h-zeta'))?.id, pid)
  const cap = await local.insertPendingCapture(id, '/tmp/zeta-2.png', { imageHash: 'z2' })
  await local.setCaptureStatus(cap, 'committed')
  await local.linkCaptureToPage(cap, pid)
  assert.equal((await local.getCapture(cap))?.pageId, pid)
  assert.deepEqual(await local.pendingIndexPages(id), [])
  await local.setPageNotePath(pid, '/tmp/page.md')
  assert.deepEqual(await local.pendingIndexPages(id), [pid])
  const data = local.exportSession(id)
  assert.equal(data?.pages.length, 1)
  assert.equal(data?.captures.find((c) => c.id === cap)?.page_id, pid)
  assert.ok((await local.timeline(id)).some((t) => t.title.includes('Learning rate')))
})

test('selected areas are stored as selection captures', async () => {
  const id = await sessionWithNotes('eta')
  const cap = await local.insertPendingCapture(
    id,
    '/tmp/eta-sel.png',
    { imageHash: 'sel' },
    'selection'
  )
  await local.setCaptureStatus(cap, 'committed')
  await local.setCaptureNote(cap, 'A loss curve against learning rate', '/tmp/n.md')
  assert.equal((await local.getCapture(cap))?.source, 'selection')
  const t = await local.timeline(id)
  assert.ok(t.some((i) => i.title === 'You selected an area of the screen'))
  // Selections don't merge into the "Read …" rows of automatic captures.
  assert.equal(t.filter((i) => i.title.startsWith('Read')).length, 1)
  assert.equal(local.exportSession(id)?.captures.find((c) => c.id === cap)?.source, 'selection')
})

test('added files are stored, searchable by content and exported', async () => {
  const id = await sessionWithNotes('theta')
  const before = new Date(Date.now() - 1000).toISOString()
  const fid = await local.insertFile({
    sessionId: id,
    name: 'adam-paper.pdf',
    kind: 'pdf',
    size: 120_000,
    originalPath: '/Users/x/Downloads/adam-paper.pdf',
    storedPath: '/tmp/adam-paper.pdf',
    sha1: 'abc',
    body: 'Adam combines momentum with per-parameter adaptive step sizes.',
    extractStatus: 'ok',
    truncated: false
  })
  await local.insertNote({
    sessionId: id,
    fileId: fid,
    provenance: 'observed',
    topic: 'adam-paper.pdf',
    body: 'File "adam-paper.pdf": Adam combines momentum with adaptive step sizes.'
  })
  const hit = (await local.searchNotes('adaptive momentum', { sessionId: id })).find((h) =>
    h.body.includes('adam-paper')
  )
  assert.equal(hit?.fileName, 'adam-paper.pdf')
  assert.equal((await local.latestFile(id, before))?.name, 'adam-paper.pdf')
  assert.equal(await local.latestFile(id, new Date(Date.now() + 60_000).toISOString()), null)
  await local.setFileNotePath(fid, '/tmp/file.md')
  assert.deepEqual(await local.pendingIndexFiles(id), [fid])
  const data = local.exportSession(id)
  assert.equal(data?.files[0].name, 'adam-paper.pdf')
  assert.equal(data?.notes.find((n) => n.file_id === fid)?.topic, 'adam-paper.pdf')
  assert.ok(
    (await local.timeline(id)).some((t) => t.title === 'Added "adam-paper.pdf" from Downloads')
  )
})
