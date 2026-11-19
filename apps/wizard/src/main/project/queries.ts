/** Reading the project: point pages, counts, statistics, valid options and exports. */

import {
  BACTWIN_FIELDS,
  applyFilter,
  countFilter,
  emptyFilter,
  datapointsJson,
  datapointsTable,
  exportReplacementCsv,
  getFieldValue,
  hasError,
  markDuplicateNames,
  pointKey,
  narrowForTable,
  replacementRows,
  serializeDataPoint,
  validOptionsBulk,
  validOptionsFree,
  validOptionsGewerkSpecific,
  type DataPoint,
  type ExportOptions,
  type FilterDsl,
  type SerializedDataPoint,
} from '@bactwin/mapping-engine'

import type { Session } from './session.js'
import { tableToXlsx } from './xlsx.js'

export interface PointsRequest {
  filter?: FilterDsl
  page?: number
  page_size?: number
  sort?: string | null
  sort_desc?: boolean
}

export interface PointsResponse {
  items: SerializedDataPoint[]
  /** Per item, the fields more than one step changed, with those steps in order; null when none did. */
  collisions: (Record<string, number[]> | null)[]
  total: number
  filtered: number
  page: number
  page_count: number
}

export interface Stats {
  total: number
  filtered: number
  ignore: number
  doNotParse: number
  review: number
  translation_complete: number
  combinations_valid: number
  valid_bactwin_rules: number
  duplicated_name: number
  errors: number
  fields_set: number
  fields_total: number
  field_fill_pct: Record<string, number>
}

export type ExportFormat = 'replacement' | 'xlsx' | 'json'

/** The core name fields; the optional sub-plant index is counted only where set. */
const STATS_FIELDS = BACTWIN_FIELDS.filter((f) => f.counted).map((f) => f.id)

const isSet = (value: unknown) => value !== null && value !== undefined && value !== ''

const collator = new Intl.Collator('de', { numeric: true })

/** `points` ordered by `field`: numbers as numbers, text in German order with numbers in it as numbers, empty values last either way. */
export function sortPoints<T>(items: T[], field: string, desc: boolean, point: (item: T) => DataPoint = (p) => p as DataPoint): T[] {
  const sign = desc ? -1 : 1
  return [...items].sort((a, b) => {
    const av = getFieldValue(point(a), field)
    const bv = getFieldValue(point(b), field)
    if (!isSet(av) || !isSet(bv)) return isSet(av) ? -1 : isSet(bv) ? 1 : 0
    return sign * (typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv)))
  })
}

// The sorted list, kept while the same blocks of a list are fetched one after another.
const sortCache = new WeakMap<Session, { key: string; points: DataPoint[] }>()

export function points(s: Session, req: PointsRequest): PointsResponse {
  if (!s.project) return { items: [], collisions: [], total: 0, filtered: 0, page: 1, page_count: 1 }
  const all = s.project.points
  markDuplicateNames(all)

  const filtered = applyFilter(all, req.filter ?? emptyFilter())
  let sorted = filtered
  if (req.sort) {
    const key = JSON.stringify([req.filter, req.sort, req.sort_desc, s.replay?.version, all.length])
    const hit = sortCache.get(s)
    sorted = hit?.key === key ? hit.points : sortPoints(filtered, req.sort, !!req.sort_desc)
    sortCache.set(s, { key, points: sorted })
  }

  const pageSize = req.page_size ?? 50
  const page = req.page ?? 1
  const start = (page - 1) * pageSize
  const shown = sorted.slice(start, start + pageSize)
  const replay = s.replay
  return {
    items: shown.map(serializeDataPoint),
    collisions: shown.map((p) => {
      const index = replay?.indexOfPoint(p)
      const cells = index === undefined ? {} : replay!.collidedCells(index)
      return Object.keys(cells).length ? cells : null
    }),
    total: all.length,
    filtered: filtered.length,
    page,
    page_count: Math.max(1, Math.ceil(filtered.length / pageSize)),
  }
}

export function pointsByKeys(s: Session, keys: string[]): { items: SerializedDataPoint[] } {
  if (!s.project) return { items: [] }
  const wanted = new Set(keys)
  return { items: s.project.points.filter((p) => wanted.has(pointKey(p.ede))).map(serializeDataPoint) }
}

export function count(s: Session, filter: FilterDsl): { total: number; filtered: number } {
  if (!s.project) return { total: 0, filtered: 0 }
  markDuplicateNames(s.project.points)
  return { total: s.project.points.length, filtered: countFilter(s.project.points, filter) }
}

/** Points marked ignore count towards the status counts but not towards the progress and quality ratios. */
export function stats(s: Session, filter?: FilterDsl): Stats {
  if (!s.project) {
    return {
      total: 0, filtered: 0, ignore: 0, doNotParse: 0, review: 0, translation_complete: 0,
      combinations_valid: 0, valid_bactwin_rules: 0, duplicated_name: 0, errors: 0,
      fields_set: 0, fields_total: 0, field_fill_pct: {},
    }
  }
  const all = s.project.points
  markDuplicateNames(all)
  const relevant = all.filter((p) => p.state.command !== 'ignore')
  const bt = (p: DataPoint) => p.bactwin as unknown as Record<string, unknown>

  const fieldsSet = relevant.reduce((sum, p) => sum + STATS_FIELDS.filter((f) => isSet(bt(p)[f])).length, 0)
  // The optional sub-plant index adds to numerator and denominator only where set.
  const subSet = relevant.filter((p) => isSet(bt(p)['sub_anlage_number'])).length
  const fieldFill: Record<string, number> = {}
  for (const f of STATS_FIELDS) {
    fieldFill[f] = relevant.length ? (relevant.filter((p) => isSet(bt(p)[f])).length / relevant.length) * 100 : 0
  }

  return {
    total: all.length,
    filtered: filter ? countFilter(all, filter) : all.length,
    ignore: all.length - relevant.length,
    doNotParse: all.filter((p) => p.state.command === 'doNotParse').length,
    review: all.filter((p) => p.state.review).length,
    translation_complete: relevant.filter((p) => p.state.translation_complete).length,
    combinations_valid: all.filter((p) => p.state.combinations_valid === true).length,
    valid_bactwin_rules: all.filter((p) => p.state.valid_bactwin_rules).length,
    duplicated_name: all.filter((p) => p.state.duplicated_name).length,
    errors: all.filter(hasError).length,
    fields_set: fieldsSet + subSet,
    fields_total: relevant.length * STATS_FIELDS.length + subSet,
    field_fill_pct: fieldFill,
  }
}

export function validOptions(s: Session, req: {
  field: string
  mode: 'free' | 'combination' | 'gewerk_specific'
  filter?: FilterDsl
  overrides?: Record<string, string>
}): { valid_for_all: string[]; valid_for_some: string[]; all_options: string[] } {
  const ref = s.requireReferenceData()
  const selected = s.project ? applyFilter(s.project.points, req.filter ?? emptyFilter()) : []
  const all = validOptionsFree(req.field, ref)
  if (req.mode === 'free') return { valid_for_all: all, valid_for_some: all, all_options: all }
  const result = req.mode === 'combination'
    ? validOptionsBulk(selected, req.field, ref, req.overrides, true)
    : validOptionsGewerkSpecific(selected, req.field, ref, req.overrides)
  return { ...result, all_options: all }
}

/** Which points an export starts from: all, what the view filter lists, or what a step's Wenn selected. */
export interface ExportRequest {
  scope: 'all' | 'view' | 'step'
  /** The view filter, for 'view'. */
  filter?: FilterDsl
  /** The step, for 'step'. */
  step?: number
  options: ExportOptions
}

function scopePoints(s: Session, scope: ExportRequest['scope'], req: ExportRequest): DataPoint[] {
  const points = s.requireProject().points
  if (scope === 'view') return applyFilter(points, req.filter ?? emptyFilter())
  if (scope === 'step') return Array.from(s.replay?.outcome(req.step ?? -1)?.hits ?? [], (i) => points[i]!)
  return points
}

/** Per scope its points; for the chosen one, what the table would write and the replacement table's rows. */
export function exportCounts(s: Session, req: ExportRequest) {
  const chosen = scopePoints(s, req.scope, req)
  const { rows, ...replacement } = replacementRows(chosen, req.options.ignore)
  return {
    scopes: { all: scopePoints(s, 'all', req).length, view: scopePoints(s, 'view', req).length, step: scopePoints(s, 'step', req).length },
    table: narrowForTable(chosen, req.options.complete).length,
    replacement: { rows: rows.length, ...replacement },
  }
}

/** The export's content; what it leaves out the dialog names before. */
export async function exportFile(s: Session, format: ExportFormat, req: ExportRequest): Promise<Uint8Array> {
  const project = s.requireProject()
  const chosen = scopePoints(s, req.scope, req)
  if (format === 'replacement') return new TextEncoder().encode(exportReplacementCsv(chosen, req.options.ignore).content)
  const selected = narrowForTable(chosen, req.options.complete)
  if (format === 'json') return new TextEncoder().encode(datapointsJson(project.points, selected))
  const { columns, rows } = datapointsTable(project.points, selected)
  return tableToXlsx(s.t('files.datapointSheet'), columns, rows)
}
