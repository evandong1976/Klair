import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FlowerWindow } from './views/FlowerWindow'
import { PanelWindow } from './views/Panel'
import { SessionsWindow } from './views/Sessions'
import { StartWindow } from './views/Start'
import { TrayWindow } from './views/Tray'

// One renderer bundle; each Klair window loads index.html#/<route>.
const routes: Record<string, () => React.JSX.Element | null> = {
  flower: FlowerWindow,
  panel: PanelWindow,
  start: StartWindow,
  sessions: SessionsWindow,
  tray: TrayWindow
}

const route = window.location.hash.replace(/^#\/?/, '') || 'start'
const View = routes[route] ?? StartWindow
document.title = `Klair · ${route}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>
)
