import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { flowerPixels } from '../shared/flower'

// Menu bar icon: the Klair flower itself (18pt, @2x), grey while paused.

function flowerIcon(paused: boolean): NativeImage {
  const res = 18
  const cell = 2
  const size = res * cell
  const buf = Buffer.alloc(size * size * 4)
  const px = flowerPixels(res, { paused })
  for (let k = 0; k < px.length; k++) {
    const c = px[k]
    if (!c) continue
    let r = 0
    let g = 0
    let b = 0
    if (c.startsWith('#')) {
      r = parseInt(c.slice(1, 3), 16)
      g = parseInt(c.slice(3, 5), 16)
      b = parseInt(c.slice(5, 7), 16)
    } else {
      const m = c.match(/\d+/g)
      if (m) [r, g, b] = m.map(Number)
    }
    const cx = (k % res) * cell
    const cy = Math.floor(k / res) * cell
    for (let dy = 0; dy < cell; dy++) {
      for (let dx = 0; dx < cell; dx++) {
        const o = ((cy + dy) * size + (cx + dx)) * 4
        buf[o] = b
        buf[o + 1] = g
        buf[o + 2] = r
        buf[o + 3] = 255
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

let tray: Tray | null = null

export function createTray(handlers: {
  onClick: (bounds: Electron.Rectangle) => void
  onOpen: () => void
  onTogglePause: () => void
  onSessions: () => void
  onQuit: () => void
}): Tray {
  tray = new Tray(flowerIcon(false))
  tray.setToolTip('Klair')
  tray.on('click', (_e, bounds) => handlers.onClick(bounds))
  tray.on('right-click', () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Klair', click: handlers.onOpen },
        { label: 'Pause or resume', click: handlers.onTogglePause },
        { label: 'All sessions', click: handlers.onSessions },
        { type: 'separator' },
        { label: 'Quit Klair', click: handlers.onQuit }
      ])
    )
  })
  return tray
}

export function setTrayPaused(paused: boolean): void {
  tray?.setImage(flowerIcon(paused))
}
