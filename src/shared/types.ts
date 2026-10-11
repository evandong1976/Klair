import type { AnswerBlock } from './blocks'

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
  key: number // 1, 2 or 3 → ⌘1–3
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

export interface SessionInfo {
  id: number
  name: string
  startedAt: string
  status: 'active' | 'paused' | 'ended'
}

export interface KlairState {
  session: SessionInfo | null
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
  lastAnswerTitle: string | null
  retentionDays: number
  stats: { captures: number; answers: number; tabs: number }
  /**
   * An area of the screen the user selected (⌘S in the panel), pinned as the context
   * for ideas and answers until cleared. `selecting` while the overlay is up.
   */
  selection: { captureId: number; at: string; width: number; height: number } | null
  selecting: boolean
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
 * Where an ended session stands with TigerData. Sessions are saved on the Mac (SQLite)
 * while they run and uploaded when they end: local → uploading → synced, or failed
 * (retried later).
 */
export type UploadStatus = 'local' | 'uploading' | 'synced' | 'failed'

export interface SessionListItem {
  id: number
  name: string
  startedAt: string
  endedAt: string | null
  status: SessionInfo['status']
  upload: { status: UploadStatus; error: string | null; remoteId: number | null }
}

export interface TimelineItem {
  at: string
  kind: 'seen' | 'switched' | 'asked'
  title: string
  detail: string
  actionId?: number
  status?: AnswerStatus
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
  timeline: TimelineItem[]
  holding: { onScreen: string; topic: string; related: string }
  privacy: { sentToClaude: number; retentionDays: number }
  insights: { byTopic: InsightRow[]; stuck: StuckSpot[]; source: 'aggregate' | 'raw' | 'none' }
}

export type WindowName = 'start' | 'sessions'
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

  startSession(name: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  endSession(): Promise<void>
  deleteSession(id: number): Promise<void>
  listSessions(): Promise<SessionListItem[]>
  getSessionDetail(id: number): Promise<SessionDetail | null>
  setDwellMs(ms: number): Promise<void>
  setQuiet(on: boolean): Promise<void>
  /** Resolves false if the shortcut is invalid or another app already owns it. */
  setToggleKey(accel: string): Promise<boolean>

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
  'pause',
  'resume',
  'endSession',
  'deleteSession',
  'listSessions',
  'getSessionDetail',
  'setDwellMs',
  'setQuiet',
  'setToggleKey',
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
