import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { resolveServerSettings } from './src/shared/serverSettings'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The renderer on its own, in a normal browser (talks to a backend URL
 * instead of the desktop bridge). Used for end-to-end tests and quick UI work.
 */
export default defineConfig(({ mode }) => ({
  define: { __ERP_SERVER_DEFAULTS__: JSON.stringify(resolveServerSettings(mode, loadEnv(mode, __dirname, ''))) },
  root: 'src/renderer',
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src'), '@shared': resolve(__dirname, 'src/shared') } },
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
}))
