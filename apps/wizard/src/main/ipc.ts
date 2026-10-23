/**
 * The IPC surface: one handler per channel in shared/channels.ts, nothing reachable by name beyond
 * that. Handlers do the Electron side (dialogs, settings, window events) and call into project/.
 * Errors cross as `{ ok: false, error }`, since structured clone cannot carry an Error.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { BrowserWindow, app, ipcMain, nativeTheme } from 'electron'
import { z } from 'zod'
import { BACTWIN_FIELDS, CombinationModeSchema, FilterDslSchema, SequenceTooNewError, SetActionSchema } from '@bactwin/mapping-engine'

import { EVENTS, type Channel } from '../shared/channels.js'
import * as dialogs from './dialogs.js'
import { setProjectOpen } from './menu.js'
import { t } from './i18n.js'
import { referenceSources } from './paths.js'
import { readSettings, rememberRecentProject, writeSettings } from './settings.js'
import { applySet, projectSettings, setTableLayout, updateProjectSettings } from './project/editing.js'
import { importEde, removeSource, replaceSource, updateFromSource } from './project/importing.js'
import { locateSource, sourceStatuses } from './project/sources.js'
import { loadProject, ProjectTooNewError, serializeProject, writeProject, type LoadResult } from './project/projectFile.js'
import { TableLayoutSchema } from './project/projectSchema.js'
import { pointHistory, preview } from './project/preview.js'
import * as queries from './project/queries.js'
import { applyProjectPlugins, capabilities, labels, loadReferenceData, nameTemplate, setProjectPlugins } from './project/reference.js'
import * as sequence from './project/sequence.js'
import { Session, emptyProject } from './project/session.js'
import { FileWatcher } from './project/watcher.js'

/** The one session the application has: one window, one project. */
export const session = new Session(t)

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}
session.onProgress = (progress) => broadcast(EVENTS.runProgress, progress)

/** Reloads files changed outside the app; synced after every call, since most can change which files the project uses. */
export const watcher = new FileWatcher(session, {
  sequenceFile: (event) => broadcast(EVENTS.sequenceFileChanged, event),
  status: () => broadcast(EVENTS.sequenceGit, null),
  project: (kind) => projectFileChanged(kind),
  source: (event) => broadcast(EVENTS.sourceChanged, event),
})

/** After anything that can open, close or change the project: the files watched and the menu entries that need a project. */
function syncWithProject(): void {
  watcher.sync()
  setProjectOpen(session.project !== null)
}

/** Autosave waits while the user decides about a project file changed outside, so it does not overwrite that version first. */
let askingAboutProject = false

async function projectFileChanged(kind: 'changed' | 'deleted'): Promise<void> {
  const path = session.projectPath
  if (!path) return
  askingAboutProject = true
  try {
    if (kind === 'changed') await resolveOutsideChange(path)
    else await resolveDeletion(path)
  } finally {
    askingAboutProject = false
  }
  syncWithProject()
  await flushAutosave().catch((e: Error) => dialogs.showError(t('dialog.saveFailed'), e.message))
}

/** Load the outside version (unapplied steps are asked about first), or keep this one, which then saves over it. */
async function resolveOutsideChange(path: string): Promise<void> {
  for (;;) {
    if ((await dialogs.askProjectChanged(basename(path))) === 'keep') {
      session.dirty = true
      return
    }
    if (session.unappliedSteps && !(await dialogs.askToDiscardSteps(session.unappliedSteps))) continue
    try {
      await openProjectFile(path)
      broadcast(EVENTS.openProject, null)
      return
    } catch (e) {
      await dialogs.showError(t('dialog.openFailed'), (e as Error).message)
    }
  }
}

/** Write the project back, save it elsewhere, or close it without saving. */
/** No project open any more; new projects' plugins apply. */
function closeProject(): Promise<void> {
  return session.exclusive(() => {
    session.reset()
    applyProjectPlugins(session, undefined)
  })
}

async function resolveDeletion(path: string): Promise<void> {
  for (;;) {
    const choice = await dialogs.askProjectDeleted(basename(path))
    if (choice === 'restore') {
      session.dirty = true
      return
    }
    if (choice === 'close') {
      await closeProject()
      broadcast(EVENTS.openProject, null)
      return
    }
    try {
      if (await saveProject(true)) return
    } catch (e) {
      await dialogs.showError(t('dialog.saveFailed'), (e as Error).message)
    }
  }
}

/** Saved or not, and where; pushed whenever it may have changed. */
function projectState() {
  return { dirty: session.dirty, path: session.projectPath, saving: autosaving !== null }
}

const AUTOSAVE_DELAY_MS = 1500
let autosaveTimer: NodeJS.Timeout | null = null
let autosaving: Promise<void> | null = null

/** Write the project now if it has a file and unsaved changes; the timer's job, also run before closing. */
export async function flushAutosave(): Promise<void> {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = null
  // A save already running may have started before the latest change; wait, then save again if needed.
  await autosaving
  if (askingAboutProject || !session.project || !session.projectPath || !session.dirty) return
  const path = session.projectPath
  autosaving = session.exclusive(async () => {
    session.dirty = false
    try {
      await writeProject(session, path)
    } catch (e) {
      session.dirty = true
      throw e
    }
  })
  broadcastState()
  try {
    await autosaving
  } finally {
    autosaving = null
    broadcastState()
    // The first save gives sequence files created before it their place.
    syncWithProject()
  }
}

let lastState = ''

/** Tell the window about the save state, only when it changed. */
function broadcastState(): void {
  const state = JSON.stringify(projectState())
  if (state === lastState) return
  lastState = state
  broadcast(EVENTS.projectState, JSON.parse(state))
}

/** After any call: save a moment after the first unsaved change, so a burst of changes is one write. */
function scheduleAutosave(): void {
  broadcastState()
  if (!session.dirty || !session.projectPath || autosaveTimer) return
  autosaveTimer = setTimeout(() => void flushAutosave().catch((e: Error) => void dialogs.showError(t('dialog.saveFailed'), e.message)), AUTOSAVE_DELAY_MS)
}

const EXPORT_FILES: Record<queries.ExportFormat, Omit<dialogs.SaveOptions, 'suggestedName'> & { name: string; ext: string }> = {
  replacement: { id: 'export-replacement', name: 'replacement', ext: 'csv', description: 'CSV', extensions: ['csv'] },
  xlsx: { id: 'export-xlsx', name: '', ext: 'xlsx', description: 'Excel', extensions: ['xlsx'] },
  json: { id: 'export-json', name: '', ext: 'json', description: 'JSON', extensions: ['json'] },
}

/** Only "save as", or a project never saved, opens the dialog. */
async function saveProject(saveAs: boolean): Promise<string | null> {
  session.requireProject()
  const path = (!saveAs && session.projectPath) || await dialogs.pickSavePath({
    id: 'project-save',
    suggestedName: `${session.project?.header.project_name || t('files.projectName')}.bactwin`,
    description: t('filePicker.project'),
    extensions: ['bactwin', 'json'],
  })
  if (!path) return null
  await session.exclusive(() => writeProject(session, path))
  session.projectPath = path
  session.dirty = false
  rememberRecentProject(path)
  return path
}

/** Tell the user when a project was saved with other reference data than is loaded now. */
export async function noteReferenceChanges(changes: string[]): Promise<void> {
  if (changes.length) await dialogs.showInfo(t('reference.changedTitle'), `${changes.join('\n')}\n\n${t('reference.changedDetail')}`)
}

/** Before replacing or closing the project: false means the user chose to stay. A saved project just saves. */
export async function resolveUnsaved(): Promise<boolean> {
  if (session.unappliedSteps && !(await dialogs.askToDiscardSteps(session.unappliedSteps))) return false
  if (session.projectPath) {
    await flushAutosave()
    return true
  }
  if (!session.dirty || !session.project) return true
  const choice = await dialogs.askToSave()
  if (choice === 'save') return (await saveProject(false)) !== null
  return choice === 'discard'
}

/**
 * Run `open`; a file saved by a newer version is not opened, and the version to install is named instead
 * (null). `file` names the file when the error does not.
 */
async function unlessTooNew<T>(file: string, open: () => Promise<T>): Promise<T | null> {
  try {
    return await open()
  } catch (e) {
    if (e instanceof ProjectTooNewError) {
      await dialogs.showInfo(t('dialog.tooNewTitle'), t('dialog.tooNew', { file: basename(file) }))
      return null
    }
    if (e instanceof SequenceTooNewError) {
      await dialogs.showInfo(t('dialog.tooNewTitle'), t('dialog.tooNew', { file: basename(e.file ?? file) }))
      return null
    }
    throw e
  }
}

/** Open a project file (picked, double-clicked or passed on the command line); null when it is too new to open. */
export async function openProjectFile(path: string): Promise<LoadResult | null> {
  const content = await readFile(path, 'utf8')
  const result = await unlessTooNew(path, () => loadProject(session, content, path))
  if (!result) return null
  syncWithProject()
  app.addRecentDocument(path)
  rememberRecentProject(path)
  if (result.missingSequences.length) await dialogs.showInfo(t('dialog.missingSequencesTitle'), result.missingSequences.join('\n'))
  await noteReferenceChanges(result.referenceChanges)
  if (result.duplicates) await dialogs.showInfo(t('dialog.duplicatesTitle'), result.duplicates)
  const changed = (await sourceStatuses(session)).filter((source) => source.state === 'changed')
  if (changed.length) await dialogs.showInfo(t('dialog.sourcesChangedTitle'), `${changed.map((c) => c.filename).join('\n')}\n\n${t('dialog.sourcesChangedDetail')}`)
  return result
}

function pickAndImport<S extends z.ZodObject>(
  schema: S,
  picker: { id: string; descriptionKey: string; extensions: string[] },
  run: (paths: string[], options: z.output<S>) => ReturnType<typeof importEde>,
) {
  const handler = async (options: z.output<S>) => {
    if (options['mode'] === 'new' && !(await resolveUnsaved())) return null
    const { descriptionKey, ...rest } = picker
    const paths = await dialogs.pickFiles({ ...rest, description: t(descriptionKey), multiple: true })
    return paths.length ? { ...(await run(paths, options)), files: paths.length } : null
  }
  // zod cannot resolve a tuple's element types over a generic schema, so the one-argument shape is asserted here.
  return checked(z.tuple([schema]), handler as never) as unknown as (options: z.input<S>) => ReturnType<typeof handler>
}

function about() {
  return {
    version: __APP_VERSION__,
    electron: process.versions['electron'] ?? '',
    chrome: process.versions['chrome'] ?? '',
    repository: __APP_REPOSITORY__,
    plugins: session.plugins.map(({ id, name, version, license, origin, enabled }) => ({ id, name, version, license, origin, enabled })),
  }
}

// --- argument schemas: renderer input is untrusted, so every handler parses its arguments ---

const Index = z.number().int().min(0)
const StepPosition = z.object({ block: Index, position: Index })
const Filter = FilterDslSchema
/** Actions as the sequence file defines them, so a recorded step always saves. */
const SetRequest = z.object({
  filter: Filter.optional(),
  actions: z.array(SetActionSchema),
  note: z.string(),
  replace: Index.optional(),
  insert: StepPosition.optional(),
  combination_mode: CombinationModeSchema.optional(),
})
const PreviewRequest = z.object({
  index: Index.nullable(),
  isNew: z.boolean().optional(),
  filter: Filter,
  actions: z.array(SetActionSchema),
  mode: z.enum(['hits', 'near', 'missed']),
  context: z.enum(['before', 'import']).optional(),
  view: Filter.optional(),
  page: z.number().int().min(1).optional(),
  page_size: z.number().int().min(1).max(10_000).optional(),
  sort: z.string().nullish(),
  sort_desc: z.boolean().optional(),
  example: z.string().optional(),
})
const Import = z.object({ mode: z.enum(['new', 'append']) })
const PointsRequest = z.object({
  filter: Filter.optional(),
  page: z.number().int().min(1).optional(),
  page_size: z.number().int().min(1).max(10_000).optional(),
  sort: z.string().nullish(),
  sort_desc: z.boolean().optional(),
})
const ValidOptionsRequest = z.object({
  field: z.enum(BACTWIN_FIELDS.map((f) => f.id) as [string, ...string[]]),
  mode: z.enum(['free', 'combination', 'gewerk_specific']),
  filter: Filter.optional(),
  overrides: z.record(z.string(), z.string()).optional(),
})
const ExportFormat = z.enum(['replacement', 'xlsx', 'json'])
const ExportScope = z.enum(['all', 'filtered', 'complete'])

type Args = z.ZodTuple<[] | [z.ZodType, ...z.ZodType[]], null>

/** Arguments the renderer sent that do not match a channel's schema. */
class InvalidArguments extends Error {
  constructor(issues: z.core.$ZodIssue[]) {
    super(`invalid arguments (${issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')})`)
  }
}

/** A handler that parses its arguments first. Missing trailing arguments count as undefined; extra ones are refused. */
function checked<A extends Args, R>(args: A, fn: (...parsed: z.output<A>) => R): (...raw: z.input<A>) => R {
  return (...raw) => {
    const padded = Array.from({ length: Math.max(raw.length, args.def.items.length) }, (_, i) => (raw as unknown[])[i])
    const parsed = args.safeParse(padded)
    if (!parsed.success) throw new InvalidArguments(parsed.error.issues)
    return fn(...(parsed.data as z.output<A>))
  }
}

const handlers = {
  // reference data
  /** Rescans the plugin folders, so a newly installed plugin and its load problems show up. */
  'plugins:list': () => {
    const { plugins, issues } = loadReferenceData(referenceSources(), session.enabledPlugins)
    return { plugins, issues, defaults: session.defaultPlugins ?? plugins.map((p) => p.id), missing: session.missingPlugins }
  },
  /** The plugins new projects start with; without an open project they apply at once. */
  'plugins:setDefaults': checked(z.tuple([z.array(z.string())]), (enabled) => session.exclusive(() => {
    writeSettings({ ...readSettings(), enabledPlugins: enabled })
    session.defaultPlugins = enabled
    if (!session.project) applyProjectPlugins(session, undefined)
    return { ok: true as const }
  })),
  'reference:capabilities': () => capabilities(session),
  'reference:nameTemplate': () => nameTemplate(session),
  'reference:labels': () => labels(session),

  // project
  /** Asks where the project goes, then creates it there with its own, empty sequence file. */
  'project:new': async () => {
    if (!(await resolveUnsaved())) return null
    const path = await dialogs.pickSavePath({
      id: 'project-save',
      suggestedName: `${t('files.projectName')}.bactwin`,
      description: t('filePicker.project'),
      extensions: ['bactwin'],
    })
    if (!path) return null
    await session.exclusive(() => {
      session.reset()
      applyProjectPlugins(session, undefined)
    })
    const project = emptyProject()
    project.header.project_name = basename(path).replace(/\.bactwin$/, '')
    session.project = project
    session.projectPath = path
    await session.exclusive(() => writeProject(session, path))
    rememberRecentProject(path)
    return { ok: true as const }
  },
  'project:importEde': pickAndImport(Import,
    { id: 'ede-import', descriptionKey: 'filePicker.ede', extensions: ['csv'] },
    (paths, o) => importEde(session, paths, o),
  ),
  'project:open': async () => {
    if (!(await resolveUnsaved())) return null
    const [path] = await dialogs.pickFiles({ id: 'project-open', description: t('filePicker.project'), extensions: ['bactwin', 'json'] })
    return path ? openProjectFile(path) : null
  },
  // Opened by position in the list main keeps, so the renderer never names a file.
  'project:openRecent': checked(z.tuple([Index]), async (index) => {
    const path = readSettings().recentProjects?.[index]
    if (!path) throw new Error(t('error.noSuchRecent'))
    if (!(await resolveUnsaved())) return null
    return openProjectFile(path)
  }),
  'project:serialize': () => serializeProject(session),
  'project:settings': () => projectSettings(session),
  'project:updateSettings': checked(z.tuple([z.object({ project_name: z.string().optional() })]),
    (patch) => updateProjectSettings(session, patch)),
  /** Back to the start screen; unsaved changes and unapplied steps are asked about first. */
  'project:close': async () => {
    if (!(await resolveUnsaved())) return null
    await closeProject()
    return { ok: true as const }
  },
  'project:setPlugins': checked(z.tuple([z.array(z.string())]), (ids) => setProjectPlugins(session, ids)),
  'project:setTableLayout': checked(z.tuple([TableLayoutSchema]), (layout) => setTableLayout(session, layout)),
  'project:state': () => projectState(),
  'project:setUnappliedSteps': checked(z.tuple([z.number().int().nonnegative()]), (count) => {
    session.unappliedSteps = count
    return { ok: true as const }
  }),
  'project:save': checked(z.tuple([z.boolean()]), (saveAs) => saveProject(saveAs)),

  // sources
  'sources:list': () => sourceStatuses(session),
  'sources:locate': checked(z.tuple([Index]), async (index) => {
    const [path] = await dialogs.pickFiles({ id: 'ede-import', description: t('filePicker.ede'), extensions: ['csv'] })
    return path ? locateSource(session, index, path) : null
  }),
  /** Remove a source and its points, after asking. */
  'sources:remove': checked(z.tuple([Index]), async (index) => {
    const source = session.requireProject().header.ede_sources[index]
    if (!source) throw new Error(t('error.noSuchSource', { index: index + 1 }))
    const points = (await sourceStatuses(session))[index]?.points ?? 0
    if (!(await dialogs.confirm(t('dialog.removeSourceTitle', { file: source.filename }), t('dialog.removeSourceDetail', { count: points }), t('dialog.removeSource')))) return null
    await removeSource(session, index)
    return sourceStatuses(session)
  }),
  'sources:update': checked(z.tuple([Index]), async (index) => ({ report: await updateFromSource(session, index), sources: await sourceStatuses(session) })),
  /** Read a new version of a source from a file the user picks, e.g. a re-export under another name. */
  'sources:replace': checked(z.tuple([Index]), async (index) => {
    const [path] = await dialogs.pickFiles({ id: 'ede-import', description: t('filePicker.ede'), extensions: ['csv'] })
    return path ? { report: await replaceSource(session, index, path), sources: await sourceStatuses(session) } : null
  }),

  // points
  'points:list': checked(z.tuple([PointsRequest]), (req) => queries.points(session, req)),
  'points:byKeys': checked(z.tuple([z.array(z.string())]), (keys) => queries.pointsByKeys(session, keys)),
  'points:count': checked(z.tuple([Filter]), (filter) => queries.count(session, filter)),
  'points:stats': checked(z.tuple([Filter.optional()]), (filter) => queries.stats(session, filter)),

  'step:preview': checked(z.tuple([PreviewRequest]), (req) => preview(session, req)),
  'point:history': checked(z.tuple([z.string()]), (key) => pointHistory(session, key)),

  // combinations and writing
  'combinations:validOptions': checked(z.tuple([ValidOptionsRequest]), (req) => queries.validOptions(session, req)),
  'apply:set': checked(z.tuple([SetRequest]), (req) => applySet(session, req)),

  // sequence
  'sequence:get': () => sequence.getSequence(session),
  'sequence:deleteStep': checked(z.tuple([Index]), (index) => sequence.deleteStep(session, index)),
  'sequence:moveStep': checked(z.tuple([Index, StepPosition]), (index, to) => sequence.moveStep(session, index, to)),
  'sequence:moveBlock': checked(z.tuple([Index, Index]), (from, to) => sequence.moveBlock(session, from, to)),
  'sequence:setDisabled': checked(z.tuple([Index, z.boolean()]), (index, disabled) => sequence.setDisabled(session, index, disabled)),
  /** Link sequence files the user picks, e.g. ones shared between projects. */
  'sequence:link': async () => {
    session.requireProject()
    const paths = await dialogs.pickFiles({ id: 'sequence-load', description: t('filePicker.sequence'), extensions: ['json'], multiple: true })
    if (!paths.length) return null
    const result = await unlessTooNew(paths[0]!, () => sequence.linkBlocks(session, paths))
    if (!result) return null
    if (result.alreadyLinked.length) await dialogs.showInfo(t('dialog.alreadyLinkedTitle'), result.alreadyLinked.join('\n'))
    return result
  },
  'sequence:unlink': checked(z.tuple([Index]), (block) => sequence.unlinkBlock(session, block)),
  /** A new, empty sequence file where the user says, beside the project by default, linked at the end. */
  'sequence:create': async () => {
    session.requireProject()
    const path = await dialogs.pickSavePath({
      id: 'sequence-new', suggestedName: `${t('files.newSequence')}.json`, description: t('filePicker.sequence'), extensions: ['json'],
      ...(session.projectPath ? { folder: dirname(session.projectPath) } : {}),
    })
    return path ? sequence.createBlock(session, path) : null
  },
  /** Find the file of a block that was not found when the project opened. */
  'sequence:locate': checked(z.tuple([Index]), async (block) => {
    const [path] = await dialogs.pickFiles({ id: 'sequence-load', description: t('filePicker.sequence'), extensions: ['json'] })
    if (!path) return null
    return unlessTooNew(path, () => sequence.locateBlock(session, block, path))
  }),
  'sequence:restore': checked(z.tuple([Index]), (block) => sequence.restoreBlock(session, block)),
  /** Write a block's steps to a new file the user picks, e.g. after its own was deleted. */
  'sequence:saveAs': checked(z.tuple([Index]), async (block) => {
    const current = session.blocks[block]?.path
    const path = await dialogs.pickSavePath({
      id: 'sequence-new', suggestedName: current ? basename(current) : `${t('files.newSequence')}.json`, description: t('filePicker.sequence'), extensions: ['json'],
      ...(current ? { folder: dirname(current) } : {}),
    })
    return path ? sequence.saveBlockAs(session, block, path) : null
  }),

  // files
  'files:confirm': checked(z.tuple([z.string(), z.string(), z.string()]), (message, detail, label) => dialogs.confirm(message, detail, label)),
  'files:showError': checked(z.tuple([z.string(), z.string()]), (message, detail) => dialogs.showError(message, detail)),

  'export:counts': checked(z.tuple([Filter.optional()]), (filter) => queries.exportCounts(session, filter)),
  // The dialog names the points left out before export, so nothing is reported after.
  'export:save': checked(z.tuple([ExportFormat, ExportScope, Filter.optional()]), async (format, scope, filter) => {
    const { name, ext, ...spec } = EXPORT_FILES[format]
    const { bytes } = await queries.exportFile(session, format, scope, filter)
    return dialogs.saveBytes(bytes, { ...spec, suggestedName: `${name || t('files.datapointTable')}.${ext}` })
  }),

  // about and appearance
  'app:about': () => about(),
  'app:appearance': () => readSettings().appearance ?? 'system',
  'app:recentProjects': () => (readSettings().recentProjects ?? []).map((path) => ({
    name: basename(path).replace(/\.(bactwin|json)$/, ''),
    folder: dirname(path),
    exists: existsSync(path),
  })),
  'app:setAppearance': checked(z.tuple([z.enum(['system', 'light', 'dark'])]), (appearance) => {
    nativeTheme.themeSource = appearance
    writeSettings({ ...readSettings(), appearance })
  }),
} satisfies Record<Channel, (...args: never[]) => unknown>

export type Handlers = typeof handlers

export function registerIpc(): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        const value = await (handler as (...a: unknown[]) => unknown)(...args)
        scheduleAutosave()
        return { ok: true, value }
      } catch (e) {
        return { ok: false, error: e instanceof InvalidArguments ? `${channel}: ${e.message}` : (e as Error).message }
      } finally {
        syncWithProject()
      }
    })
  }
}
