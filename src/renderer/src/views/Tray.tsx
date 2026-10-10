import { useEffect, useState } from 'react'
import { Flower } from '../components/Flower'
import { MagicCard } from '../components/magicui/magic-card'
import { Button, Key, PixelLabel } from '../components/ui'
import { isMod, klair, minutes, timeLabel, useKlairState } from '../lib/useKlair'
import { accelFromEvent, prettyAccel } from '../../../shared/keys'

// Menu bar popover (Tray.dc.html).
const DWELL = [
  { label: '30 sec', ms: 30_000 },
  { label: '1 min', ms: 60_000 },
  { label: '2 min', ms: 120_000 }
]

export function TrayWindow(): React.JSX.Element | null {
  const s = useKlairState()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Recording a new "open Klair" shortcut: the next key combination is the binding.
  const [recording, setRecording] = useState(false)
  const [keyError, setKeyError] = useState('')
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setRecording(false)
      const accel = accelFromEvent(e)
      if (!accel) {
        // Still holding modifiers, or a key that can't be global on its own.
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key))
          setKeyError('Add ⌃, ⌥ or ⌘ to that key')
        return
      }
      setRecording(false)
      void klair.setToggleKey(accel).then((ok) => {
        setKeyError(ok ? '' : `${prettyAccel(accel)} is taken by macOS or another app`)
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return window.close()
      if (!isMod(e)) return
      const k = e.key.toLowerCase()
      const act: Record<string, () => void> = {
        p: () => void (s.observing === 'on' ? klair.pause() : klair.resume()),
        e: () => void klair.endSession(),
        o: () => void klair.openWindow('sessions'),
        ',': () => void klair.openWindow('start'),
        l: () => void klair.openPanel(),
        '1': () => void klair.setDwellMs(DWELL[0].ms),
        '2': () => void klair.setDwellMs(DWELL[1].ms),
        '3': () => void klair.setDwellMs(DWELL[2].ms)
      }
      if (act[k]) {
        e.preventDefault()
        act[k]()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  if (!s) return null
  const quiet = !!s.quietUntil && s.quietUntil > now
  const elapsed = s.session ? now - new Date(s.session.startedAt).getTime() : 0

  return (
    <MagicCard
      className="rounded-[22px] h-screen box-border"
      contentClassName="h-full flex flex-col overflow-hidden"
    >
      <header className="pt-[18px] px-[18px] pb-3.5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Flower res={11} cell={4} paused={s.flower === 'paused' || s.flower === 'off'} />
          <div className="flex-1 flex flex-col gap-0.5">
            <PixelLabel>
              {s.session
                ? `${s.observing === 'paused' ? 'Paused' : s.saving ? 'Observing' : 'Not saving'} · ${minutes(elapsed)}`
                : 'Not observing'}
            </PixelLabel>
            <span className="text-[19px] font-extrabold">{s.session?.name ?? 'No session'}</span>
          </div>
        </div>
        {s.session ? (
          <span className="text-[13px] font-semibold text-ink-3">
            {`Started ${timeLabel(s.session.startedAt)} · ${s.stats.tabs} tabs · ${s.stats.answers} answers`}
          </span>
        ) : null}
        {s.session ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              kind="primary"
              keyHint="⌘P"
              className="h-11 text-[14px]"
              onClick={() => void (s.observing === 'on' ? klair.pause() : klair.resume())}
            >
              {s.observing === 'on' ? 'Pause' : 'Resume'}
            </Button>
            <Button
              keyHint="⌘E"
              className="h-11 text-[14px]"
              onClick={() => void klair.endSession()}
            >
              End
            </Button>
          </div>
        ) : (
          <Button
            kind="primary"
            className="h-11 text-[14px]"
            onClick={() => void klair.openWindow('start')}
          >
            Start a session
          </Button>
        )}
      </header>

      <div className="pt-1.5 px-[18px] pb-3.5 flex flex-col gap-3">
        <PixelLabel>Ideas</PixelLabel>
        <div className="flex flex-col gap-2">
          <span id="dwell" className="text-[14px] font-semibold">
            Offer ideas after I stay on a screen for
          </span>
          <div
            role="radiogroup"
            aria-labelledby="dwell"
            className="grid grid-cols-3 gap-1 p-1 rounded-[12px] bg-white/55"
          >
            {DWELL.map((d, i) => {
              const on = s.dwellMs === d.ms
              return (
                <button
                  key={d.ms}
                  role="radio"
                  aria-checked={on}
                  type="button"
                  onClick={() => void klair.setDwellMs(d.ms)}
                  className={`h-[38px] rounded-[9px] border-0 text-[13px] flex items-center justify-center gap-1.5 cursor-pointer ${
                    on
                      ? 'bg-white shadow-[0_1px_3px_rgba(110,70,65,0.14)] font-bold text-ink'
                      : 'bg-transparent font-semibold text-ink-2'
                  }`}
                >
                  {d.label} <span className="text-[10.5px] text-muted">{`⌘${i + 1}`}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 min-h-11">
          <span className="flex flex-col gap-0.5">
            <span id="toggle-key" className="text-[14px] font-semibold">
              Open Klair with
            </span>
            <span className="text-[12.5px] text-ink-3" role="status">
              {keyError ||
                (recording ? 'Press the new shortcut · esc to cancel' : 'Click to change')}
            </span>
          </span>
          <Button
            className="h-[34px] text-[13px]"
            aria-labelledby="toggle-key"
            onClick={() => {
              setKeyError('')
              setRecording((r) => !r)
            }}
          >
            {recording ? 'Listening…' : prettyAccel(s.toggleKey)}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 min-h-11">
          <label htmlFor="quiet" className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold">Quiet for 30 minutes</span>
            <span className="text-[12.5px] text-ink-3">fn Q or ⌃⌥Q from anywhere</span>
          </label>
          <input
            id="quiet"
            type="checkbox"
            role="switch"
            checked={quiet}
            onChange={(e) => void klair.setQuiet(e.target.checked)}
            className="w-10 h-6 m-0 accent-rose"
          />
        </div>
      </div>

      {s.lastAnswerTitle ? (
        <div className="px-[18px] pb-3.5 flex flex-col gap-2.5">
          <PixelLabel>Last answer</PixelLabel>
          <button
            type="button"
            onClick={() => void klair.openPanel()}
            className="flex items-center justify-between gap-3 min-h-11 px-3 rounded-[12px] bg-white border border-[#F3E2DF] text-ink text-[14px] font-semibold text-left cursor-pointer"
          >
            {s.lastAnswerTitle}
            <Key variant="inline">⌘L</Key>
          </button>
        </div>
      ) : null}

      <footer className="mt-auto pt-3 px-[18px] pb-4 flex flex-col gap-2.5">
        <span className="text-[12.5px] leading-[1.45] text-ink-3">
          Screenshots stay on this Mac. Notes sync to your TigerData database; Claude sees new
          screens to take notes, and the relevant ones to make ideas and answers.
        </span>
        <div className="flex justify-between gap-3 text-[13px] font-bold">
          <button
            type="button"
            onClick={() => void klair.openWindow('sessions')}
            className="flex items-center gap-1.5 text-rose-text cursor-pointer"
          >
            All sessions <span className="text-[11px] text-muted">⌘O</span>
          </button>
          <button
            type="button"
            onClick={() => void klair.openWindow('start')}
            className="flex items-center gap-1.5 text-ink-2 cursor-pointer"
          >
            Settings <span className="text-[11px] text-muted">⌘,</span>
          </button>
        </div>
      </footer>
    </MagicCard>
  )
}
