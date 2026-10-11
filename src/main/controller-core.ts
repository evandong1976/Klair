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
  /** A selected area the user pinned as the context (see pin / unpin). */
  pinnedCaptureId: number | null = null
  private latestAutoCaptureId: number | null = null
  dwellStart = 0
  generation = 0
  inflightGeneration: number | null = null
  current: SuggestionSet | null = null
  executingSetId: string | null = null
  /** A screen change that arrived while the panel was open, applied when it closes. */
  private heldCaptureId: number | null = null
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

  /** Closing the panel applies any screen change that was held back while it was open. */
  setPanelOpen(open: boolean): Effect[] {
    this.panelOpen = open
    if (open || this.heldCaptureId === null) return []
    const held = this.heldCaptureId
    this.heldCaptureId = null
    return this.onCapture(held, true)
  }

  setQuiet(on: boolean, ms: number): void {
    this.quietUntil = on ? this.now() + ms : 0
  }

  /** A capture tick. `changed` frames carry the new committed capture id. */
  onCapture(captureId: number | null, changed: boolean): Effect[] {
    if (!changed && this.currentCaptureId !== null) return []
    if (captureId === null) return []
    this.latestAutoCaptureId = captureId
    // A selected area pinned as the context stays put; automatic captures are still
    // stored, and the latest one takes over when the selection is cleared.
    if (this.pinnedCaptureId !== null) return []
    // With the panel open the user is reading Klair. The screen changing behind it must
    // not pull the ideas out from under them or keep reloading them: the change is held
    // until the panel closes, or until they ask for fresh ideas (requestNow).
    if (this.panelOpen && this.currentCaptureId !== null) {
      this.heldCaptureId = captureId
      return []
    }
    this.heldCaptureId = null
    return this.switchTo(captureId)
  }

  /**
   * Another project became active: nothing from the previous one's screen carries over
   * (its capture, ideas, held change or pinned selection). The next capture starts afresh.
   */
  resetContext(): void {
    this.currentCaptureId = null
    this.current = null
    this.inflightGeneration = null
    this.heldCaptureId = null
    this.pinnedCaptureId = null
    this.latestAutoCaptureId = null
    this.offeredForCapture = null
    this.executingSetId = null
    this.dwellStart = this.now()
  }

  /** A selected area becomes the context until it's cleared or replaced. */
  pin(captureId: number): Effect[] {
    this.pinnedCaptureId = captureId
    this.heldCaptureId = null // the user chose this explicitly; it wins over a held change
    return this.switchTo(captureId)
  }

  /** Back to following the screen: the latest automatic capture is the context again. */
  unpin(): Effect[] {
    if (this.pinnedCaptureId === null) return []
    this.pinnedCaptureId = null
    this.heldCaptureId = null
    const latest = this.latestAutoCaptureId
    return latest === null || latest === this.currentCaptureId ? [] : this.switchTo(latest)
  }

  private switchTo(captureId: number): Effect[] {
    const effects: Effect[] = []
    this.currentCaptureId = captureId
    this.dwellStart = this.now()
    // A suggestion request for the previous screen is now stale; its result will be dropped.
    this.inflightGeneration = null
    // Shown-but-unpicked ideas belong to the old screen, so they go (and their shortcuts
    // with them). An idea that is already running stays bound to its own capture.
    if (this.current && this.executingSetId !== this.current.id) {
      effects.push({ type: 'invalidateSuggestions', set: this.current, reason: 'changed' })
      this.current = null
    }
    // The panel opened before the first capture landed: offer ideas for it now.
    if (this.panelOpen && !this.current) effects.push(this.request('user'))
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

  /**
   * Explicit user request (panel opened, or back to ideas). Ignores dwell, cooldown and
   * quiet. Ideas kept for an older screen while one of them ran are replaced.
   */
  requestNow(): Effect[] {
    // An explicit request is for the screen as it is now, including a held change.
    if (this.heldCaptureId !== null && this.executingSetId === null) {
      this.currentCaptureId = this.heldCaptureId
      this.heldCaptureId = null
      this.dwellStart = this.now()
      this.inflightGeneration = null
    }
    if (this.currentCaptureId === null || this.inflightGeneration !== null) return []
    const effects: Effect[] = []
    if (this.current) {
      if (this.current.captureId === this.currentCaptureId) return []
      if (this.executingSetId === this.current.id) return []
      effects.push({ type: 'invalidateSuggestions', set: this.current, reason: 'changed' })
      this.current = null
    }
    effects.push(this.request('user'))
    return effects
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

  /**
   * The standing options for the project's type, shown at once while the screen is still
   * being checked. The request stays in flight; its result replaces them (onSuggestions).
   */
  onDefaults(generationId: number, set: SuggestionSet): Effect[] {
    if (generationId !== this.inflightGeneration) return []
    if (set.captureId !== this.currentCaptureId || this.current) return []
    this.current = set
    return [{ type: 'publishSuggestions', set }]
  }

  /** Result of a suggestion request. Late or stale results are dropped. */
  onSuggestions(generationId: number, set: SuggestionSet): Effect[] {
    if (generationId !== this.inflightGeneration) return []
    this.inflightGeneration = null
    if (set.captureId !== this.currentCaptureId) return []
    // A standing option picked before the check finished keeps running under the new list.
    if (this.current && this.executingSetId === this.current.id) this.executingSetId = set.id
    this.current = set
    return [{ type: 'publishSuggestions', set }]
  }

  onSuggestionsFailed(generationId: number): Effect[] {
    if (generationId !== this.inflightGeneration) return []
    this.inflightGeneration = null
    // Allow a quiet retry for the same screen once the cooldown passes.
    this.offeredForCapture = null
    // The standing options stay as they are, no longer marked as being checked.
    if (!this.current?.thinking) return []
    this.current = { ...this.current, thinking: false }
    return [{ type: 'publishSuggestions', set: this.current }]
  }

  /** Swap the shown list for another made for the same screen ("All options" and back). */
  replace(set: SuggestionSet): Effect[] {
    if (!this.current || set.captureId !== this.current.captureId) return []
    if (this.executingSetId === this.current.id) return []
    this.current = set
    return [{ type: 'publishSuggestions', set }]
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
    // A dimmed option (listed under "All options", can't run here) is not a choice.
    if (!idea || idea.disabled) return [{ type: 'rejectSelection', reason: 'no-such-key' }]
    this.executingSetId = set.id
    return [{ type: 'execute', set, idea, captureId: set.captureId }]
  }

  executionFinished(): void {
    this.executingSetId = null
  }
}
