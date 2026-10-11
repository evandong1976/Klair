import { useCallback, useEffect, useState } from 'react'
import type { HealthReport } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button, PixelLabel } from '../components/ui'
import { isMod, klair, useKlairState } from '../lib/useKlair'
import { HealthRow } from './HealthRow'
import { prettyAccel } from '../../../shared/keys'

// Start a session (Start.dc.html) + connection health (BUILD_PROMPT §4.1).
// Privacy copy follows BUILD_PROMPT §2 (TigerData), corrected so it's literally true.

export function StartWindow(): React.JSX.Element {
  const state = useKlairState()
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [name, setName] = useState('ML study')

  const recheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      setHealth(await klair.runHealth())
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void klair.getHealth().then(setHealth)
    const onFocus = (): void => void klair.runHealth().then(setHealth)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const check = (id: string): HealthReport['checks'][number] | undefined =>
    health?.checks.find((c) => c.id === id)
  const screenOk = check('screen')?.status === 'ok'
  // Sessions are saved on this Mac first and uploaded to TigerData when they end,
  // so only the local store has to work to start one.
  const localOk = check('local')?.status === 'ok'
  const tigerOk = !!check('tigerdata') && check('tigerdata')?.status !== 'fail'
  const canStart = !!health && screenOk && localOk && !state?.session
  const start = (): void => {
    if (canStart) void klair.startSession(name)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isMod(e) && e.key === 'Enter') {
        e.preventDefault()
        start()
      }
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const conn = ['tigerdata', 'openrouter', 'graphify', 'browser']
    .map((id) => check(id))
    .filter(Boolean)

  return (
    <div className="bg-ground/55 min-h-screen box-border pt-10 px-9 pb-7 flex flex-col gap-5">
      <div className="drag absolute top-0 left-0 right-0 h-8" />
      <div className="flex items-center gap-[18px]">
        <Flower res={30} cell={3} label="Klair" />
        <div className="flex flex-col gap-1">
          <PixelLabel className="text-[12px]">Klair</PixelLabel>
          <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.01em]">
            {state?.session ? 'Session running' : 'Start a session'}
          </h1>
        </div>
      </div>
      <p className="m-0 text-[15px] leading-[1.5] text-ink-2 text-pretty">
        Klair watches your screen while a session is on. When you pause, the flower offers ideas.
        Tap fn (or {state ? prettyAccel(state.toggleKey) : '⌃⌥K'}) to open it, then ⌘1, ⌘2 or ⌘3 to
        pick. Nothing runs until you do.
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor="sname" className="text-[13.5px] font-bold">
          Session name
        </label>
        <input
          id="sname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 box-border px-3.5 rounded-[12px] border border-line-input bg-white text-[15px] font-medium text-ink outline-none"
        />
      </div>

      <ul className="list-none m-0 p-0 flex flex-col rounded-[18px] bg-white border border-line-2">
        <HealthRow
          status={check('screen')?.status ?? 'unknown'}
          title="Screen recording"
          detail={check('screen')?.detail ?? 'Checking…'}
          action={
            screenOk ? null : (
              <Button
                className="h-[34px] text-[13px]"
                onClick={() => void klair.openSettings('screen')}
              >
                Allow
              </Button>
            )
          }
        />
        <HealthRow
          status={check('fnkey')?.status ?? 'unknown'}
          title="The fn key"
          detail={check('fnkey')?.detail ?? 'Checking…'}
          action={
            check('fnkey')?.status === 'ok' ? null : (
              <Button
                className="h-[34px] text-[13px]"
                onClick={() => void klair.openSettings('input-monitoring')}
              >
                Allow
              </Button>
            )
          }
        />
        <HealthRow
          status={!localOk ? 'fail' : tigerOk ? 'ok' : 'warn'}
          title="Where your data lives"
          detail={`${
            localOk ? '' : `${check('local')?.detail ?? 'Checking this Mac…'} `
          }Screenshots stay on this Mac. A session is saved here while it runs, then uploaded to your TigerData database when it ends${
            tigerOk ? '' : ' (once TigerData is reachable)'
          }. Kept for ${state?.retentionDays ?? '…'} days.`}
          last
        />
      </ul>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <PixelLabel>Connections</PixelLabel>
          <button
            type="button"
            onClick={() => void recheck()}
            className="text-[13px] font-bold text-rose-text cursor-pointer"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
        <ul className="list-none m-0 p-0 flex flex-col rounded-[18px] bg-white border border-line-2">
          {conn.map((c, i) => (
            <HealthRow
              key={c!.id}
              status={c!.status}
              title={c!.label}
              detail={c!.detail}
              last={i === conn.length - 1}
            />
          ))}
        </ul>
      </div>

      <p className="m-0 text-[12.5px] leading-[1.5] text-ink-3 text-pretty">
        Klair sends each new screen to an AI model (via OpenRouter) to take notes, and the relevant
        notes when it makes ideas and answers. With the Chrome extension, the full text of the page
        you&apos;re on goes with them. When you download a file, Klair asks before adding it. Pause
        anytime with fn P or ⌃⌥P.
      </p>

      <div className="mt-auto flex justify-end gap-2.5">
        <Button onClick={() => window.close()} keyHint="esc" className="h-11 text-[14px]">
          Not now
        </Button>
        <Button
          kind="primary"
          onClick={start}
          disabled={!canStart}
          keyHint="⌘↵"
          className="h-11 text-[14px]"
        >
          Start observing
        </Button>
      </div>
    </div>
  )
}
