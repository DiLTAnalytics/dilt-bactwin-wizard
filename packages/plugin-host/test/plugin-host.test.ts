import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  loadPlugin, mergePlugins, parseBacnetTables, parseCombinationCsv, PLUGIN_FILES, satisfies, type LoadedPlugin, type PluginFiles,
} from '../src/index.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  sourceId: 'DEMO',
  engineRange: '^1.0.0',
  license: 'Apache-2.0',
  provides: ['keys'],
}

function files(overrides: Omit<Partial<PluginFiles>, 'manifest'> & { manifest?: unknown } = {}): PluginFiles {
  const { manifest, ...rest } = overrides
  return {
    manifest: JSON.stringify(manifest ?? MANIFEST),
    keys: JSON.stringify([{ block: 'gewerk', key: 'HZG', description: 'Heizung' }]),
    ...rest,
  }
}

/** Read a real plugin directory off disk, the way the application will. */
function readPluginDir(dir: string): PluginFiles {
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined)
  const files: PluginFiles = { manifest: readFileSync(join(dir, PLUGIN_FILES.manifest), 'utf8') }
  for (const kind of ['keys', 'combinations', 'nameTemplate'] as const) {
    const content = read(PLUGIN_FILES[kind])
    if (content !== undefined) files[kind] = content
  }
  return files
}

describe('loading a plugin', () => {
  it('loads a well-formed plugin', () => {
    const { plugin, issues } = loadPlugin(files())
    expect(issues).toEqual([])
    expect(plugin?.manifest.id).toBe('demo')
    expect(plugin?.library).toHaveLength(1)
  })

  it('tags every entry with the manifest source, whatever the entry claims', () => {
    // Or an entry could slip past the active-source toggle.
    const { plugin, issues } = loadPlugin(
      files({ keys: JSON.stringify([{ block: 'gewerk', key: 'HZG', source: 'SOMETHING-ELSE' }]) }),
    )
    expect(plugin?.library[0]?.source).toBe('DEMO')
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('SOMETHING-ELSE'))).toBe(true)
  })

  it('reports a malformed manifest instead of throwing', () => {
    const { plugin, issues } = loadPlugin({ manifest: '{ not json' })
    expect(plugin).toBeNull()
    expect(issues[0]?.severity).toBe('error')
  })

  it('rejects an id that is not directory-safe', () => {
    const { plugin, issues } = loadPlugin(files({ manifest: { ...MANIFEST, id: '../escape' } }))
    expect(plugin).toBeNull()
    expect(issues.some((i) => i.message.includes('id must be'))).toBe(true)
  })

  it('rejects a manifest that promises what it does not ship', () => {

    const { plugin, issues } = loadPlugin(files({ manifest: { ...MANIFEST, provides: ['keys', 'combinations'] } }))
    expect(plugin).toBeNull()
    expect(issues.some((i) => i.message.includes('promises "combinations"'))).toBe(true)
  })

  it('refuses a plugin built for another engine version', () => {
    const { plugin, issues } = loadPlugin(files({ manifest: { ...MANIFEST, engineRange: '^2.0.0' } }))
    expect(plugin).toBeNull()
    expect(issues[0]?.message).toContain('^2.0.0')
  })

  it('refuses a name template with a segment the application does not know', () => {
    const template = { version: 't', separator: '_', segments: [{ id: 'gewerk', type: 'key' }, { id: 'gewrek', type: 'key' }] }
    const { plugin, issues } = loadPlugin(files({
      manifest: { ...MANIFEST, provides: ['keys', 'name-template'] },
      nameTemplate: JSON.stringify(template),
    }))
    expect(plugin).toBeNull()
    expect(issues.map((i) => i.message).join()).toContain('unknown segment "gewrek"')
  })

  it('refuses a key in a block the name has no place for', () => {
    const { plugin, issues } = loadPlugin(files({ keys: JSON.stringify([{ block: 'gewrek', key: 'HZG' }]) }))
    expect(plugin).toBeNull()
    expect(issues[0]?.message).toContain('keys.json[0]: unknown block "gewrek"')
  })

  it('reports a bad library entry with its path and index', () => {
    const { plugin, issues } = loadPlugin(files({ keys: JSON.stringify([{ key: 'HZG' }]) }))
    expect(plugin).toBeNull()
    expect(issues[0]?.message).toContain('keys.json[0]')
  })
})

describe('typos a plugin author can make', () => {
  const warnings = (f: PluginFiles) => loadPlugin(f).issues.map((i) => `${i.severity}: ${i.message}`)

  it('warns about unknown fields in the manifest, the keys and the template, and still loads', () => {
    const tpl = { version: 't', separator: '_', segment: 1, segments: [{ id: 'ort', type: 'free', requird: true }] }
    const f = files({
      manifest: { ...MANIFEST, provides: ['keys', 'name-template'], require: ['amev-2026'] },
      keys: JSON.stringify([{ block: 'gewerk', key: 'HZG', default_gewek: ['HZG'] }, { block: 'gewerk', key: 'RLT', default_gewek: [] }]),
      nameTemplate: JSON.stringify(tpl),
    })
    expect(loadPlugin(f).plugin).not.toBeNull()
    expect(warnings(f)).toEqual([
      'warning: bactwin-plugin.json: unknown fields "require" (1) ignored',
      'warning: keys.json: unknown fields "default_gewek" (2) ignored',
      'warning: name-template.json: unknown fields "segment" (1), "requird" (1) ignored',
    ])
  })

  it('warns about a key defined twice in one plugin, and a combination column it does not know', () => {
    const f = files({
      manifest: { ...MANIFEST, provides: ['keys', 'combinations'] },
      keys: JSON.stringify([{ block: 'gewerk', key: 'HZG', name: 'a' }, { block: 'gewerk', key: 'HZG', name: 'b' }]),
      combinations: 'gewerk,aggreat,unit_code\nHZG,X,62\n',
    })
    expect(loadPlugin(f).plugin?.library.map((e) => e.name)).toEqual(['a', 'b'])
    expect(warnings(f)).toEqual([
      'warning: keys.json[1]: gewerk:HZG is defined again (first at [0]); the later one is used',
      'warning: combinations.csv: unknown columns "aggreat" ignored',
    ])
  })
})

describe('combination CSV', () => {
  it('keeps an empty cell as a wildcard rather than dropping the column', () => {
    // An empty cell is a wildcard, so the key must stay.
    const rows = parseCombinationCsv('gewerk,anlage,funktion\nHZG,,MW~\n')
    expect(rows[0]).toEqual({ gewerk: 'HZG', anlage: '', funktion: 'MW~' })
  })

  it('handles quoted cells, also with a line break inside', () => {
    const rows = parseCombinationCsv('gewerk,b\n"x,y",z\n"two\nlines",w\n')
    expect(rows).toEqual([{ gewerk: 'x,y', b: 'z' }, { gewerk: 'two\nlines', b: 'w' }])
  })

  it('reads a file German Excel saved with semicolons', () => {
    expect(parseCombinationCsv('\uFEFFgewerk;anlage;unit_code\r\nHZG;;62\r\n')).toEqual([{ gewerk: 'HZG', anlage: '', unit_code: '62' }])
  })

  it('refuses a file whose header has no name block, and a row of another length, in the plugin issues', () => {
    expect(() => parseCombinationCsv('a|b\n1|2\n')).toThrow('none of the columns')
    const { plugin, issues } = loadPlugin(files({ manifest: { ...MANIFEST, provides: ['keys', 'combinations'] }, combinations: 'gewerk,anlage\nHZG\n' }))
    expect(plugin).toBeNull()
    expect(issues[0]?.message).toMatch(/^combinations\.csv: .*line 2/)
  })
})

describe('merging plugins', () => {
  const base = { bacnetTypes: {}, bacnetUnits: {}, fallbackNameTemplate: { version: 'f', separator: '_', segments: [{ id: 'ort', type: 'free' as const }] } }

  function plugin(id: string, key: string, description: string): LoadedPlugin {
    const { plugin: p } = loadPlugin(
      files({
        manifest: { ...MANIFEST, id, sourceId: id.toUpperCase() },
        keys: JSON.stringify([{ block: 'gewerk', key, description }]),
      }),
    )
    return p as LoadedPlugin
  }

  it('reports a collision instead of resolving it silently', () => {

    const result = mergePlugins([plugin('a', 'HZG', 'from a'), plugin('b', 'HZG', 'from b')], base)
    expect(result.issues.some((i) => i.message.includes('redefines gewerk:HZG'))).toBe(true)
    expect(result.referenceData.library).toHaveLength(1)
    expect(result.referenceData.library[0]?.description).toBe('from b')
  })

  it('honours the enabled list', () => {
    const result = mergePlugins([plugin('a', 'HZG', 'a'), plugin('b', 'RLT', 'b')], { ...base, enabled: ['a'] })
    expect(result.contributors).toEqual(['a'])
    expect(result.referenceData.activeSources).toEqual(['A'])
    expect(result.referenceData.library).toHaveLength(1)
  })

  it('leaves out a plugin whose requirement is not enabled, and what builds on it', () => {
    const needing = (p: LoadedPlugin, requires: string[]): LoadedPlugin => ({ ...p, manifest: { ...p.manifest, requires } })
    const result = mergePlugins([plugin('a', 'HZG', 'a'), needing(plugin('b', 'RLT', 'b'), ['a']), needing(plugin('c', 'LUE', 'c'), ['b'])], { ...base, enabled: ['b', 'c'] })
    expect(result.contributors).toEqual([])
    expect(result.issues.map((i) => `${i.pluginId}: ${i.message}`)).toEqual(['b: needs a, which is not enabled', 'c: needs b, which is not enabled'])
    expect(mergePlugins([plugin('a', 'HZG', 'a'), needing(plugin('b', 'RLT', 'b'), ['a'])], base).contributors).toEqual(['a', 'b'])
  })

  it('falls back to the supplied template when no plugin provides one', () => {
    const result = mergePlugins([plugin('a', 'HZG', 'a')], base)
    expect(result.referenceData.nameTemplate.version).toBe('f')
  })
})

describe('the plugin template', () => {
  it('carries exactly the corpus demo bundle, so the two cannot drift apart', () => {
    const demo = JSON.parse(readFileSync(join(REPO, 'packages/mapping-engine/test/reference/demo.json'), 'utf8')) as { library: unknown[]; combinations: unknown[] }
    const { plugin } = loadPlugin(readPluginDir(join(REPO, 'examples/plugin-template')))
    expect(plugin?.library).toEqual(demo.library)
    expect(plugin?.combinations).toEqual(demo.combinations)
  })
})

describe('the plugins shipped in this repository', () => {
  for (const dir of ['plugins/amev-2026', 'plugins/dilt-2026', 'examples/plugin-template']) {
    it(`${dir} loads without errors or warnings`, () => {
      const { plugin, issues } = loadPlugin(readPluginDir(join(REPO, dir)))
      // Warnings too: a typo in a shipped plugin fails here, before a release.
      expect(issues).toEqual([])
      expect(plugin).not.toBeNull()
    })
  }

  it('the AMEV and DiLT plugins do not collide', () => {
    const amev = loadPlugin(readPluginDir(join(REPO, 'plugins/amev-2026'))).plugin as LoadedPlugin
    const dilt = loadPlugin(readPluginDir(join(REPO, 'plugins/dilt-2026'))).plugin as LoadedPlugin
    const result = mergePlugins([amev, dilt], {
      bacnetTypes: {}, bacnetUnits: {},
      fallbackNameTemplate: amev.nameTemplate as NonNullable<LoadedPlugin['nameTemplate']>,
    })
    expect(result.issues.filter((i) => i.message.includes('redefines'))).toEqual([])
    expect(result.referenceData.activeSources).toEqual(['AMEV', 'dilt'])
  })
})

describe('satisfies', () => {
  it.each([
    ['0.1.0', '^0.1.0', true], ['0.1.5', '^0.1.0', true], ['0.2.0', '^0.1.0', false],
    ['1.4.0', '^1.2.0', true], ['2.0.0', '^1.2.0', false], ['1.2.9', '~1.2.0', true], ['1.3.0', '~1.2.0', false],
    ['0.1.0', '0.1.0', true], ['0.1.1', '0.1.0', false], ['3.0.0', '>=1.0.0', true], ['0.1.0', '*', null],
  ] as const)('%s in %s -> %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })
})

describe('BACnet tables', () => {
  it('fall back to the BACnet unit name when a unit has no symbol', () => {
    const { units } = parseBacnetTables('', 'ede_unit-code,bacnet_unit,unit\n0,Square-meters,m²\n1,Square-feet,\n')
    expect(units['0']?.unit).toBe('m²')
    expect(units['1']?.unit).toBe('Square-feet')
  })

  it('give every shipped unit code a readable unit', () => {
    const csv = readFileSync(join(REPO, 'data', 'bacnet_keys', 'bacnet_unitcodes.csv'), 'utf8')
    const empty = Object.entries(parseBacnetTables('', csv).units).filter(([, u]) => !u.unit)
    expect(empty).toEqual([])
  })
})

