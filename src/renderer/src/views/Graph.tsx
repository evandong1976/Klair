import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectGraph, ProjectItem } from '../../../shared/types'
import { Flower } from '../components/Flower'
import { Button, PixelLabel, PixelProgress } from '../components/ui'
import { isMod, klair, timeLabel } from '../lib/useKlair'

// The Knowledge graph pane (#/graph/<projectId>): one project's Graphify graph, built
// from that project's notes, with a picker to look at any project. The graph itself is
// Graphify's own graph.html, which the main process shows in a sandboxed view placed
// exactly over the area below (it is generated from captured text, so it never runs
// inside this window).

function projectFromHash(): number | null {
  const id = Number(window.location.hash.split('/')[2])
  return Number.isInteger(id) && id > 0 ? id : null
}

export function GraphWindow(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectItem[] | null>(null)
  const [selected, setSelected] = useState<number | null>(projectFromHash)
  const [graph, setGraph] = useState<ProjectGraph | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const area = useRef<HTMLDivElement>(null)

  const loadProjects = useCallback((): void => {
    void klair.listProjects().then((l) => {
      setProjects(l)
      setSelected((cur) => (cur && l.some((p) => p.id === cur) ? cur : (l[0]?.id ?? null)))
    })
  }, [])

  useEffect(() => {
    loadProjects()
    // "Knowledge graph" clicked elsewhere while this pane is open: show that project.
    const onHash = (): void => {
      const id = projectFromHash()
      if (id) setSelected(id)
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('focus', loadProjects)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('focus', loadProjects)
    }
  }, [loadProjects])

  // The graph's status; checked often while it builds.
  useEffect(() => {
    if (selected === null) return
    let alive = true
    let timer = 0
    const load = (): void => {
      void klair.projectGraph(selected).then((g) => {
        if (!alive) return
        setGraph(g)
        timer = window.setTimeout(load, g?.status === 'building' ? 2000 : 8000)
      })
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [selected])

  // Keep Graphify's view over the graph area (or hidden when there's nothing to show).
  const ready = graph?.status === 'ready' && graph.projectId === selected
  const builtAt = graph?.builtAt
  useEffect(() => {
    const el = area.current
    if (!ready || !el || selected === null) {
      void klair.showGraph(null, null)
      return
    }
    const place = (): void => {
      const r = el.getBoundingClientRect()
      void klair.showGraph(selected, { x: r.x, y: r.y, width: r.width, height: r.height })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [ready, selected, builtAt])
  useEffect(() => () => void klair.showGraph(null, null), [])

  const rebuild = useCallback((): void => {
    if (selected === null) return
    void klair
      .rebuildGraph(selected)
      .then(() => setGraph((g) => (g ? { ...g, status: 'building', detail: null } : g)))
  }, [selected])

  const del = async (): Promise<void> => {
    if (selected === null) return
    if (!confirmDelete) return setConfirmDelete(true)
    setConfirmDelete(false)
    void klair.showGraph(null, null)
    await klair.deleteProject(selected)
    setSelected(null)
    setGraph(null)
    loadProjects()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return window.close()
      if (!isMod(e)) return
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        rebuild()
      }
      // ⌘N: the Nth project in the picker.
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      const p = n ? projects?.[Number(n) - 1] : undefined
      if (p) {
        e.preventDefault()
        setSelected(p.id)
        setConfirmDelete(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const current = projects?.find((p) => p.id === selected)

  return (
    <div className="bg-ground/55 h-screen box-border flex flex-col">
      <div className="drag absolute top-0 left-0 right-0 h-8" />
      <header className="pt-10 px-8 pb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Flower res={14} cell={3} label="Klair" />
          <div className="flex flex-col gap-1 min-w-0">
            <PixelLabel>Knowledge graph</PixelLabel>
            <div className="no-drag flex items-center gap-3">
              <select
                aria-label="Project"
                value={selected ?? ''}
                onChange={(e) => {
                  setSelected(Number(e.target.value))
                  setConfirmDelete(false)
                }}
                className="h-10 max-w-[320px] px-3 rounded-[12px] border border-line-input bg-white text-[18px] font-extrabold text-ink outline-none cursor-pointer"
              >
                {(projects ?? []).map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {`${i < 9 ? `${i + 1} · ` : ''}${p.name}`}
                  </option>
                ))}
              </select>
              {graph && graph.projectId === selected ? (
                <span className="text-[13px] text-ink-3">
                  {graph.nodes !== null
                    ? `${graph.nodes} concepts · ${graph.edges} links · ${graph.communities} clusters · from ${graph.notes} notes · built ${timeLabel(graph.builtAt as string)}`
                    : `${graph.notes} notes · no graph yet`}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="no-drag flex gap-2">
          <Button
            keyHint="⌘R"
            disabled={selected === null || graph?.status === 'building' || !graph?.notes}
            onClick={rebuild}
          >
            {graph?.status === 'building' ? 'Building…' : 'Rebuild graph'}
          </Button>
          <Button kind="danger" disabled={selected === null} onClick={() => void del()}>
            {confirmDelete ? `Press again to delete ${current?.name ?? ''}` : 'Delete project'}
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 px-8 pb-8">
        <div
          ref={area}
          className="h-full rounded-[18px] bg-white border border-line-2 overflow-hidden flex items-center justify-center"
        >
          {projects !== null && projects.length === 0 ? (
            <Empty title="No projects yet">
              Start a session with a project from the Start window; its graph appears here.
            </Empty>
          ) : !graph || graph.projectId !== selected ? (
            <Empty title="Loading…" />
          ) : graph.status === 'building' ? (
            <Empty title={`Building ${graph.name}'s graph…`}>
              <PixelProgress />
              Graphify is reading {graph.notes} notes. This takes about a minute.
            </Empty>
          ) : graph.status === 'failed' ? (
            <Empty title="The graph couldn't be built">
              {graph.detail}
              <Button onClick={rebuild}>Try again</Button>
            </Empty>
          ) : graph.status === 'none' ? (
            <Empty title="No graph yet">
              {graph.notes
                ? `It builds from ${graph.name}'s ${graph.notes} notes after a few new screens, or now:`
                : `It builds once ${graph.name} has a few notes.`}
              {graph.notes ? (
                <Button kind="primary" onClick={rebuild}>
                  Build now
                </Button>
              ) : null}
            </Empty>
          ) : null}
        </div>
        <p className="m-0 pt-3 text-[12.5px] text-ink-3">
          Answers in a project search its graph and notes only, so they send a small, relevant part
          of the project instead of everything. Drawing the graph needs an internet connection.
        </p>
      </div>
    </div>
  )
}

function Empty({
  title,
  children
}: {
  title: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="max-w-[420px] flex flex-col items-center gap-3 text-center text-[14px] text-ink-2 p-6">
      <span className="text-[17px] font-extrabold text-ink">{title}</span>
      {children}
    </div>
  )
}
