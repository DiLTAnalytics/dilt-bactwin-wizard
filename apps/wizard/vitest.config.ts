import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const { version, repository } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; repository: { url: string } }

// test/e2e/ is Playwright, not vitest. The build constants are defined as the main build defines them.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __APP_REPOSITORY__: JSON.stringify(repository.url) },
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'], exclude: ['test/e2e/**', 'node_modules/**'] },
})
