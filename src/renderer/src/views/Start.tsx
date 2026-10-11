import { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthReport, ProjectItem } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button, Key, PixelLabel } from '../components/ui'
import { isMod, klair, useKlairState } from '../lib/useKlair'
import { HealthRow } from './HealthRow'
import { prettyAccel } from '../../../shared/keys'

// The Start window. Projects ("ML", "SWE", "OS") keep the context; a session is the
// time you use Klair, with the projects you pull into it.
//   No session running: tick the projects for this session (or make new ones) and
//   start. Their order is fn 1, fn 2, … and the first is active.
//   A session running: its projects (fn N switches to the Nth; click to switch), and
//   "Add a project" to pull in another saved project or a new one.
// Connection health (BUILD_PROMPT §4.1) shows when starting, or when something needs
// attention. Privacy copy follows BUILD_PROMPT §2, kept literally true.

function lastUsed(p: ProjectItem): string {
  const d = new Date(p.lastUsedAt ?? p.createdAt)
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

function notesLabel(p: ProjectItem): string {
  return p.notes
    ? `${p.notes} note${p.notes === 1 ? '' : 's'} · last used ${lastUsed(p)}`
    : 'No context yet'
}

const ROW =
  'flex items-center gap-3 px-3 min-h-[52px] rounded-[14px] border bg-white text-left cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed'

export function StartWindow(): React.JSX.Element {
  const state = useKlairState()
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [projects, setProjects] = useState<ProjectItem[] | null>(null)
  // Ticked for the new session, in the order ticked (= fn 1, fn 2, …).
  const [picked, setPicked] = useState<number[]>([])
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const running = !!state?.session
  const inSession = new Set((state?.sessionProjects ?? []).map((p) => p.id))

  const recheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      setHealth(await klair.runHealth())
    } finally {
      setChecking(false)
    }
  }, [])

  // Projects deleted elsewhere (the graph pane) drop out of the ticked list too, or
  // they would keep their fn number and push new ones down.
  const loadProjects = useCallback(
    (): Promise<void> =>
      klair.listProjects().then((l) => {
        setProjects(l)
        setPicked((cur) => cur.filter((id) => l.some((p) => p.id === id)))
      }),
    []
  )

  useEffect(() => {
    void klair.getHealth().then(setHealth)
    void loadProjects()
    const onFocus = (): void => {
      void klair.runHealth().then(setHealth)
      void loadProjects()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadProjects])

  const check = (id: string): HealthReport['checks'][number] | undefined =>
    health?.checks.find((c) => c.id === id)
  const screenOk = check('screen')?.status === 'ok'
  // Projects are saved on this Mac first and uploaded to TigerData after each session,
  // so only the local store has to work to start.
  const localOk = check('local')?.status === 'ok'
  const tigerOk = !!check('tigerdata') && check('tigerdata')?.status !== 'fail'
  const ready = !!health && screenOk && localOk

  const toggle = (id: number): void =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const start = (): void => {
    if (ready && picked.length) void klair.startSession(picked)
  }
  /** A new project: ticked for the new session, or pulled into the running one. */
  const create = async (): Promise<void> => {
    const n = name.trim()
    if (!n) return
    const p = await klair.createProject(n)
    setName('')
    if (running) await klair.addToSession(p.id)
    else setPicked((cur) => [...cur, p.id])
    await loadProjects()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = document.activeElement?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        if (typing) return (document.activeElement as HTMLElement).blur()
        return window.close()
      }
      if (typing) {
        if (e.key === 'Enter' && !isMod(e)) {
          e.preventDefault()
          void create()
        }
        if (!(isMod(e) && e.key === 'Enter')) return
      }
      if (isMod(e) && e.key === 'Enter' && !running) {
        e.preventDefault()
        return start()
      }
      if (isMod(e) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        nameRef.current?.focus()
        return
      }
      // In a running session, 1–9 switch to its Nth project (like fn N).
      const slot = /^Digit([1-9])$/.exec(e.code)?.[1]
      const target = slot ? state?.sessionProjects.find((p) => p.slot === Number(slot)) : undefined
      if (running && target && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        void klair.switchProject(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const conn = ['tigerdata', 'openrouter', 'graphify', 'browser']
    .map((id) => check(id))
    .filter(Boolean)

  const openKey = state ? prettyAccel(state.toggleKey) : '⌃⌥K'
  // Setup details show when starting, or while something needs attention.
  const showSetup = !running || (!!health && !ready)
  const others = (projects ?? []).filter((p) => !inSession.has(p.id))

  const newProject = (
    <div className="flex gap-2">
      <input
        ref={nameRef}
        aria-label="New project name"
        value={name}
        placeholder={running ? 'New project for this session, e.g. OS' : 'New project, e.g. OS'}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 h-11 box-border px-3.5 rounded-[12px] border border-line-input bg-white text-[15px] font-medium text-ink outline-none"
      />
      <Button
        onClick={() => void create()}
        disabled={!name.trim()}
        keyHint="↵"
        className="h-11 text-[14px]"
      >
        Add
      </Button>
    </div>
  )

  return (
    <div className="bg-ground/55 h-screen overflow-y-auto box-border pt-10 px-9 pb-7 flex flex-col gap-5">
      <div className="drag absolute top-0 left-0 right-0 h-8" />
      <div className="flex items-center gap-[18px]">
        <Flower res={30} cell={3} label="Klair" />
        <div className="flex flex-col gap-1">
          <PixelLabel className="text-[12px]">Klair</PixelLabel>
          <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.01em]">
            {running ? 'This session' : 'Start a session'}
          </h1>
        </div>
      </div>

      {running ? (
        <>
          <p className="m-0 text-[15px] leading-[1.5] text-ink-2 text-pretty">
            What you give Klair goes into the active project. Switch with its number here, or fn 1–9
            (⌃⌥1–9) from anywhere; the session keeps running.
          </p>
          <nav aria-label="Projects in this session" className="flex flex-col gap-2">
            {(state?.sessionProjects ?? []).map((p) => {
              const active = state?.project?.id === p.id
              const item = projects?.find((x) => x.id === p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void klair.switchProject(p.id)}
                  className={`${ROW} ${active ? 'border-blush-line bg-blush-3' : 'border-line hover:bg-blush-3 hover:border-blush-line'}`}
                >
                  <Key variant={active ? 'selected' : 'default'}>{String(p.slot)}</Key>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px] font-bold truncate">{p.name}</span>
                    <span className="text-[12.5px] text-muted">
                      {active ? 'Active: context goes here' : item ? notesLabel(item) : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
          <div className="flex flex-col gap-2">
            <PixelLabel>Add a project</PixelLabel>
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void klair.addToSession(p.id)}
                className={`${ROW} border-line hover:bg-blush-3 hover:border-blush-line`}
              >
                <span className="flex-none w-[26px] text-center text-[18px] text-ink-3">+</span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold truncate">{p.name}</span>
                  <span className="text-[12.5px] text-muted">{notesLabel(p)}</span>
                </span>
              </button>
            ))}
            {newProject}
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[15px] leading-[1.5] text-ink-2 text-pretty">
            Pick the projects for this session. Each keeps the context from earlier sessions; what
            you give Klair goes into the active one (the first, then switch with fn 1–9). When you
            pause, the flower offers ideas: tap fn (or {openKey}) and ⌘1–9 to pick.
          </p>
          <nav aria-label="Your projects" className="flex flex-col gap-2">
            {(projects ?? []).map((p) => {
              const n = picked.indexOf(p.id) + 1
              return (
                <button
                  key={p.id}
                  type="button"
                  role="checkbox"
                  aria-checked={n > 0}
                  onClick={() => toggle(p.id)}
                  className={`${ROW} ${n ? 'border-blush-line bg-blush-3' : 'border-line hover:bg-blush-3 hover:border-blush-line'}`}
                >
                  <Key variant={n ? 'selected' : 'default'}>{n ? String(n) : ' '}</Key>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px] font-bold truncate">{p.name}</span>
                    <span className="text-[12.5px] text-muted">
                      {n ? `fn ${n} in this session · ` : ''}
                      {notesLabel(p)}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
          {newProject}
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
              }Screenshots and files stay on this Mac. Each project is saved here, then uploaded to your TigerData database after each session${
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
            of the page you&apos;re on goes with them. When you download a file, Klair asks before
            adding it. Pause anytime with fn P or ⌃⌥P.
          </p>
        </>
      ) : null}

      <div className="mt-auto flex justify-end gap-2.5">
        <Button
          onClick={() => void klair.openWindow('sessions')}
          className="h-11 text-[14px] mr-auto"
        >
          All sessions
        </Button>
        <Button onClick={() => window.close()} keyHint="esc" className="h-11 text-[14px]">
          {running ? 'Close' : 'Not now'}
        </Button>
        {running ? null : (
          <Button
            kind="primary"
            onClick={start}
            disabled={!ready || !picked.length}
            keyHint="⌘↵"
            className="h-11 text-[14px]"
          >
            {picked.length > 1 ? `Start with ${picked.length} projects` : 'Start session'}
          </Button>
        )}
      </div>
    </div>
  )
}
