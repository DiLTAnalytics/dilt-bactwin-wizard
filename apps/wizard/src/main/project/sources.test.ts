import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applySet } from './editing.js'
import { importEde, removeSource, replaceSource, updateFromSource } from './importing.js'
import { loadProject, writeProject } from './projectFile.js'
import { locateSource, sourceStatuses } from './sources.js'
import { DEMO_EDE, testSession } from './testing.js'

/** A project folder with the demo EDE file under EDE/, imported and saved as projekt.bactwin. */
async function savedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'bactwin-sources-'))
  mkdirSync(join(dir, 'EDE'))
  const ede = join(dir, 'EDE', 'demo.csv')
  copyFileSync(DEMO_EDE, ede)
  const s = testSession()
  await importEde(s, [ede], { mode: 'new' })
  const project = join(dir, 'projekt.bactwin')
  await writeProject(s, project)
  return { dir, ede, project, s }
}

describe('source files', () => {
  it('records where an imported file was and its checksum', async () => {
    const { ede, s } = await savedProject()
    expect(s.requireProject().header.ede_sources[0]).toMatchObject({ path: ede, size: readFileSync(ede).length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('stores the path relative to the project file, and finds the file again when the folder moves', async () => {
    const { dir, project } = await savedProject()
    const saved = JSON.parse(readFileSync(project, 'utf8')) as { header: { ede_sources: { path: string }[] } }
    expect(saved.header.ede_sources[0]?.path).toBe('EDE/demo.csv')

    const moved = mkdtempSync(join(tmpdir(), 'bactwin-moved-'))
    mkdirSync(join(moved, 'EDE'))
    copyFileSync(join(dir, 'EDE', 'demo.csv'), join(moved, 'EDE', 'demo.csv'))
    copyFileSync(project, join(moved, 'projekt.bactwin'))
    const t = testSession()
    await loadProject(t, readFileSync(join(moved, 'projekt.bactwin'), 'utf8'), join(moved, 'projekt.bactwin'))
    expect(await sourceStatuses(t)).toMatchObject([{ path: join(moved, 'EDE', 'demo.csv'), state: 'current' }])
  })

  it('tells a changed, a missing and an unrecorded source apart, and the project opens regardless', async () => {
    const { ede, project, s } = await savedProject()
    appendFileSync(ede, 'OBJECT_ANALOG_INPUT:99;111012;NEW;0;99;new;;;;;;;;;;\n')
    expect((await sourceStatuses(s))[0]?.state).toBe('changed')

    rmSync(ede)
    const t = testSession()
    expect((await loadProject(t, readFileSync(project, 'utf8'), project)).total).toBe(s.requireProject().points.length)
    expect((await sourceStatuses(t))[0]?.state).toBe('missing')

    delete t.requireProject().header.ede_sources[0]!.path
    expect((await sourceStatuses(t))[0]?.state).toBe('unknown')
  })

  it('keeps a path outside the project folder, relative with ..', async () => {
    const { s } = await savedProject()
    const elsewhere = mkdtempSync(join(tmpdir(), 'bactwin-elsewhere-'))
    await writeProject(s, join(elsewhere, 'p.bactwin'))
    const saved = JSON.parse(readFileSync(join(elsewhere, 'p.bactwin'), 'utf8')) as { header: { ede_sources: { path: string }[] } }
    expect(saved.header.ede_sources[0]?.path).toMatch(/^\.\.\//)
    expect(saved.header.ede_sources[0]?.path.endsWith('EDE/demo.csv')).toBe(true)
  })

  it('records a located file, taking its checksum when none was recorded', async () => {
    const { dir, s } = await savedProject()
    const source = s.requireProject().header.ede_sources[0]!
    delete source.sha256
    s.dirty = false
    const located = join(dir, 'other.csv')
    writeFileSync(located, readFileSync(DEMO_EDE))
    expect(await locateSource(s, 0, located)).toMatchObject([{ path: located, state: 'current' }])
    expect(s.dirty).toBe(true)
  })

  it('updates from a changed source: new values, new points, and missing points flagged, translations kept', async () => {
    const { ede, s } = await savedProject()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'step' })
    const before = s.requireProject().points.length
    const text = readFileSync(ede, 'utf8')
      .replace('KA-HH4: RL-Temperatur', 'KA-HH4: RL-Temperatur neu')
      .split('\n').filter((line) => !line.includes('VLPU1__SBEIN')).join('\n')
    writeFileSync(ede, `${text.trimEnd()}\nOBJECT_ANALOG_INPUT:99;111012;XXDILT__NEU;0;99;neu;;;;;;;;;62\n`)

    const report = await updateFromSource(s, 0)
    expect(report).toMatchObject({ updated: 1, added: 1, missing: 1 })
    const points = s.requireProject().points
    expect(points).toHaveLength(before + 1)
    expect(points.find((p) => p.ede.description === 'KA-HH4: RL-Temperatur neu')?.bactwin.gewerk).toBe('HZG')
    expect(points.find((p) => p.ede.object_name === 'XXDILT__NEU')?.source).toMatchObject({ type: 'ede', filename: 'demo.csv' })
    const gone = points.find((p) => p.ede.object_name.includes('VLPU1__SBEIN'))!
    expect(gone.source.missing_from_source).toBe(true)
    expect(gone.state.messages).toContainEqual({ level: 'warning', code: 'MISSING_FROM_SOURCE', params: { file: 'demo.csv' } })
    expect((await sourceStatuses(s))[0]?.state).toBe('current')
    expect(s.dirty).toBe(true)

    writeFileSync(ede, readFileSync(DEMO_EDE))
    expect(await updateFromSource(s, 0)).toMatchObject({ missing: 1 })
    expect(gone.source.missing_from_source).toBe(false)
  })

  it('counts a point as changed only when its content changed, whatever order its fields are stored in', async () => {
    const { s } = await savedProject()
    for (const point of s.requireProject().points) {
      point.ede = Object.fromEntries(Object.entries(point.ede).reverse()) as typeof point.ede
      point.source.invalid = Object.fromEntries(Object.entries(point.source.invalid).reverse())
    }
    expect(await updateFromSource(s, 0)).toMatchObject({ updated: 0, added: 0, missing: 0 })
  })

  it('refuses a second file of the same name from another folder', async () => {
    const { ede, s } = await savedProject()
    const twin = join(mkdtempSync(join(tmpdir(), 'bactwin-twin-')), 'demo.csv')
    copyFileSync(ede, twin)
    const report = await importEde(s, [twin], { mode: 'append' })
    expect(report.failures).toEqual([{ file: 'demo.csv', error: 'error.sourceSameName {"file":"demo.csv"}' }])
    expect(s.requireProject().header.ede_sources).toHaveLength(1)
  })

  it('leaves a point another file brought alone when a file read again has it too', async () => {
    const { ede, s } = await savedProject()
    const other = join(dirname(ede), 'other.csv')
    const rows = readFileSync(DEMO_EDE, 'utf8').split('\n')
    writeFileSync(other, [...rows.slice(0, 8), 'OBJECT_ANALOG_INPUT:99;111012;XXDILT__NEU;0;99;neu;;;;;;;;;62'].join('\n'))
    await importEde(s, [other], { mode: 'append' })
    appendFileSync(ede, 'OBJECT_ANALOG_INPUT:99;111012;XXDILT__NEU;0;99;anders;;;;;;;;;62\n')

    const report = await updateFromSource(s, 0)
    expect(report).toMatchObject({ added: 0, updated: 0 })
    expect(report.warnings).toEqual(['parse.EXISTING_SKIPPED {"count":"1","names":"XXDILT__NEU"}'])
    expect(s.requireProject().points.find((p) => p.ede.object_name === 'XXDILT__NEU')).toMatchObject({ source: { filename: 'other.csv' }, ede: { description: 'neu' } })
  })

  it('tells a file it may not read from a missing one', async () => {
    const { ede, s } = await savedProject()
    chmodSync(ede, 0o000)
    try {
      expect((await sourceStatuses(s))[0]?.state).toBe('unreadable')
      await expect(updateFromSource(s, 0)).rejects.toThrow('error.sourceUnreadable')
    } finally {
      chmodSync(ede, 0o644)
    }
  })

  it('refuses to update a source whose file is not located or not there', async () => {
    const { ede, s } = await savedProject()
    rmSync(ede)
    await expect(updateFromSource(s, 0)).rejects.toThrow('error.sourceMissing')
    delete s.requireProject().header.ede_sources[0]!.path
    await expect(updateFromSource(s, 0)).rejects.toThrow('error.sourceNotLocated')
  })

  it('reads a file the project already lists again instead of adding it twice', async () => {
    const { ede, s } = await savedProject()
    const before = s.requireProject().points.length
    writeFileSync(ede, `${readFileSync(ede, 'utf8').trimEnd()}\nOBJECT_ANALOG_INPUT:99;111012;XXDILT__NEU;0;99;neu;;;;;;;;;62\n`)
    const report = await importEde(s, [ede], { mode: 'append' })
    expect(report).toMatchObject({ imported: 0, failures: [], reread: [{ file: 'demo.csv', updated: 0, added: 1, missing: 0 }] })
    expect(s.requireProject().header.ede_sources).toHaveLength(1)
    expect(s.requireProject().points).toHaveLength(before + 1)
    expect((await sourceStatuses(s))[0]).toMatchObject({ state: 'current', points: before + 1 })
  })

  it('reads a new version of a file under another name in its place, moving its points', async () => {
    const { dir, s } = await savedProject()
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'step' })
    const count = s.requireProject().points.length
    const text = readFileSync(DEMO_EDE, 'utf8')
      .replace('KA-HH4: RL-Temperatur', 'KA-HH4: RL-Temperatur neu')
      .split('\n').filter((line) => !line.includes('VLPU1__SBEIN')).join('\n')
    const next = join(dir, 'EDE', 'demo-v2.csv')
    writeFileSync(next, `${text.trimEnd()}\nOBJECT_ANALOG_INPUT:99;111012;XXDILT__NEU;0;99;neu;;;;;;;;;62\n`)

    expect(await replaceSource(s, 0, next)).toMatchObject({ updated: 1, added: 1, missing: 1 })
    expect(s.requireProject().header.ede_sources).toMatchObject([{ filename: 'demo-v2.csv', path: next }])
    const points = s.requireProject().points
    expect(points).toHaveLength(count + 1)
    expect(points.every((p) => p.source.filename === 'demo-v2.csv')).toBe(true)
    expect(points.every((p) => p.bactwin.gewerk === 'HZG')).toBe(true)
    expect((await sourceStatuses(s))[0]).toMatchObject({ state: 'current', points: count + 1 })
  })

  it('removes a file with its points, and the steps run again over what is left', async () => {
    const { ede, s } = await savedProject()
    const other = join(dirname(ede), 'other.csv')
    writeFileSync(other, readFileSync(DEMO_EDE, 'utf8').replaceAll(';111012;', ';222222;'))
    await importEde(s, [other], { mode: 'append' })
    await applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'step' })
    const total = s.requireProject().points.length
    const own = (await sourceStatuses(s))[0]!.points
    s.dirty = false

    expect(await removeSource(s, 0)).toBe(own)
    const points = s.requireProject().points
    expect(points).toHaveLength(total - own)
    expect(points.every((p) => p.source.filename === 'other.csv' && p.bactwin.gewerk === 'HZG')).toBe(true)
    expect((await sourceStatuses(s)).map((x) => x.filename)).toEqual(['other.csv'])
    expect(s.dirty).toBe(true)
  })

  it('refuses a new version that is already another file of the project', async () => {
    const { ede, s } = await savedProject()
    const other = join(dirname(ede), 'other.csv')
    writeFileSync(other, readFileSync(DEMO_EDE, 'utf8').replace('KA-HH4', 'KA-XX9'))
    await importEde(s, [other], { mode: 'append' })
    await expect(replaceSource(s, 0, other)).rejects.toThrow('error.sourceAlreadyListed')
  })
})
