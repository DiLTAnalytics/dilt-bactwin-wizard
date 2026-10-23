/**
 * The imported EDE files behind a project. Their data is in the project, so a source is never needed
 * to open it; the recorded location and checksum only tell whether the file is still there and
 * unchanged. In memory a source's path is absolute; in the file it is relative to the project file,
 * or absolute when it is on another drive.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { EdeSource, Session } from './session.js'

export type SourceState = 'current' | 'changed' | 'missing' | 'unreadable' | 'unknown'

export interface SourceStatus {
  index: number
  filename: string
  /** Absolute; null when the project stores no location for it. */
  path: string | null
  imported_at: string | null
  state: SourceState
  /** Points the project has from this file. */
  points: number
}

export function fingerprint(bytes: Uint8Array): { sha256: string; size: number } {
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
}

/** Sources as stored next to `projectPath`: relative, or absolute for a path that cannot be (another drive). */
export function storedSources(sources: EdeSource[], projectPath: string | null): EdeSource[] {
  return sources.map(({ path, ...rest }) => {
    if (!path || !projectPath) return rest
    const rel = relative(dirname(projectPath), path)
    return { ...rest, path: isAbsolute(rel) ? path : rel.split(sep).join('/') }
  })
}

/** Stored relative paths made absolute against the project file's folder. */
export function resolvedSources(sources: EdeSource[], projectPath: string | null): EdeSource[] {
  return sources.map(({ path, ...rest }) => (path && projectPath ? { ...rest, path: resolve(dirname(projectPath), path) } : rest))
}

export async function stateOf(source: EdeSource): Promise<SourceState> {
  if (!source.path || !source.sha256) return 'unknown'
  try {
    return fingerprint(await readFile(source.path)).sha256 === source.sha256 ? 'current' : 'changed'
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unreadable'
  }
}

export async function sourceStatuses(s: Session): Promise<SourceStatus[]> {
  const sources = s.project?.header.ede_sources ?? []
  const counts = new Map<string, number>()
  for (const p of s.project?.points ?? []) counts.set(p.source.filename, (counts.get(p.source.filename) ?? 0) + 1)
  return Promise.all(sources.map(async (source, index) => ({
    index,
    filename: source.filename,
    path: source.path ?? null,
    imported_at: source.imported_at ?? null,
    state: await stateOf(source),
    points: counts.get(source.filename) ?? 0,
  })))
}

/** Record where a source is now. A source imported without a checksum takes the located file's. */
export async function locateSource(s: Session, index: number, path: string): Promise<SourceStatus[]> {
  const source = s.requireProject().header.ede_sources[index]
  if (!source) throw new Error(s.t('error.noSuchSource', { index: index + 1 }))
  source.path = path
  if (!source.sha256) Object.assign(source, fingerprint(await readFile(path)))
  s.dirty = true
  return sourceStatuses(s)
}
