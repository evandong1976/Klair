import { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthReport, SessionListItem } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button, Key, PixelLabel } from '../components/ui'
import { isMod, klair, useKlairState } from '../lib/useKlair'
import { HealthRow } from './HealthRow'
import { prettyAccel } from '../../../shared/keys'

// Opening Klair: pick up one of your sessions (keys 1–9, the same numbers as the
// fn 1–9 switcher), or make a new one. The very first time there is nothing to pick
// up, so it goes straight to "Start a session" (Start.dc.html) with connection
// health (BUILD_PROMPT §4.1). Privacy copy follows BUILD_PROMPT §2, kept literally true.

function lastUsed(s: SessionListItem): string {
  const d = new Date(s.endedAt ?? s.startedAt)
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function StartWindow(): React.JSX.Element {
  const state = useKlairState()
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // null until the list has loaded, so the window doesn't flash the wrong screen.
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null)
  const [wantsNew, setWantsNew] = useState(false)
  const slotted = (sessions ?? [])
    .filter((s) => s.slot !== null)
    .sort((a, b) => (a.slot as number) - (b.slot as number))
  const creating = wantsNew || (sessions !== null && slotted.length === 0)

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
    void klair.listSessions().then(setSessions)
    const onFocus = (): void => {
      void klair.runHealth().then(setHealth)
      void klair.listSessions().then(setSessions)
    }
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
  const ready = !!health && screenOk && localOk
  const start = (): void => {
    if (ready && creating) void klair.startSession(name)
  }
  const pick = (s: SessionListItem): void => {
    if (ready) void klair.continueSession(s.id)
  }
  const newSession = (): void => {
    setWantsNew(true)
    setTimeout(() => nameRef.current?.focus(), 0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = document.activeElement?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        if (wantsNew && slotted.length) return setWantsNew(false)
        return window.close()
      }
      if (creating) {
        if (e.key === 'Enter' && (isMod(e) || typing)) {
          e.preventDefault()
          start()
        }
        return
      }
      // Picking: 1–9 (with or without ⌘) continues that session, ⌘N makes a new one.
      const slot = /^Digit([1-9])$/.exec(e.code)?.[1]
      const target = slot ? slotted.find((s) => s.slot === Number(slot)) : undefined
      if (target && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        pick(target)
      } else if (isMod(e) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newSession()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const conn = ['tigerdata', 'openrouter', 'graphify', 'browser']
    .map((id) => check(id))
    .filter(Boolean)

  const openKey = state ? prettyAccel(state.toggleKey) : '⌃⌥K'
  // While picking, setup details only show if something needs attention.
  const showSetup = creating || (!!health && !ready)

  return (
    <div className="bg-ground/55 h-screen overflow-y-auto box-border pt-10 px-9 pb-7 flex flex-col gap-5">
      <div className="drag absolute top-0 left-0 right-0 h-8" />
      <div className="flex items-center gap-[18px]">
        <Flower res={30} cell={3} label="Klair" />
        <div className="flex flex-col gap-1">
          <PixelLabel className="text-[12px]">Klair</PixelLabel>
          <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.01em]">
            {creating ? 'Start a session' : 'Pick up a session'}
          </h1>
        </div>
      </div>

      {creating ? (
        <>
          <p className="m-0 text-[15px] leading-[1.5] text-ink-2 text-pretty">
            Klair watches your screen while a session is on. When you pause, the flower offers
            ideas. Tap fn (or {openKey}) to open it, then ⌘1–9 to pick. Nothing runs until you do.
          </p>
          <div className="flex flex-col gap-2">
            <label htmlFor="sname" className="text-[13.5px] font-bold">
              Session name
            </label>
            <input
              id="sname"
              ref={nameRef}
              value={name}
              placeholder="e.g. ML study"
              onChange={(e) => setName(e.target.value)}
              className="h-11 box-border px-3.5 rounded-[12px] border border-line-input bg-white text-[15px] font-medium text-ink outline-none"
            />
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[15px] leading-[1.5] text-ink-2 text-pretty">
            Each session keeps its own notes and ideas. Press its number here, or fn 1–9 (⌃⌥1–9)
            from anywhere to switch while you work.
          </p>
          <nav aria-label="Your sessions" className="flex flex-col gap-2">
            {slotted.map((s) => {
              const running = state?.session?.id === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!ready}
                  onClick={() => pick(s)}
                  className="flex items-center gap-3 px-3 min-h-[52px] rounded-[14px] border border-line bg-white text-left cursor-pointer transition-colors hover:bg-blush-3 hover:border-blush-line focus:bg-blush-3 focus:border-blush-line disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Key variant={running ? 'selected' : 'default'}>{String(s.slot)}</Key>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px] font-bold truncate">{s.name}</span>
                    <span className="text-[12.5px] text-muted">
                      {running ? 'Running now' : `Last used ${lastUsed(s)}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        </>
      )}

      {showSetup ? (
        <>
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
            Klair sends each new screen to an AI model (via OpenRouter) to take notes, and the
            relevant notes when it makes ideas and answers. With the Chrome extension, the full text
            of the page you&apos;re on goes with them. Pause anytime with fn P or ⌃⌥P.
          </p>
        </>
      ) : null}

      <div className="mt-auto flex justify-end gap-2.5">
        {creating ? (
          <>
            <Button
              onClick={() => (slotted.length ? setWantsNew(false) : window.close())}
              keyHint="esc"
              className="h-11 text-[14px]"
            >
              {slotted.length ? 'Back' : 'Not now'}
            </Button>
            <Button
              kind="primary"
              onClick={start}
              disabled={!ready}
              keyHint="⌘↵"
              className="h-11 text-[14px]"
            >
              Start observing
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => void klair.openWindow('sessions')}
              className="h-11 text-[14px] mr-auto"
            >
              All sessions
            </Button>
            <Button onClick={() => window.close()} keyHint="esc" className="h-11 text-[14px]">
              Not now
            </Button>
            <Button onClick={newSession} keyHint="⌘N" className="h-11 text-[14px]">
              New session
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
