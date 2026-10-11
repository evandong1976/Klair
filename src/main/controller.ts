import { app, systemPreferences } from 'electron'
import { createReadStream, existsSync } from 'fs'
import { copyFile, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AnswerOutput } from '../shared/blocks'
import type {
  ProjectItem,
  DownloadOffer,
  SelectionRect,
  Provenance,
  AnswerState,
  InsightRow,
  StuckSpot,
  Idea,
  KlairState,
  Notice,
  SessionDetail,
  SuggestionSet
} from '../shared/types'
import { createHash, randomUUID } from 'crypto'
import { cache } from './cache'
import { captureArea, CaptureLoop, type Frame } from './capture'
import { belongsInProject, changeJudgeEnabled, judgeScreen, thumbnail } from './judge'
import { config } from './config'
import { ControllerCore, type Effect } from './controller-core'
import * as db from './db'
import { DownloadWatcher, type Download } from './downloads'
import { extractText, fileKind, imageForModel } from './files'
import * as store from './local'
import { answerToText, runAssistance } from './execute'
import { pickHighlights, samePage, type HighlightSet } from './highlights'
import { lastHealth, runHealth } from './health'
import { cancelIndex, scheduleIndex } from './indexer'
import {
  describeImage,
  makeVisionNote,
  writeNoteFile,
  type PageContext,
  type VisionNote
} from './notes'
import { filesDir, notesDir, PROJECT_DIR_PREFIX, projectDir, projectsRoot, shotsDir } from './paths'
import { retrieve } from './retrieve'
import { getState, setState } from './state'
import { suggestionsFromNote } from './suggest'
import { deleteRemote, uploadPending } from './upload'
import * as windows from './windows'

// The background controller: owns the session (time) and the active project (where
// everything captured goes), the suggestion set, execution state and every write. Decisions about *when* things may happen live in ControllerCore;
// this module carries out the effects.

const core = new ControllerCore({
  dwellMs: config.dwellMs,
  cooldownMs: config.cooldownMs,
  dismissQuietMs: config.dismissQuietMs
})

interface CaptureMem {
  id: number
  path: string
  capturedAt: string
  note: VisionNote | null
  /** The Chrome page this screenshot shows, when the note model matched them. */
  pageId: number | null
  source: store.CaptureSource
}

/** The running session: only a span of time. */
let sessionId: number | null = null
/** The active project: everything captured now goes into it. */
let projectId: number | null = null
let loop: CaptureLoop | null = null
let tickTimer: NodeJS.Timeout | null = null
let flushTimer: NodeJS.Timeout | null = null
let statsTimer: NodeJS.Timeout | null = null
let lastChangeAt = Date.now()
let currentTopic: string | null = null
let lastMeta: Frame['meta'] = { appName: null, windowTitle: null, url: null }
/** Small copy of the last screenshot that was noted: what a new one is compared with. */
let notedThumb: Buffer | null = null
let activity: store.ActivityRow[] = []
const captures = new Map<number, CaptureMem>()
const notePromises = new Map<number, Promise<VisionNote | null>>()
const setDbIds = new Map<string, number>()

let exec: { abort: AbortController; token: number } | null = null
let execToken = 0
let lastRun: Parameters<typeof execute>[0] | null = null
let lastOutput: AnswerOutput | null = null
let lastAnswerCaptureId: number | null = null
let staleTimer: NodeJS.Timeout | null = null

// The page most recently opened in Chrome (Chrome extension → bridge.ts). Offered to the
// note model with each new screenshot, which says whether the screenshot shows it.
const LIVE_PAGE_MS = 30 * 60_000
let livePage: (PageContext & { id: number; at: number }) | null = null
// Passages marked on a Chrome page for the latest answer about it (highlights.ts). The
// extension asks for them by URL; a new answer, project or session clears them.
let pageHighlights: HighlightSet | null = null

// ------------------------------------------------------------------ helpers

function notice(n: Notice | null): void {
  setState({ notice: n })
}

/** Nothing on screen to help with: grey flower, no nudge, no new ideas (see judge.ts). */
function setIdle(idle: boolean): void {
  if (getState().idle === idle) return
  setState(idle ? { idle, nudge: false } : { idle })
}

/** A notice that clears itself, e.g. "Now in ML study" after switching sessions. */
function flash(n: Notice, ms = 2500): void {
  notice(n)
  setTimeout(() => {
    if (getState().notice === n) notice(null)
  }, ms)
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function persistenceFailed(err: unknown): void {
  console.error('persistence failed:', err)
  loop?.stop()
  setState({ saving: false, notice: { kind: 'not-saving', detail: (err as Error)?.message } })
}

function apply(effects: Effect[]): void {
  for (const e of effects) {
    switch (e.type) {
      case 'requestSuggestions':
        void doSuggest(e.generationId, e.captureId)
        break
      case 'publishSuggestions':
        setState({ suggestions: e.set, nudge: getState().panel === 'closed' && !getState().idle })
        if (projectId) {
          const sid = projectId
          store
            .insertSuggestionSet({
              projectId: sid,
              captureId: e.set.captureId,
              generationId: e.set.generationId,
              topic: e.set.topic,
              suggestions: e.set
            })
            .then((id) => setDbIds.set(e.set.id, id))
            .catch((err) => console.warn('suggestion set not saved:', err.message))
        }
        break
      case 'invalidateSuggestions': {
        const dbId = setDbIds.get(e.set.id)
        if (dbId)
          void store
            .setSuggestionStatus(dbId, e.reason === 'changed' ? 'stale' : 'dismissed')
            .catch(() => {})
        const wasNudging = getState().nudge
        setState({ suggestions: null, nudge: false })
        if (e.reason === 'changed' && wasNudging) {
          notice({ kind: 'stale' })
          if (staleTimer) clearTimeout(staleTimer)
          staleTimer = setTimeout(() => {
            if (getState().notice?.kind === 'stale') notice(null)
          }, 3000)
        }
        break
      }
      case 'execute':
        void execute({
          set: e.set,
          idea: e.idea,
          captureId: e.captureId,
          kind: e.idea.kind,
          task: e.idea.prompt
        })
        break
      case 'rejectSelection':
        break
    }
  }
}

// ------------------------------------------------------------------ projects & sessions
//
// A project ("ML", "SW") holds everything: captures, notes, ideas, answers, pages and
// files go into the active project. A session is only the time the user spends
// working, possibly across several projects; project_spans records which was active.

/** Why Klair can't observe right now, shown to the user; null when it can. */
async function cannotObserve(): Promise<Notice | null> {
  const health = lastHealth() ?? (await runHealth({ skipModel: true }))
  if (!health.checks.find((c) => c.id === 'screen' && c.status === 'ok')) {
    return { kind: 'screen-access' }
  }
  // Everything is saved on this Mac (SQLite) first, so only the local store has to work.
  const localStore = store.localStatus()
  return localStore.ok ? null : { kind: 'not-saving', detail: localStore.detail }
}

/** Make `p` the active project. Nothing from the previous project's screen carries over. */
async function enterProject(p: { id: number; name: string; slot: number | null }): Promise<void> {
  await flushActivity() // buffered activity belongs to the project it was seen in
  cancelExecution()
  projectId = p.id
  captures.clear()
  notePromises.clear()
  livePage = null
  pageHighlights = null
  currentTopic = null
  notedThumb = null
  core.resetContext()
  lastOutput = null
  lastRun = null
  lastAnswerCaptureId = null
  offered.clear() // download offers belong to the project they appeared in
  setState({
    project: { id: p.id, name: p.name, slot: p.slot },
    notice: null,
    suggestions: null,
    answer: null,
    lastAnswerTitle: null,
    nudge: false,
    selection: null,
    idle: false,
    downloads: [],
    stats: await store.projectStats(p.id).catch(() => ({ captures: 0, answers: 0, tabs: 0 }))
  })
}

/** Publish the session's projects (fn 1–9 order) and the active one's position. */
async function syncSessionProjects(): Promise<void> {
  const list = sessionId ? await store.sessionProjects(sessionId).catch(() => []) : []
  const sessionProjects = list.map((p) => ({ id: p.id, name: p.name, slot: p.position }))
  setState({
    sessionProjects,
    project: sessionProjects.find((p) => p.id === projectId) ?? null
  })
}

/** Make `p` (already in the running session) the active project. */
async function activate(p: { id: number; name: string }): Promise<void> {
  if (!sessionId) return
  windows.closeStart()
  if (p.id !== projectId) {
    await enterProject({ id: p.id, name: p.name, slot: null })
    await store.openSpan(sessionId, p.id)
    flash({ kind: 'switched', detail: p.name })
  }
  await syncSessionProjects()
  if (getState().observing === 'paused') await resume()
}

/**
 * Start a session with these projects pulled in (in this order: fn 1, fn 2, …). The
 * first is active. If a session is already running, they are added to it instead.
 */
export async function startSession(projectIds: number[]): Promise<void> {
  const ids: number[] = []
  for (const n of new Set(projectIds))
    if (Number.isInteger(n) && n > 0 && (await store.projectExists(n))) ids.push(n)
  if (!ids.length) return
  if (sessionId) {
    for (const id of ids) await store.addSessionProject(sessionId, id)
    const first = await store.getProject(ids[0])
    if (first) await activate(first)
    return
  }
  const blocked = await cannotObserve()
  if (blocked) {
    setState({ notice: blocked, ...(blocked.kind === 'not-saving' ? { saving: false } : {}) })
    return
  }
  try {
    const first = await store.getProject(ids[0])
    if (!first) return
    const s = await store.startSession()
    sessionId = s.id
    for (const id of ids) await store.addSessionProject(s.id, id)
    setState({
      session: { id: s.id, startedAt: s.startedAt, status: 'active' },
      observing: 'on',
      saving: true
    })
    await enterProject({ id: first.id, name: first.name, slot: null })
    await store.openSpan(s.id, first.id)
    await syncSessionProjects()
    windows.closeStart()
    beginObserving()
  } catch (err) {
    persistenceFailed(err)
  }
}

/** A new, empty project (pulled into a session separately). */
export async function createProject(name: string): Promise<ProjectItem> {
  return store.createProject(name.trim() || 'Project')
}

/** Pull a saved project into the running session, without switching to it. */
export async function addToSession(id: number): Promise<void> {
  if (!sessionId || !(await store.projectExists(id))) return
  await store.addSessionProject(sessionId, id)
  await syncSessionProjects()
}

/** The project everything goes into right now (null when no session runs). */
export function activeProjectId(): number | null {
  return projectId
}

/** Work in project `id`: pulled into the running session if needed, or a new session. */
export async function switchProject(id: number): Promise<void> {
  const p = await store.getProject(id).catch(() => null)
  if (!p) return
  if (!sessionId) return startSession([id])
  await store.addSessionProject(sessionId, id)
  await activate(p)
}

/** fn N / ⌃⌥N: the Nth project pulled into the running session. */
export async function switchToSlot(slot: number): Promise<void> {
  if (!sessionId) return flash({ kind: 'switched', detail: 'No session running' })
  const p = await store.sessionProjectAt(sessionId, slot).catch(() => null)
  if (!p) return flash({ kind: 'switched', detail: `No project ${slot} in this session` })
  await activate(p)
}

function beginObserving(): void {
  core.setObserving(true)
  lastChangeAt = Date.now()
  if (!loop) loop = new CaptureLoop(config.captureMs, onFrame, onCaptureError)
  loop.start()
  // No dwell nudges while there is nothing on screen to help with.
  tickTimer ??= setInterval(() => {
    if (!getState().idle) apply(core.tick())
  }, 1000)
  flushTimer ??= setInterval(() => void flushActivity(), 10_000)
  statsTimer ??= setInterval(() => void refreshStats(), 15_000)
  startDownloads()
}

function stopTimers(): void {
  loop?.stop()
  downloads?.stop()
  for (const t of [tickTimer, flushTimer, statsTimer]) if (t) clearInterval(t)
  tickTimer = flushTimer = statsTimer = null
}

export async function pause(): Promise<void> {
  if (!sessionId || getState().observing !== 'on') return
  loop?.stop()
  downloads?.stop()
  core.setObserving(false)
  setState({ observing: 'paused', nudge: false })
  await store.setSessionStatus(sessionId, 'paused').catch(() => {})
}

export async function resume(): Promise<void> {
  if (!sessionId || getState().observing !== 'paused') return
  setState({ observing: 'on' })
  beginObserving()
  await store.setSessionStatus(sessionId, 'active').catch(() => {})
}

export async function togglePause(): Promise<void> {
  if (getState().observing === 'on') await pause()
  else await resume()
}

/** Stop the session (the time). Every project worked in gets its graph built and uploaded. */
export async function endSession(): Promise<void> {
  if (!sessionId) return
  const sid = sessionId
  stopTimers()
  await flushActivity()
  core.setObserving(false)
  core.setPanelOpen(false) // the panel closes below; a held screen change dies with the session
  cancelExecution()
  sessionId = null
  projectId = null
  livePage = null
  pageHighlights = null
  core.resetContext()
  setState({
    session: null,
    project: null,
    sessionProjects: [],
    observing: 'off',
    suggestions: null,
    nudge: false,
    idle: false,
    answer: null,
    panel: 'closed',
    panelHidden: false,
    selection: null,
    downloads: []
  })
  offered.clear()
  windows.hidePanel()
  await store.setSessionStatus(sid, 'ended').catch(() => {})
  for (const p of await store.sessionProjects(sid).catch(() => []))
    scheduleIndex(p.id, { now: true })
  void uploadPending()
}

/** Removes a session's time record only: its projects keep their context. */
export async function deleteSession(id: number): Promise<void> {
  if (id === sessionId) await endSession()
  await store.deleteSession(id)
}

/** Delete a project and everything in it: rows, files, graph, cache entries, TigerData copy. */
export async function deleteProject(id: number): Promise<void> {
  if (id === projectId) await endSession()
  cancelIndex(id)
  let remoteId: number | null = null
  let hashes: string[] = []
  try {
    remoteId = (await store.getProject(id))?.upload.remoteId ?? null
    hashes = await store.captureHashes(id)
    await store.deleteProjectRows(id)
  } catch (err) {
    console.error('delete project failed:', err)
    throw err
  }
  // Its TigerData copy goes too (queued if TigerData can't be reached right now).
  if (remoteId) await deleteRemote(remoteId)
  for (const h of hashes) cache.deleteMatching(`note:%:${h}`)
  await rm(projectDir(id), { recursive: true, force: true })
}

/**
 * Remove context older than the retention period, in every project (the projects stay),
 * and old session time records. Affected projects get their graph rebuilt.
 */
export async function retentionSweep(): Promise<void> {
  try {
    for (const id of await store.expiredSessionIds(config.retentionDays))
      await store.deleteSession(id)
    const pruned = await store.pruneOlderThan(config.retentionDays)
    for (const path of pruned.paths) await unlink(path).catch(() => {})
    for (const h of pruned.hashes) cache.deleteMatching(`note:%:${h}`)
    for (const p of pruned.projects) scheduleIndex(p, { now: true, force: true })
  } catch (err) {
    console.warn('retention sweep failed:', (err as Error).message)
  }
}

/** End sessions a crash or quit left open, then upload every project not yet in TigerData. */
export async function syncEnded(): Promise<void> {
  try {
    await store.endAbandonedSessions(sessionId)
  } catch (err) {
    console.warn('could not close abandoned sessions:', (err as Error).message)
  }
  await uploadPending()
}

/** Fix incomplete writes from a crash: orphan files, half-committed rows, deleted projects. */
export async function reconcileLocal(): Promise<void> {
  const root = projectsRoot()
  if (!existsSync(root)) return
  for (const name of await readdir(root)) {
    if (!name.startsWith(PROJECT_DIR_PREFIX)) continue
    const id = Number(name.slice(PROJECT_DIR_PREFIX.length))
    if (!Number.isInteger(id) || id <= 0) continue
    try {
      if (!(await store.projectExists(id))) {
        await rm(projectDir(id), { recursive: true, force: true })
        continue
      }
      const rows = await store.capturePaths(id)
      const known = new Set(rows.map((r) => r.path))
      const dir = shotsDir(id)
      for (const f of await readdir(dir)) {
        const full = join(dir, f)
        if (!known.has(full)) await unlink(full).catch(() => {})
      }
      for (const r of rows) {
        if (r.status !== 'pending') continue
        await store.setCaptureStatus(r.id, existsSync(r.path) ? 'committed' : 'failed')
      }
    } catch (err) {
      console.warn(`reconcile project ${id} failed:`, (err as Error).message)
    }
  }
}

// ------------------------------------------------------------------ capture → persist → note

/** Save buffered activity before quitting (SQLite writes are synchronous). */
export function flushOnQuit(): void {
  if (activity.length === 0) return
  void store.insertActivity(activity).catch(() => {})
  activity = []
}

async function flushActivity(): Promise<void> {
  if (activity.length === 0) return
  const batch = activity
  activity = []
  try {
    await store.insertActivity(batch)
  } catch (err) {
    console.warn('activity not saved:', (err as Error).message)
  }
}

async function refreshStats(): Promise<void> {
  if (!projectId) return
  try {
    setState({ stats: await store.projectStats(projectId) })
  } catch {
    /* stats are cosmetic */
  }
}

// Consecutive failed captures. macOS sometimes hands back a blank frame even with
// permission, so one bad frame is retried on the next tick rather than treated as a
// lost permission. ~20 s of nothing but failures is worth stopping for.
const MAX_CAPTURE_FAILURES = 5
let captureFailures = 0

function onCaptureError(err: Error): void {
  console.warn('capture error:', err.message)
  // Ask macOS now; the health report may be from before the permission changed.
  const granted =
    process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
  if (granted && ++captureFailures < MAX_CAPTURE_FAILURES) return
  captureFailures = 0
  loop?.stop()
  core.setObserving(false)
  // "blank": allowed in System Settings, yet every frame came back empty.
  setState({
    observing: 'paused',
    notice: { kind: 'screen-access', detail: granted ? 'blank' : undefined }
  })
}

async function onFrame(frame: Frame): Promise<void> {
  captureFailures = 0
  const sid = projectId
  if (!sid || !getState().saving) return
  const now = Date.now()
  lastMeta = frame.meta
  const row: store.ActivityRow = {
    time: frame.at,
    projectId: sid,
    captureId: null,
    appName: frame.meta.appName,
    windowTitle: frame.meta.windowTitle,
    url: frame.meta.url,
    topic: currentTopic,
    changed: frame.changed,
    dwellMs: frame.changed ? 0 : now - lastChangeAt
  }
  activity.push(row)
  if (!frame.changed) return

  // The pixel diff says the screen changed. Before re-noting it and replacing the ideas,
  // ask whether there is anything on it to help with, and whether it is really different
  // content. A bare desktop gets no note and no ideas; more of the same gets no new ones.
  const thumb = changeJudgeEnabled ? thumbnail(frame.png) : null
  // The note is started alongside the judgement, not after it, so a real change doesn't
  // wait for both in turn. If the judgement says to skip this frame, the note is dropped.
  const started = await startNote(sid, frame)
  if (thumb) {
    const verdict = await judgeScreen(notedThumb, thumb, sid)
    // "Nothing useful here" greys the flower and stops ideas, so it takes two votes: the
    // judge's, and the note model's once its note is in.
    const useful =
      verdict.useful ||
      (await started.note.then(
        (n) => n.hasContent !== false,
        () => true
      ))
    if (sid !== projectId) return // the project switched or the session ended meanwhile
    setIdle(!useful)
    if (!useful || (notedThumb && !verdict.changed)) {
      row.changed = false
      row.dwellMs = now - lastChangeAt
      return
    }
  }
  if (sid !== projectId) return // the project switched or the session ended meanwhile
  notedThumb = thumb
  lastChangeAt = now

  // Persist first: file, then row (pending → committed). Only committed captures get notes.
  let id: number
  const path = join(shotsDir(sid), `${frame.at.getTime()}-${frame.hash.slice(0, 10)}.png`)
  try {
    await writeFile(path, frame.png)
    id = await store.insertPendingCapture(sid, path, { ...frame.meta, imageHash: frame.hash })
    await store.setCaptureStatus(id, 'committed')
  } catch (err) {
    await unlink(path).catch(() => {})
    persistenceFailed(err)
    return
  }
  row.captureId = id
  const mem: CaptureMem = {
    id,
    path,
    capturedAt: frame.at.toISOString(),
    note: null,
    pageId: null,
    source: 'auto'
  }
  captures.set(id, mem)
  if (captures.size > 40) captures.delete(captures.keys().next().value as number)
  notePromises.set(id, noteFor(sid, mem, frame, started))
  apply(core.onCapture(id, true))
}

/**
 * What this project has covered so far, for the note model: it lets the ideas for a new
 * screen build on the project (connections, follow-up questions) rather than treat
 * every page as the first one. Only this project's notes are read.
 */
async function projectContext(sid: number): Promise<string> {
  const notes = await store.recentNotes(sid, 24).catch(() => [])
  const seen = new Set<string>()
  const lines: string[] = []
  for (const n of notes) {
    const topic = n.topic?.trim() || n.body.slice(0, 40)
    if (seen.has(topic)) continue
    seen.add(topic)
    lines.push(`- ${topic}: ${n.body.replace(/\s+/g, ' ').slice(0, 200)}`)
    if (lines.length === 8) break
  }
  if (!lines.length) return ''
  const name = getState().project?.name ?? 'Project'
  return `Project "${name}". Covered earlier, most recent first:\n${lines.join('\n')}`
}

/** A note being written for a frame that may or may not end up being kept. */
interface StartedNote {
  page: (PageContext & { id: number; at: number }) | null
  soFar: string
  note: Promise<VisionNote>
}

async function startNote(sid: number, frame: Frame, selection = false): Promise<StartedNote> {
  const page = livePage && Date.now() - livePage.at < LIVE_PAGE_MS ? livePage : null
  const soFar = await projectContext(sid)
  const note = makeVisionNote(frame.png, frame.hash, frame.meta, sid, page, {
    selection,
    projectContext: soFar
  })
  note.catch(() => {}) // a dropped note must not surface as an unhandled rejection
  return { page, soFar, note }
}

async function noteFor(
  sid: number,
  mem: CaptureMem,
  frame: Frame,
  started?: StartedNote
): Promise<VisionNote | null> {
  try {
    const {
      page,
      soFar,
      note: pending
    } = started ?? (await startNote(sid, frame, mem.source === 'selection'))
    const note = await pending
    mem.note = note
    currentTopic = note.topic
    // Linked when the note model sees the page in the screenshot, or when Chrome's front
    // tab is that page: then answers (summaries above all) get the whole page.
    const frontTab = frame.meta.url && page && samePage(frame.meta.url, page.url)
    if (page && (note.chromePageOnScreen || frontTab)) {
      mem.pageId = page.id
      await store.linkCaptureToPage(mem.id, page.id)
    }
    // Saving it into the session's context happens in the background, so ideas for
    // this screen never wait on that decision.
    void remember(sid, mem, frame, note, soFar).catch((err) =>
      console.warn('note not saved:', (err as Error).message)
    )
    return note
  } catch (err) {
    console.warn('vision note failed:', (err as Error).message)
    return null
  }
}

/**
 * Add a noted screen to the session's context (search index and Graphify notes),
 * unless it clearly has nothing to do with the session. The note is kept on the
 * capture either way, so the Sessions window still shows what was seen.
 */
async function remember(
  sid: number,
  mem: CaptureMem,
  frame: Frame,
  note: VisionNote,
  soFar: string
): Promise<void> {
  // An area the user selected on purpose always belongs. Otherwise, with nothing covered
  // yet there is nothing to compare against: keep it.
  const belongs =
    mem.source === 'selection' ||
    !changeJudgeEnabled ||
    !soFar ||
    (await belongsInProject(soFar, note.topic, note.note, sid))
  if (!belongs) {
    console.log(`kept out of session context: ${note.topic}`)
    await store.setCaptureNote(mem.id, note.note, null)
    return
  }
  const file = await writeNoteFile(
    notesDir(sid),
    `capture-${mem.id}`,
    {
      capture_id: mem.id,
      captured_at: mem.capturedAt,
      app: frame.meta.appName,
      window_title: frame.meta.windowTitle,
      url: frame.meta.url,
      topic: note.topic,
      page_id: mem.pageId,
      provenance: 'observed'
    },
    note.note
  )
  await store.setCaptureNote(mem.id, note.note, file)
  await store.insertNote({
    projectId: sid,
    captureId: mem.id,
    provenance: 'observed',
    topic: note.topic,
    body: note.note
  })
  scheduleIndex(sid)
}

// ------------------------------------------------------------------ selected area

// The panel's "Select an area" (⌘S): the panel steps aside, an overlay lets the user
// drag out a rectangle, and that area is captured at full resolution, saved like any
// capture (source 'selection') and pinned as the context for ideas and answers until
// it's cleared or replaced.

export function startSelection(): void {
  if (!projectId || getState().selecting) return
  setState({ selecting: true })
  windows.stepAsidePanel()
  windows.showSelectionOverlay()
}

export function cancelSelection(): void {
  if (!getState().selecting) return
  windows.hideSelectionOverlay()
  setState({ selecting: false })
  showPanelAgain()
}

function showPanelAgain(): void {
  const view = getState().panel === 'closed' ? 'ideas' : getState().panel
  core.setPanelOpen(true)
  if (!getState().idle || getState().selection) apply(core.requestNow())
  setState({ panel: view, nudge: false })
  showPanelWindow()
}

export async function finishSelection(rect: SelectionRect): Promise<void> {
  const sid = projectId
  if (!getState().selecting) return
  const overlay = windows.hideSelectionOverlay()
  setState({ selecting: false })
  if (!sid || !overlay || rect.width < 8 || rect.height < 8) return showPanelAgain()
  // Let the overlay leave the screen first (it's excluded from capture anyway).
  await new Promise((r) => setTimeout(r, 120))
  let png: Buffer
  try {
    png = await captureArea(overlay.display, {
      ...rect,
      x: rect.x + overlay.offset.x,
      y: rect.y + overlay.offset.y
    })
  } catch (err) {
    notice({ kind: 'request-failed', detail: (err as Error).message })
    return showPanelAgain()
  }
  const at = new Date()
  const hash = createHash('sha1').update(png).digest('hex')
  const path = join(shotsDir(sid), `${at.getTime()}-selection-${hash.slice(0, 10)}.png`)
  let id: number
  try {
    await writeFile(path, png)
    id = await store.insertPendingCapture(sid, path, { ...lastMeta, imageHash: hash }, 'selection')
    await store.setCaptureStatus(id, 'committed')
  } catch (err) {
    await unlink(path).catch(() => {})
    persistenceFailed(err)
    return
  }
  const mem: CaptureMem = {
    id,
    path,
    capturedAt: at.toISOString(),
    note: null,
    pageId: null,
    source: 'selection'
  }
  captures.set(id, mem)
  notePromises.set(id, noteFor(sid, mem, { at, png, hash, changed: true, meta: lastMeta }))
  void refreshStats()
  setState({
    selection: {
      captureId: id,
      at: mem.capturedAt,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    answer: null,
    panel: 'ideas'
  })
  core.setPanelOpen(true)
  setIdle(false) // the user picked something to work with
  apply(core.pin(id))
  showPanelWindow()
}

/** Unpin the selection: ideas and answers follow the screen again. */
export function clearSelection(): void {
  if (!getState().selection) return
  setState({ selection: null })
  apply(core.unpin())
}

// ------------------------------------------------------------------ downloads

// While a session observes, files that finish downloading are offered (flower pill and
// panel card). Nothing is read until the user picks Add: then the file is copied into
// the session folder, its text extracted (or, for an image, described), and stored as
// a files row, a searchable note and a Graphify file. The newest added file also goes
// with answers for a while, so the user can ask about it straight away.

const MAX_COPY_BYTES = 200 * 1024 * 1024 // bigger files are kept by reference only
const RECENT_FILE_MS = 20 * 60_000
const MAX_OFFERS = 3
let downloads: DownloadWatcher | null = null
const offered = new Map<string, Download>()

function startDownloads(): void {
  if (!config.watchDownloads) return
  downloads ??= new DownloadWatcher(
    config.downloadsDir ?? app.getPath('downloads'),
    onDownload,
    (err) => console.warn('downloads:', err.message)
  )
  downloads.start()
}

function setOffer(id: string, patch: Partial<DownloadOffer> | null): void {
  const list = getState().downloads
  setState({
    downloads: patch
      ? list.map((o) => (o.id === id ? { ...o, ...patch } : o))
      : list.filter((o) => o.id !== id)
  })
  if (!patch) offered.delete(id)
}

function onDownload(d: Download): void {
  if (!projectId || getState().observing !== 'on') return
  const id = randomUUID()
  offered.set(id, d)
  const offer: DownloadOffer = {
    id,
    name: d.name,
    size: d.size,
    kind: fileKind(d.name),
    at: new Date(d.at).toISOString(),
    status: 'offered'
  }
  // Keep the newest few; older unanswered offers drop off.
  const list = [...getState().downloads, offer]
  for (const old of list.slice(0, Math.max(0, list.length - MAX_OFFERS))) offered.delete(old.id)
  setState({ downloads: list.slice(-MAX_OFFERS) })
}

export function skipDownload(id: string): void {
  setOffer(id, null)
}

function sha1File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

export async function addDownload(id: string): Promise<void> {
  const d = offered.get(id)
  const sid = projectId
  if (!d || !sid) return setOffer(id, null)
  const offer = getState().downloads.find((o) => o.id === id)
  if (!offer || offer.status === 'adding') return
  setOffer(id, { status: 'adding' })
  try {
    const st = await stat(d.path)
    const kind = fileKind(d.name)
    let storedPath: string | null = null
    if (st.size <= MAX_COPY_BYTES) {
      storedPath = join(filesDir(sid), `${Date.now()}-${d.name.replace(/[/\\:]/g, '_')}`)
      await copyFile(d.path, storedPath)
    }
    const source = storedPath ?? d.path
    let body = ''
    let status = 'unsupported'
    let truncated = false
    if (kind === 'image') {
      body = await describeImage(await imageForModel(source, d.name, filesDir(sid)), d.name, sid)
      status = body ? 'ok' : 'empty'
    } else {
      const out = await extractText(source, d.name)
      body = out.text
      status = out.status
      truncated = out.truncated
    }
    const fileId = await store.insertFile({
      projectId: sid,
      name: d.name,
      kind,
      size: st.size,
      originalPath: d.path,
      storedPath,
      sha1: storedPath ? await sha1File(storedPath) : null,
      body,
      extractStatus: status,
      truncated
    })
    const summary = `File "${d.name}" (${kind}, ${Math.round(st.size / 1024)} KB) added from Downloads`
    const file = await writeNoteFile(
      notesDir(sid),
      `file-${fileId}`,
      {
        file_id: fileId,
        name: d.name,
        kind,
        added_at: new Date().toISOString(),
        source: 'downloads',
        provenance: 'observed'
      },
      body ? `# ${d.name}\n\n${body}` : `# ${d.name}\n\n${summary}; its contents can't be read.`
    )
    await store.setFileNotePath(fileId, file)
    await store.insertNote({
      projectId: sid,
      fileId,
      provenance: 'observed',
      topic: d.name.slice(0, 80),
      body: body ? `${summary}:\n\n${body}` : `${summary}; its contents can't be read.`
    })
    scheduleIndex(sid)
    void refreshStats()
    setOffer(id, {
      status: 'added',
      detail:
        status === 'ok' ? undefined : status === 'unsupported' ? 'kept by name' : 'not readable'
    })
    offered.delete(id)
    setTimeout(() => setOffer(id, null), 6000)
  } catch (err) {
    console.warn('adding download failed:', (err as Error).message)
    setOffer(id, { status: 'failed', detail: (err as Error).message.slice(0, 120) })
  }
}

/** The newest file added in the last RECENT_FILE_MS, for answers. */
async function recentFile(
  sid: number
): Promise<{ name: string; kind: string; body: string } | null> {
  const since = new Date(Date.now() - RECENT_FILE_MS).toISOString()
  const f = await store.latestFile(sid, since).catch(() => null)
  return f && f.body ? { name: f.name, kind: f.kind, body: f.body } : null
}

// ------------------------------------------------------------------ Chrome pages

/**
 * A page sent by the Chrome extension: its whole rendered text, not just what a
 * screenshot shows. Stored with the session (row, searchable note, Graphify file) and
 * offered to the note model with the next screenshots.
 */
export async function onBrowserPage(p: {
  url: string
  title: string
  description: string
  text: string
  truncated: boolean
}): Promise<{ stored: boolean; reason?: 'no-session' | 'paused' | 'duplicate' }> {
  const sid = projectId
  if (!sid) return { stored: false, reason: 'no-session' }
  const s = getState()
  if (s.observing !== 'on' || !s.saving) return { stored: false, reason: 'paused' }
  const title = p.title.trim() || p.url
  const textHash = createHash('sha1').update(`${p.url}\n${p.text}`).digest('hex')
  const seen = await store.findPageByHash(sid, textHash)
  if (seen) {
    // Back on a page already stored: it is the live page again, nothing new to save.
    livePage = { id: seen.id, title, url: p.url, body: seen.body, at: Date.now() }
    return { stored: false, reason: 'duplicate' }
  }
  try {
    const id = await store.insertPage({
      projectId: sid,
      url: p.url,
      title,
      description: p.description,
      body: p.text,
      textHash,
      truncated: p.truncated
    })
    const capturedAt = new Date().toISOString()
    const file = await writeNoteFile(
      notesDir(sid),
      `page-${id}`,
      {
        page_id: id,
        captured_at: capturedAt,
        url: p.url,
        title,
        source: 'chrome',
        provenance: 'observed'
      },
      `# ${title}\n\n${p.url}\n\n${p.text}`
    )
    await store.setPageNotePath(id, file)
    await store.insertNote({
      projectId: sid,
      provenance: 'observed',
      topic: title.slice(0, 80),
      body: `Page "${title}" (${p.url}), full text from Chrome:\n\n${p.text}`
    })
    livePage = { id, title, url: p.url, body: p.text, at: Date.now() }
    scheduleIndex(sid)
    void refreshStats()
    return { stored: true }
  } catch (err) {
    persistenceFailed(err)
    return { stored: false, reason: 'paused' }
  }
}

const PAGE_SOURCE = 'Full page'

function pageSource(title: string, captureId: number | null): Provenance {
  return {
    kind: 'screen',
    label: `${PAGE_SOURCE} · ${title.slice(0, 40)}`,
    captureId: captureId ?? undefined
  }
}

// ------------------------------------------------------------------ suggestions

async function doSuggest(generationId: number, captureId: number): Promise<void> {
  const sid = projectId
  if (!sid) return
  try {
    const note = await (notePromises.get(captureId) ?? Promise.resolve(null))
    const mem = captures.get(captureId)
    if (!note || !mem) throw new Error('No note for this screen yet')
    const page = mem.pageId ? await store.getPage(mem.pageId) : null
    const set = suggestionsFromNote({
      captureId,
      generationId,
      note,
      capturedAt: mem.capturedAt,
      pageTitle: page?.title ?? null,
      selection: mem.source === 'selection'
    })
    apply(core.onSuggestions(generationId, set))
  } catch (err) {
    console.warn('suggestions failed:', (err as Error).message)
    apply(core.onSuggestionsFailed(generationId))
  }
}

// ------------------------------------------------------------------ panel & selection

/** Show the panel window; a panel hidden with fn H comes back too. */
function showPanelWindow(): void {
  if (getState().panelHidden) setState({ panelHidden: false })
  windows.showPanel()
}

export function openPanel(): void {
  // Hidden with fn H: bring it back exactly as it was, without fresh ideas.
  if (getState().panelHidden && getState().panel !== 'closed') return showPanelWindow()
  core.setPanelOpen(true)
  const s = getState()
  const view =
    s.answer && (s.answer.status === 'pending' || s.answer.status === 'streaming')
      ? 'answer'
      : 'ideas'
  // Fresh ideas for the current screen, unless the shown ones are already for it.
  if (!getState().idle || getState().selection) apply(core.requestNow())
  setState({ panel: view, nudge: false })
  showPanelWindow()
}

export function closePanel(): void {
  const held = core.setPanelOpen(false) // a screen change that waited for the panel to close
  setState({ panel: 'closed', panelHidden: false, nudge: false })
  apply(held)
  windows.hidePanel()
}

export function togglePanel(): void {
  if (getState().panel === 'closed' || getState().panelHidden) openPanel()
  else closePanel()
}

/**
 * fn H / ⌃⌥H: hide the panel for a moment and bring it back as it was. Unlike closing,
 * it stays open underneath: screen changes keep being held, so its ideas or answer
 * don't change and no fresh ideas are asked for. fn, fn H or the flower brings it back.
 */
export function toggleHidePanel(): void {
  const s = getState()
  if (s.panel === 'closed') return
  if (s.panelHidden) return showPanelWindow()
  setState({ panelHidden: true })
  windows.hidePanel()
}

export function showShortcuts(): void {
  setState({ panel: 'shortcuts' })
}

export function backToIdeas(): void {
  setState({ panel: 'ideas' })
  if (!getState().idle || getState().selection) apply(core.requestNow())
}

export function pickKey(key: number): void {
  apply(core.select(key, getState().suggestions?.id))
}

export function dismissIdeas(): void {
  apply(core.dismiss())
  if (getState().panel === 'ideas') closePanel()
}

export function setDwellMs(ms: number): void {
  core.setConfig({ dwellMs: ms })
  setState({ dwellMs: ms })
}

export function setQuiet(on: boolean): void {
  core.setQuiet(on, config.quietMs)
  setState({
    quietUntil: on ? Date.now() + config.quietMs : null,
    nudge: on ? false : getState().nudge
  })
}

export function toggleQuiet(): void {
  const q = getState().quietUntil
  setQuiet(!(q && q > Date.now()))
}

export function dismissNotice(): void {
  notice(null)
}

// ------------------------------------------------------------------ execution

async function captureImage(captureId: number | null): Promise<{
  png: Buffer | null
  note: string
  topic: string
  page: PageContext | null
  selection: boolean
}> {
  if (captureId === null)
    return { png: null, note: '', topic: currentTopic ?? '', page: null, selection: false }
  const note = await (notePromises.get(captureId) ?? Promise.resolve(null))
  const mem = captures.get(captureId)
  let path = mem?.path
  let pageId = mem?.pageId ?? null
  let selection = mem?.source === 'selection'
  let noteText = note?.note ?? ''
  if (!mem) {
    const row = await store.getCapture(captureId).catch(() => null)
    path = row?.path
    pageId = row?.pageId ?? null
    selection = row?.source === 'selection'
    noteText ||= row?.note ?? ''
  }
  const png = path && existsSync(path) ? await readFile(path) : null
  const page = pageId ? await store.getPage(pageId).catch(() => null) : null
  return {
    png,
    note: noteText,
    topic: note?.topic ?? currentTopic ?? '',
    page: page ? { title: page.title, url: page.url, body: page.body } : null,
    selection
  }
}

async function execute(run: {
  set: SuggestionSet | null
  idea: Idea | null
  captureId: number | null
  kind: AnswerState['kind']
  task: string
  previous?: AnswerOutput | null
}): Promise<void> {
  const sid = projectId
  cancelExecution(false)
  lastRun = run
  const token = ++execToken
  const abort = new AbortController()
  exec = { abort, token }
  const live = (): boolean => token === execToken && !abort.signal.aborted
  pageHighlights = null

  const base: AnswerState = {
    actionId: `pending-${token}`,
    title: run.idea?.title ?? (run.kind === 'reshape' ? 'Reshaping…' : 'Working on it…'),
    basedOn: '',
    pickedKey: run.idea?.key ?? null,
    kind: run.kind,
    status: 'pending',
    blocks: [],
    reshape: [],
    sources: run.set?.sources ?? [],
    historyUnavailable: false
  }
  core.setPanelOpen(true)
  setState({ answer: base, panel: 'answer', nudge: false, notice: null })
  showPanelWindow()

  // The action row is written alongside the model call rather than ahead of it.
  let actionId: number | null = null
  let actionSaved: Promise<number | null> = Promise.resolve(null)
  if (sid) {
    actionSaved = store
      .insertAction({
        projectId: sid,
        captureId: run.captureId,
        suggestionSetId: run.set ? (setDbIds.get(run.set.id) ?? null) : null,
        kind: run.kind,
        prompt: run.task
      })
      .catch((err) => {
        persistenceFailed(err)
        return null
      })
    const dbSet = run.set ? setDbIds.get(run.set.id) : undefined
    if (dbSet) void store.setSuggestionStatus(dbSet, 'selected').catch(() => {})
  }

  try {
    const img = await captureImage(run.captureId)
    const file = sid ? await recentFile(sid) : null
    const retrieved = sid
      ? await retrieve(`${img.topic} ${run.task}`.slice(0, 300), {
          projectId: sid,
          excludeCaptureId: run.captureId
        })
      : {
          text: '',
          sources: [],
          graphOk: false,
          searchOk: false,
          historyUnavailable: true,
          chars: 0
        }
    if (!live()) return
    const screenSources = run.set?.sources.filter((s) => s.kind === 'screen') ?? []
    if (img.selection && !screenSources.length) {
      screenSources.push({
        kind: 'screen',
        label: 'Your selection',
        captureId: run.captureId ?? undefined
      })
    }
    if (file)
      screenSources.push({ kind: 'earlier', label: `Your file · ${file.name.slice(0, 40)}` })
    if (img.page && !screenSources.some((s) => s.label.startsWith(PAGE_SOURCE))) {
      screenSources.push(pageSource(img.page.title, run.captureId))
    }
    const sources = [...screenSources, ...retrieved.sources].slice(0, 3)
    setState({
      answer: {
        ...base,
        status: 'streaming',
        sources,
        historyUnavailable: retrieved.historyUnavailable
      }
    })
    if (retrieved.historyUnavailable) notice({ kind: 'no-history' })

    const result = await runAssistance({
      projectId: sid ?? 0,
      task: run.task,
      kind: run.kind,
      title: base.title,
      // The note already describes the screen; attaching the image as well delays the
      // first word by several seconds, so it is only sent when there is no note, or when
      // the user selected the area themselves (they want what's in it looked at).
      png: img.selection || !img.note ? img.png : null,
      selection: img.selection,
      note: img.note,
      topic: img.topic,
      page: img.page,
      file,
      retrieved,
      previous: run.previous ?? null,
      signal: abort.signal,
      onPartial: (p) => {
        if (!live()) return
        const cur = getState().answer
        if (!cur) return
        setState({
          answer: {
            ...cur,
            status: 'streaming',
            title: p.title || cur.title,
            basedOn: p.basedOn || cur.basedOn,
            blocks: p.blocks.length ? p.blocks : cur.blocks,
            reshape: p.reshape.length ? p.reshape : cur.reshape
          }
        })
      }
    })
    actionId = await actionSaved
    if (!live()) return
    lastOutput = result.output
    lastAnswerCaptureId = run.captureId
    const done: AnswerState = {
      ...(getState().answer as AnswerState),
      actionId: actionId ? String(actionId) : base.actionId,
      status: 'complete',
      title: result.output.title,
      basedOn: result.output.basedOn,
      blocks: result.output.blocks,
      reshape: result.output.reshape
    }
    setState({ answer: done, lastAnswerTitle: result.output.title })
    if (sid && img.page) void markPage(sid, run.task, img.page, result.output, live, done.actionId)
    if (sid && actionId) {
      const text = answerToText(result.output)
      await store.finishAction(actionId, {
        status: 'complete',
        result: text,
        blocks: result.output.blocks,
        sources: done.sources,
        tokensIn: result.inputTokens ?? null,
        tokensOut: result.outputTokens ?? null
      })
      const file = await writeNoteFile(
        notesDir(sid),
        `answer-${actionId}`,
        {
          action_id: actionId,
          capture_id: run.captureId,
          provenance: 'assistant',
          created_at: new Date().toISOString()
        },
        text
      )
      void file
      await store.insertNote({
        projectId: sid,
        captureId: run.captureId,
        actionId,
        provenance: 'assistant',
        topic: img.topic,
        body: text
      })
      scheduleIndex(sid)
      void refreshStats()
    }
  } catch (err) {
    const cancelled = abort.signal.aborted
    if (token === execToken) {
      const cur = getState().answer
      if (cur) {
        setState({
          answer: {
            ...cur,
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? undefined : (err as Error).message.slice(0, 200)
          },
          notice: cancelled
            ? null
            : { kind: 'request-failed', detail: (err as Error).message.slice(0, 200) }
        })
      }
    }
    actionId ??= await actionSaved
    if (actionId) {
      const partial = getState().answer
      await store
        .finishAction(actionId, {
          status: cancelled ? 'cancelled' : 'failed',
          blocks: partial?.blocks?.length ? partial.blocks : undefined
        })
        .catch(() => {})
    }
  } finally {
    core.executionFinished()
    if (exec?.token === token) exec = null
  }
}

/** Mark the passages of the page an answer was about, for the Chrome extension to show. */
async function markPage(
  sid: number,
  task: string,
  page: PageContext,
  output: AnswerOutput,
  live: () => boolean,
  actionId: string
): Promise<void> {
  try {
    const set = await pickHighlights({ answer: answerToText(output), task, page, projectId: sid })
    if (!set || !live() || projectId !== sid) return
    pageHighlights = set
    const cur = getState().answer
    if (cur?.actionId === actionId) setState({ answer: { ...cur, highlighted: set.items.length } })
  } catch (err) {
    console.warn('page highlights failed:', (err as Error).message)
  }
}

/** The passages to mark on this page, if the latest answer was about it. */
export function pageHighlightsFor(url: string): HighlightSet | null {
  return pageHighlights && samePage(pageHighlights.url, url) ? pageHighlights : null
}

/** Abort the running request; late events are suppressed by the token check. */
export function cancelExecution(markCancelled = true): void {
  if (!exec) return
  exec.abort.abort()
  exec = null
  execToken += 1
  core.executionFinished()
  const cur = getState().answer
  if (markCancelled && cur && (cur.status === 'pending' || cur.status === 'streaming')) {
    setState({ answer: { ...cur, status: 'cancelled' } })
  }
}

export async function retry(): Promise<void> {
  const s = getState()
  if (s.notice?.kind === 'not-saving' || !s.saving) {
    if (store.localStatus().ok) {
      setState({ saving: true, notice: null })
      if (sessionId && s.observing === 'on') beginObserving()
    }
    return
  }
  if (lastRun) await execute(lastRun)
}

export async function ask(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  await execute({ set: null, idea: null, captureId: core.currentCaptureId, kind: 'ask', task: t })
}

export async function reshape(text: string): Promise<void> {
  const t = text.trim()
  if (!t || !lastOutput) return
  await execute({
    set: null,
    idea: null,
    captureId: lastAnswerCaptureId,
    kind: 'reshape',
    task: `Reshape the previous answer: ${t}`,
    previous: lastOutput
  })
}

// ------------------------------------------------------------------ sessions window

export async function sessionDetail(id: number): Promise<SessionDetail | null> {
  const session = await store.getSession(id)
  if (!session) return null
  const stuckMs = Math.min(config.dwellMs, 30_000)
  const localInsights = (): Promise<[InsightRow[], StuckSpot[], 'raw']> =>
    Promise.all([
      store.insightsByTopic(id, config.captureMs).then((r) => r.rows),
      store.stuckSpots(id, stuckMs),
      'raw' as const
    ])
  // Once every project in the session is uploaded, its insights come from TigerData
  // (the activity_by_minute continuous aggregate, over the session's time range);
  // otherwise they are read on this Mac.
  const projects = await Promise.all(session.projects.map((p) => store.getProject(p.id)))
  const remoteIds = projects.map((p) => (p?.upload.status === 'synced' ? p.upload.remoteId : null))
  const range = { from: session.startedAt, to: session.endedAt ?? new Date().toISOString() }
  const insights =
    remoteIds.length && remoteIds.every((r) => r !== null) && db.getPool()
      ? Promise.all([
          db.insightsByTopic(remoteIds as number[], range, config.captureMs),
          db.stuckSpots(remoteIds as number[], range, stuckMs)
        ]).then(
          ([t, st]): [InsightRow[], StuckSpot[], 'aggregate' | 'raw'] => [t.rows, st, t.source],
          localInsights
        )
      : localInsights()
  const [timeline, sent, [byTopicRows, stuck, source]] = await Promise.all([
    store.timeline(id),
    store.sentToClaudeCount(id),
    insights.catch((): [InsightRow[], StuckSpot[], 'raw'] => [[], [], 'raw'])
  ])
  const live = id === sessionId
  const lastSeen = [...timeline].reverse().find((t) => t.kind !== 'asked')
  return {
    session,
    mainProjectId: [...session.projects].sort((a, b) => b.ms - a.ms)[0]?.id ?? null,
    timeline,
    holding: {
      onScreen: live
        ? (lastMeta.windowTitle ?? currentTopic ?? 'Nothing yet')
        : (lastSeen?.title ?? 'Nothing yet'),
      topic: live ? (currentTopic ?? 'Nothing yet') : (byTopicRows[0]?.topic ?? 'Nothing yet'),
      related: timeline.filter((t) => t.kind === 'switched').slice(-1)[0]?.title ?? 'Nothing yet'
    },
    privacy: { sentToClaude: sent, retentionDays: config.retentionDays },
    insights: { byTopic: byTopicRows, stuck, source: byTopicRows.length ? source : 'none' }
  }
}

export async function shotDataUrl(captureId: number): Promise<string | null> {
  const row = await store.getCapture(captureId).catch(() => null)
  if (!row || !existsSync(row.path)) return null
  return `data:image/png;base64,${(await readFile(row.path)).toString('base64')}`
}

export function snapshot(): KlairState {
  return getState()
}

export { timeLabel }
