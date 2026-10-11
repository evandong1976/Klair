import './assets/main.css'

import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { FlowerWindow } from './views/FlowerWindow'
import { GraphWindow } from './views/Graph'
import { PanelWindow } from './views/Panel'
import { SelectWindow } from './views/Select'
import { SessionsWindow } from './views/Sessions'
import { StartWindow } from './views/Start'
import { TrayWindow } from './views/Tray'

// One renderer bundle; each Klair window loads index.html#/<route>.
const routes: Record<string, () => React.JSX.Element | null> = {
  flower: FlowerWindow,
  panel: PanelWindow,
  select: SelectWindow,
  start: StartWindow,
  sessions: SessionsWindow,
  graph: GraphWindow,
  tray: TrayWindow
}

// #/graph/12 → the graph route with project 12 (the view reads the rest).
const route = window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'start'
const View = routes[route] ?? StartWindow
document.title = `Klair · ${route}`

// Scrollbar thumbs show only while scrolling (styled in main.css).
const scrollTimers = new WeakMap<Element, number>()
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target instanceof Element ? e.target : document.documentElement
    el.classList.add('scrolling')
    window.clearTimeout(scrollTimers.get(el))
    scrollTimers.set(
      el,
      window.setTimeout(() => el.classList.remove('scrolling'), 800)
    )
  },
  { capture: true, passive: true }
)

/**
 * If something throws while a window is being drawn, React removes everything in it and
 * the window is left blank. This says what happened instead, with a way back.
 */
class Recover extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error(`Klair window "${route}" failed to draw:`, error)
  }
  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="m-2 p-4 rounded-[16px] bg-white border border-danger-line flex flex-col gap-2 text-ink">
        <strong className="text-[15px]">Klair couldn&apos;t draw this window</strong>
        <span className="text-[13px] text-ink-2 break-words">{error.message}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start h-9 px-3 rounded-[12px] bg-ink text-on-dark text-[13px] font-bold cursor-pointer"
        >
          Reload
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Recover>
        <View />
      </Recover>
    </MotionConfig>
  </StrictMode>
)
