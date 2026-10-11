import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import * as local from './local'

const dir = mkdtempSync(join(tmpdir(), 'klair-local-'))
local.setDatabaseFile(join(dir, 'klair.db'))
after(() => rmSync(dir, { recursive: true, force: true }))

async function projectWithNotes(name: string): Promise<number> {
  const { id } = await local.createProject(name)
  const cap = await local.insertPendingCapture(id, `/tmp/${name}.png`, {
    imageHash: name,
    windowTitle: name
  })
  await local.setCaptureStatus(cap, 'committed')
  await local.insertNote({
    projectId: id,
    captureId: cap,
    provenance: 'observed',
    body: `${name}: gradient descent learning rate`
  })
  await local.insertActivity([
    {
      time: new Date(),
      projectId: id,
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

test('a project round-trips through the local store and its search', async () => {
  const id = await projectWithNotes('alpha')
  const hits = await local.searchNotes('What is the learning rate?', { projectId: id })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].origin, 'local')
  assert.equal(hits[0].projectId, id)
  assert.match(hits[0].body, /alpha/)
  assert.deepEqual(await local.projectStats(id), { captures: 1, answers: 0, tabs: 1 })
  assert.equal((await local.getProject(id))?.notes, 1)
})

test("search never returns another project's notes", async () => {
  const current = await projectWithNotes('beta')
  await projectWithNotes('gamma')
  const bodies = (await local.searchNotes('gradient', { projectId: current, limit: 20 })).map(
    (h) => h.body
  )
  assert.ok(bodies.some((b) => b.startsWith('beta')))
  assert.ok(!bodies.some((b) => b.startsWith('gamma')))
})

test('projects get switcher slots and are found by them', async () => {
  const a = await local.createProject('slot-a')
  const b = await local.createProject('slot-b')
  assert.ok(a.slot !== null && b.slot !== null && a.slot !== b.slot)
  assert.equal((await local.projectBySlot(b.slot as number))?.name, 'slot-b')
  assert.ok((await local.listProjects()).some((p) => p.id === a.id))
})

test('a session holds no data: it is time, spanning the projects worked in', async () => {
  const ml = await projectWithNotes('ml-proj')
  const sw = await projectWithNotes('sw-proj')
  const s = await local.startSession()
  await local.openSpan(s.id, ml)
  await new Promise((r) => setTimeout(r, 20))
  await local.openSpan(s.id, sw) // switching closes the ML span and opens SW's
  // Something captured during the session, in SW.
  await local.insertNote({ projectId: sw, provenance: 'observed', body: 'sw-proj: a refactor' })
  await local.setSessionStatus(s.id, 'ended')

  const item = await local.getSession(s.id)
  assert.deepEqual(item?.projects.map((p) => p.id).sort(), [ml, sw].sort())
  assert.equal(item?.status, 'ended')
  assert.ok(item?.endedAt)
  // The session's timeline reads across the projects, each item tagged with its project.
  const t = await local.timeline(s.id)
  assert.ok(t.every((i) => i.project === 'ml-proj' || i.project === 'sw-proj'))
  // Deleting the session removes the time record only: the projects keep everything.
  await local.deleteSession(s.id)
  assert.equal(await local.getSession(s.id), null)
  assert.equal((await local.getProject(sw))?.notes, 2)
})

test('abandoned sessions are ended; the projects in them are queued for upload', async () => {
  const p = await projectWithNotes('delta')
  local.setUploadStatus(p, 'synced', { remoteId: 7 })
  const s = await local.startSession()
  await local.openSpan(s.id, p) // marks the project as changed again
  const touched = await local.endAbandonedSessions(null)
  assert.ok(touched.includes(p))
  assert.equal((await local.getSession(s.id))?.status, 'ended')
  assert.ok((await local.projectsToUpload(null)).includes(p))
  const data = local.exportProject(p)
  assert.ok(data)
  assert.equal(data.captures.length, 1)
  assert.equal(data.notes.length, 1)
  assert.equal(data.activity.length, 1)
  assert.equal(data.activity[0].changed, true)
  assert.equal(data.spans.length, 1)
  assert.equal(typeof data.spans[0].session_key, 'string') // spans name their session, not its data
})

test('deleting a project removes its rows and search entries', async () => {
  const id = await projectWithNotes('epsilon')
  await local.deleteProjectRows(id)
  assert.equal(await local.projectExists(id), false)
  assert.equal((await local.searchNotes('epsilon', { projectId: id })).length, 0)
})

test('Chrome pages are stored once, linked to captures and exported', async () => {
  const id = await projectWithNotes('zeta')
  const page = {
    projectId: id,
    url: 'https://en.wikipedia.org/wiki/Learning_rate',
    title: 'Learning rate',
    description: '',
    body: 'In machine learning, the learning rate is a tuning parameter…',
    textHash: 'h-zeta',
    truncated: false
  }
  const pid = await local.insertPage(page)
  await assert.rejects(local.insertPage(page)) // same version twice: unique per project
  assert.equal((await local.findPageByHash(id, 'h-zeta'))?.id, pid)
  const cap = await local.insertPendingCapture(id, '/tmp/zeta-2.png', { imageHash: 'z2' })
  await local.setCaptureStatus(cap, 'committed')
  await local.linkCaptureToPage(cap, pid)
  assert.equal((await local.getCapture(cap))?.pageId, pid)
  await local.setPageNotePath(pid, '/tmp/page.md')
  assert.deepEqual(await local.pendingIndexPages(id), [pid])
  const data = local.exportProject(id)
  assert.equal(data?.pages.length, 1)
  assert.equal(data?.captures.find((c) => c.id === cap)?.page_id, pid)
})

test('selected areas are stored as selection captures', async () => {
  const id = await projectWithNotes('eta')
  const cap = await local.insertPendingCapture(
    id,
    '/tmp/eta-sel.png',
    { imageHash: 'sel' },
    'selection'
  )
  await local.setCaptureStatus(cap, 'committed')
  assert.equal((await local.getCapture(cap))?.source, 'selection')
  assert.equal(local.exportProject(id)?.captures.find((c) => c.id === cap)?.source, 'selection')
})

test('added files are stored, searchable by content and exported', async () => {
  const id = await projectWithNotes('theta')
  const before = new Date(Date.now() - 1000).toISOString()
  const fid = await local.insertFile({
    projectId: id,
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
    projectId: id,
    fileId: fid,
    provenance: 'observed',
    topic: 'adam-paper.pdf',
    body: 'File "adam-paper.pdf": Adam combines momentum with adaptive step sizes.'
  })
  const hit = (await local.searchNotes('adaptive momentum', { projectId: id })).find((h) =>
    h.body.includes('adam-paper')
  )
  assert.equal(hit?.fileName, 'adam-paper.pdf')
  assert.equal((await local.latestFile(id, before))?.name, 'adam-paper.pdf')
  await local.setFileNotePath(fid, '/tmp/file.md')
  assert.deepEqual(await local.pendingIndexFiles(id), [fid])
  assert.equal(local.exportProject(id)?.files[0].name, 'adam-paper.pdf')
})

test('a session holds the projects pulled into it, numbered fn 1, fn 2, …', async () => {
  const swe = await projectWithNotes('swe-topic')
  const ml = await local.createProject('ml-topic')
  const os = await local.createProject('os-topic')
  // Session 1: SWE and ML. Context goes into the active project (SWE).
  const s1 = await local.startSession()
  assert.equal(await local.addSessionProject(s1.id, swe), 1)
  assert.equal(await local.addSessionProject(s1.id, ml.id), 2)
  assert.equal(await local.addSessionProject(s1.id, swe), 1) // already in: same place
  await local.openSpan(s1.id, swe)
  await local.insertNote({ projectId: swe, provenance: 'observed', body: 'swe-topic: big O' })
  await local.setSessionStatus(s1.id, 'ended')
  const one = await local.getSession(s1.id)
  // ML is in the session though nothing was captured in it.
  assert.deepEqual(
    one?.projects.map((p) => [p.position, p.name]),
    [
      [1, 'swe-topic'],
      [2, 'ml-topic']
    ]
  )
  assert.equal((await local.sessionProjectAt(s1.id, 2))?.id, ml.id)
  assert.equal(await local.sessionProjectAt(s1.id, 3), null)

  // Session 2: SWE and OS. SWE brings its context; OS starts empty.
  const s2 = await local.startSession()
  await local.addSessionProject(s2.id, swe)
  await local.addSessionProject(s2.id, os.id)
  assert.equal((await local.getProject(swe))?.notes, 2)
  assert.equal((await local.getProject(os.id))?.notes, 0)
  assert.equal((await local.searchNotes('big', { projectId: swe })).length, 1)

  // Deleting session 1 removes the session only; SWE keeps everything it was given.
  await local.deleteSession(s1.id)
  assert.equal(await local.getSession(s1.id), null)
  assert.equal((await local.getProject(swe))?.notes, 2)
  assert.deepEqual(
    (await local.getSession(s2.id))?.projects.map((p) => p.name),
    ['swe-topic', 'os-topic']
  )
})

test('a project keeps a brief and the number of notes it was written from', async () => {
  const p = await local.createProject('briefed')
  assert.deepEqual(local.getBrief(p.id), { brief: '', notes: 0 })
  assert.equal(local.observedNoteCount(p.id), 0)
  await local.insertNote({ projectId: p.id, provenance: 'observed', topic: 'a', body: 'one' })
  await local.insertNote({ projectId: p.id, provenance: 'observed', topic: 'b', body: 'two' })
  // Answers Klair wrote are not screens the user worked on.
  await local.insertNote({ projectId: p.id, provenance: 'assistant', topic: 'c', body: 'three' })
  assert.equal(local.observedNoteCount(p.id), 2)
  local.setBrief(p.id, 'Building an Electron app in a terminal.', 2)
  assert.deepEqual(local.getBrief(p.id), {
    brief: 'Building an Electron app in a terminal.',
    notes: 2
  })
})

test('a project keeps the type it was given; without one it is guessed from the name', async () => {
  const guessed = await local.createProject('Thesis research')
  assert.equal(guessed.type, 'research')
  const chosen = await local.createProject('Thesis research', 'work')
  assert.equal(chosen.type, 'work')
  local.setProjectType(guessed.id, 'study')
  assert.equal((await local.getProject(guessed.id))?.type, 'study')
  // An older project with a brief and no type: the brief decides.
  const old = await local.createProject('ML')
  assert.equal(old.type, 'work')
  local.setBrief(old.id, 'The project is studying machine learning from course PDFs.', 2)
  assert.equal((await local.getProject(old.id))?.type, 'study')
})
