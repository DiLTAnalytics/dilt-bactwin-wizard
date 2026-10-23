/** Every action the native menu sends has a renderer handler, and vice versa (checked in the source). */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

const menuSource = readFileSync(join(SRC, 'main', 'menu.ts'), 'utf8')
const rendererSource = walk(join(SRC, 'renderer'))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

/** Actions the menu hands to the renderer. Entries that act in the main process send nothing. */
const sent = [...menuSource.matchAll(/send\('([^']+)'\)/g)].map((m) => m[1]!)
const handled = new Set([...rendererSource.matchAll(/useMenuAction\('([^']+)'/g)].map((m) => m[1]!))

describe('the native menu', () => {
  it('sends at least one action', () => {
    expect(sent.length).toBeGreaterThan(0)
  })

  it.each([...new Set(sent)])('%s is handled in the renderer', (action) => {
    expect(handled.has(action)).toBe(true)
  })

  it('registers no handler for an action the menu never sends', () => {
    expect([...handled].filter((a) => !sent.includes(a))).toEqual([])
  })
})
