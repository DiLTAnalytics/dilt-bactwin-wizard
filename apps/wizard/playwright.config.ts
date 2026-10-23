import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  // One Electron app at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
})
