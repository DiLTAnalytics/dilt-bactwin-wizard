import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

import { thirdPartyNotices } from './vite.notices.js'

const { version, repository } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string; repository: { url: string } }

// Workspace packages are bundled in: the packaged app has no node_modules.
export default defineConfig({
  plugins: [thirdPartyNotices('main')],
  // Baked in: app.getVersion() reports Electron's own version when main runs unpackaged (e2e).
  define: { __APP_VERSION__: JSON.stringify(version), __APP_REPOSITORY__: JSON.stringify(repository.url) },
  build: {
    rolldownOptions: { external: ['electron', /^node:/] },
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'main.cjs' },
  },
})
