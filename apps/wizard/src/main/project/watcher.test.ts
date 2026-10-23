import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SequenceFileEvent, SourceChangedEvent } from '../../shared/channels.js'
import { applySet } from './editing.js'
import { importEde } from './importing.js'
import { writeProject } from './projectFile.js'
import { linkBlocks, restoreBlock, saveBlockAs, setDisabled, unlinkBlock } from './sequence.js'
import { edeFile, testSession } from './testing.js'
import { FileWatcher, gitStatus } from './watcher.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'bactwin-watch-'))
const steps = (...gewerke: string[]) =>
  JSON.stringify({ schema_version: '1.0', steps: gewerke.map((g) => ({ name: g, filter: [], actions: [{ field: 'bactwin.gewerk', value: g }] })) })

let watcher: FileWatcher | null = null
afterEach(() => watcher?.close())

/** A project of three points with one linked file, watched; events are collected. */
async function watched(content = steps('HZG')) {
  const s = testSession()
  const ede = edeFile([['A', '0', '1'], ['B', '0', '1'], ['C', '0', '1']])
  await importEde(s, [ede], { mode: 'new' })
  const dir = tempDir()
  const path = join(dir, 'shared.json')
  writeFileSync(path, content)
  await linkBlocks(s, [path])
  const events: SequenceFileEvent[] = []
  const sources: SourceChangedEvent[] = []
  const status = vi.fn()
  // Resolves when `answer` is called, as the user closing the dialog.
  let answer = () => {}
  const project = vi.fn(() => new Promise<void>((resolve) => { answer = resolve }))
  watcher = new FileWatcher(s, { sequenceFile: (e) => events.push(e), status, project, source: (e) => sources.push(e) }, 50)
  watcher.sync()
  // FSEvents may report what happened just before the watch started.
  await new Promise((r) => setTimeout(r, 200))
  events.length = 0
  return { s, dir, path, ede, events, sources, status, project, answer: () => answer(), gewerke: () => s.requireProject().points.map((p) => p.bactwin.gewerk) }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watching sequence files', () => {
  it('ignores the app\'s own writes', async () => {
    const { s, events } = await watched()
    await setDisabled(s, 0, true)
    await wait(500)
    expect(events).toEqual([])
  })

  it('reloads a file changed outside and recalculates, without marking the project changed', async () => {
    const { s, path, events, gewerke } = await watched()
    s.dirty = false
    writeFileSync(path, steps('RLT', 'ISP'))
    await vi.waitFor(() => expect(events).toEqual([{ name: 'shared', kind: 'reloaded', start: 0, before: 1, after: 2 }]), { timeout: 3000 })
    expect(gewerke()).toEqual(['ISP', 'ISP', 'ISP'])
    expect(s.sequence.steps.map((st) => st.name)).toEqual(['RLT', 'ISP'])
    expect(s.dirty).toBe(false)
  })

  it('keeps the steps of an unreadable file, and reloads it once it can be read again', async () => {
    const { s, path, events, gewerke } = await watched()
    writeFileSync(path, '<<<<<<< HEAD\n{}')
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(['unreadable']), { timeout: 3000 })
    expect(events[0]?.message).toBeTruthy()
    expect(gewerke()).toEqual(['HZG', 'HZG', 'HZG'])
    writeFileSync(path, steps('RLT'))
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(['unreadable', 'reloaded']), { timeout: 3000 })
    expect(gewerke()).toEqual(['RLT', 'RLT', 'RLT'])
    expect(s.blocks[0]?.steps).toHaveLength(1)
  })

  it('keeps the steps of a deleted file running, refuses edits, and writes them back or elsewhere', async () => {
    const { s, dir, path, events, gewerke } = await watched()
    rmSync(path)
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(['deleted']), { timeout: 3000 })
    expect(s.blocks[0]?.gone).toBe(true)
    expect(gewerke()).toEqual(['HZG', 'HZG', 'HZG'])
    await expect(setDisabled(s, 0, true)).rejects.toThrow('error.sequenceFileGone')
    await expect(applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'RLT' }], note: 'x', insert: { block: 0, position: 0 } }))
      .rejects.toThrow('error.sequenceFileGone')

    await restoreBlock(s, 0)
    expect(s.blocks[0]?.gone).toBeUndefined()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ steps: [{ name: 'HZG' }] })

    rmSync(path)
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(['deleted', 'deleted']), { timeout: 3000 })
    const other = join(dir, 'other.json')
    s.dirty = false
    await saveBlockAs(s, 0, other)
    expect(s.blocks[0]).toMatchObject({ path: other })
    expect(s.dirty).toBe(true)
    expect(JSON.parse(readFileSync(other, 'utf8'))).toMatchObject({ steps: [{ name: 'HZG' }] })
    await setDisabled(s, 0, true)
  })

  it('refuses to save a block as a file another block links', async () => {
    const { s, dir } = await watched()
    const second = join(dir, 'second.json')
    writeFileSync(second, steps('RLT'))
    await linkBlocks(s, [second])
    await expect(saveBlockAs(s, 0, second)).rejects.toThrow('error.sequenceAlreadyLinked')
  })

  it('counts a file deleted and written again within the settle time as changed', async () => {
    const { path, events, gewerke } = await watched()
    rmSync(path)
    writeFileSync(path, steps('RLT'))
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(['reloaded']), { timeout: 3000 })
    expect(gewerke()).toEqual(['RLT', 'RLT', 'RLT'])
  })

  it('loads a file that was missing when linked once it appears', async () => {
    const { s, dir, events, gewerke } = await watched()
    const later = join(dir, 'later.json')
    await linkBlocks(s, [later])
    watcher!.sync()
    expect(s.blocks[1]?.missing).toBe(true)
    writeFileSync(later, steps('RLT'))
    await vi.waitFor(() => expect(events).toEqual([{ name: 'later', kind: 'reloaded', start: 1, before: 0, after: 1 }]), { timeout: 3000 })
    expect(s.blocks[1]?.missing).toBeUndefined()
    expect(gewerke()).toEqual(['RLT', 'RLT', 'RLT'])
  })

  it('stops watching a folder once no file in it is used, and everything on reset', async () => {
    const { s, dir, ede } = await watched()
    const other = tempDir()
    writeFileSync(join(other, 'b.json'), steps('RLT'))
    await linkBlocks(s, [join(other, 'b.json')])
    watcher!.sync()
    expect(watcher!.watching.sort()).toEqual([dir, other, dirname(ede)].sort())
    await unlinkBlock(s, 0)
    watcher!.sync()
    expect(watcher!.watching.sort()).toEqual([other, dirname(ede)].sort())
    s.reset()
    watcher!.sync()
    expect(watcher!.watching).toEqual([])
  })
})

describe('Git state', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })

  it('tells a modified and an untracked file from a committed one, and is null outside a repository', async () => {
    const dir = tempDir()
    const path = join(dir, 'a.json')
    writeFileSync(path, steps('HZG'))
    expect(await gitStatus(path)).toBeNull()
    git(dir, 'init', '-q')
    expect(await gitStatus(path)).toBe('untracked')
    git(dir, 'add', 'a.json')
    git(dir, 'commit', '-q', '-m', 'a')
    expect(await gitStatus(path)).toBeNull()
    writeFileSync(path, steps('RLT'))
    expect(await gitStatus(path)).toBe('modified')
  })

  it('is checked for a newly linked file and reported when it changes', async () => {
    const { s, dir, status } = await watched()
    await vi.waitFor(() => expect(s.blocks[0]?.git).toBeNull())
    git(dir, 'init', '-q')
    await watcher!.refreshGit()
    expect(s.blocks[0]?.git).toBe('untracked')
    expect(status).toHaveBeenCalled()
  })
})

describe('watching the project file', () => {
  async function saved() {
    const w = await watched()
    const file = join(w.dir, 'p.bactwin')
    await writeProject(w.s, file)
    w.s.projectPath = file
    watcher!.sync()
    await wait(200)
    return { ...w, file }
  }

  it('ignores the app\'s own writes', async () => {
    const { s, file, project } = await saved()
    s.requireProject().header.project_name = 'other'
    await writeProject(s, file)
    await wait(500)
    expect(project).not.toHaveBeenCalled()
  })

  it('asks once about an outside change, however often the file is touched meanwhile, and checks again after', async () => {
    const { file, project, answer } = await saved()
    writeFileSync(file, readFileSync(file, 'utf8').replace('"project_name":""', '"project_name":"outside"'))
    await vi.waitFor(() => expect(project).toHaveBeenCalledWith('changed'), { timeout: 3000 })
    writeFileSync(file, `${readFileSync(file, 'utf8')} `)
    await wait(400)
    expect(project).toHaveBeenCalledTimes(1)
    answer()
    // Nothing was written in between, so the file still differs and is asked about again.
    await vi.waitFor(() => expect(project).toHaveBeenCalledTimes(2), { timeout: 3000 })
  })

  it('asks about a deleted project file', async () => {
    const { file, project } = await saved()
    rmSync(file)
    await vi.waitFor(() => expect(project).toHaveBeenCalledWith('deleted'), { timeout: 3000 })
  })
})

describe('watching EDE files', () => {
  it('reports a changed file once and a deleted one as missing, and never imports by itself', async () => {
    const { s, ede, sources } = await watched()
    await wait(200)
    const before = JSON.stringify(s.requireProject().points)
    writeFileSync(ede, `${readFileSync(ede, 'utf8')}\nK;1;D;0;1;`)
    await vi.waitFor(() => expect(sources).toEqual([{ filename: 'test.csv', state: 'changed' }]), { timeout: 3000 })
    writeFileSync(ede, `${readFileSync(ede, 'utf8')}\nK;1;E;0;1;`)
    await wait(400)
    expect(sources).toHaveLength(1)
    rmSync(ede)
    await vi.waitFor(() => expect(sources.at(-1)).toEqual({ filename: 'test.csv', state: 'missing' }), { timeout: 3000 })
    expect(JSON.stringify(s.requireProject().points)).toBe(before)
  })
})
