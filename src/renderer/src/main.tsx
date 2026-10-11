import './assets/main.css'

import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <View />
    </MotionConfig>
  </StrictMode>
)
