/** A step's field rows (its "Dann" part), and how they turn into actions and back. */

import { BACTWIN_FIELDS, type BACtwinField, type BACtwinFieldId, type SetAction } from '@bactwin/mapping-engine'
import type { SourceCheck } from '@/hooks/usePreview'

/** EDE fields a transfer may take its value from (the format allows any; these are offered). */
export const TRANSFER_SOURCE_FIELDS = ['ede.object_name', 'ede.description', 'ede.keyname', 'ede.device_obj_instance', 'ede.object_instance']
const DEFAULT_SOURCE_FIELD = TRANSFER_SOURCE_FIELDS[0]!

/** 'transfer' takes the value from fields by regex: other fields, or the field itself to rewrite part of it. */
export type SetMode = 'set' | 'transfer'

export interface SourceRow {
  /** Stable React key, so sources keep their state when reordered. */
  key: number
  field: string
  pattern: string
}

export interface SetRow {
  /** Stable React key, so rows keep their state when reordered. */
  key: number
  field: BACtwinField
  value: string | null
  mode: SetMode
  sources: SourceRow[]
  /** What a transfer writes: `$1`-`$9` are the groups of all sources, counted in order. */
  template: string
}

export const fieldById = (id: string) => BACTWIN_FIELDS.find((f) => f.id === id)
/** Keys come from the catalogue; free text and numbers can be taken from fields. */
export const canTransfer = (f: BACtwinField) => f.kind !== 'key'
const isTransfer = (r: SetRow) => r.mode === 'transfer'

let nextKey = 0

export const emptySource = (field = DEFAULT_SOURCE_FIELD): SourceRow => ({ key: nextKey++, field, pattern: '' })

export const emptyRow = (field: BACtwinField): SetRow =>
  ({ key: nextKey++, field, value: null, mode: 'set', sources: [emptySource()], template: '$1' })

/** Settable: a value (an explicit empty included), or a pattern in every source. */
export function rowReady(r: SetRow): boolean {
  return isTransfer(r) ? r.sources.length > 0 && r.sources.every((s) => s.pattern !== '') : r.value !== null
}

export function toAction(r: SetRow): SetAction {
  const field = `bactwin.${r.field.id}`
  if (!isTransfer(r)) return { field, value: r.value! }
  return { field, from: r.sources.map((s) => ({ field: s.field, regex: s.pattern })), value: r.template }
}

/** A recorded action as a row, or null for fields the panel does not edit (flags, the comment). */
export function fromAction(a: SetAction): SetRow | null {
  const field = a.field.startsWith('bactwin.') ? fieldById(a.field.slice('bactwin.'.length)) : undefined
  if (!field) return null
  if (!a.from) return { ...emptyRow(field), value: String(a.value) }
  const sources = a.from.map((s) => ({ ...emptySource(s.field), pattern: s.regex }))
  return { ...emptyRow(field), mode: 'transfer', sources, template: String(a.value) }
}

/** Number of capture groups in `pattern`, or null when it is not a valid regex. */
export function groupCount(pattern: string): number | null {
  try {
    return new RegExp(`${pattern}|`).exec('')!.length - 1
  } catch {
    return null
  }
}

/** The group numbers each source fills (first and last, 1-based), or null for all when a pattern is invalid. */
export function sourceGroups(sources: SourceRow[]): ({ first: number; last: number } | null)[] {
  const counts = sources.map((s) => groupCount(s.pattern))
  if (counts.some((c) => c === null)) return sources.map(() => null)
  let next = 1
  return counts.map((c) => {
    const range = { first: next, last: next + c! - 1 }
    next += c!
    return range
  })
}

/**
 * `template` with each group number moved to where `order` puts its source: `order` lists the old
 * indexes of the sources in their new order; a group of a source left out of it is removed.
 * Unchanged when a pattern is invalid, since its groups are unknown.
 */
export function renumberTemplate(template: string, sources: SourceRow[], order: number[]): string {
  const old = sourceGroups(sources)
  if (old.some((g) => g === null)) return template
  const map = new Map<number, number>()
  let next = 1
  for (const i of order) {
    const g = old[i]!
    for (let n = g.first; n <= g.last; n++) map.set(n, next++)
  }
  return template.replace(/\$(\$|\d)/g, (m, c: string) => {
    if (c === '$' || c === '0') return m
    const to = map.get(Number(c))
    // A group past the last source's stays as written; one of a removed source goes.
    if (to === undefined) return Number(c) > old.at(-1)!.last ? m : ''
    return `$${to}`
  })
}

/** `row` with source `from` moved to index `to`, its template following. */
export function moveSource(row: SetRow, from: number, to: number): SetRow {
  const order = row.sources.map((_, i) => i)
  order.splice(to, 0, order.splice(from, 1)[0]!)
  return { ...row, sources: order.map((i) => row.sources[i]!), template: renumberTemplate(row.template, row.sources, order) }
}

/** `row` without source `i`; references to its groups leave the template. */
export function removeSource(row: SetRow, i: number): SetRow {
  const order = row.sources.map((_, j) => j).filter((j) => j !== i)
  return { ...row, sources: order.map((j) => row.sources[j]!), template: renumberTemplate(row.template, row.sources, order) }
}

/** What the preview says about one row's sources: hits each does not match, and one example point. */
export interface RowCheck {
  misses: number[]
  example: { name: string; sources: (string[] | null)[]; value: string | null } | null
}

/** Action `action`'s part of `check`; undefined while the preview is of a draft with other sources. */
export function sourceCheckOf(check: SourceCheck, action: number, sourceCount: number): RowCheck | undefined {
  const misses = check.misses[action]
  if (!misses || misses.length !== sourceCount) return undefined
  return { misses, example: check.examples[action] ?? null }
}

/** The group numbers `template` uses. */
export function usedGroups(template: string): Set<number> {
  return new Set([...template.matchAll(/\$(\$|\d)/g)].filter((m) => m[1] !== '$').map((m) => Number(m[1])))
}

/** Values set by the rows before `i`, which narrow the options offered for row `i`. */
export function overridesBefore(rows: SetRow[], i: number): Partial<Record<BACtwinFieldId, string>> {
  const out: Partial<Record<BACtwinFieldId, string>> = {}
  for (const r of rows.slice(0, i)) if (r.value && r.field.kind === 'key') out[r.field.id] = r.value
  return out
}
