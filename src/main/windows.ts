import {
  app,
  BrowserWindow,
  nativeTheme,
  screen,
  shell,
  WebContentsView,
  type Rectangle
} from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Window plan (DESIGN.md §7):
//   flower   transparent, click-through (except the nudge pill), non-focusable, top-right
//   panel    focusable panel in the same corner, drawn over the bloomed flower; takes focus while open
//   start / sessions  normal windows; tray popover under the menu bar icon
// Frosted glass is native macOS vibrancy (CSS backdrop-filter can't blur other apps).
// macOS rounds a vibrancy window at 16px, so the panel and tray shells use that radius
// to sit exactly on it. The flower window has no vibrancy: it is mostly empty space.
// All Klair windows are excluded from screen capture (setContentProtection).

const TOP = 10
const RIGHT = 14
const FLOWER_W = 480
const FLOWER_H = 140

let flower: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let startWin: BrowserWindow | null = null
let sessionsWin: BrowserWindow | null = null
let trayWin: BrowserWindow | null = null
let panelSize = { width: 460, height: 420 }

const isMac = process.platform === 'darwin'

// Klair's palette is light-only. Without this, a Mac in Dark mode gives the windows
// the dark vibrancy material, which turns the glass muddy under the light tint.
nativeTheme.themeSource = 'light'

const glass = (material: 'popover' | 'under-window'): Electron.BrowserWindowConstructorOptions =>
  isMac ? { vibrancy: material, visualEffectState: 'active' } : {}

function webPreferences(): Electron.WebPreferences {
  return { preload: join(__dirname, '../preload/index.js'), sandbox: false }
}

function load(win: BrowserWindow, route: string): void {
  const go = (): void => {
    if (win.isDestroyed()) return
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/${route}`).catch(() => {})
    } else {
      void win
        .loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
        .catch(() => {})
    }
  }
  // A window whose page didn't load (in development, the dev server not answering yet)
  // or whose page process died would otherwise stay white for good. Try again.
  // ponytail: retries every half second for as long as the load fails. Right for a dev
  // server that is restarting; a packaged app loads from disk, which doesn't fail.
  let fails = 0
  win.webContents.on('did-fail-load', (_e, code, why, _url, isMainFrame) => {
    // -3 is "aborted": a newer load of the same window replaced this one.
    if (!isMainFrame || code === -3) return
    if (fails++ < 3) console.warn(`window "${route}" failed to load (${why}); trying again`)
    setTimeout(go, 500)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.warn(`window "${route}" lost its page process (${details.reason}); reloading`)
    if (details.reason !== 'clean-exit') setTimeout(go, 200)
  })
  go()
  win.webContents.setWindowOpenHandler((d) => {
    void shell.openExternal(d.url)
    return { action: 'deny' }
  })
}

function workArea(): Rectangle {
  return screen.getPrimaryDisplay().workArea
}

function floatEverywhere(win: BrowserWindow, level: 'screen-saver' | 'floating'): void {
  win.setAlwaysOnTop(true, level)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(true)
}

export function createFlowerWindow(): BrowserWindow {
  const wa = workArea()
  flower = new BrowserWindow({
    width: FLOWER_W,
    height: FLOWER_H,
    x: wa.x + wa.width - FLOWER_W - RIGHT,
    y: wa.y + TOP,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: webPreferences()
  })
  floatEverywhere(flower, 'screen-saver')
  flower.setIgnoreMouseEvents(true, { forward: true })
  flower.once('ready-to-show', () => flower?.showInactive())
  load(flower, 'flower')
  return flower
}

export function setFlowerInteractive(interactive: boolean): void {
  flower?.setIgnoreMouseEvents(!interactive, { forward: true })
}

export function createPanelWindow(): BrowserWindow {
  panel = new BrowserWindow({
    width: panelSize.width,
    height: panelSize.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    ...glass('popover'),
    show: false,
    webPreferences: webPreferences()
  })
  floatEverywhere(panel, 'floating')
  load(panel, 'panel')
  return panel
}

function positionPanel(): void {
  if (!panel) return
  const wa = workArea()
  // The panel opens over the corner the flower sits in: the bloomed flower becomes the
  // panel's backdrop (Panel.tsx), so it takes no room of its own above the panel.
  const y = wa.y + TOP
  const maxH = wa.y + wa.height - y - 12
  const height = Math.min(panelSize.height, maxH)
  panel.setBounds({
    x: Math.round(wa.x + wa.width - RIGHT - panelSize.width),
    y: Math.round(y),
    width: Math.round(panelSize.width),
    height: Math.round(height)
  })
  panel.invalidateShadow()
}

export function resizePanel(width: number, height: number): void {
  panelSize = { width: Math.max(320, width), height: Math.max(120, height) }
  positionPanel()
}

export function showPanel(): void {
  if (!panel) return
  positionPanel()
  panel.show()
  panel.focus()
  if (isMac) app.focus({ steal: true })
}

export function hidePanel(): void {
  if (!panel || !panel.isVisible()) return
  panel.hide()
  // Hand focus back to the app the user was in (macOS), keeping the flower visible.
  const otherWindows = [startWin, sessionsWin].some((w) => w && !w.isDestroyed() && w.isVisible())
  if (isMac && !otherWindows) {
    app.hide()
    setTimeout(() => flower?.showInactive(), 60)
  }
}

/** Hide the panel without handing focus back to the previous app (a Klair window follows). */
export function stepAsidePanel(): void {
  panel?.hide()
}

// The selection overlay: a transparent window over one whole display (menu bar
// included) where the user drags out an area. Excluded from capture like every
// Klair window, and its CSS pixels are the display's points.
let selectWin: BrowserWindow | null = null
let selectDisplay: Electron.Display | null = null

export function showSelectionOverlay(): Electron.Display {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  selectDisplay = display
  if (!selectWin || selectWin.isDestroyed()) {
    selectWin = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: webPreferences()
    })
    floatEverywhere(selectWin, 'screen-saver')
    load(selectWin, 'select')
    selectWin.once('ready-to-show', () => revealSelection())
  } else {
    revealSelection()
  }
  return display
}

function revealSelection(): void {
  if (!selectWin || !selectDisplay) return
  selectWin.setBounds(selectDisplay.bounds)
  selectWin.show()
  selectWin.focus()
  if (isMac) app.focus({ steal: true })
}

/**
 * Hide the overlay. Returns its display and where the overlay actually sat on it (in
 * points), in case macOS nudged it (e.g. below the menu bar), so a selection made in
 * overlay coordinates can be mapped back onto the display exactly.
 */
export function hideSelectionOverlay(): {
  display: Electron.Display
  offset: { x: number; y: number }
} | null {
  if (!selectWin || selectWin.isDestroyed() || !selectDisplay) return null
  const b = selectWin.getBounds()
  selectWin.hide()
  return {
    display: selectDisplay,
    offset: { x: b.x - selectDisplay.bounds.x, y: b.y - selectDisplay.bounds.y }
  }
}

export function panelVisible(): boolean {
  return !!panel?.isVisible()
}

function appWindow(
  route: string,
  opts: { width: number; height: number; resizable: boolean; minWidth?: number; minHeight?: number }
): BrowserWindow {
  const win = new BrowserWindow({
    ...opts,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: isMac ? '#00000000' : '#FBF7F5',
    ...glass('under-window'),
    webPreferences: webPreferences()
  })
  win.setContentProtection(true)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  load(win, route)
  return win
}

export function openStart(): void {
  if (startWin && !startWin.isDestroyed()) return startWin.focus()
  startWin = appWindow('start', { width: 560, height: 860, resizable: false })
  startWin.on('closed', () => (startWin = null))
}

export function closeStart(): void {
  if (startWin && !startWin.isDestroyed()) startWin.close()
}

export function openSessions(): void {
  if (sessionsWin && !sessionsWin.isDestroyed()) return sessionsWin.focus()
  sessionsWin = appWindow('sessions', {
    width: 1180,
    height: 820,
    resizable: true,
    minWidth: 720,
    minHeight: 560
  })
  sessionsWin.on('closed', () => (sessionsWin = null))
}

// The Knowledge graph pane: a normal window (#/graph/<projectId>) with a project picker,
// plus Graphify's own graph.html for the chosen project, shown in a sandboxed view
// placed over the pane's graph area. graph.html is generated from captured text, so it
// gets no preload and no Node, can't navigate away, and opens links in the browser.
let graphWin: BrowserWindow | null = null
let graphView: WebContentsView | null = null
let graphViewFile: string | null = null
let graphViewMtime = 0

export function openGraph(projectId: number | null): void {
  const route = projectId ? `graph/${projectId}` : 'graph'
  if (graphWin && !graphWin.isDestroyed()) {
    if (projectId)
      void graphWin.webContents.executeJavaScript(`location.hash = '#/${route}'`).catch(() => {})
    return graphWin.focus()
  }
  graphWin = appWindow(route, {
    width: 1180,
    height: 820,
    resizable: true,
    minWidth: 760,
    minHeight: 560
  })
  graphWin.on('closed', () => {
    graphWin = null
    graphView = null
    graphViewFile = null
  })
}

/** Show `htmlPath` in the graph area (`rect`, window coordinates), or hide the view. */
export function showGraphView(htmlPath: string | null, rect: Rectangle | null): void {
  if (!graphWin || graphWin.isDestroyed()) return
  if (!htmlPath || !rect || !existsSync(htmlPath)) {
    graphView?.setVisible(false)
    return
  }
  if (!graphView) {
    graphView = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const wc = graphView.webContents
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    graphView.setBackgroundColor('#FBF7F5')
    graphWin.contentView.addChildView(graphView)
  }
  // A different project, or the same one rebuilt since it was loaded.
  const mtime = statSync(htmlPath).mtimeMs
  if (graphViewFile !== htmlPath || graphViewMtime !== mtime) {
    graphViewFile = htmlPath
    graphViewMtime = mtime
    void graphView.webContents.loadFile(htmlPath).catch(() => {})
  }
  graphView.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  })
  graphView.setVisible(true)
}

export function toggleTrayWindow(anchor: Rectangle): void {
  if (trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) {
    trayWin.hide()
    return
  }
  if (!trayWin || trayWin.isDestroyed()) {
    trayWin = new BrowserWindow({
      width: 380,
      height: 750,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      hasShadow: true,
      ...glass('popover'),
      webPreferences: webPreferences()
    })
    trayWin.setContentProtection(true)
    trayWin.on('blur', () => trayWin?.hide())
    load(trayWin, 'tray')
  }
  const x = Math.round(anchor.x + anchor.width / 2 - 190)
  const y = Math.round(anchor.y + anchor.height + 4)
  trayWin.setPosition(x, y)
  trayWin.show()
  trayWin.focus()
}

export function hideTrayWindow(): void {
  trayWin?.hide()
}
