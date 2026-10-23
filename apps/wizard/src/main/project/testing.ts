/** Test helpers: a session on the repository's own plugins and data, and EDE files on disk. */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyProjectPlugins, type ReferenceSources } from './reference.js'
import { Session } from './session.js'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
export const DEMO_EDE = join(REPO, 'examples', 'ede', 'demo_devices_ede.csv')

export const repoSources = (): ReferenceSources => ({
  pluginRoots: [{ dir: join(REPO, 'plugins'), origin: 'bundled' }],
  dataDir: join(REPO, 'data'),
})

/** Messages come back as their key plus values, so tests can match on them. */
export function testSession(enabled?: string[]): Session {
  const s = new Session((key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key))
  s.pluginSources = repoSources()
  s.defaultPlugins = enabled
  applyProjectPlugins(s, undefined)
  return s
}

/** An EDE file with the given `object-name;object-type;object-instance[;description]` rows on device 1. */
export function edeFile(rows: [name: string, type: string, instance: string, description?: string][], filename = 'test.csv'): string {
  const dir = mkdtempSync(join(tmpdir(), 'bactwin-test-'))
  const path = join(dir, filename)
  writeFileSync(path, [
    '#Engineering-Data-Exchange - test',
    'PROJECT_NAME;Test',
    'VERSION_OF_REFERENCEFILE',
    'TIMESTAMP_OF_LAST_CHANGE;01.10.2026',
    'AUTHOR_OF_LAST_CHANGE;test',
    'VERSION_OF_LAYOUT;2.3',
    '#mandatory;mandatory;mandatory;mandatory;mandatory;optional',
    '# keyname;device obj.-instance;object-name;object-type;object-instance;description',
    ...rows.map(([name, type, instance, description = '']) => `K;1;${name};${type};${instance};${description}`),
  ].join('\n'))
  return path
}
