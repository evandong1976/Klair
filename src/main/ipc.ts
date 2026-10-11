import { desktopCapturer, ipcMain, shell } from 'electron'
import {
  invokeChannel,
  type KlairApi,
  type KlairInvokeMethod,
  type SettingsPane
} from '../shared/types'
import * as c from './controller'
import { getProject, listProjects, listSessions } from './local'
import { projectGraph, rebuildGraph } from './graphs'
import { graphHtmlPath } from './paths'
import { retryFnKey } from './fnkey'
import { lastHealth, runHealth } from './health'
import { setToggleKey } from './shortcuts'
import { uploadPending } from './upload'
import { getState } from './state'
import * as windows from './windows'

// The narrow, typed bridge between the renderer and the background controller.
// The renderer only sends intents; validation and all privileged work happen here.

type Handlers = {
  [K in KlairInvokeMethod]: (
    ...args: Parameters<KlairApi[K]>
  ) => ReturnType<KlairApi[K]> | Awaited<ReturnType<KlairApi[K]>>
}

const SETTINGS_URLS: Record<SettingsPane, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'input-monitoring': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  keyboard: 'x-apple.systempreferences:com.apple.preference.keyboard',
  privacy: 'x-apple.systempreferences:com.apple.preference.security'
}

const handlers: Handlers = {
  getState: async () => getState(),
  openPanel: async () => c.openPanel(),
  closePanel: async () => c.closePanel(),
  showShortcuts: async () => c.showShortcuts(),
  backToIdeas: async () => c.backToIdeas(),
  pickKey: async (key) => c.pickKey(Number(key)),
  ask: (text) => c.ask(String(text)),
  reshape: (text) => c.reshape(String(text)),
  cancel: async () => c.cancelExecution(),
  retry: () => c.retry(),
  dismissNotice: async () => c.dismissNotice(),
  dismissIdeas: async () => c.dismissIdeas(),
  setPanelSize: async (w, h) => windows.resizePanel(Number(w), Number(h)),
  setFlowerInteractive: async (on) => windows.setFlowerInteractive(Boolean(on)),
  startSession: (name) => c.startSession(String(name)),
  switchProject: (id) => c.switchProject(Number(id)),
  pause: () => c.pause(),
  resume: () => c.resume(),
  endSession: () => c.endSession(),
  deleteSession: (id) => c.deleteSession(Number(id)),
  listSessions: () => listSessions().catch(() => []),
  getSessionDetail: (id) => c.sessionDetail(Number(id)).catch(() => null),
  setDwellMs: async (ms) => c.setDwellMs(Math.max(10_000, Number(ms))),
  setQuiet: async (on) => c.setQuiet(Boolean(on)),
  setToggleKey: async (accel) => setToggleKey(String(accel)),
  getHealth: async () => lastHealth() ?? runHealth(),
  runHealth: async () => {
    const h = await runHealth()
    // "Check again" doubles as "retry uploads" once TigerData is reachable.
    if (h.checks.find((ch) => ch.id === 'tigerdata')?.status !== 'fail') void uploadPending()
    return h
  },
  openSettings: async (pane) => {
    // macOS only lists an app under Screen Recording after it has tried to capture,
    // and checking the status doesn't count. One throwaway capture registers Klair
    // (and shows the system prompt the first time).
    if (pane === 'screen') {
      await desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .catch(() => [])
    }
    // Same for Input Monitoring: only the addon's request (CGRequestListenEventAccess)
    // gets Klair listed there.
    if (pane === 'input-monitoring') retryFnKey()
    const url = SETTINGS_URLS[pane]
    if (url) await shell.openExternal(url)
  },
  openWindow: async (name) =>
    name === 'sessions'
      ? windows.openSessions()
      : name === 'graph'
        ? windows.openGraph(c.activeProjectId())
        : windows.openStart(),
  openShot: (id) => c.shotDataUrl(Number(id)),
  listProjects: () => listProjects().catch(() => []),
  deleteProject: (id) => c.deleteProject(Number(id)),
  openGraph: async (id) => {
    // The given project, else the active one, else the most recently used.
    const pid =
      (id != null && (await getProject(Number(id)))?.id) ||
      c.activeProjectId() ||
      (await listProjects().catch(() => []))[0]?.id ||
      null
    windows.openGraph(pid)
  },
  projectGraph: (id) => projectGraph(Number(id)),
  rebuildGraph: async (id) => rebuildGraph(Number(id)),
  showGraph: async (id, rect) =>
    windows.showGraphView(
      id == null ? null : graphHtmlPath(Number(id)),
      rect
        ? {
            x: Number(rect.x),
            y: Number(rect.y),
            width: Number(rect.width),
            height: Number(rect.height)
          }
        : null
    ),
  startSelection: async () => c.startSelection(),
  finishSelection: (rect) =>
    c.finishSelection({
      x: Number(rect?.x),
      y: Number(rect?.y),
      width: Number(rect?.width),
      height: Number(rect?.height)
    }),
  cancelSelection: async () => c.cancelSelection(),
  clearSelection: async () => c.clearSelection(),
  addDownload: (id) => c.addDownload(String(id)),
  skipDownload: async (id) => c.skipDownload(String(id))
}

export function registerIpc(): void {
  for (const [name, fn] of Object.entries(handlers) as [
    KlairInvokeMethod,
    (...a: unknown[]) => unknown
  ][]) {
    ipcMain.handle(invokeChannel(name), (_e, ...args) => fn(...args))
  }
}
