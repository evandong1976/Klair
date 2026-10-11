import { useCallback, useEffect, useState } from 'react'
import type { ProjectItem, SessionDetail, SessionListItem } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button, PixelLabel } from '../components/ui'
import { isMod, klair, timeLabel, useKlairState } from '../lib/useKlair'

// Sessions window (Sessions.dc.html) + Session insights from the TigerData
// continuous aggregate `activity_by_minute` (BUILD_PROMPT §4.6). A session is the time
// worked; its context lives in the projects worked in during it, each with its own
// knowledge graph (the Knowledge graph button opens the pane on them).

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function duration(a: string, b: string | null): string {
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

/** Where a project's records are: on this Mac, and in TigerData once uploaded. */
function uploadLine(p: ProjectItem | undefined): string {
  switch (p?.upload.status) {
    case 'synced':
      return 'also in TigerData'
    case 'uploading':
      return 'uploading to TigerData…'
    case 'failed':
      return `not uploaded yet${p.upload.error ? ` (${p.upload.error})` : ''}; Klair retries hourly`
    default:
      return 'on this Mac; uploads to TigerData after the session'
  }
}

function projectNames(s: SessionListItem): string {
  return s.projects.length ? s.projects.map((p) => p.name).join(' · ') : 'No project'
}

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`
}

const TAG = {
  seen: 'border border-[#D4D9C6] text-sage-deep',
  asked: 'bg-sage-dark text-white',
  answer: 'bg-blush text-[#8E3A32]'
}

export function SessionsWindow(): React.JSX.Element {
  const live = useKlairState()
  const [list, setList] = useState<SessionListItem[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [projects, setProjects] = useState<ProjectItem[]>([])

  const [listVersion, setListVersion] = useState(0)

  useEffect(() => {
    let alive = true
    klair.listSessions().then((l) => {
      if (!alive) return
      setList(l)
      setSelected((cur) => (cur && l.some((x) => x.id === cur) ? cur : (l[0]?.id ?? null)))
    })
    return () => {
      alive = false
    }
  }, [live?.session?.id, listVersion])

  useEffect(() => {
    let alive = true
    const load = (): void => {
      if (selected === null) return
      klair.getSessionDetail(selected).then((d) => alive && setDetail(d))
      klair.listProjects().then((l) => alive && setProjects(l))
    }
    load()
    const t = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [selected])

  const select = useCallback((id: number) => {
    setSelected(id)
    setConfirmDelete(false)
  }, [])

  const del = async (): Promise<void> => {
    if (!selected) return
    if (!confirmDelete) return setConfirmDelete(true)
    await klair.deleteSession(selected)
    setConfirmDelete(false)
    setSelected(null)
    setDetail(null)
    setListVersion((v) => v + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isMod(e)) return
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        void klair.openWindow('start')
      } else if (k === 'g' && detail?.mainProjectId) {
        e.preventDefault()
        void klair.openGraph(detail.mainProjectId)
      } else if (k === 'p' && live?.session) {
        e.preventDefault()
        void (live.observing === 'on' ? klair.pause() : klair.resume())
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        void del()
      } else if (['1', '2', '3'].includes(e.key) && list[Number(e.key) - 1]) {
        e.preventDefault()
        select(list[Number(e.key) - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const s = detail?.session
  const isLive = !!s && live?.session?.id === s.id
  const maxSecs = Math.max(1, ...(detail?.insights.byTopic.map((r) => r.seconds) ?? [1]))

  return (
    <div className="bg-ground/55 min-h-screen box-border flex flex-wrap items-stretch">
      <div className="drag fixed top-0 left-0 right-0 h-8 z-10" />
      <nav
        aria-label="Sessions"
        className="flex-[1_1_240px] max-w-full box-border border-r border-white/80 bg-white/20 pt-10 px-3.5 pb-6 flex flex-col gap-[18px]"
      >
        <div className="flex items-center justify-between gap-2.5 px-2">
          <span className="flex items-center gap-2.5">
            <Flower res={12} cell={2} />
            <span className="font-pixel text-[14px]">Klair</span>
          </span>
          <button
            type="button"
            aria-label="New session"
            onClick={() => void klair.openWindow('start')}
            className="no-drag h-[30px] px-2 rounded-[8px] border border-line-input bg-white text-[11px] font-bold cursor-pointer"
          >
            ⌘N
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {list.length === 0 ? (
            <span className="px-3 text-[13px] text-ink-3">No sessions yet.</span>
          ) : null}
          {list.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => select(it.id)}
              className={`no-drag flex items-center justify-between gap-2 py-2.5 px-3 rounded-[12px] text-left cursor-pointer ${
                it.id === selected ? 'bg-white shadow-[0_1px_3px_rgba(110,70,65,0.08)]' : ''
              }`}
            >
              <span className="flex flex-col gap-0.5">
                <span
                  className={`text-[14.5px] ${it.id === selected ? 'font-bold' : 'font-semibold'}`}
                >
                  {projectNames(it)}
                </span>
                <span className="text-[12.5px] text-ink-3">
                  {`${dayLabel(it.startedAt)} · ${
                    it.id === live?.session?.id
                      ? 'observing now'
                      : duration(it.startedAt, it.endedAt)
                  }`}
                </span>
              </span>
              {i < 3 ? (
                <span className="text-[11px] font-bold text-ink-3">{`⌘${i + 1}`}</span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-[999_1_560px] min-w-0 box-border pt-10 px-10 pb-10 flex flex-col gap-7">
        {!s ? (
          <p className="text-[15px] text-ink-2">Pick a session, or start one with ⌘N.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <PixelLabel>
                  {isLive
                    ? `Observing since ${timeLabel(s.startedAt)}`
                    : `${dayLabel(s.startedAt)} · ${duration(s.startedAt, s.endedAt)}`}
                </PixelLabel>
                <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.01em]">
                  {projectNames(s)}
                </h1>
                {s.projects.length ? (
                  <span className="no-drag flex flex-wrap gap-1.5 pt-1">
                    {s.projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        title={`Open ${p.name}'s knowledge graph`}
                        onClick={() => void klair.openGraph(p.id)}
                        className="h-7 px-2.5 rounded-full border border-sage-line bg-sage-tint-2 text-[12.5px] font-semibold text-sage-deep cursor-pointer hover:bg-sage-tint"
                      >
                        {`${p.name} · ${Math.max(1, Math.round(p.ms / 60_000))} min`}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              <div className="no-drag flex flex-wrap gap-2">
                <Button
                  kind="primary"
                  keyHint="⌘G"
                  disabled={!detail?.mainProjectId}
                  onClick={() => void klair.openGraph(detail?.mainProjectId ?? undefined)}
                >
                  Knowledge graph
                </Button>
                {isLive ? (
                  <Button
                    keyHint="⌘P"
                    onClick={() => void (live?.observing === 'on' ? klair.pause() : klair.resume())}
                  >
                    {live?.observing === 'on' ? 'Pause' : 'Resume'}
                  </Button>
                ) : null}
                <Button kind="danger" keyHint="⌘⌫" onClick={() => void del()}>
                  {confirmDelete ? 'Press again: projects keep their data' : 'Delete session'}
                </Button>
              </div>
            </header>

            <div className="flex flex-wrap gap-8 items-start">
              <section aria-label="Timeline" className="flex-[999_1_420px] min-w-0 flex flex-col">
                <h2 className="m-0 mb-3.5 font-pixel font-normal text-[11px] text-sage-deep">
                  Timeline
                </h2>
                <ol className="list-none m-0 p-0 flex flex-col rounded-[18px] bg-white border border-line-2">
                  {detail.timeline.length === 0 ? (
                    <li className="py-4 px-[18px] text-[14px] text-ink-3">Nothing captured yet.</li>
                  ) : null}
                  {detail.timeline.map((t, i) => (
                    <li
                      key={`${t.at}-${i}`}
                      className={`grid grid-cols-[72px_minmax(0,1fr)] gap-4 py-4 px-[18px] ${
                        i < detail.timeline.length - 1 ? 'border-b border-[#F5EDEB]' : ''
                      }`}
                    >
                      <span className="font-mono text-[12px] text-muted pt-0.5">
                        {timeLabel(t.at)}
                      </span>
                      <span className="flex flex-col gap-1.5 min-w-0">
                        <span className="text-[15px] font-semibold break-words">
                          {t.title}
                          {t.project && s.projects.length > 1 ? (
                            <span className="ml-2 align-middle text-[11px] font-bold py-0.5 px-[7px] rounded-[5px] bg-sage-tint text-sage-deep">
                              {t.project}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex gap-1.5 flex-wrap items-center">
                          {t.kind === 'asked' ? (
                            <>
                              <span
                                className={`text-[11.5px] font-bold py-0.5 px-[7px] rounded-[5px] ${TAG.asked}`}
                              >
                                You asked
                              </span>
                              {t.status === 'complete' ? (
                                <span
                                  className={`text-[11.5px] font-bold py-0.5 px-[7px] rounded-[5px] ${TAG.answer}`}
                                >
                                  Klair&apos;s answer
                                </span>
                              ) : null}
                              <span className="text-[12.5px] text-muted">{t.status}</span>
                            </>
                          ) : (
                            <>
                              <span
                                className={`text-[11.5px] font-bold py-0.5 px-[7px] rounded-[5px] ${TAG.seen}`}
                              >
                                Seen on screen
                              </span>
                              <span className="text-[12.5px] text-muted break-all">{t.detail}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <aside className="flex-[1_1_280px] min-w-0 flex flex-col gap-4">
                <section className="rounded-[18px] bg-white border border-line-2 p-[18px] flex flex-col gap-3">
                  <h2 className="m-0 font-pixel font-normal text-[11px] text-sage-deep">
                    Session insights
                  </h2>
                  {detail.insights.byTopic.length === 0 ? (
                    <span className="text-[13.5px] text-ink-3">No activity yet.</span>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <span className="text-[12.5px] font-semibold text-ink-3">
                        Where the time went
                      </span>
                      {detail.insights.byTopic.map((r) => (
                        <div key={r.topic} className="flex flex-col gap-1">
                          <div className="flex justify-between gap-2 text-[13px]">
                            <span className="font-semibold truncate">{r.topic}</span>
                            <span className="font-mono text-[12px] text-muted whitespace-nowrap">
                              {fmtSecs(r.seconds)}
                            </span>
                          </div>
                          <div
                            aria-hidden="true"
                            className="h-2"
                            style={{
                              width: `${Math.max(6, (r.seconds / maxSecs) * 100)}%`,
                              background:
                                'repeating-linear-gradient(90deg, #9CAA77 0 8px, transparent 8px 10px)'
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.insights.stuck.length ? (
                    <div className="flex flex-col gap-2 pt-1">
                      <span className="text-[12.5px] font-semibold text-ink-3">Stuck spots</span>
                      {detail.insights.stuck.map((st) => (
                        <div
                          key={st.at}
                          className="flex flex-col gap-0.5 py-2 px-2.5 rounded-[10px] bg-blush-2"
                        >
                          <span className="text-[13px] font-bold">
                            {`${st.topic} · paused ${fmtSecs(Math.round(st.dwellMs / 1000))}`}
                          </span>
                          <span className="text-[12px] text-ink-3">{`Offered: ${st.offered.join(' · ')}`}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <span className="text-[11.5px] text-muted">
                    {detail.insights.source === 'aggregate'
                      ? 'From the TigerData continuous aggregate activity_by_minute'
                      : detail.insights.source === 'raw'
                        ? 'From the screen_activity table on this Mac'
                        : ''}
                  </span>
                </section>

                <section className="rounded-[18px] bg-white border border-line-2 p-[18px] flex flex-col gap-3">
                  <h2 className="m-0 font-pixel font-normal text-[11px] text-sage-deep">
                    What Klair is holding
                  </h2>
                  <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-[14px]">
                    <dt className="text-muted">On screen</dt>
                    <dd className="m-0 font-semibold break-words">{detail.holding.onScreen}</dd>
                    <dt className="text-muted">Topic</dt>
                    <dd className="m-0 font-semibold">
                      {detail.holding.topic}{' '}
                      <span className="text-muted font-normal">— a guess</span>
                    </dd>
                    <dt className="text-muted">Related</dt>
                    <dd className="m-0 font-semibold break-words">{detail.holding.related}</dd>
                  </dl>
                </section>

                <section className="rounded-[18px] bg-white border border-line-2 p-[18px] flex flex-col gap-2.5">
                  <h2 className="m-0 font-pixel font-normal text-[11px] text-sage-deep">Privacy</h2>
                  <p className="m-0 text-[14px] leading-[1.5]">
                    {`Screenshots and files stay on this Mac.${
                      isLive ? ' Projects upload to TigerData when the session ends.' : ''
                    } Kept for ${detail.privacy.retentionDays} days.`}
                  </p>
                  <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[13.5px]">
                    {s.projects.map((p) => (
                      <li key={p.id}>
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-muted">{` · ${uploadLine(projects.find((x) => x.id === p.id))}`}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-[14px] leading-[1.5]">
                    {`Sent to the AI model ${detail.privacy.sentToClaude} times this session: new screens for notes, plus ideas and answers.`}
                  </p>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
