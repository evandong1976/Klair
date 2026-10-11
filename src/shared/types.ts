import type { AnswerBlock } from './blocks'
import type { FlowerStyleId } from './flower'

export type ObservingState = 'off' | 'on' | 'paused'
export type FlowerMode = 'off' | 'observing' | 'ideas' | 'open' | 'paused'
export type PanelView = 'closed' | 'ideas' | 'answer' | 'shortcuts'

export interface Provenance {
  kind: 'screen' | 'earlier' | 'assistant'
  label: string // e.g. "On screen · 2:14 PM"
  captureId?: number
}

export interface Idea {
  id: string
  key: number // 1–9 → ⌘1–9
  title: string
  subtitle: string
  kind: 'summary' | 'code' | 'quiz' | 'explain' | 'other'
  prompt: string
}

export interface SuggestionSet {
  id: string
  generationId: number
  captureId: number | null
  createdAt: string
  topic: string
  whereTitle: string
  whereRead: string
  ideas: Idea[]
  sources: Provenance[]
}

export type AnswerStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled'

export interface AnswerState {
  actionId: string
  title: string
  basedOn: string
  pickedKey: number | null
  kind: Idea['kind'] | 'ask' | 'reshape'
  status: AnswerStatus
  blocks: AnswerBlock[]
  reshape: string[]
  sources: Provenance[]
  historyUnavailable: boolean
  error?: string
}

export type NoticeKind =
  | 'no-history'
  | 'request-failed'
  | 'fn-busy'
  | 'screen-access'
  | 'not-saving'
  | 'partial-page'
  | 'stale'
  | 'switched' // just moved to another project; detail is its name

export interface Notice {
  kind: NoticeKind
  detail?: string
}

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown'

export interface HealthCheck {
  id: 'openrouter' | 'tigerdata' | 'local' | 'graphify' | 'cache' | 'screen' | 'fnkey' | 'browser'
  label: string
  status: CheckStatus
  detail: string
}

export interface HealthReport {
  at: string
  checks: HealthCheck[]
  capabilities: {
    timescale: boolean
    textsearch: 'bm25' | 'fts' | 'none'
    continuousAggregate: boolean
    retentionPolicy: boolean
  }
}

/** A session is only time: when it started and whether it's running. */
export interface SessionInfo {
  id: number
  startedAt: string
  status: 'active' | 'paused' | 'ended'
}

/** A project pulled into the running session; `slot` is its position there (fn N). */
export interface ProjectInfo {
  id: number
  name: string
  slot: number | null
}

export interface KlairState {
  session: SessionInfo | null
  /** The active project: everything captured right now goes into it. */
  project: ProjectInfo | null
  /** The projects pulled into the running session, in order (fn 1–9). */
  sessionProjects: ProjectInfo[]
  observing: ObservingState
  saving: boolean // false → "This session isn't being saved"
  flower: FlowerMode
  panel: PanelView
  nudge: boolean
  suggestions: SuggestionSet | null
  answer: AnswerState | null
  notice: Notice | null
  quietUntil: number | null
  dwellMs: number
  /** Electron accelerator that opens or closes Klair, e.g. "Control+Alt+K". */
  toggleKey: string
  /** Which pixel flower is drawn everywhere (Appearance in the menu bar popover). */
  flowerStyle: FlowerStyleId
  lastAnswerTitle: string | null
  retentionDays: number
  stats: { captures: number; answers: number; tabs: number }
  /**
   * An area of the screen the user selected (⌘S in the panel), pinned as the context
   * for ideas and answers until cleared. `selecting` while the overlay is up.
   */
  selection: { captureId: number; at: string; width: number; height: number } | null
  selecting: boolean
  /**
   * Nothing on screen to help with (the desktop, a lock screen, an empty window). The
   * flower greys out and no ideas are made or offered until there is something again.
   */
  idle: boolean
  /** Files that finished downloading during the session; nothing is read until Add. */
  downloads: DownloadOffer[]
}

export interface DownloadOffer {
  id: string
  name: string
  size: number
  /** pdf | document | slides | spreadsheet | text | image | other */
  kind: string
  at: string
  status: 'offered' | 'adding' | 'added' | 'failed'
  detail?: string
}

/** A rectangle in the selection overlay, in its CSS pixels (= screen points). */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a project stands with TigerData. Projects are saved on the Mac (SQLite) and
 * uploaded after each session they were worked in: local (changed) → uploading →
 * synced, or failed (retried later).
 */
export type UploadStatus = 'local' | 'uploading' | 'synced' | 'failed'

export interface ProjectItem {
  id: number
  name: string
  /** 1–9 on the fn 1–9 / ⌃⌥1–9 project switcher; null when all nine are taken. */
  slot: number | null
  createdAt: string
  lastUsedAt: string | null
  notes: number
  upload: { status: UploadStatus; error: string | null; remoteId: number | null }
}

/** A session: a span of time, and the projects worked in during it (longest first). */
export interface SessionListItem {
  id: number
  startedAt: string
  endedAt: string | null
  status: SessionInfo['status']
  /** In the order they were pulled in (position = fn N in the session), with time active. */
  projects: { id: number; name: string; ms: number; position: number }[]
}

/** A project's Graphify graph, for the Knowledge graph pane. */
export interface ProjectGraph {
  projectId: number
  name: string
  notes: number
  /** none: not built yet · building · ready · failed */
  status: 'none' | 'building' | 'ready' | 'failed'
  nodes: number | null
  edges: number | null
  communities: number | null
  builtAt: string | null
  detail: string | null
}

export interface TimelineItem {
  at: string
  kind: 'seen' | 'switched' | 'asked'
  title: string
  detail: string
  actionId?: number
  status?: AnswerStatus
  /** The project it went into. */
  project?: string
}

export interface InsightRow {
  topic: string
  seconds: number
  maxDwellMs: number
}

export interface StuckSpot {
  at: string
  topic: string
  dwellMs: number
  offered: string[]
}

export interface SessionDetail {
  session: SessionListItem
  /** The project the Knowledge graph button opens: the one worked in longest. */
  mainProjectId: number | null
  timeline: TimelineItem[]
  holding: { onScreen: string; topic: string; related: string }
  privacy: { sentToClaude: number; retentionDays: number }
  insights: { byTopic: InsightRow[]; stuck: StuckSpot[]; source: 'aggregate' | 'raw' | 'none' }
}

export type WindowName = 'start' | 'sessions' | 'graph'
export type SettingsPane = 'screen' | 'input-monitoring' | 'keyboard' | 'privacy'

/** Everything the renderer may ask of the main process. */
export interface KlairApi {
  getState(): Promise<KlairState>
  onState(cb: (state: KlairState) => void): () => void

  openPanel(): Promise<void>
  closePanel(): Promise<void>
  showShortcuts(): Promise<void>
  backToIdeas(): Promise<void>
  pickKey(key: number): Promise<void>
  ask(text: string): Promise<void>
  reshape(text: string): Promise<void>
  cancel(): Promise<void>
  retry(): Promise<void>
  dismissNotice(): Promise<void>
  dismissIdeas(): Promise<void>

  setPanelSize(width: number, height: number): Promise<void>
  setFlowerInteractive(interactive: boolean): Promise<void>

  /** Start a session with these projects pulled in (first = active); adds them if one runs. */
  startSession(projectIds: number[]): Promise<void>
  /** A new, empty project. */
  createProject(name: string): Promise<ProjectItem>
  /** Pull a saved project into the running session (without switching to it). */
  addToSession(projectId: number): Promise<void>
  /** Work in this project: pulled into the running session if needed, or starts one. */
  switchProject(id: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  endSession(): Promise<void>
  /** Removes a session's time record; its projects keep their context. */
  deleteSession(id: number): Promise<void>
  listProjects(): Promise<ProjectItem[]>
  /** Delete a project and everything in it, here and in TigerData. */
  deleteProject(id: number): Promise<void>
  /** Open the Knowledge graph pane on this project (or the active one). */
  openGraph(projectId?: number): Promise<void>
  projectGraph(projectId: number): Promise<ProjectGraph | null>
  /** Build the project's graph now. */
  rebuildGraph(projectId: number): Promise<void>
  /**
   * Show a project's Graphify view in the pane's graph area (window coordinates), or
   * hide it (null): the view is a separate, sandboxed page placed over that area.
   */
  showGraph(projectId: number | null, rect: SelectionRect | null): Promise<void>
  listSessions(): Promise<SessionListItem[]>
  getSessionDetail(id: number): Promise<SessionDetail | null>
  setDwellMs(ms: number): Promise<void>
  setQuiet(on: boolean): Promise<void>
  /** Resolves false if the shortcut is invalid or another app already owns it. */
  setToggleKey(accel: string): Promise<boolean>
  setFlowerStyle(style: FlowerStyleId): Promise<void>

  getHealth(): Promise<HealthReport>
  runHealth(): Promise<HealthReport>
  openSettings(pane: SettingsPane): Promise<void>
  openWindow(name: WindowName): Promise<void>
  openShot(captureId: number): Promise<string | null>

  /** Hide the panel and show the selection overlay. */
  startSelection(): Promise<void>
  /** From the overlay: capture this area, save it and pin it as the context. */
  finishSelection(rect: SelectionRect): Promise<void>
  cancelSelection(): Promise<void>
  /** Unpin the selection: ideas and answers follow the screen again. */
  clearSelection(): Promise<void>

  /** Copy a finished download into the session and read it. */
  addDownload(id: string): Promise<void>
  /** Leave it out of the session. */
  skipDownload(id: string): Promise<void>
}

export type KlairInvokeMethod = Exclude<keyof KlairApi, 'onState'>

export const KLAIR_INVOKE_METHODS: KlairInvokeMethod[] = [
  'getState',
  'openPanel',
  'closePanel',
  'showShortcuts',
  'backToIdeas',
  'pickKey',
  'ask',
  'reshape',
  'cancel',
  'retry',
  'dismissNotice',
  'dismissIdeas',
  'setPanelSize',
  'setFlowerInteractive',
  'startSession',
  'createProject',
  'addToSession',
  'switchProject',
  'pause',
  'resume',
  'endSession',
  'deleteSession',
  'listSessions',
  'getSessionDetail',
  'listProjects',
  'deleteProject',
  'openGraph',
  'projectGraph',
  'rebuildGraph',
  'showGraph',
  'setDwellMs',
  'setQuiet',
  'setToggleKey',
  'setFlowerStyle',
  'getHealth',
  'runHealth',
  'openSettings',
  'openWindow',
  'openShot',
  'startSelection',
  'finishSelection',
  'cancelSelection',
  'clearSelection',
  'addDownload',
  'skipDownload'
]

export const STATE_CHANNEL = 'klair:state'
export const invokeChannel = (m: KlairInvokeMethod): string => `klair:${m}`
