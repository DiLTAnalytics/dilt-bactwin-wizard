/**
 * What a step would do before it is saved: which points its filter hits, condition by condition, which
 * it almost hits, which it misses, and the values it would change. Runs on the data as it is before
 * the step, never touching the project.
 */

import {
  WRITABLE_FIELDS,
  applyActions,
  applyFilter,
  compileCondition,
  expandTemplate,
  markDuplicateNames,
  pointKey,
  serializeDataPoint,
  sourceMatches,
  toCondition,
  validateAndUpdate,
  type DataPoint,
  type FilterDsl,
  type SerializedDataPoint,
  type SetAction,
} from '@bactwin/mapping-engine'

import { sortPoints } from './queries.js'
import type { Session } from './session.js'

export type PreviewMode = 'hits' | 'near' | 'missed'

export interface PreviewRequest {
  /** The step being edited, or where a new step goes; null for a new step after the last one. */
  index: number | null
  /** A new step at `index`, rather than the step there. */
  isNew?: boolean
  filter: FilterDsl
  actions: SetAction[]
  mode: PreviewMode
  /** For 'missed': the data before this step, or as imported. */
  context?: 'before' | 'import'
  /** Narrows what is listed, never what the step does. */
  view?: FilterDsl
  page?: number
  page_size?: number
  /** The field the listed points are ordered by, as area.field. */
  sort?: string | null
  sort_desc?: boolean
  /** The hit whose source matches to show, by point key; otherwise each action shows the first hit all its sources match. */
  example?: string
}

/** What the sources of the step's actions match. */
export interface SourceCheck {
  /** Per action, per source: hits where its regex does not match; empty for an action without sources. */
  misses: number[][]
  /**
   * Per action, one hit as the action finds it: each source's groups (null where it does not match) and
   * the value written (null: skipped); null for an action without sources or a step without hits.
   */
  examples: ({ key: string; name: string; sources: (string[] | null)[]; value: string | null } | null)[]
  /** Hits that some action's sources skipped. */
  skipped: Set<number>
}

export interface PreviewRow {
  point: SerializedDataPoint
  /** The BACtwin name before the step ('hits' only, when the step changes it). */
  beforeName: string | null
  /** The values the step changes on this point, as they were before it ('hits' only). */
  before: Record<string, unknown>
  /** Whether each condition holds. */
  conditions: boolean[]
  /** Per changed field: the earlier step whose value it replaces, and the later step that replaces its own ('hits' only). */
  collisions: Record<string, CellCollision>
}

export interface CellCollision {
  overwrites: number | null
  overwrittenBy: number | null
}

export interface PreviewCounts {
  /** Points each condition alone selects. */
  conditions: number[]
  hits: number
  /** Hits the step would change, hits a source skipped, and hits that already have its values. */
  changed: number
  skipped: number
  same: number
  /** Points failing exactly one of two or more conditions. */
  near: number
  missed: number
  total: number
}

export interface PreviewResponse {
  counts: PreviewCounts
  items: PreviewRow[]
  filtered: number
  page: number
  page_count: number
  /** For 'missed': the missed points by device, largest first. */
  groups: { device: number | null; count: number }[]
  sources: Omit<SourceCheck, 'skipped'>
}

const read = (p: DataPoint, field: string) => {
  const [a, f] = field.split('.') as [string, string]
  return (p as unknown as Record<string, Record<string, unknown>>)[a]![f]
}

/** A copy that writes can go to without reaching the project; only the written areas are copied. */
const writable = (p: DataPoint): DataPoint => ({ ...p, bactwin: { ...p.bactwin }, state: { ...p.state } })

const cache = new WeakMap<Session, { key: string; points: DataPoint[] }>()

/** The points as they were before step `k` (0: as imported), copied, revalidated and with duplicates marked; cached. */
function pointsBefore(s: Session, k: number): DataPoint[] {
  const project = s.requireProject()
  const replay = s.replay
  if (!replay || k >= replay.applied) return project.points
  const key = `${k}:${replay.version}`
  const hit = cache.get(s)
  if (hit?.key === key) return hit.points
  const ref = s.requireReferenceData()
  const before = replay.valuesBefore(k)
  const changed: DataPoint[] = []
  const points = project.points.map((p, i) => {
    const values = before.get(i)
    const copy = writable(p)
    if (values) {
      for (const [field, value] of Object.entries(values)) {
        const [a, f] = field.split('.') as [string, string]
        ;(copy as unknown as Record<string, Record<string, unknown>>)[a]![f] = value
      }
      changed.push(copy)
    }
    return copy
  })
  validateAndUpdate(changed, ref)
  markDuplicateNames(points)
  cache.set(s, { key, points })
  return points
}

/** Collects a SourceCheck while the step's actions run on `after`; `chosen` is the hit to show, -1 for none. */
function checkSources(after: DataPoint[], chosen: number) {
  const check: SourceCheck = { misses: [], examples: [], skipped: new Set() }
  const beforeEach = (action: SetAction, index: number) => {
    check.misses[index] = []
    check.examples[index] = null
    if (!action.from) return
    let compiled: RegExp[]
    try {
      compiled = action.from.map((source) => new RegExp(source.regex, 'i'))
    } catch {
      return
    }
    const misses = action.from.map(() => 0)
    const matches = after.map((p) => sourceMatches(p, action.from!, compiled))
    let firstFull = -1
    matches.forEach((m, h) => {
      m.forEach((g, i) => { if (g === null) misses[i]! += 1 })
      if (m.some((g) => g === null)) check.skipped.add(h)
      else if (firstFull === -1) firstFull = h
    })
    check.misses[index] = misses
    const shown = chosen >= 0 ? chosen : Math.max(0, firstFull)
    const example = after[shown]
    if (example) {
      const groups = matches[shown]!
      const value = groups.some((g) => g === null) ? null : expandTemplate(String(action.value), groups.flat() as string[])
      check.examples[index] = { key: pointKey(example.ede), name: example.ede.object_name, sources: groups, value }
    }
  }
  return { check, beforeEach }
}

export function preview(s: Session, req: PreviewRequest): PreviewResponse {
  const ref = s.requireReferenceData()
  const total = s.sequence.steps.length
  const k = req.index ?? total
  const points = pointsBefore(s, k)
  const conditions = req.filter.rules.map(toCondition)
  const tests = conditions.map(compileCondition)

  const results = points.map((p) => tests.map((test) => test(p)))
  const countsPerCondition = tests.map((_, c) => results.reduce((n, r) => n + (r[c] ? 1 : 0), 0))
  const hitIndex: number[] = []
  const nearIndex: number[] = []
  results.forEach((r, i) => {
    const failed = r.filter((ok) => !ok).length
    if (failed === 0) hitIndex.push(i)
    else if (failed === 1 && r.length >= 2) nearIndex.push(i)
  })

  // The step on copies of the hits: what it would change.
  const after = hitIndex.map((i) => writable(points[i]!))
  const sources = checkSources(after, hitIndex.findIndex((i) => pointKey(points[i]!.ede) === req.example))
  if (req.actions.length) applyActions(after, req.actions, ref, sources.beforeEach)
  const beforeValues = hitIndex.map((i, h) => {
    const changes: Record<string, unknown> = {}
    for (const field of WRITABLE_FIELDS) {
      const old = read(points[i]!, field)
      if (read(after[h]!, field) !== old) changes[field] = old
    }
    return changes
  })
  const changed = beforeValues.filter((v) => Object.keys(v).length > 0).length
  const skipped = [...sources.check.skipped].filter((h) => Object.keys(beforeValues[h]!).length === 0).length

  // Other steps changing the same cells: the last one before this step, and the first one after it.
  const collide = (i: number, before: Record<string, unknown>) => {
    const out: Record<string, CellCollision> = {}
    for (const field of Object.keys(before)) {
      const writers = s.replay?.cellWriters(i, field) ?? []
      const overwrites = writers.filter((w) => w < k).at(-1) ?? null
      const overwrittenBy = writers.find((w) => (req.isNew ? w >= k : w > k)) ?? null
      if (overwrites !== null || overwrittenBy !== null) out[field] = { overwrites, overwrittenBy }
    }
    return out
  }

  let rows: { point: DataPoint; before: Record<string, unknown>; beforeName?: string; conditions: boolean[]; index?: number }[]
  let groups: PreviewResponse['groups'] = []
  if (req.mode === 'hits') {
    rows = hitIndex.map((i, h) => ({ point: after[h]!, before: beforeValues[h]!, beforeName: points[i]!.bactwin.bactwin_name, conditions: results[i]!, index: i }))
  } else if (req.mode === 'near') {
    rows = nearIndex.map((i) => ({ point: points[i]!, before: {}, conditions: results[i]! }))
  } else {
    const base = req.context === 'import' ? pointsBefore(s, 0) : points
    const hitKeys = new Set(hitIndex)
    const baseTests = req.context === 'import' ? base.map((p) => tests.map((test) => test(p))) : results
    rows = base.flatMap((p, i) => (req.context === 'import' ? baseTests[i]!.every(Boolean) : hitKeys.has(i)) ? [] : [{ point: p, before: {}, conditions: baseTests[i]! }])
    const byDevice = new Map<number | null, number>()
    for (const r of rows) byDevice.set(r.point.ede.device_obj_instance, (byDevice.get(r.point.ede.device_obj_instance) ?? 0) + 1)
    groups = [...byDevice].map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count)
  }

  if (req.view && req.view.rules.length) {
    const visible = new Set(applyFilter(rows.map((r) => r.point), req.view))
    rows = rows.filter((r) => visible.has(r.point))
  }

  if (req.sort) rows = sortPoints(rows, req.sort, !!req.sort_desc, (r) => r.point)

  const pageSize = req.page_size ?? 50
  const page = req.page ?? 1
  const start = (page - 1) * pageSize
  return {
    counts: {
      conditions: countsPerCondition,
      hits: hitIndex.length,
      changed,
      skipped,
      same: hitIndex.length - changed - skipped,
      near: nearIndex.length,
      missed: points.length - hitIndex.length,
      total: points.length,
    },
    items: rows.slice(start, start + pageSize).map((r) => ({
      point: serializeDataPoint(r.point),
      before: r.before,
      beforeName: r.beforeName !== undefined && r.beforeName !== r.point.bactwin.bactwin_name ? r.beforeName : null,
      conditions: r.conditions,
      collisions: r.index === undefined ? {} : collide(r.index, r.before),
    })),
    filtered: rows.length,
    page,
    page_count: Math.max(1, Math.ceil(rows.length / pageSize)),
    groups,
    sources: { misses: sources.check.misses, examples: sources.check.examples },
  }
}

export interface HistoryEntry {
  step: number
  name: string | null
  /** Each change, with the earlier step whose value it replaced (null: the imported value). */
  changes: { field: string; before: unknown; after: unknown; overwrites: number | null }[]
}

/** The steps that changed a point, in order, with what each changed. */
export function pointHistory(s: Session, key: string): HistoryEntry[] {
  const project = s.requireProject()
  const index = project.points.findIndex((p) => pointKey(p.ede) === key)
  if (index < 0 || !s.replay) return []
  const steps = s.sequence.steps
  return s.replay.history(index).map(({ step, changes }) => ({
    step,
    name: steps[step]?.name ?? null,
    changes: changes.map(({ field, before, after }) => ({
      field, before, after, overwrites: s.replay!.cellWriters(index, field).filter((w) => w < step).at(-1) ?? null,
    })),
  }))
}
