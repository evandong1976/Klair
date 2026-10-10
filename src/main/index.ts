import './env'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import * as c from './controller'
import { getPool } from './db'
import { runHealth } from './health'
import { registerIpc } from './ipc'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { getState, onStateChange, setState } from './state'
import { createTray, setTrayPaused } from './tray'
import * as windows from './windows'

// Klair runs in the background: a flower in the top-right corner, a panel on fn,
// and a menu bar icon. There is no main window.

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.klair.app')
  if (process.platform === 'darwin') app.dock?.hide()

  // F12 devtools in dev for app windows. Not for the panel: it handles its own ⌘ keys (⌘R etc.).
  app.on('browser-window-created', (_, window) => {
    window.webContents.once('did-finish-load', () => {
      if (!window.webContents.getURL().includes('#/panel')) optimizer.watchWindowShortcuts(window)
    })
  })

  registerIpc()
  windows.createFlowerWindow()
  windows.createPanelWindow()

  createTray({
    onClick: (bounds) => windows.toggleTrayWindow(bounds),
    onOpen: () => c.openPanel(),
    onTogglePause: () => void c.togglePause(),
    onSessions: () => windows.openSessions(),
    onQuit: () => app.quit()
  })
  onStateChange((s) => setTrayPaused(s.flower === 'paused' || s.flower === 'off'))

  const keys = registerShortcuts({
    toggle: () => c.togglePanel(),
    pause: () => void c.togglePause(),
    quiet: () => c.toggleQuiet()
  })
  if (!keys.fn && !keys.fallback.toggle) {
    setState({ notice: { kind: 'fn-busy', detail: 'Neither fn nor ⌃⌥K could be registered' } })
  }

  windows.openStart()

  const health = await runHealth()
  console.log('klair health:', health.checks.map((ch) => `${ch.id}=${ch.status}`).join(' '))
  if (health.checks.find((ch) => ch.id === 'tigerdata')?.status !== 'fail' && getPool()) {
    await c.reconcileLocal()
    await c.retentionSweep()
    setInterval(() => void c.retentionSweep(), 60 * 60_000)
  } else if (!getState().session) {
    setState({ saving: false })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createFlowerWindow()
  })
})

app.on('will-quit', () => {
  unregisterShortcuts()
})

// Klair lives in the menu bar; closing its windows doesn't quit it.
app.on('window-all-closed', () => {})
