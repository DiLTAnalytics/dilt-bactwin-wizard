import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

import { thirdPartyNotices } from './vite.notices.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), thirdPartyNotices('renderer')],
  // Relative asset paths, as the bundle is served from the app:// scheme.
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) },
    // Forge turns this on; Vite's default resolves workspace packages to their real path, so it serves them as source and hot-reloads their edits.
    preserveSymlinks: false,
  },
  build: { target: 'chrome152', sourcemap: true },
})
