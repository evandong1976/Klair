import type { Idea, SuggestionSet } from '../shared/types'

// The pure decision logic behind Klair's background controller: dwell, cooldown,
// dismissal, stale-result rejection and selection validation. No Electron, no I/O,
// so it can be unit-tested (see controller-core.test.ts).
//
// Rule from the brief: a dwell may only *request suggestions*. Only `select()` with a
// valid key against the currently shown set ever produces an `execute` effect.

export interface CoreConfig {
  dwellMs: number
  cooldownMs: number
  dismissQuietMs: number
}

export type Effect =
  | {
      type: 'requestSuggestions'
      generationId: number
      captureId: number
      reason: 'dwell' | 'user'
    }
  | { type: 'publishSuggestions'; set: SuggestionSet }
  | { type: 'invalidateSuggestions'; set: SuggestionSet; reason: 'changed' | 'dismissed' }
  | { type: 'execute'; set: SuggestionSet; idea: Idea; captureId: number | null }
  | { type: 'rejectSelection'; reason: 'no-suggestions' | 'stale' | 'duplicate' | 'no-such-key' }

export class ControllerCore {
  observing = false
  panelOpen = false
  quietUntil = 0
  currentCaptureId: number | null = null
  dwellStart = 0
  generation = 0
  inflightGeneration: number | null = null
  current: SuggestionSet | null = null
  executingSetId: string | null = null
  private lastRequestAt = Number.NEGATIVE_INFINITY
  private offeredForCapture: number | null = null

  constructor(
    private cfg: CoreConfig,
    private now: () => number = Date.now
  ) {}

  setConfig(patch: Partial<CoreConfig>): void {
    this.cfg = { ...this.cfg, ...patch }
  }

  get config(): CoreConfig {
    return this.cfg
  }

  setObserving(on: boolean): Effect[] {
    this.observing = on
    if (!on) {
      this.inflightGeneration = null
      this.dwellStart = this.now()
    }
    return []
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open
  }

  setQuiet(on: boolean, ms: number): void {
    this.quietUntil = on ? this.now() + ms : 0
  }

  /** A capture tick. `changed` frames carry the new committed capture id. */
  onCapture(captureId: number | null, changed: boolean): Effect[] {
    const effects: Effect[] = []
    if (!changed && this.currentCaptureId !== null) return effects
    if (captureId === null) return effects
    this.currentCaptureId = captureId
    this.dwellStart = this.now()
    // A suggestion request for the previous screen is now stale; its result will be dropped.
    this.inflightGeneration = null
    // Shown-but-unpicked ideas belong to the old screen. Keep them while the panel is open
    // so the user isn't yanked around; an already-selected request stays bound to its capture.
    if (this.current && !this.panelOpen && this.executingSetId !== this.current.id) {
      effects.push({ type: 'invalidateSuggestions', set: this.current, reason: 'changed' })
      this.current = null
    }
    return effects
  }

  /** Called periodically. Emits at most one suggestion request per dwell. */
  tick(): Effect[] {
    const t = this.now()
    if (!this.observing || this.panelOpen) return []
    if (t < this.quietUntil) return []
    if (this.inflightGeneration !== null || this.current) return []
    if (this.currentCaptureId === null) return []
    if (this.offeredForCapture === this.currentCaptureId) return []
    if (t - this.dwellStart < this.cfg.dwellMs) return []
    if (t - this.lastRequestAt < this.cfg.cooldownMs) return []
    return [this.request('dwell')]
  }

  /** Explicit user request (panel opened with nothing to show). Ignores dwell, cooldown and quiet. */
  requestNow(): Effect[] {
    if (this.currentCaptureId === null || this.inflightGeneration !== null || this.current)
      return []
    return [this.request('user')]
  }

  private request(reason: 'dwell' | 'user'): Effect {
    this.generation += 1
    this.inflightGeneration = this.generation
    this.lastRequestAt = this.now()
    this.offeredForCapture = this.currentCaptureId
    return {
      type: 'requestSuggestions',
      generationId: this.generation,
      captureId: this.currentCaptureId as number,
      reason
    }
  }

  /** Result of a suggestion request. Late or stale results are dropped. */
  onSuggestions(generationId: number, set: SuggestionSet): Effect[] {
    if (generationId !== this.inflightGeneration) return []
    this.inflightGeneration = null
    if (set.captureId !== this.currentCaptureId) return []
    this.current = set
    return [{ type: 'publishSuggestions', set }]
  }

  onSuggestionsFailed(generationId: number): Effect[] {
    if (generationId !== this.inflightGeneration) return []
    this.inflightGeneration = null
    // Allow a quiet retry for the same screen once the cooldown passes.
    this.offeredForCapture = null
    return []
  }

  dismiss(): Effect[] {
    if (!this.current) return []
    const set = this.current
    this.current = null
    this.quietUntil = this.now() + this.cfg.dismissQuietMs
    return [{ type: 'invalidateSuggestions', set, reason: 'dismissed' }]
  }

  /** Clicks and shortcuts both land here. */
  select(key: number, setId?: string): Effect[] {
    const set = this.current
    if (!set) return [{ type: 'rejectSelection', reason: 'no-suggestions' }]
    if (setId && setId !== set.id) return [{ type: 'rejectSelection', reason: 'stale' }]
    if (this.executingSetId === set.id) return [{ type: 'rejectSelection', reason: 'duplicate' }]
    const idea = set.ideas.find((i) => i.key === key)
    if (!idea) return [{ type: 'rejectSelection', reason: 'no-such-key' }]
    this.executingSetId = set.id
    return [{ type: 'execute', set, idea, captureId: set.captureId }]
  }

  executionFinished(): void {
    this.executingSetId = null
  }
}
