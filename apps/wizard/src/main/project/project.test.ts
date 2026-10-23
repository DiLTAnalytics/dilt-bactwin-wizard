import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applySet, projectSettings, setTableLayout, updateProjectSettings } from './editing.js'
import { importEde } from './importing.js'
import { loadProject, ProjectTooNewError, serializeProject, writeProject } from './projectFile.js'
import { capabilities, setProjectPlugins } from './reference.js'
import { validOptions } from './queries.js'
import { createBlock, deleteStep, linkBlocks, locateBlock, moveBlock, moveStep, setDisabled, unlinkBlock } from './sequence.js'
import { DEMO_EDE, edeFile, testSession } from './testing.js'

const set = (field: string, value: string, note = 'step', rules: { field: string; operator: 'equals'; value: string; case_sensitive: false; negated: false }[] = []) =>
  ({ filter: { rules }, actions: [{ field, value }], note })
const gewerkHzg = set('bactwin.gewerk', 'HZG')
const only = (name: string) => [{ field: 'ede.object_name', operator: 'equals' as const, value: name, case_sensitive: false as const, negated: false as const }]

async function demoSession() {
  const s = testSession()
  await importEde(s, [DEMO_EDE], { mode: 'new' })
  return s
}

async function abcSession() {
  const s = testSession()
  await importEde(s, [edeFile([['A', '0', '1'], ['B', '0', '1'], ['C', '0', '1']])], { mode: 'new' })
  return s
}

const gewerke = (s: ReturnType<typeof testSession>) => s.requireProject().points.map((p) => p.bactwin.gewerk)
const tempDir = () => mkdtempSync(join(tmpdir(), 'bactwin-test-'))

describe('steps', () => {
  it('refuses a step without a name', async () => {
    const s = await abcSession()
    await expect(applySet(s, set('bactwin.gewerk', 'HZG', '  '))).rejects.toThrow()
    expect(s.sequence.steps).toHaveLength(0)
  })
})

describe('importing', () => {
  it('keeps distinct points that share an object name, and skips points already present on append', async () => {
    const s = testSession()
    await importEde(s, [edeFile([['A', '0', '1'], ['A', '0', '2']])], { mode: 'new' })
    expect(s.requireProject().points).toHaveLength(2)

    const again = await importEde(s, [edeFile([['A', '0', '1'], ['A', '0', '3']], 'more.csv')], { mode: 'append' })
    expect(again.imported).toBe(1)
    expect(again.warnings).toEqual(['more.csv: parse.EXISTING_SKIPPED {"count":"1","names":"A"}'])
    expect(s.requireProject().points).toHaveLength(3)
    expect(s.requireProject().points.some((p) => p.source.duplicated_keyname)).toBe(false)
  })

  it('flags a row the file repeats, and only that', async () => {
    const s = testSession()
    const report = await importEde(s, [edeFile([['A', '0', '1'], ['A', '0', '1'], ['B', '0', '1']])], { mode: 'new' })
    expect(s.requireProject().points.map((p) => [p.ede.object_name, p.source.duplicated_keyname])).toEqual([['A', true], ['B', false]])
    expect(report.warnings).toEqual(['test.csv: parse.DUPLICATES_SKIPPED {"count":"1","names":"A"}'])
  })

  it('runs every step over imported points, new ones included, and leaves a point already present as it is', async () => {
    const s = testSession()
    await importEde(s, [edeFile([['A', '0', '1', 'old'], ['B', '0', '1', 'b']])], { mode: 'new' })
    await applySet(s, gewerkHzg)
    const report = await importEde(s, [edeFile([['A', '0', '1', 'new'], ['C', '0', '1', 'c']], 'more.csv')], { mode: 'append' })
    expect(report.imported).toBe(1)
    expect(report.warnings).toEqual(['more.csv: parse.EXISTING_SKIPPED {"count":"1","names":"A"}'])
    expect(s.requireProject().points.map((p) => [p.ede.object_name, p.ede.description, p.bactwin.gewerk]))
      .toEqual([['A', 'old', 'HZG'], ['B', 'b', 'HZG'], ['C', 'c', 'HZG']])
  })

  it('records the EDE file header with its source', async () => {
    const s = testSession()
    await importEde(s, [edeFile([['A', '0', '1']])], { mode: 'new' })
    expect(s.requireProject().header.ede_sources[0]?.meta).toMatchObject({ PROJECT_NAME: 'Test', TIMESTAMP_OF_LAST_CHANGE: '01.10.2026' })
  })

  it('reports a file that fails without losing the others', async () => {
    const s = testSession()
    const report = await importEde(s, ['/does/not/exist.csv', DEMO_EDE], { mode: 'new' })
    expect(report.failures.map((f) => f.file)).toEqual(['exist.csv'])
    expect(report.imported).toBeGreaterThan(0)
  })
})

describe('the data is the import plus every step', () => {
  it('replacing a step changes the data as if it had always been the new step', async () => {
    const s = await abcSession()
    await applySet(s, gewerkHzg)
    await applySet(s, set('bactwin.anlage', 'X', 'only A', only('A')))
    await applySet(s, { ...set('bactwin.gewerk', 'RLT'), replace: 0 })
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
    expect(s.requireProject().points[0]!.bactwin.anlage).toBe('X')
  })

  it('deleting a step undoes what it did', async () => {
    const s = await abcSession()
    await applySet(s, gewerkHzg)
    await applySet(s, set('bactwin.gewerk', 'RLT', 'B', only('B')))
    await deleteStep(s, 0)
    expect(gewerke(s)).toEqual(['', 'RLT', ''])
  })

  it('a disabled step stays in the sequence and is passed over', async () => {
    const s = await abcSession()
    await applySet(s, gewerkHzg)
    await setDisabled(s, 0, true)
    expect(gewerke(s)).toEqual(['', '', ''])
    expect(s.sequence.steps[0]?.disabled).toBe(true)
    await setDisabled(s, 0, false)
    expect(gewerke(s)).toEqual(['HZG', 'HZG', 'HZG'])
  })

  it('the last step wins, so moving steps changes the result', async () => {
    const s = await abcSession()
    await applySet(s, gewerkHzg)
    await applySet(s, set('bactwin.gewerk', 'RLT'))
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
    await moveStep(s, 1, { block: 0, position: 0 })
    expect(gewerke(s)).toEqual(['HZG', 'HZG', 'HZG'])
  })

  it('changes queued at once are applied one after another, in order', async () => {
    const s = await abcSession()
    await Promise.all([applySet(s, gewerkHzg), applySet(s, set('bactwin.gewerk', 'RLT'))])
    expect(s.sequence.steps.map((st) => st.actions[0]?.value)).toEqual(['HZG', 'RLT'])
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
  })

  it('reports what a recorded step did', async () => {
    const s = await abcSession()
    const result = await applySet(s, set('bactwin.gewerk', 'HZG', 'A', only('A')))
    expect(result).toEqual({ matched: 1, changed: 1, skipped: 0 })
  })

  it('writes a change to its block\'s file at once', async () => {
    const s = await abcSession()
    const dir = tempDir()
    await applySet(s, set('bactwin.anlage', 'X'))
    await writeProject(s, join(dir, 'p.bactwin'))
    await applySet(s, gewerkHzg)
    const file = JSON.parse(readFileSync(join(dir, 'p.sequence.json'), 'utf8')) as { steps: unknown[] }
    expect(file.steps).toHaveLength(2)
  })
})

describe('sequence files', () => {
  const gewerkFile = (dir: string, name: string, gewerk: string) => {
    const path = join(dir, name)
    writeFileSync(path, JSON.stringify({ schema_version: '1.0', steps: [{ name, filter: [], actions: [{ field: 'bactwin.gewerk', value: gewerk }] }] }))
    return path
  }
  const names = (s: ReturnType<typeof testSession>) => s.sequence.steps.map((st) => st.name)

  it('links several files after the existing steps, in the order of their names, and names those already linked', async () => {
    const s = await abcSession()
    const dir = tempDir()
    await applySet(s, set('bactwin.gewerk', 'ISP', 'own'))
    const [b, a] = [gewerkFile(dir, '10_b.json', 'RLT'), gewerkFile(dir, '2_a.json', 'HZG')]
    expect((await linkBlocks(s, [b, a])).alreadyLinked).toEqual([])
    expect(names(s)).toEqual(['own', '2_a.json', '10_b.json'])
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
    expect((await linkBlocks(s, [a])).alreadyLinked).toEqual(['2_a.json'])
    expect(s.blocks).toHaveLength(3)
  })

  it('reordering blocks changes which step wins, and unlinking takes a file\'s steps away', async () => {
    const s = await abcSession()
    const dir = tempDir()
    await linkBlocks(s, [gewerkFile(dir, 'a.json', 'HZG'), gewerkFile(dir, 'b.json', 'RLT')])
    await moveBlock(s, 1, 0)
    expect(names(s)).toEqual(['b.json', 'a.json'])
    expect(gewerke(s)).toEqual(['HZG', 'HZG', 'HZG'])
    await unlinkBlock(s, 1)
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
  })

  it('a new step goes where it is asked to, and a step can move into another block, also an empty one', async () => {
    const s = await abcSession()
    const dir = tempDir()
    const empty = join(dir, 'empty.json')
    writeFileSync(empty, JSON.stringify({ schema_version: '1.0', steps: [] }))
    await linkBlocks(s, [gewerkFile(dir, 'a.json', 'HZG'), empty])
    await applySet(s, { ...set('bactwin.gewerk', 'RLT', 'first'), insert: { block: 0, position: 0 } })
    expect(names(s)).toEqual(['first', 'a.json'])
    await moveStep(s, 0, { block: 1, position: 0 })
    expect(s.blocks.map((b) => b.steps.map((st) => st.name))).toEqual([['a.json'], ['first']])
    expect(gewerke(s)).toEqual(['RLT', 'RLT', 'RLT'])
    expect((JSON.parse(readFileSync(empty, 'utf8')) as { steps: unknown[] }).steps).toHaveLength(1)
  })

  it('takes no step into a file that is missing', async () => {
    const s = await abcSession()
    const dir = tempDir()
    await linkBlocks(s, [join(dir, 'gone.json')])
    expect(s.blocks[0]?.missing).toBe(true)
    await expect(applySet(s, { ...gewerkHzg, insert: { block: 0, position: 0 } })).rejects.toThrow('error.sequenceFileMissing')
    await applySet(s, gewerkHzg)
    expect(s.blocks).toHaveLength(2)
  })

  it('refuses to link a JSON file that is no sequence and leaves it as it was', async () => {
    const s = await abcSession()
    const dir = tempDir()
    const files = { 'package.json': '{"name":"x","version":"1.0.0","dependencies":{}}', 'other.json': '{"plugin":"x"}' }
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text)
      await expect(linkBlocks(s, [join(dir, name)])).rejects.toThrow()
      expect(readFileSync(join(dir, name), 'utf8')).toBe(text)
    }
    expect(s.blocks).toHaveLength(0)
  })

  it('creates an empty file and links it at the end, but not one already linked', async () => {
    const s = await abcSession()
    const path = join(tempDir(), 'neu.json')
    await createBlock(s, path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ steps: [] })
    expect(s.blocks.map((b) => b.path)).toEqual([path])
    await expect(createBlock(s, path)).rejects.toThrow('error.sequenceAlreadyLinked')
  })

  it('a file that was not found can be pointed at its new place, and its steps run again', async () => {
    const s = await abcSession()
    const dir = tempDir()
    await linkBlocks(s, [join(dir, 'moved.json')])
    expect(s.blocks[0]?.missing).toBe(true)
    await locateBlock(s, 0, gewerkFile(dir, 'elsewhere.json', 'HZG'))
    expect(s.blocks[0]).toMatchObject({ path: join(dir, 'elsewhere.json') })
    expect(s.blocks[0]?.missing).toBeUndefined()
    expect(gewerke(s)).toEqual(['HZG', 'HZG', 'HZG'])
    const other = gewerkFile(dir, 'other.json', 'RLT')
    await linkBlocks(s, [other])
    await expect(locateBlock(s, 0, other)).rejects.toThrow('error.sequenceAlreadyLinked')
  })

  it('every block can be unlinked; a new step then gets a fresh file beside the project, never an old one', async () => {
    const s = await abcSession()
    const dir = tempDir()
    const path = join(dir, 'p.bactwin')
    await applySet(s, set('bactwin.gewerk', 'HZG', 'old'))
    await writeProject(s, path)
    s.projectPath = path
    await unlinkBlock(s, 0)
    expect(s.blocks).toEqual([])
    await applySet(s, set('bactwin.gewerk', 'RLT', 'new'))
    expect(s.blocks[0]?.path).toBe(join(dir, 'p-2.sequence.json'))
    expect(names(s)).toEqual(['new'])
    expect((JSON.parse(readFileSync(join(dir, 'p.sequence.json'), 'utf8')) as { steps: { name: string }[] }).steps[0]?.name).toBe('old')
  })
})

describe('the project file', () => {
  it('round-trips points, settings, table layout and the sequence file, and loads clean', async () => {
    const s = await demoSession()
    await applySet(s, gewerkHzg)
    await updateProjectSettings(s, { project_name: 'P' })
    const layout = { pinned_left: ['object_name'], pinned_right: [], widths: { bt_ort: 180 } }
    setTableLayout(s, layout)
    const path = join(tempDir(), 'p.bactwin')
    await writeProject(s, path)
    expect(readdirSync(dirname(path)).filter((f) => f.endsWith('.work.json'))).toEqual([])

    const t = testSession()
    const result = await loadProject(t, readFileSync(path, 'utf8'), path)
    expect(result.total).toBe(s.requireProject().points.length)
    expect(result.referenceChanges).toEqual([])
    expect(t.requireProject().header.project_name).toBe('P')
    expect(projectSettings(t).table_layout).toEqual(layout)
    expect(t.sequence.steps).toEqual(s.sequence.steps)
    expect(t.requireProject().points.map((p) => [p.ede.object_name, p.bactwin.gewerk, p.bactwin.bactwin_description]))
      .toEqual(s.requireProject().points.map((p) => [p.ede.object_name, p.bactwin.gewerk, p.bactwin.bactwin_description]))
    expect(t.dirty).toBe(false)
    expect(t.projectPath).toBe(path)
  })

  it('stores only the imported data; the translation is the sequence\'s result', async () => {
    const s = await demoSession()
    await applySet(s, gewerkHzg)
    const point = (JSON.parse(serializeProject(s)) as { points: Record<string, Record<string, unknown>>[] }).points[0]!
    expect(Object.keys(point)).toEqual(['source', 'ede'])
  })

  it('writes one compact point per line, leaving out fields at their default', async () => {
    const s = await demoSession()
    const text = serializeProject(s)
    const lines = text.split('\n')
    expect(lines.length).toBe(s.requireProject().points.length + 6)
    expect(lines[1]).toBe('"schema_version":"1.0",')
    const point = JSON.parse(lines[4]!.replace(/,$/, '')) as Record<string, Record<string, unknown>>
    expect(Object.values(point).flatMap((area) => Object.values(area))).not.toContainEqual(null)
    expect(point['source']).toEqual({ filename: 'demo_devices_ede.csv' })
  })

  it('keeps settable, commandable and supports COV as the text the file had', async () => {
    const s = await demoSession()
    Object.assign(s.requireProject().points[0]!.ede, { settable: 'N', commandable: 'ja', supports_cov: '' })
    const t = testSession()
    await loadProject(t, serializeProject(s), null)
    expect(t.requireProject().points[0]!.ede).toMatchObject({ settable: 'N', commandable: 'ja', supports_cov: '' })
  })

  it('saves through temporary files, writing a sequence file not saved yet beside the project, and leaves none behind', async () => {
    const s = await demoSession()
    await applySet(s, gewerkHzg)
    const dir = tempDir()
    const path = join(dir, 'p.bactwin')
    await writeProject(s, path)
    expect(existsSync(`${path}.saving`)).toBe(false)
    expect(existsSync(join(dir, 'p.sequence.json'))).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(serializeProject(s, path))
    await expect(writeProject(s, join(path, 'not-a-folder', 'x.bactwin'))).rejects.toThrow()
  })

  it('keeps points that share an identity, and reports them', async () => {
    const s = await demoSession()
    const file = JSON.parse(serializeProject(s)) as { points: unknown[] }
    file.points.push(file.points[0])
    const t = testSession()
    const result = await loadProject(t, JSON.stringify(file), null)
    expect(t.requireProject().points).toHaveLength(s.requireProject().points.length + 1)
    expect(result.duplicates).toMatch(/^dialog\.duplicatesDetail \{"count":"1"/)
    expect((await loadProject(testSession(), serializeProject(s), null)).duplicates).toBeNull()
  })

  it('refuses an unknown field in a file of the current version, naming it', async () => {
    const file = JSON.parse(serializeProject(await demoSession())) as { points: { source: Record<string, unknown> }[] }
    file.points[3]!.source['commnet'] = 'typo'
    await expect(loadProject(testSession(), JSON.stringify(file), null)).rejects.toThrow(/points\.3\.source.*commnet/)
  })

  it('knows no format before 1.0: a file without schema_version is invalid', async () => {
    const { schema_version: _, ...file } = JSON.parse(serializeProject(await demoSession())) as Record<string, unknown>
    await expect(loadProject(testSession(), JSON.stringify(file), null)).rejects.toThrow('error.projectInvalid')
  })

  it('refuses a newer version, minor included, and leaves the open project alone', async () => {
    const s = await demoSession()
    const before = s.project
    const file = JSON.parse(serializeProject(s)) as Record<string, unknown>
    file['schema_version'] = '1.1'
    await expect(loadProject(s, JSON.stringify(file), null)).rejects.toMatchObject({ version: '1.1' })
    await expect(loadProject(s, JSON.stringify({ schema_version: '2.0', header: {} }), null)).rejects.toBeInstanceOf(ProjectTooNewError)
    expect(s.project).toBe(before)
  })

  it('reports a plugin the project names that is not installed here', async () => {
    const file = JSON.parse(serializeProject(await demoSession())) as { header: { reference: { plugins: { id: string; version: string }[] } } }
    file.header.reference.plugins.push({ id: 'elsewhere', version: '1.0.0' })
    const { referenceChanges } = await loadProject(testSession(), JSON.stringify(file), null)
    expect(referenceChanges).toEqual(['reference.pluginMissing {"id":"elsewhere","version":"1.0.0"}'])
  })

  it('reports a linked sequence file that is gone, and still opens', async () => {
    const s = await abcSession()
    const dir = tempDir()
    const shared = join(dir, 'shared.json')
    writeFileSync(shared, JSON.stringify({ schema_version: '1.0', steps: [] }))
    await linkBlocks(s, [shared])
    const path = join(dir, 'p.bactwin')
    await writeProject(s, path)
    const text = readFileSync(path, 'utf8').replace('"shared.json"', '"gone.json"')
    const result = await loadProject(testSession(), text, path)
    expect(result.missingSequences).toEqual([join(dir, 'gone.json')])
  })
})

describe('the dirty flag', () => {
  it('is set by every change and cleared by loading', async () => {
    const s = await demoSession()
    expect(s.dirty).toBe(true)

    const changes: [string, () => Promise<unknown>][] = [
      ['set', () => applySet(s, gewerkHzg)],
      ['settings', async () => updateProjectSettings(s, { project_name: 'x' })],
      ['disable step', () => setDisabled(s, 0, true)],
      ['delete step', () => deleteStep(s, 0)],
    ]
    for (const [name, change] of changes) {
      s.dirty = false
      await change()
      expect(s.dirty, name).toBe(true)
    }

    await loadProject(s, serializeProject(s), null)
    expect(s.dirty).toBe(false)
  })
})

describe('valid options', () => {
  it('take the bare field name, as the key library and catalogue use it', async () => {
    const s = await demoSession()
    expect(validOptions(s, { field: 'gewerk', mode: 'free' }).valid_for_all).toContain('HZG')
    expect(validOptions(s, { field: 'gewerk', mode: 'gewerk_specific' }).valid_for_all.length).toBeGreaterThan(0)
  })
})

describe('plugins per project', () => {
  const stored = (s: ReturnType<typeof testSession>) =>
    (JSON.parse(serializeProject(s)) as { header: { reference: { plugins: { id: string }[] } } }).header.reference.plugins.map((p) => p.id)

  it('starts a new project with the default plugins', async () => {
    const s = testSession(['amev-2026'])
    await importEde(s, [DEMO_EDE], { mode: 'new' })
    expect(s.enabledPlugins).toEqual(['amev-2026'])
    expect(stored(s)).toEqual(['amev-2026'])
  })

  it('opens a project with its own plugins, whatever the defaults are', async () => {
    const amevOnly = testSession(['amev-2026'])
    await importEde(amevOnly, [DEMO_EDE], { mode: 'new' })
    const both = await demoSession()

    const s = testSession(['dilt-2026'])
    await loadProject(s, serializeProject(amevOnly), null)
    expect(s.enabledPlugins).toEqual(['amev-2026'])
    expect(capabilities(s).combinations).toBe(false)
    await loadProject(s, serializeProject(both), null)
    expect(s.enabledPlugins).toEqual(['amev-2026', 'dilt-2026'])
    expect(capabilities(s).combinations).toBe(true)
  })

  it('takes the defaults for a project that names no plugins', async () => {
    const file = JSON.parse(serializeProject(await demoSession())) as { header: Record<string, unknown> }
    delete file.header['reference']
    const s = testSession(['amev-2026'])
    await loadProject(s, JSON.stringify(file), null)
    expect(s.enabledPlugins).toEqual(['amev-2026'])
  })

  it('keeps a plugin that is not installed when saving, until it is switched off', async () => {
    const file = JSON.parse(serializeProject(await demoSession())) as { header: { reference: { plugins: { id: string; version: string }[] } } }
    file.header.reference.plugins.push({ id: 'elsewhere', version: '1.0.0' })
    const s = testSession()
    await loadProject(s, JSON.stringify(file), null)
    expect(stored(s)).toEqual(['amev-2026', 'dilt-2026', 'elsewhere'])

    await setProjectPlugins(s, ['amev-2026', 'dilt-2026'])
    expect(stored(s)).toEqual(['amev-2026', 'dilt-2026'])
  })

  it('switches the open project to other plugins, recalculates and marks it changed', async () => {
    const s = await demoSession()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'g' })
    s.dirty = false
    await setProjectPlugins(s, ['amev-2026'])
    expect(s.enabledPlugins).toEqual(['amev-2026'])
    expect(capabilities(s).combinations).toBe(false)
    expect(s.dirty).toBe(true)
    expect(s.requireProject().points.every((p) => p.bactwin.gewerk === 'HZG')).toBe(true)
  })
})
