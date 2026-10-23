import { defineConfig } from 'vite'

// CommonJS as .cjs: a sandboxed preload cannot be ESM, and in this "type": "module" package a .js
// would load as ESM and fail silently (window.bactwin undefined).
export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['electron'],
      input: 'src/preload/index.ts',
      output: { format: 'cjs', entryFileNames: 'preload.cjs', codeSplitting: false },
    },
  },
})
