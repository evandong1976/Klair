import { useEffect, useState } from 'react'
import type { KlairState } from '../../../shared/types'

export const klair = window.klair

/** Live copy of the main process state. */
export function useKlairState(): KlairState | null {
  const [state, setState] = useState<KlairState | null>(null)
  useEffect(() => {
    let alive = true
    void klair.getState().then((s) => alive && setState(s))
    const off = klair.onState((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function minutes(ms: number): string {
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}
