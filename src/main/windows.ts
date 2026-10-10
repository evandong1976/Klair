import { app, BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { PanelView } from '../shared/types'

// Window plan (DESIGN.md §7):
//   flower   transparent, click-through (except the nudge pill), non-focusable, top-right
//   panel    focusable panel under the flower; takes focus while open
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
let panelView: PanelView = 'closed'

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
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/${route}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
  }
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
  const flowerOpen = panelView === 'ideas' ? 120 : 90
  const y = wa.y + TOP + flowerOpen + 6
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

export function setPanelView(view: PanelView): void {
  panelView = view
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

export function toggleTrayWindow(anchor: Rectangle): void {
  if (trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) {
    trayWin.hide()
    return
  }
  if (!trayWin || trayWin.isDestroyed()) {
    trayWin = new BrowserWindow({
      width: 380,
      height: 640,
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
