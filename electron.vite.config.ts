import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // The dev server is given as an address, not "localhost". Node binds "localhost" to
    // the IPv6 loopback only, and when Electron reaches for the IPv4 one the windows get
    // ERR_CONNECTION_REFUSED and stay blank (seen 2026-10-11 on a network with no IPv6).
    server: { host: '127.0.0.1' },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
