import { contextBridge, ipcRenderer } from 'electron'
import {
  KLAIR_INVOKE_METHODS,
  STATE_CHANNEL,
  invokeChannel,
  type KlairApi,
  type KlairState
} from '../shared/types'

// Narrow, typed API for the renderer. No Node, no keys, no direct IPC access.
const api = Object.fromEntries(
  KLAIR_INVOKE_METHODS.map((m) => [
    m,
    (...args: unknown[]) => ipcRenderer.invoke(invokeChannel(m), ...args)
  ])
) as unknown as KlairApi

api.onState = (cb: (s: KlairState) => void) => {
  const listener = (_: unknown, s: KlairState): void => cb(s)
  ipcRenderer.on(STATE_CHANNEL, listener)
  return () => ipcRenderer.removeListener(STATE_CHANNEL, listener)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('klair', api)
} else {
  // @ts-ignore (declared in index.d.ts)
  window.klair = api
}
