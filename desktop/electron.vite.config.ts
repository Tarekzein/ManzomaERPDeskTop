import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import { resolveServerSettings } from './src/shared/serverSettings'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const defaults = resolveServerSettings(mode, loadEnv(mode, __dirname, ''))
  const define = { __ERP_SERVER_DEFAULTS__: JSON.stringify(defaults) }
  return {
  main: {
    define,
    build: { outDir: 'out/main' },
  },
  preload: {
    build: { outDir: 'out/preload' },
  },
  renderer: {
    define,
    root: 'src/renderer',
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src'), '@shared': resolve(__dirname, 'src/shared') } },
    plugins: [react(), tailwindcss()],
    build: { outDir: 'out/renderer', chunkSizeWarningLimit: 2500 },
  },
  }
})
