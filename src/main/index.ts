import './env'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import * as c from './controller'
import { Bridge } from './bridge'
import { condense } from './condense'
import { config } from './config'
import { runHealth, setBridgeInfo } from './health'
import { registerIpc } from './ipc'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { getState, onStateChange, setState } from './state'
import { createTray, setTrayPaused } from './tray'
import * as windows from './windows'

// Klair runs in the background: a flower in the top-right corner, a panel on fn,
// and a menu bar icon. There is no main window.

// app.quit() would still run whenReady below and start a second flower, tray and
// fn tap; exit at once instead. The running Klair shows its Start window.
if (!app.requestSingleInstanceLock()) {
  console.log(
    'Klair is already running (quit it from the menu bar first); showing its Start window.'
  )
  app.exit(0)
}
app.on('second-instance', () => windows.openStart())

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

  // With text selected in Chrome, fn replaces it with a short version (condense.ts)
  // instead of opening the panel.
  let bridge: Bridge | null = null
  const keys = registerShortcuts({
    toggle: () => {
      if (!bridge?.fnTap()) c.togglePanel()
    },
    pause: () => void c.togglePause(),
    quiet: () => c.toggleQuiet(),
    session: (slot) => void c.switchToSlot(slot)
  })
  if (!keys.fn && !keys.fallback.toggle) {
    setState({
      notice: { kind: 'fn-busy', detail: 'Neither fn nor the Klair shortcut could be registered' }
    })
  }

  // Full pages from the Chrome extension (extension/), fed into the running session.
  bridge = new Bridge(
    {
      onPage: (page) => c.onBrowserPage(page),
      status: () => ({ session: !!getState().session, observing: getState().observing === 'on' }),
      condense
    },
    { port: config.bridgePort, extensionId: config.extensionId }
  )
  const b = bridge
  setBridgeInfo(() => b.info())
  if (!(await b.listen())) console.warn('chrome bridge:', b.info().error)

  windows.openStart()

  const health = await runHealth()
  console.log('klair health:', health.checks.map((ch) => `${ch.id}=${ch.status}`).join(' '))
  if (health.checks.find((ch) => ch.id === 'local')?.status === 'ok') {
    // Sessions live in SQLite on this Mac; TigerData gets each one when it ends.
    await c.reconcileLocal()
    await c.retentionSweep()
    void c.syncEnded() // sessions a quit or crash left open, and uploads that failed
    setInterval(() => {
      void c.retentionSweep()
      void c.syncEnded()
    }, 60 * 60_000)
  } else if (!getState().session) {
    setState({ saving: false })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createFlowerWindow()
  })
})

app.on('will-quit', () => {
  unregisterShortcuts()
  c.flushOnQuit()
})

// Klair lives in the menu bar; closing its windows doesn't quit it.
app.on('window-all-closed', () => {})
