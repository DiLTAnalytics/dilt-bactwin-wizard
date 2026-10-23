/** Importing EDE files into the project. */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { CodedError, parseEde, pointKey, type DataPoint } from '@bactwin/mapping-engine'

import { emptyProject, type EdeSource, type Session } from './session.js'
import { applyProjectPlugins } from './reference.js'
import { fingerprint } from './sources.js'

export interface ImportOptions {
  mode: 'new' | 'append'
}

export interface ImportReport {
  imported: number
  total: number
  warnings: string[]
  failures: { file: string; error: string }[]
  /** Files the project already listed, read again instead of added. */
  reread: (UpdateReport & { file: string })[]
}

/** Count and the first few object names, for a message about duplicate points. */
export function duplicateSummary(points: DataPoint[]): { count: string; names: string } {
  const names = points.slice(0, 5).map((p) => p.ede.object_name || '?').join(', ')
  return { count: String(points.length), names: points.length > 5 ? `${names}, …` : names }
}

/**
 * Import files (into a fresh project for "new"). A point already in the project is skipped and
 * reported. A row the file repeats is skipped, and the point is flagged source.duplicated_keyname.
 * Distinct points that only share an object name are kept. A file the project already lists is read
 * again, as updateFromSource does. A file that fails is reported and the others still import. Every
 * step then runs again over all points, the new ones included.
 */
export function importEde(s: Session, paths: string[], options: ImportOptions): Promise<ImportReport> {
  return s.exclusive(() => importInto(s, paths, options))
}

async function importInto(s: Session, paths: string[], options: ImportOptions): Promise<ImportReport> {
  s.requireIdle()
  // Files are added to a project; without one they would land in a project nobody sees.
  if (options.mode === 'append') s.requireProject()
  // Back to the imported values, so a point's EDE data can change underneath its steps.
  s.replay?.rewind(0)
  s.replay = null
  if (options.mode === 'new' || !s.project) {
    s.project = null
    applyProjectPlugins(s, undefined)
    s.project = emptyProject()
  }
  const project = s.project
  const seen = new Map(project.points.map((p) => [pointKey(p.ede), p]))
  const report: ImportReport = { imported: 0, total: 0, warnings: [], failures: [], reread: [] }

  for (const path of paths) {
    const filename = basename(path)
    try {
      const bytes = new Uint8Array(await readFile(path))
      const result = parseEde(bytes, { filename })
      const listed = project.header.ede_sources.find((source) => source.path === path)
      // Points are tied to their file by name, so two files of one name would share them.
      if (!listed && project.header.ede_sources.some((source) => source.filename === filename)) {
        report.failures.push({ file: filename, error: s.t('error.sourceSameName', { file: filename }) })
        continue
      }
      if (listed) {
        const update = takeOver(s, listed, bytes, result)
        report.warnings.push(...update.warnings.map((w) => `${listed.filename}: ${w}`))
        report.reread.push({ ...update, file: listed.filename })
        for (const point of project.points) seen.set(pointKey(point.ede), point)
        continue
      }
      report.warnings.push(...result.warnings.map((w) => `${filename}: ${s.t(`parse.${w.code}`, w.params)}`))
      const inFile = new Set<string>()
      const repeated: DataPoint[] = []
      const present: DataPoint[] = []
      for (const point of result.points) {
        const key = pointKey(point.ede)
        const kept = seen.get(key)
        if (inFile.has(key)) {
          kept!.source.duplicated_keyname = true
          repeated.push(point)
          continue
        }
        inFile.add(key)
        if (kept) {
          present.push(point)
          continue
        }
        seen.set(key, point)
        point.source = { ...point.source, type: 'ede', filename }
        project.points.push(point)
        report.imported++
      }
      if (repeated.length) report.warnings.push(`${filename}: ${s.t('parse.DUPLICATES_SKIPPED', duplicateSummary(repeated))}`)
      if (present.length) report.warnings.push(`${filename}: ${s.t('parse.EXISTING_SKIPPED', duplicateSummary(present))}`)
      project.header.ede_sources.push({ filename, imported_at: new Date().toISOString(), meta: result.meta, path, ...fingerprint(bytes) })
    } catch (e) {
      report.failures.push({ file: filename, error: e instanceof CodedError ? s.t(`parse.${e.code}`, e.params) : (e as Error).message })
    }
  }

  await s.rebase()
  s.dirty = true
  report.total = project.points.length
  return report
}

export interface UpdateReport {
  /** Points whose EDE values changed. */
  updated: number
  added: number
  /** Points of this file that the file no longer contains; flagged, never deleted. */
  missing: number
  warnings: string[]
}

/**
 * Take over a source file's current content, matched by identity: changed EDE values replace the old
 * ones and translations stay, new points are added (untranslated), and points the file no longer
 * contains are flagged missing_from_source. A point that comes back loses the flag. Every step then
 * runs again.
 */
export function updateFromSource(s: Session, index: number): Promise<UpdateReport> {
  return s.exclusive(() => updateInto(s, index))
}

async function updateInto(s: Session, index: number): Promise<UpdateReport> {
  s.requireIdle()
  const project = s.requireProject()
  const source = project.header.ede_sources[index]
  if (!source) throw new Error(s.t('error.noSuchSource', { index: index + 1 }))
  if (!source.path) throw new Error(s.t('error.sourceNotLocated', { file: source.filename }))
  const { bytes, result } = await readSource(s, source.path, source.filename)
  s.replay?.rewind(0)
  s.replay = null
  const report = takeOver(s, source, bytes, result)
  await s.rebase()
  s.dirty = true
  return report
}

/**
 * Read a new version of source `index` from `path`, e.g. a re-export under another name: the source
 * and its points move to that file, then it is taken over as updateFromSource does. A file another
 * source already names is refused.
 */
export function replaceSource(s: Session, index: number, path: string): Promise<UpdateReport> {
  return s.exclusive(async () => {
    s.requireIdle()
    const project = s.requireProject()
    const source = project.header.ede_sources[index]
    if (!source) throw new Error(s.t('error.noSuchSource', { index: index + 1 }))
    const filename = basename(path)
    if (project.header.ede_sources.some((other) => other !== source && (other.path === path || other.filename === filename))) {
      throw new Error(s.t('error.sourceAlreadyListed', { file: filename }))
    }
    const { bytes, result } = await readSource(s, path, filename)
    s.replay?.rewind(0)
    s.replay = null
    for (const point of project.points) if (point.source.filename === source.filename) point.source.filename = filename
    Object.assign(source, { filename, path })
    const report = takeOver(s, source, bytes, result)
    await s.rebase()
    s.dirty = true
    return report
  })
}

/** Drop source `index` and its points; the steps stay and run again over what is left. Returns how many points went. */
export function removeSource(s: Session, index: number): Promise<number> {
  return s.exclusive(async () => {
    s.requireIdle()
    const project = s.requireProject()
    const source = project.header.ede_sources[index]
    if (!source) throw new Error(s.t('error.noSuchSource', { index: index + 1 }))
    s.replay?.rewind(0)
    s.replay = null
    const before = project.points.length
    project.points = project.points.filter((p) => p.source.filename !== source.filename)
    project.header.ede_sources.splice(index, 1)
    await s.rebase()
    s.dirty = true
    return before - project.points.length
  })
}

async function readSource(s: Session, path: string, filename: string): Promise<{ bytes: Uint8Array; result: ReturnType<typeof parseEde> }> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(path))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new Error(code === 'ENOENT' || code === 'ENOTDIR'
      ? s.t('error.sourceMissing', { file: filename, path })
      : s.t('error.sourceUnreadable', { file: filename, path, reason: (e as Error).message }))
  }
  try {
    return { bytes, result: parseEde(bytes, { filename }) }
  } catch (e) {
    throw e instanceof CodedError ? new Error(s.t(`parse.${e.code}`, e.params)) : e
  }
}

/** Take a parsed file over into `source`'s points; the caller has rewound the replay and runs it again after. */
function takeOver(s: Session, source: EdeSource, bytes: Uint8Array, result: ReturnType<typeof parseEde>): UpdateReport {
  const project = s.requireProject()
  const report: UpdateReport = { updated: 0, added: 0, missing: 0, warnings: result.warnings.map((w) => s.t(`parse.${w.code}`, w.params)) }
  // Matched only against this file's points: a point another file brought stays that file's.
  const existing = new Map(project.points.filter((p) => p.source.filename === source.filename).map((p) => [pointKey(p.ede), p]))
  const elsewhere = new Set(project.points.filter((p) => p.source.filename !== source.filename).map((p) => pointKey(p.ede)))
  const inFile = new Map<string, DataPoint>()
  const skipped: DataPoint[] = []
  const inOthers: DataPoint[] = []
  for (const fresh of result.points) {
    const key = pointKey(fresh.ede)
    const first = inFile.get(key)
    if (first) {
      first.source.duplicated_keyname = true
      skipped.push(fresh)
      continue
    }
    if (elsewhere.has(key)) {
      inOthers.push(fresh)
      continue
    }
    const point = existing.get(key)
    if (point) {
      // Key order differs between a stored and a freshly read point, so compare by content.
      if (!isDeepStrictEqual([point.ede, point.source.invalid], [fresh.ede, fresh.source.invalid])) report.updated++
      point.ede = fresh.ede
      point.source = { ...point.source, invalid: fresh.source.invalid, duplicated_keyname: false, missing_from_source: false }
      inFile.set(key, point)
    } else {
      fresh.source = { ...fresh.source, type: 'ede', filename: source.filename }
      project.points.push(fresh)
      inFile.set(key, fresh)
      report.added++
    }
  }
  if (skipped.length) report.warnings.push(s.t('parse.DUPLICATES_SKIPPED', duplicateSummary(skipped)))
  if (inOthers.length) report.warnings.push(s.t('parse.EXISTING_SKIPPED', duplicateSummary(inOthers)))
  for (const point of project.points) {
    if (point.source.filename !== source.filename || inFile.has(pointKey(point.ede))) continue
    point.source.missing_from_source = true
    report.missing++
  }
  Object.assign(source, { imported_at: new Date().toISOString(), meta: result.meta, ...fingerprint(bytes) })
  return report
}
