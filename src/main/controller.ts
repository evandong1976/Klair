import { existsSync } from 'fs'
import { readdir, readFile, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AnswerOutput } from '../shared/blocks'
import type {
  AnswerState,
  Idea,
  KlairState,
  Notice,
  SessionDetail,
  SuggestionSet
} from '../shared/types'
import { cache } from './cache'
import { CaptureLoop, type Frame } from './capture'
import { config } from './config'
import { ControllerCore, type Effect } from './controller-core'
import * as db from './db'
import { answerToText, runAssistance } from './execute'
import { healthOk, lastHealth, runHealth } from './health'
import { cancelIndex, scheduleIndex } from './indexer'
import { makeVisionNote, writeNoteFile, type VisionNote } from './notes'
import { notesDir, sessionDir, shotsDir } from './paths'
import { retrieve } from './retrieve'
import { getState, setState } from './state'
import { generateSuggestions } from './suggest'
import * as windows from './windows'

// The background controller: owns the session, the suggestion set, execution state
// and every write. Decisions about *when* things may happen live in ControllerCore;
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
}

let sessionId: number | null = null
let loop: CaptureLoop | null = null
let tickTimer: NodeJS.Timeout | null = null
let flushTimer: NodeJS.Timeout | null = null
let statsTimer: NodeJS.Timeout | null = null
let lastChangeAt = Date.now()
let currentTopic: string | null = null
let lastMeta: Frame['meta'] = { appName: null, windowTitle: null, url: null }
let activity: db.ActivityRow[] = []
const captures = new Map<number, CaptureMem>()
const notePromises = new Map<number, Promise<VisionNote | null>>()
const setDbIds = new Map<string, number>()

let exec: { abort: AbortController; token: number } | null = null
let execToken = 0
let lastRun: Parameters<typeof execute>[0] | null = null
let lastOutput: AnswerOutput | null = null
let lastAnswerCaptureId: number | null = null
let staleTimer: NodeJS.Timeout | null = null

// ------------------------------------------------------------------ helpers

function notice(n: Notice | null): void {
  setState({ notice: n })
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
        setState({ suggestions: e.set, nudge: getState().panel === 'closed' })
        if (sessionId) {
          const sid = sessionId
          db.insertSuggestionSet({
            sessionId: sid,
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
          void db
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

// ------------------------------------------------------------------ session lifecycle

export async function startSession(name: string): Promise<void> {
  const health = lastHealth() ?? (await runHealth({ skipModel: true }))
  if (!health.checks.find((c) => c.id === 'screen' && c.status === 'ok')) {
    notice({ kind: 'screen-access' })
    return
  }
  if (!healthOk('tigerdata')) {
    setState({
      saving: false,
      notice: { kind: 'not-saving', detail: 'TigerData is not connected' }
    })
    return
  }
  try {
    const s = await db.createSession(name.trim() || 'Session')
    sessionId = s.id
    captures.clear()
    notePromises.clear()
    setState({
      session: {
        id: s.id,
        name: name.trim() || 'Session',
        startedAt: s.startedAt,
        status: 'active'
      },
      observing: 'on',
      saving: true,
      notice: null,
      suggestions: null,
      answer: null,
      nudge: false,
      stats: { captures: 0, answers: 0, tabs: 0 }
    })
    windows.closeStart()
    beginObserving()
  } catch (err) {
    persistenceFailed(err)
  }
}

function beginObserving(): void {
  core.setObserving(true)
  lastChangeAt = Date.now()
  if (!loop) loop = new CaptureLoop(config.captureMs, onFrame, onCaptureError)
  loop.start()
  tickTimer ??= setInterval(() => apply(core.tick()), 1000)
  flushTimer ??= setInterval(() => void flushActivity(), 10_000)
  statsTimer ??= setInterval(() => void refreshStats(), 15_000)
}

function stopTimers(): void {
  loop?.stop()
  for (const t of [tickTimer, flushTimer, statsTimer]) if (t) clearInterval(t)
  tickTimer = flushTimer = statsTimer = null
}

export async function pause(): Promise<void> {
  if (!sessionId || getState().observing !== 'on') return
  loop?.stop()
  core.setObserving(false)
  setState({ observing: 'paused', nudge: false })
  await db.setSessionStatus(sessionId, 'paused').catch(() => {})
}

export async function resume(): Promise<void> {
  if (!sessionId || getState().observing !== 'paused') return
  setState({ observing: 'on' })
  beginObserving()
  await db.setSessionStatus(sessionId, 'active').catch(() => {})
}

export async function togglePause(): Promise<void> {
  if (getState().observing === 'on') await pause()
  else await resume()
}

export async function endSession(): Promise<void> {
  if (!sessionId) return
  const id = sessionId
  stopTimers()
  await flushActivity()
  core.setObserving(false)
  cancelExecution()
  sessionId = null
  setState({
    session: null,
    observing: 'off',
    suggestions: null,
    nudge: false,
    answer: null,
    panel: 'closed'
  })
  windows.hidePanel()
  await db.setSessionStatus(id, 'ended').catch(() => {})
  scheduleIndex(id, { now: true })
}

export async function deleteSession(id: number): Promise<void> {
  if (id === sessionId) await endSession()
  cancelIndex(id)
  let hashes: string[] = []
  try {
    hashes = await db.captureHashes(id)
    await db.deleteSessionRows(id)
  } catch (err) {
    console.error('delete session rows failed:', err)
    throw err
  }
  for (const h of hashes) cache.delete(`note:${h}`)
  await rm(sessionDir(id), { recursive: true, force: true })
}

/** Delete expired sessions everywhere: TigerData rows, local files, Graphify output, cache. */
export async function retentionSweep(): Promise<void> {
  try {
    for (const id of await db.expiredSessionIds(config.retentionDays)) await deleteSession(id)
  } catch (err) {
    console.warn('retention sweep failed:', (err as Error).message)
  }
}

/** Fix incomplete writes from a crash: orphan files, half-committed rows, deleted sessions. */
export async function reconcileLocal(): Promise<void> {
  const root = join(sessionDir(0), '..')
  if (!existsSync(root)) return
  for (const name of await readdir(root)) {
    const id = Number(name)
    if (!Number.isInteger(id) || id <= 0) continue
    try {
      if (!(await db.sessionExists(id))) {
        await rm(sessionDir(id), { recursive: true, force: true })
        continue
      }
      const rows = await db.capturePaths(id)
      const known = new Set(rows.map((r) => r.path))
      const dir = shotsDir(id)
      for (const f of await readdir(dir)) {
        const full = join(dir, f)
        if (!known.has(full)) await unlink(full).catch(() => {})
      }
      for (const r of rows) {
        if (r.status !== 'pending') continue
        await db.setCaptureStatus(r.id, existsSync(r.path) ? 'committed' : 'failed')
      }
    } catch (err) {
      console.warn(`reconcile session ${id} failed:`, (err as Error).message)
    }
  }
}

// ------------------------------------------------------------------ capture → persist → note

async function flushActivity(): Promise<void> {
  if (activity.length === 0) return
  const batch = activity
  activity = []
  try {
    await db.insertActivity(batch)
  } catch (err) {
    console.warn('activity not saved:', (err as Error).message)
  }
}

async function refreshStats(): Promise<void> {
  if (!sessionId) return
  try {
    setState({ stats: await db.sessionStats(sessionId) })
  } catch {
    /* stats are cosmetic */
  }
}

function onCaptureError(err: Error): void {
  console.warn('capture error:', err.message)
  const screenOk = lastHealth()?.checks.find((c) => c.id === 'screen')?.status === 'ok'
  if (!screenOk || /denied|permission|nothing/i.test(err.message)) {
    loop?.stop()
    core.setObserving(false)
    setState({ observing: 'paused', notice: { kind: 'screen-access' } })
  }
}

async function onFrame(frame: Frame): Promise<void> {
  const sid = sessionId
  if (!sid || !getState().saving) return
  const now = Date.now()
  lastMeta = frame.meta
  activity.push({
    time: frame.at,
    sessionId: sid,
    captureId: null,
    appName: frame.meta.appName,
    windowTitle: frame.meta.windowTitle,
    url: frame.meta.url,
    topic: currentTopic,
    changed: frame.changed,
    dwellMs: frame.changed ? 0 : now - lastChangeAt
  })
  if (!frame.changed) return
  lastChangeAt = now

  // Persist first: file, then row (pending → committed). Only committed captures get notes.
  let id: number
  const path = join(shotsDir(sid), `${frame.at.getTime()}-${frame.hash.slice(0, 10)}.png`)
  try {
    await writeFile(path, frame.png)
    id = await db.insertPendingCapture(sid, path, { ...frame.meta, imageHash: frame.hash })
    await db.setCaptureStatus(id, 'committed')
  } catch (err) {
    await unlink(path).catch(() => {})
    persistenceFailed(err)
    return
  }
  activity[activity.length - 1].captureId = id
  const mem: CaptureMem = { id, path, capturedAt: frame.at.toISOString(), note: null }
  captures.set(id, mem)
  if (captures.size > 40) captures.delete(captures.keys().next().value as number)
  notePromises.set(id, noteFor(sid, mem, frame))
  apply(core.onCapture(id, true))
}

async function noteFor(sid: number, mem: CaptureMem, frame: Frame): Promise<VisionNote | null> {
  try {
    const note = await makeVisionNote(frame.png, frame.hash, frame.meta, sid)
    mem.note = note
    currentTopic = note.topic
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
        provenance: 'observed'
      },
      note.note
    )
    await db.setCaptureNote(mem.id, note.note, file)
    await db.insertNote({
      sessionId: sid,
      captureId: mem.id,
      provenance: 'observed',
      topic: note.topic,
      body: note.note
    })
    scheduleIndex(sid)
    return note
  } catch (err) {
    console.warn('vision note failed:', (err as Error).message)
    return null
  }
}

// ------------------------------------------------------------------ suggestions

async function doSuggest(generationId: number, captureId: number): Promise<void> {
  const sid = sessionId
  if (!sid) return
  try {
    const note = await (notePromises.get(captureId) ?? Promise.resolve(null))
    const mem = captures.get(captureId)
    if (!note || !mem) throw new Error('No note for this screen yet')
    const retrieved = await retrieve(note.topic, { sessionId: sid, excludeCaptureId: captureId })
    const set = await generateSuggestions({
      sessionId: sid,
      captureId,
      generationId,
      note: note.note,
      topic: note.topic,
      capturedAt: mem.capturedAt,
      retrieved
    })
    apply(core.onSuggestions(generationId, set))
  } catch (err) {
    console.warn('suggestions failed:', (err as Error).message)
    apply(core.onSuggestionsFailed(generationId))
  }
}

// ------------------------------------------------------------------ panel & selection

export function openPanel(): void {
  core.setPanelOpen(true)
  const s = getState()
  const view =
    s.answer && s.answer.status !== 'cancelled' && s.panel === 'answer' ? 'answer' : 'ideas'
  if (!s.suggestions) apply(core.requestNow())
  setState({ panel: view, nudge: false })
  windows.setPanelView(view)
  windows.showPanel()
}

export function closePanel(): void {
  core.setPanelOpen(false)
  setState({ panel: 'closed', nudge: false })
  windows.setPanelView('closed')
  windows.hidePanel()
}

export function togglePanel(): void {
  if (getState().panel === 'closed') openPanel()
  else closePanel()
}

export function showShortcuts(): void {
  setState({ panel: 'shortcuts' })
  windows.setPanelView('shortcuts')
}

export function backToIdeas(): void {
  setState({ panel: 'ideas' })
  windows.setPanelView('ideas')
  if (!getState().suggestions) apply(core.requestNow())
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

async function captureImage(
  captureId: number | null
): Promise<{ png: Buffer | null; note: string; topic: string }> {
  if (captureId === null) return { png: null, note: '', topic: currentTopic ?? '' }
  const note = await (notePromises.get(captureId) ?? Promise.resolve(null))
  let path = captures.get(captureId)?.path
  let noteText = note?.note ?? ''
  if (!path) {
    const row = await db.getCapture(captureId).catch(() => null)
    path = row?.path
    noteText ||= row?.note ?? ''
  }
  const png = path && existsSync(path) ? await readFile(path) : null
  return { png, note: noteText, topic: note?.topic ?? currentTopic ?? '' }
}

async function execute(run: {
  set: SuggestionSet | null
  idea: Idea | null
  captureId: number | null
  kind: AnswerState['kind']
  task: string
  previous?: AnswerOutput | null
}): Promise<void> {
  const sid = sessionId
  cancelExecution(false)
  lastRun = run
  const token = ++execToken
  const abort = new AbortController()
  exec = { abort, token }
  const live = (): boolean => token === execToken && !abort.signal.aborted

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
  windows.setPanelView('answer')
  windows.showPanel()

  let actionId: number | null = null
  if (sid) {
    actionId = await db
      .insertAction({
        sessionId: sid,
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
    if (dbSet) void db.setSuggestionStatus(dbSet, 'selected').catch(() => {})
  }

  try {
    const img = await captureImage(run.captureId)
    const retrieved = sid
      ? await retrieve(`${img.topic} ${run.task}`.slice(0, 300), {
          sessionId: sid,
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
    const sources = [
      ...(run.set?.sources.filter((s) => s.kind === 'screen') ?? []),
      ...retrieved.sources
    ].slice(0, 3)
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
      sessionId: sid ?? 0,
      task: run.task,
      kind: run.kind,
      png: img.png,
      note: img.note,
      topic: img.topic,
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
    if (sid && actionId) {
      const text = answerToText(result.output)
      await db.finishAction(actionId, {
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
      await db.insertNote({
        sessionId: sid,
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
    if (actionId) {
      const partial = getState().answer
      await db
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
    const h = await runHealth({ skipModel: true })
    if (h.checks.find((c) => c.id === 'tigerdata')?.status !== 'fail') {
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
  const session = await db.getSession(id)
  if (!session) return null
  const [timeline, sent, byTopic, stuck] = await Promise.all([
    db.timeline(id),
    db.sentToClaudeCount(id),
    db.insightsByTopic(id, config.captureMs).catch(() => ({ rows: [], source: 'raw' as const })),
    db.stuckSpots(id, Math.min(config.dwellMs, 30_000)).catch(() => [])
  ])
  const live = id === sessionId
  const lastSeen = [...timeline].reverse().find((t) => t.kind !== 'asked')
  return {
    session,
    timeline,
    holding: {
      onScreen: live ? (lastMeta.windowTitle ?? currentTopic ?? '—') : (lastSeen?.title ?? '—'),
      topic: live ? (currentTopic ?? '—') : (byTopic.rows[0]?.topic ?? '—'),
      related: timeline.filter((t) => t.kind === 'switched').slice(-1)[0]?.title ?? '—'
    },
    privacy: { sentToClaude: sent, retentionDays: config.retentionDays },
    insights: {
      byTopic: byTopic.rows,
      stuck,
      source: byTopic.rows.length ? byTopic.source : 'none'
    }
  }
}

export async function shotDataUrl(captureId: number): Promise<string | null> {
  const row = await db.getCapture(captureId).catch(() => null)
  if (!row || !existsSync(row.path)) return null
  return `data:image/png;base64,${(await readFile(row.path)).toString('base64')}`
}

export function snapshot(): KlairState {
  return getState()
}

export { timeLabel }
