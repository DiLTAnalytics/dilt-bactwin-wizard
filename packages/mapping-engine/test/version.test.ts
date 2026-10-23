import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ENGINE_VERSION } from '../src/index.js'

it('ENGINE_VERSION matches package.json, which plugins check their engineRange against', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  expect(ENGINE_VERSION).toBe(pkg.version)
})
