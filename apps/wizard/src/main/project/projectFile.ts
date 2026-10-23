/** Reading and writing the .bactwin project file; its format is projectSchema.ts. */

import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { DataPointSchema, emptyDataPoint, isNewer, pointKey, type DataPoint } from '@bactwin/mapping-engine'

import { writeFileSafely } from './files.js'
import { duplicateSummary } from './importing.js'
import { PROJECT_FORMAT_VERSION, PROJECT_SCHEMA_URL, ProjectFileSchema, type StoredPoint } from './projectSchema.js'
import { applyProjectPlugins } from './reference.js'
import { readBlock, sequencePathFor, writeBlock } from './sequence.js'
import { emptyProject, type ReferenceStamp, type SequenceBlock, type Session } from './session.js'
import { fingerprint, resolvedSources, storedSources } from './sources.js'

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The template and enabled plugins in use now, as stored in a saved project. */
export function referenceStamp(s: Session): ReferenceStamp {
  return {
    template: s.requireReferenceData().nameTemplate.version,
    plugins: [...s.plugins.filter((p) => p.enabled).map((p) => ({ id: p.id, version: p.version })), ...s.missingPlugins],
  }
}

/** How the current reference data differs from what a file was saved with; empty if the same. */
export function referenceChanges(s: Session, saved: ReferenceStamp | undefined): string[] {
  if (!saved) return []
  const { t } = s
  const now = referenceStamp(s)
  const out: string[] = []
  if (saved.template !== now.template) out.push(t('reference.template', { saved: saved.template, now: now.template }))
  const installed = new Map(s.plugins.filter((p) => p.enabled).map((p) => [p.id, p.version]))
  for (const p of saved.plugins) {
    const version = installed.get(p.id)
    if (version === undefined) out.push(t('reference.pluginMissing', { id: p.id, version: p.version }))
    else if (version !== p.version) out.push(t('reference.pluginVersion', { id: p.id, saved: p.version, now: version }))
  }
  return out
}

/** What a point stores: where it came from and the imported row. Its translation is the sequence's result. */
function storedPoint(p: DataPoint): StoredPoint {
  const { type: _type, ...source } = p.source
  return { source: { ...source, invalid: { ...source.invalid } }, ede: { ...p.ede } }
}

// A field equal to what loading fills in; `false` is not the default of a yes/no EDE cell, which is null.
const DEFAULTS = storedPoint(emptyDataPoint()) as unknown as Record<string, Json>
const isDefault = (area: string, key: string, v: unknown) => JSON.stringify(v) === JSON.stringify(DEFAULTS[area]?.[key])

/** A stored point without the fields at their default, which loading fills back in. */
function compactPoint(p: StoredPoint): Json {
  const out: Json = {}
  for (const [area, fields] of Object.entries(p)) {
    // source.filename is required, so it is always written.
    const kept = Object.entries(fields as Json).filter(([key, v]) => (area === 'source' && key === 'filename') || !isDefault(area, key, v))
    if (kept.length) out[area] = Object.fromEntries(kept)
  }
  return out
}

/** A path as stored in the project file: relative to it with / separators, or absolute on another drive. */
function storedPath(path: string, projectPath: string): string {
  const rel = relative(dirname(projectPath), path)
  return isAbsolute(rel) ? path : rel.split(sep).join('/')
}

/**
 * The project file in pieces: the header on its own line, then one point per line.
 * Each piece stays small, so a project of any size can be written without building one huge string.
 */
export function* projectChunks(s: Session, projectPath: string | null): Generator<string> {
  const project = s.requireProject()
  // Spelled out, so the order of the keys does not depend on how the project was created.
  const header = {
    project_name: project.header.project_name,
    ede_sources: storedSources(project.header.ede_sources, projectPath),
    sequences: s.blocks.filter((b) => b.path).map((b) => ({ path: projectPath ? storedPath(b.path!, projectPath) : b.path! })),
    reference: referenceStamp(s),
    ...(project.header.layout ? { layout: project.header.layout } : {}),
  }
  yield `{"$schema":${JSON.stringify(PROJECT_SCHEMA_URL)},\n"schema_version":${JSON.stringify(PROJECT_FORMAT_VERSION)},\n"header":${JSON.stringify(header)},\n"points":[`
  for (let i = 0; i < project.points.length; i++) {
    yield `${i === 0 ? '' : ','}\n${JSON.stringify(compactPoint(storedPoint(project.points[i] as DataPoint)))}`
  }
  yield `\n]}\n`
}

/** The project file as saved at `projectPath`, which paths are relative to; by default where it was last saved. */
export function serializeProject(s: Session, projectPath = s.projectPath): string {
  return [...projectChunks(s, projectPath)].join('')
}

/**
 * Write the project to `path`, safely. A block created before the first save gets its sequence file
 * beside the project now.
 */
export async function writeProject(s: Session, path: string): Promise<void> {
  for (const block of s.blocks.filter((b) => !b.path)) {
    block.path = await sequencePathFor(s, path, false)
    await writeBlock(block)
  }
  const hash = createHash('sha256')
  let size = 0
  function* hashed() {
    for (const chunk of projectChunks(s, path)) {
      const bytes = Buffer.from(chunk, 'utf8')
      hash.update(bytes)
      size += bytes.length
      yield chunk
    }
  }
  await writeFileSafely(path, hashed())
  s.projectStamp = { size, sha256: hash.digest('hex') }
}

/** Points sharing an identity with an earlier one. A file edited by hand can contain them; they are kept, not merged. */
function sharedIdentities(points: DataPoint[]): DataPoint[] {
  const seen = new Set<string>()
  return points.filter((p) => {
    const key = pointKey(p.ede)
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })
}

/** Check a file of the current format; unknown fields are refused. */
function parseCurrent(s: Session, data: unknown) {
  const parsed = ProjectFileSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const keys = i.code === 'unrecognized_keys' ? ` (${i.keys.join(', ')})` : ''
      return `${i.path.join('.') || '/'}: ${i.message}${keys}`
    })
    const shown = issues.slice(0, 5).join('; ') + (issues.length > 5 ? '; …' : '')
    throw new Error(s.t('error.projectInvalid', { version: PROJECT_FORMAT_VERSION, issues: shown }))
  }
  return parsed.data
}

/** A project saved by a newer version, in a format this one cannot save again without losing what is new. */
export class ProjectTooNewError extends Error {
  constructor(readonly version: string) {
    super(`project format ${version} is newer than ${PROJECT_FORMAT_VERSION}`)
  }
}

export interface LoadResult {
  total: number
  referenceChanges: string[]
  /** Set when points share an identity, as a message to show. */
  duplicates: string | null
  /** Sequence files that were not found; their steps are missing. */
  missingSequences: string[]
}

/** Replace the session's project with a file's content and replay its sequence; nothing changes if the file is rejected. */
export function loadProject(s: Session, content: string, path: string | null): Promise<LoadResult> {
  return s.exclusive(async () => {
    const raw: unknown = JSON.parse(content)
    const version = isObject(raw) && typeof raw['schema_version'] === 'string' ? raw['schema_version'] : null
    // A newer file, minor versions included, would lose what is new when saved again.
    if (version && isNewer(version, PROJECT_FORMAT_VERSION)) throw new ProjectTooNewError(version)

    const file = parseCurrent(s, raw)
    const { sequences, ...header } = file.header
    const project = emptyProject()
    project.header = { ...header, ede_sources: resolvedSources(header.ede_sources, path) }
    project.points = file.points.map((p) => DataPointSchema.parse({ ...p, source: { ...p.source, type: 'ede' } }))
    const base = path ? dirname(path) : process.cwd()
    const blocks = await Promise.all(sequences.map((seq) => readBlock(resolve(base, seq.path))))

    s.reset()
    applyProjectPlugins(s, header.reference?.plugins)
    s.project = project
    s.blocks = blocks
    s.projectPath = path
    s.projectStamp = fingerprint(Buffer.from(content, 'utf8'))
    s.recomputeAll()
    await s.replayFrom(0)
    s.dirty = false

    const shared = sharedIdentities(project.points)
    return {
      total: project.points.length,
      referenceChanges: referenceChanges(s, header.reference),
      duplicates: shared.length ? s.t('dialog.duplicatesDetail', duplicateSummary(shared)) : null,
      missingSequences: blocks.filter((b) => b.missing).map((b) => b.path!),
    }
  })
}
