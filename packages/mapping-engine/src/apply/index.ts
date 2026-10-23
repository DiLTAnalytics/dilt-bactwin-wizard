/** Writing values onto a selection of data points. */

import { getFieldValue, selectPoints, type FilterCondition } from '../filter/index.js'
import { markerCoupling, normalizeValue } from '../naming/fields.js'
import { BACTWIN_FIELDS } from '../naming/registry.js'
import type { ReferenceData } from '../reference/index.js'
import type { DataPoint } from '../types.js'
import { validateAndUpdate } from '../validate/index.js'

/** Flags an action can switch; their value is true or false. */
export const FLAG_FIELDS: readonly string[] = ['state.ignore', 'state.reminder']

/** Every field an action may write. Everything else is imported or derived. */
export const WRITABLE_FIELDS: readonly string[] = [...BACTWIN_FIELDS.map((f) => `bactwin.${f.id}`), 'state.comment', ...FLAG_FIELDS]

/** A field a write reads, and the regex that must match its value as text (absent is ""). */
export interface ActionSource {
  field: string
  regex: string
}

/**
 * One write. Without `from`, `value` is written as it is. With `from`, every source's regex must
 * match (case-insensitively unless inside `(?-i:...)`) or the point is skipped, and `value` is a
 * template: `$1`-`$9` are the capture groups of all sources, counted in order, `$$` a dollar sign.
 */
export interface SetAction {
  field: string
  value: string | boolean
  from?: ActionSource[]
}

export interface ApplyResult {
  matched: number
  changed: number
  skipped: number
}

/** `template` with `$1`-`$9` replaced from `groups` (group 1 first) and `$$` with a dollar sign. */
export function expandTemplate(template: string, groups: readonly (string | undefined)[]): string {
  return template.replace(/\$(\$|\d)/g, (_, c: string) => (c === '$' ? '$' : (groups[Number(c) - 1] ?? '')))
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/** Each source's capture groups on `point` (one that took no part as ""), or null where its regex does not match. */
export function sourceMatches(point: DataPoint, from: readonly ActionSource[], compiled: readonly RegExp[]): (string[] | null)[] {
  return compiled.map((re, i) => {
    const match = re.exec(text(getFieldValue(point, from[i]!.field)))
    return match ? match.slice(1).map((g) => g ?? '') : null
  })
}

/** The value an action writes onto `point`, or null when one of its sources does not match. */
function actionValue(point: DataPoint, action: SetAction, sources: RegExp[] | null): string | boolean | null {
  if (!sources) return action.value
  const groups = sourceMatches(point, action.from!, sources)
  if (groups.some((g) => g === null)) return null
  return expandTemplate(String(action.value), groups.flat() as string[])
}

function setNested(point: DataPoint, ref: ReferenceData, field: string, value: unknown): void {
  const dot = field.indexOf('.')
  const area = field.slice(0, dot)
  const attr = field.slice(dot + 1)
  const obj = (point as unknown as Record<string, unknown>)[area] as Record<string, unknown> | undefined
  if (!obj) return

  const normalized = normalizeValue(ref.nameTemplate, attr, value)
  obj[attr] = normalized

  const coupling = markerCoupling(ref.nameTemplate, attr, normalized)
  if (coupling) obj[coupling[0]] = coupling[1]
}

/**
 * Run `actions` on already selected points, then validate what changed. Combinations never block a write.
 * `beforeEach` sees the points as each action finds them, e.g. to show what its sources match.
 */
export function applyActions(
  targets: DataPoint[],
  actions: SetAction[],
  ref: ReferenceData,
  beforeEach?: (action: SetAction, index: number) => void,
): ApplyResult {
  const result: ApplyResult = { matched: targets.length, changed: 0, skipped: 0 }
  const touched = new Set<DataPoint>()

  for (const [index, action] of actions.entries()) {
    beforeEach?.(action, index)
    const flag = FLAG_FIELDS.includes(action.field)
    let sources: RegExp[] | null = null
    try {
      if (action.from) sources = action.from.map((source) => new RegExp(source.regex, 'i'))
    } catch {
      result.skipped += targets.length
      continue
    }
    for (const point of targets) {
      const value = actionValue(point, action, sources)
      // A flag already at the value, or a source that does not match, leaves the point alone.
      if (value === null || (flag && getFieldValue(point, action.field) === value)) {
        result.skipped += 1
        continue
      }
      setNested(point, ref, action.field, value)
      result.changed += 1
      if (!flag) touched.add(point)
    }
  }

  if (touched.size > 0) validateAndUpdate([...touched], ref)
  return result
}

/**
 * One step: the points matching every condition, selected once before anything is written (a
 * condition on a field an action writes must not change the selection midway), then the actions.
 */
export function applyStep(points: DataPoint[], filter: FilterCondition[], actions: SetAction[], ref: ReferenceData): ApplyResult {
  return applyActions(selectPoints(points, filter), actions, ref)
}
