import type { AnswerBlock, ExplorableTemplate } from './blocks'
import type { FlowerStyleId } from './flower'
import type { ProjectType } from './options'

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
  kind: 'summary' | 'code' | 'quiz' | 'explain' | 'other' | 'interactive' | 'action'
  prompt: string
  /** Which entry of the project type's menu this is (shared/options.ts). */
  option?: string
  /** The thing on screen the option is about, when the model named one. */
  about?: string
  /** Set on an 'interactive' idea: which explainer to build if it is picked. */
  interactive?: { template: ExplorableTemplate; concept: string }
  /** Set on "Do it for me": what picking it opens (checked by shared/open.ts). */
  open?: { kind: 'url' | 'app'; target: string; label: string }
  /** Listed under "All options" but can't run on this screen; the subtitle says why. */
  disabled?: boolean
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
  /** The type's three standing options, shown while the screen is still being checked. */
  thinking?: boolean
  /** The whole menu is listed ("All options"), not only what fits the screen. */
  all?: boolean
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
  /** Passages Klair marked on the Chrome page this answer is about (the extension shows them). */
  highlighted?: number
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
  | 'opened' // "Do it for me" opened something; detail says what

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
  /** Work, study or research: decides which options are offered (shared/options.ts). */
  type: ProjectType
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
  /** Hidden for a moment with fn H: still open underneath, comes back as it was. */
  panelHidden: boolean
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
  /** Why it is idle: nothing on screen to work with, or a screen that isn't this project's work. */
  idleWhy: 'empty' | 'unrelated' | null
  /** What Klair saw there, in the note's words (e.g. "Spotify: music app"). */
  idleSeen: string | null
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
  type: ProjectType
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
  /** `setId` is the list the key was pressed against; a pick against an older list is dropped. */
  pickKey(key: number, setId?: string): Promise<void>
  /** Show the whole menu for this project's type, or go back to what fits the screen. */
  toggleAllOptions(): Promise<void>
  /** Change the active project's type; its options change with it. */
  setProjectType(type: ProjectType): Promise<void>
  ask(text: string): Promise<void>
  reshape(text: string): Promise<void>
  cancel(): Promise<void>
  retry(): Promise<void>
  dismissNotice(): Promise<void>
  dismissIdeas(): Promise<void>
  /** Put the "N ideas" pill away. The ideas themselves stay, one tap of fn away. */
  hideNudge(): Promise<void>
  /** The screen Klair went quiet on is part of the project after all: take it as work. */
  includeScreen(): Promise<void>

  setPanelSize(width: number, height: number): Promise<void>
  setFlowerInteractive(interactive: boolean): Promise<void>

  /** Start a session with these projects pulled in (first = active); adds them if one runs. */
  startSession(projectIds: number[]): Promise<void>
  /** A new, empty project. With no type, one is guessed from the name. */
  createProject(name: string, type?: ProjectType): Promise<ProjectItem>
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
  'toggleAllOptions',
  'setProjectType',
  'ask',
  'reshape',
  'cancel',
  'retry',
  'dismissNotice',
  'dismissIdeas',
  'hideNudge',
  'includeScreen',
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
