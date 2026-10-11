import { BrowserWindow } from 'electron'
import { STATE_CHANNEL, type FlowerMode, type KlairState } from '../shared/types'
import { cache } from './cache'
import { deepNoEmDash } from '../shared/text'
import { config } from './config'
import { DEFAULT_FLOWER_STYLE, isFlowerStyle } from '../shared/flower'

// The single source of truth the renderer windows display. Only the main process
// mutates it; every change is broadcast to all windows.

let state: KlairState = {
  session: null,
  observing: 'off',
  saving: true,
  flower: 'off',
  panel: 'closed',
  nudge: false,
  suggestions: null,
  answer: null,
  notice: null,
  quietUntil: null,
  dwellMs: config.dwellMs,
  toggleKey: cache.get('toggleKey') ?? config.fallbackKeys.toggle,
  flowerStyle: ((v) => (isFlowerStyle(v) ? v : DEFAULT_FLOWER_STYLE))(cache.get('flowerStyle')),
  lastAnswerTitle: null,
  retentionDays: config.retentionDays,
  stats: { captures: 0, answers: 0, tabs: 0 },
  selection: null,
  selecting: false,
  idle: false,
  downloads: []
}

const listeners = new Set<(s: KlairState) => void>()

function flowerMode(s: KlairState): FlowerMode {
  if (!s.session || s.observing === 'off') return 'off'
  if (s.panel !== 'closed') return 'open'
  if (s.observing === 'paused' || !s.saving) return 'paused'
  if (s.nudge) return 'ideas'
  return 'observing'
}

export function getState(): KlairState {
  return state
}

export function setState(patch: Partial<KlairState>): void {
  state = { ...state, ...patch }
  state.flower = flowerMode(state)
  const shown = deepNoEmDash(state) // nothing reaches a window with an em dash in it
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(STATE_CHANNEL, shown)
  }
  for (const l of listeners) l(state)
}

export function onStateChange(fn: (s: KlairState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
