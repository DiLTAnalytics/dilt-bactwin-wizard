/** End-to-end against the real application, over the preload bridge: window, plugins, import, set, run, save, export. */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..', '..')
const REPO = join(APP, '..', '..')
const DEMO_EDE = join(REPO, 'examples', 'ede', 'demo_devices_ede.csv')
const pkgVersion = (JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { version: string }).version

let app: ElectronApplication
let page: Page
let userData: string

/** Answer the next native file dialogs with these paths, as a user picking them would. */
async function answerDialogs(answer: { open?: string[]; save?: string; button?: number }): Promise<void> {
  await app.evaluate(({ dialog }, { open, save, button }) => {
    if (open) dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: open })) as never
    if (save) dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as never
    if (button !== undefined) dialog.showMessageBox = (async () => ({ response: button, checkboxChecked: false })) as never
  }, answer)
}

/** Call the main process the way the renderer does, through the preload bridge. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([c, a]) => (window as unknown as { bactwin: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } })
      .bactwin.invoke(c as string, ...(a as unknown[])),
    [channel, args] as const,
  ) as Promise<T>
}

test.beforeAll(async () => {
  // A throwaway user-data directory: first-run state, never the developer's settings.
  userData = mkdtempSync(join(tmpdir(), 'bactwin-e2e-'))
  app = await electron.launch({
    args: [join(APP, '.vite', 'build', 'main.cjs'), `--user-data-dir=${userData}`],
    cwd: APP,
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  // Closing with unsaved changes asks first; answer "Don't save".
  if (app) await answerDialogs({ button: 1 })
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

test('the window opens and the renderer mounts', async () => {
  await expect(page.locator('body')).toContainText('BACtwin', { timeout: 20_000 })
})

test('the preload bridge reaches the main process', async () => {
  const bridged = await page.evaluate(() => typeof (window as never as { bactwin?: unknown }).bactwin)
  expect(bridged).toBe('object')
})

test('the renderer has no direct access to Node', async () => {
  // Reachable would mean context isolation or the sandbox is weakened.
  const exposed = await page.evaluate(() => ({
    require: typeof (window as never as { require?: unknown }).require,
    process: typeof (window as never as { process?: unknown }).process,
    ipcRenderer: typeof (window as never as { ipcRenderer?: unknown }).ipcRenderer,
  }))
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', ipcRenderer: 'undefined' })
})

test('plugins load from disk', async () => {
  const { plugins, issues } = await invoke<{ plugins: { id: string; enabled: boolean }[]; issues: unknown[] }>('plugins:list')
  expect(plugins.map((p) => p.id).sort()).toContain('amev-2026')
  expect(plugins.every((p) => p.enabled)).toBe(true)
  expect(issues).toEqual([])
})

test('the name template comes from the bundled plugin', async () => {
  const template = await invoke<{ version: string; segments: unknown[] }>('reference:nameTemplate')
  expect(template.version).toBe('AMEV_2026')
  expect(template.segments.length).toBeGreaterThan(5)
})

/** Wait until main has written the project after a change (autosave waits about 1.5 s). */
async function settled(): Promise<void> {
  await expect.poll(() => invoke<{ dirty: boolean; saving: boolean }>('project:state').then((st) => st.dirty || st.saving), { timeout: 10_000 }).toBe(false)
}

test('a new project asks where it goes, then imports, filters and records a step', async () => {
  const file = join(userData, 'project.bactwin')
  await answerDialogs({ save: file })
  expect(await invoke('project:new')).toEqual({ ok: true })
  expect(existsSync(file)).toBe(true)
  // The sequence file comes with the first step.
  expect(existsSync(join(userData, 'project.sequence.json'))).toBe(false)

  await answerDialogs({ open: [DEMO_EDE] })
  const imported = await invoke<{ imported: number; failures: unknown[]; files: number }>(
    'project:importEde',
    { mode: 'append' },
  )
  expect(imported.files).toBe(1)
  expect(imported.failures).toEqual([])

  // Appending the same export again adds nothing: points are matched by their full identity.
  await answerDialogs({ open: [DEMO_EDE] })
  const again = await invoke<{ imported: number; total: number }>('project:importEde', { mode: 'append' })
  expect(again).toMatchObject({ imported: 0, total: imported.imported })
  expect(imported.imported).toBeGreaterThan(0)

  // Filtering must actually narrow, or the assignment below proves nothing.
  const analogOnly = {
    rules: [{ field: 'ede.object_type', operator: 'equals', value: '0' }],
  }
  const counts = await invoke<{ total: number; filtered: number }>('points:count', analogOnly)
  expect(counts.filtered).toBeGreaterThan(0)
  expect(counts.filtered).toBeLessThan(counts.total)

  const result = await invoke<{ matched: number; changed: number }>('apply:set', {
    filter: analogOnly,
    actions: [{ field: 'bactwin.gewerk', value: 'RLT' }],
    note: 'e2e',
  })
  expect(result.matched).toBe(counts.filtered)
  expect(result.changed).toBe(counts.filtered)
  expect(existsSync(join(userData, 'project.sequence.json'))).toBe(true)

  // Recorded as exactly one step, with what it did.
  const sequence = await invoke<{ steps: { name: string }[]; outcomes: { hits: number }[] }>('sequence:get')
  expect(sequence.steps).toHaveLength(1)
  expect(sequence.steps[0]?.name).toBe('e2e')
  expect(sequence.outcomes[0]?.hits).toBe(counts.filtered)

  // The statistics reflect the filter.
  const stats = await invoke<{ total: number; filtered: number }>('points:stats', analogOnly)
  expect(stats.total).toBe(counts.total)
  expect(stats.filtered).toBe(counts.filtered)
})

test('editing a step recalculates the data, reporting each step while it runs', async () => {
  await page.evaluate(() => {
    const w = window as never as { progress: unknown[]; bactwin: { events: { onRunProgress: (h: (p: unknown) => void) => void } } }
    w.progress = []
    w.bactwin.events.onRunProgress((p) => w.progress.push(p))
  })
  const rlt = { rules: [{ field: 'bactwin.gewerk', operator: 'equals', value: 'RLT' }] }
  const hzg = { rules: [{ field: 'bactwin.gewerk', operator: 'equals', value: 'HZG' }] }
  const before = await invoke<{ filtered: number }>('points:count', rlt)
  await invoke('apply:set', {
    filter: { rules: [{ field: 'ede.object_type', operator: 'equals', value: '0' }] },
    actions: [{ field: 'bactwin.gewerk', value: 'HZG' }],
    note: 'edited',
    replace: 0,
  })
  expect((await invoke<{ filtered: number }>('points:count', rlt)).filtered).toBe(0)
  expect((await invoke<{ filtered: number }>('points:count', hzg)).filtered).toBe(before.filtered)
  // Main pushes one report per step, then null when done.
  const progress = await page.evaluate(() => (window as never as { progress: unknown[] }).progress)
  expect(progress.at(-1)).toBeNull()
  expect(progress).toContainEqual({ index: 0, total: 1, name: 'edited' })
})

test('a saved project round-trips, and is saved by itself', async () => {
  const file = join(userData, 'project.bactwin')
  await settled()
  const before = await invoke<string>('project:serialize')
  await answerDialogs({ open: [file] })
  const loaded = await invoke<{ total: number }>('project:open')
  expect(loaded.total).toBeGreaterThan(0)
  // Translations are replayed on load, so an exact match means nothing extra or missing was saved.
  expect(await invoke<string>('project:serialize')).toBe(before)

  // A change lands in the sequence file at once and in the project file shortly after.
  await invoke('sequence:setDisabled', 0, true)
  const seq = JSON.parse(readFileSync(join(userData, 'project.sequence.json'), 'utf8')) as { steps: { disabled?: boolean }[] }
  expect(seq.steps[0]?.disabled).toBe(true)
  await invoke('sequence:setDisabled', 0, false)
  await settled()

  // Cancelling the location of a new project keeps the open one.
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as never })
  expect(await invoke('project:new')).toBeNull()
  expect((await invoke<{ total: number }>('points:count', { rules: [] })).total).toBeGreaterThan(0)

  // A file saved with other reference data opens, with a notice naming the difference.
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { header: { reference: { plugins: { id: string; version: string }[] } } }
  saved.header.reference.plugins[0]!.version = '0.0.1'
  const other = join(userData, 'other-reference.bactwin')
  writeFileSync(other, JSON.stringify(saved))
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { notices?: string[] }
    g.notices = []
    dialog.showMessageBox = (async (_w: unknown, o: { type: string; detail: string }) => {
      if (o.type === 'info') g.notices!.push(o.detail)
      return { response: 1, checkboxChecked: false }
    }) as never
  })
  await answerDialogs({ open: [other] })
  await invoke('project:open')
  const notices = await app.evaluate(() => (globalThis as { notices?: string[] }).notices ?? [])
  expect(notices.join()).toContain('0.0.1')

  // A project saved by a newer version is not opened; the message asks for the latest version, naming none.
  const newer = join(userData, 'newer.bactwin')
  writeFileSync(newer, JSON.stringify({ ...saved, schema_version: '1.1' }))
  await app.evaluate(() => { (globalThis as { notices?: string[] }).notices = [] })
  await answerDialogs({ open: [newer] })
  expect(await invoke('project:open')).toBeNull()
  const tooNew = await app.evaluate(() => (globalThis as { notices?: string[] }).notices ?? [])
  expect(tooNew).toEqual([expect.stringContaining('Bitte die neueste Version installieren')])
  expect(tooNew[0]).not.toMatch(/\d+\.\d+/)

  // Leave the saved project open for the tests that follow.
  await answerDialogs({ open: [file] })
  await invoke('project:open')
})

test('a linked sequence file runs after the steps there are, and unlinking takes its steps away', async () => {
  const shared = join(userData, 'shared.json')
  writeFileSync(shared, JSON.stringify({ schema_version: '1.0', steps: [{ name: 'shared', filter: [], actions: [{ field: 'state.comment', value: 'shared' }] }] }))
  await answerDialogs({ open: [shared] })
  await invoke('sequence:link')
  const sequence = await invoke<{ steps: { name: string }[]; blocks: { name: string; count: number }[] }>('sequence:get')
  expect(sequence.blocks.map((b) => [b.name, b.count])).toEqual([['project.sequence', 1], ['shared', 1]])
  expect(sequence.steps[1]?.name).toBe('shared')
  const commented = { rules: [{ field: 'state.comment', operator: 'equals', value: 'shared' }] }
  expect((await invoke<{ filtered: number; total: number }>('points:count', commented)).filtered).toBeGreaterThan(0)
  await invoke('sequence:unlink', 1)
  expect((await invoke<{ filtered: number }>('points:count', commented)).filtered).toBe(0)
})

test('a linked sequence file changed outside the app is reloaded, and the data recalculated', async () => {
  const file = join(userData, 'outside.json')
  const comment = (value: string) => JSON.stringify({ schema_version: '1.0', steps: [{ name: value, filter: [], actions: [{ field: 'state.comment', value }] }] })
  writeFileSync(file, comment('before'))
  await answerDialogs({ open: [file] })
  await invoke('sequence:link')
  // Let the folder watch start before the file changes.
  await page.waitForTimeout(500)
  writeFileSync(file, comment('after'))
  await expect.poll(() => invoke<{ steps: { name: string }[] }>('sequence:get').then((s) => s.steps.at(-1)?.name), { timeout: 10_000 }).toBe('after')
  const after = { rules: [{ field: 'state.comment', operator: 'equals', value: 'after' }] }
  expect((await invoke<{ filtered: number }>('points:count', after)).filtered).toBeGreaterThan(0)
  await invoke('sequence:unlink', 1)
})

test('the open project keeps its own plugins, apart from the defaults for new projects', async () => {
  const stamp = async () => (JSON.parse(await invoke<string>('project:serialize')) as { header: { reference: { plugins: { id: string }[] } } })
    .header.reference.plugins.map((p) => p.id)
  await invoke('project:setPlugins', ['amev-2026'])
  expect(await stamp()).toEqual(['amev-2026'])
  expect((await invoke<{ combinations: boolean }>('reference:capabilities')).combinations).toBe(false)
  const { defaults } = await invoke<{ defaults: string[] }>('plugins:list')
  expect(defaults).toContain('dilt-2026')
  await invoke('project:setPlugins', ['amev-2026', 'dilt-2026'])
  expect((await invoke<{ combinations: boolean }>('reference:capabilities')).combinations).toBe(true)
})

test('a step that changes what an earlier one set is marked on both, and on the cells', async () => {
  const before = (await invoke<{ steps: unknown[] }>('sequence:get')).steps.length
  const all = { rules: [] }
  await invoke('apply:set', { filter: all, actions: [{ field: 'bactwin.funktion', value: 'MW' }], note: 'erst' })
  await invoke('apply:set', { filter: all, actions: [{ field: 'bactwin.funktion', value: 'SW' }], note: 'dann' })
  const { outcomes } = await invoke<{ outcomes: { overwrites: [number, number][]; overwrittenBy: [number, number][]; noEffect: boolean }[] }>('sequence:get')
  expect(outcomes[before]).toMatchObject({ overwrittenBy: [[before + 1, expect.any(Number)]], noEffect: true })
  expect(outcomes[before + 1]!.overwrites[0]![0]).toBe(before)
  const { collisions } = await invoke<{ collisions: (Record<string, number[]> | null)[] }>('points:list', { filter: all, page_size: 1 })
  expect(collisions[0]?.['bactwin.funktion']?.slice(-2)).toEqual([before, before + 1])
  await invoke('sequence:deleteStep', before + 1)
  await invoke('sequence:deleteStep', before)
})

test('an unknown IPC channel is refused', async () => {

  const error = await page.evaluate(async () => {
    try {
      await (window as never as { bactwin: { invoke: (c: string) => Promise<unknown> } }).bactwin.invoke('app:quit')
      return null
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(error).toContain('Unknown channel')
})

test('malformed IPC arguments are refused before reaching the project', async () => {
  const refused = async (channel: string, ...args: unknown[]) => {
    try {
      await invoke(channel, ...args)
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  const before = await invoke<string>('project:serialize')
  // A derived field, a negative index, a page of 0, an unknown export format, an extra argument.
  expect(await refused('apply:set', { actions: [{ field: 'state.messages', value: 'x' }], note: 'n' })).toContain('apply:set: invalid arguments')
  expect(await refused('sequence:deleteStep', -1)).toContain('invalid arguments')
  expect(await refused('points:list', { page: 0 })).toContain('invalid arguments')
  expect(await refused('export:save', 'pdf', 'all')).toContain('invalid arguments')
  expect(await refused('sequence:setDisabled', 0, true, 'extra')).toContain('invalid arguments')
  expect(await invoke<string>('project:serialize')).toBe(before)
})

test('the about information carries the licence facts', async () => {
  // The AGPL source offer and each plugin's licence.
  const about = await invoke<{
    version: string
    repository: string
    plugins: { id: string; license: string }[]
  }>('app:about')

  // The app's version, not Electron's (which app.getVersion() reports unpackaged).
  expect(about.version).toBe(pkgVersion)
  expect(about.repository).toMatch(/^https:\/\/github\.com\//)
  expect(about.plugins.length).toBeGreaterThan(0)
  for (const plugin of about.plugins) {
    expect(plugin.license, `plugin ${plugin.id} has no licence`).toBeTruthy()
  }
})
