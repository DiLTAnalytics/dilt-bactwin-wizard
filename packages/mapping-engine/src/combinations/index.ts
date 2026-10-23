/**
 * The combination catalogue: which BACtwin segment combinations occur together in practice. It
 * narrows the options offered and flags violations, but never blocks a write.
 */

import { COMBINATION_COLUMNS, isStructuralMarker, type ReferenceData } from '../reference/index.js'
import type { DataPoint } from '../types.js'

export type CombinationMode = 'free' | 'combination' | 'gewerk_specific'

export interface ValidOptions {
  valid_for_all: string[]
  valid_for_some: string[]
}

/** `ort` is free text and has no catalogue column. */
function combinationColumn(field: string): string | null {
  return field === 'ort' ? null : field
}

/**
 * A point's catalogue-relevant state. The EDE object_type and unit_code are included only when the
 * catalogue lists that value, or every trend log (which fits anywhere) would be a violation.
 */
export function bactwinToState(point: DataPoint, ref?: ReferenceData): Map<string, string> {
  const state = new Map<string, string>()
  for (const col of COMBINATION_COLUMNS) {
    const value = (point.bactwin as unknown as Record<string, string>)[col]
    if (value) state.set(col, value)
  }
  if (ref?.hasCombinations) {
    const ot = point.ede.object_type === null ? '' : String(point.ede.object_type)
    if (ot && ref.hasColumn('object_type') && ref.columnHasValue('object_type', ot)) {
      state.set('object_type', ot)
    }
    const uc = point.ede.unit_code === null ? '' : String(point.ede.unit_code)
    if (uc && ref.hasColumn('unit_code') && ref.columnHasValue('unit_code', uc)) {
      state.set('unit_code', uc)
    }
  }
  return state
}

function cacheKey(targetField: string, state: ReadonlyMap<string, string>, ref: ReferenceData): string {
  const pairs: string[] = []
  for (const [col, value] of state) {
    if (col !== targetField && ref.hasColumn(col) && value) pairs.push(`${col}=${value}`)
  }
  return `${targetField}|${pairs.sort().join('&')}`
}

/** Values the catalogue allows for one field, given everything already decided. */
export function validOptionsSingle(
  state: ReadonlyMap<string, string>,
  targetField: string,
  ref: ReferenceData,
  cache?: Map<string, string[]>,
): string[] {
  if (!ref.hasCombinations || !ref.hasColumn(targetField)) return []

  // Cached per distinct state: in a bulk operation many points share one.
  const key = cacheKey(targetField, state, ref)
  const hit = cache?.get(key)
  if (hit) return hit

  const narrowed = new Map<string, string>()
  for (const [col, value] of state) {
    if (col !== targetField && ref.hasColumn(col) && value) narrowed.set(col, value)
  }
  const rows = ref.matchingRows(narrowed)
  const result = rows === null ? [] : ref.valuesIn(rows, targetField)
  cache?.set(key, result)
  return result
}

function intersectUnion(sets: Set<string>[]): ValidOptions {
  if (sets.length === 0) return { valid_for_all: [], valid_for_some: [] }
  const all = new Set(sets[0])
  const some = new Set<string>()
  for (const s of sets) {
    for (const v of all) if (!s.has(v)) all.delete(v)
    for (const v of s) some.add(v)
  }
  return { valid_for_all: [...all].sort(), valid_for_some: [...some].sort() }
}

/** Options across a group of points: valid for all of them, and valid for some. */
export function validOptionsBulk(
  points: DataPoint[],
  targetField: string,
  ref: ReferenceData,
  overrides?: Record<string, string>,
  useLibraryFallback = false,
): ValidOptions {
  if (points.length === 0) return { valid_for_all: [], valid_for_some: [] }
  // A column the catalogue leaves empty in every row has no opinion; offer the whole library.
  if (useLibraryFallback && ref.hasCombinations && ref.columnIsAlwaysEmpty(targetField)) {
    const free = validOptionsFree(targetField, ref)
    return { valid_for_all: free, valid_for_some: free }
  }
  const cache = new Map<string, string[]>()
  return intersectUnion(points.map((p) => {
    const state = bactwinToState(p, ref)
    for (const [k, v] of Object.entries(overrides ?? {})) state.set(k, v)
    return new Set(validOptionsSingle(state, targetField, ref, cache))
  }))
}

export function isValidForPoint(
  point: DataPoint,
  targetField: string,
  value: string,
  ref: ReferenceData,
  cache?: Map<string, string[]>,
): boolean {
  // The not-present markers are valid everywhere, as validation treats them.
  if (isStructuralMarker(value)) return true
  return validOptionsSingle(bactwinToState(point, ref), targetField, ref, cache).includes(value)
}

/** Everything the library offers for the field, with no combination check at all. */
export function validOptionsFree(targetField: string, ref: ReferenceData): string[] {
  const block = combinationColumn(targetField)
  return block === null ? [] : ref.keysForBlock(block)
}

/**
 * Trades still plausible for what is set, per each key's `default_gewerk`; null when unrestricted.
 * An explicit `gewerk` wins, otherwise the intersection over every other set field.
 */
function gewerkeForState(state: ReadonlyMap<string, string>, ref: ReferenceData): Set<string> | null {
  const explicit = state.get('gewerk')
  if (explicit) return new Set([explicit])

  let candidates: Set<string> | null = null
  for (const [col, value] of state) {
    if (col === 'gewerk' || !value) continue
    const entry = ref.entry(col, value)
    if (!entry) continue
    const gewerke = new Set(entry.default_gewerk ?? [])
    if (gewerke.size === 0) continue
    if (candidates === null) {
      candidates = gewerke
    } else {
      const next = new Set<string>()
      for (const g of candidates) if (gewerke.has(g)) next.add(g)
      candidates = next
    }
  }
  return candidates
}

function typicalKeysForGewerke(
  block: string | null,
  gewerke: Set<string> | null,
  ref: ReferenceData,
): Set<string> {
  const out = new Set<string>()
  for (const entry of ref.library.values()) {
    if (entry.block !== block) continue
    if (!entry.source || !ref.activeSources.has(entry.source)) continue
    if (block === 'gewerk') {
      if (gewerke === null || gewerke.has(entry.key)) out.add(entry.key)
      continue
    }
    const entryGewerke = entry.default_gewerk ?? []
    // A key with no declared trade is trade-neutral and stays available.
    if (gewerke === null || entryGewerke.length === 0 || entryGewerke.some((g) => gewerke.has(g))) {
      out.add(entry.key)
    }
  }
  return out
}

export function isValidForGewerk(
  point: DataPoint,
  targetField: string,
  value: string,
  ref: ReferenceData,
): boolean {
  if (isStructuralMarker(value)) return true
  const state = bactwinToState(point)
  state.delete(targetField)
  const gewerke = gewerkeForState(state, ref)

  if (targetField === 'gewerk') return gewerke === null || gewerke.has(value)

  const entry = ref.entry(targetField, value)
  if (!entry) return false
  const entryGewerke = entry.default_gewerk ?? []
  return gewerke === null || entryGewerke.length === 0 || entryGewerke.some((g) => gewerke.has(g))
}

/** The middle strictness mode: looser than the catalogue, still not a free-for-all. */
export function validOptionsGewerkSpecific(
  points: DataPoint[],
  targetField: string,
  ref: ReferenceData,
  overrides?: Record<string, string>,
): ValidOptions {
  if (points.length === 0) return { valid_for_all: [], valid_for_some: [] }
  const block = combinationColumn(targetField)
  // Points share a handful of trade sets, so each set's library scan runs once, not per point.
  const byTrades = new Map<string, Set<string>>()
  const sets = points.map((p) => {
    const state = bactwinToState(p)
    for (const [k, v] of Object.entries(overrides ?? {})) state.set(k, v)
    if (block) state.delete(block)
    const gewerke = gewerkeForState(state, ref)
    const key = gewerke === null ? '*' : [...gewerke].sort().join('|')
    let keys = byTrades.get(key)
    if (!keys) byTrades.set(key, (keys = typicalKeysForGewerke(block, gewerke, ref)))
    return keys
  })
  return intersectUnion(sets)
}

export interface CombinationConflict {
  field: string
  value: string
  /** The fields before it, in catalogue order, which together still occur in the catalogue. */
  with: [string, string][]
}

/**
 * Why a combination is not in the catalogue: the first field, in catalogue order, whose value no row
 * allows together with the fields before it. Null when the combination occurs.
 */
export function combinationConflict(state: ReadonlyMap<string, string>, ref: ReferenceData): CombinationConflict | null {
  const before = new Map<string, string>()
  for (const [col, value] of state) {
    if (!ref.hasColumn(col) || !value || isStructuralMarker(value)) continue
    const rows = ref.matchingRows(new Map([...before, [col, value]]))
    if (rows !== null && rows.size === 0) return { field: col, value, with: [...before] }
    before.set(col, value)
  }
  return null
}

/** True when no catalogue row allows this combination. The not-present markers are left out of the check. */
export function combinationViolated(
  state: ReadonlyMap<string, string>,
  ref: ReferenceData,
  cache?: Map<string, boolean>,
): boolean {
  const relevant = new Map<string, string>()
  for (const [col, value] of state) {
    if (ref.hasColumn(col) && value && !isStructuralMarker(value)) relevant.set(col, value)
  }
  const key = [...relevant].map(([c, v]) => `${c}=${v}`).sort().join('&')
  const hit = cache?.get(key)
  if (hit !== undefined) return hit

  const rows = ref.matchingRows(relevant)
  const violated = rows !== null && rows.size === 0
  cache?.set(key, violated)
  return violated
}
