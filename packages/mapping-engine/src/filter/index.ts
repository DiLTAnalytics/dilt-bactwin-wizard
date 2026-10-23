/** The filter DSL: how a mapping decides which data points it applies to. */

import { z } from 'zod'
import { BACtwinDataSchema, EdeDataSchema, hasError, StateDataSchema, STATE_FLAGS, type DataPoint } from '../types.js'

export const FilterOperatorSchema = z.enum(['regex', 'equals', 'empty', 'is_true', 'is_false'])
export type FilterOperator = z.infer<typeof FilterOperatorSchema>

/** A condition as the filter panel edits it. Each one stands for exactly one regex (`conditionRegex`). */
export const FilterRuleSchema = z.object({
  field: z.string(),
  operator: FilterOperatorSchema,
  value: z.union([z.string(), z.array(z.string()), z.null()]).default(null),
  case_sensitive: z.boolean().default(false),
  negated: z.boolean().default(false),
})
export type FilterRule = z.infer<typeof FilterRuleSchema>

/** All rules must hold. There is no OR between rules; alternatives go inside one rule. */
export const FilterDslSchema = z.object({ rules: z.array(FilterRuleSchema).default([]) })
export type FilterDsl = z.infer<typeof FilterDslSchema>

export const emptyFilter = (): FilterDsl => ({ rules: [] })

/**
 * A condition as stored in a sequence: the field's value as text (absent is "") must match
 * `regex`, case-insensitively unless the regex says otherwise with `(?-i:...)`.
 */
export interface FilterCondition {
  field: string
  regex: string
}

/** Filterable `state.*` fields computed from the stored ones. */
export const DERIVED_STATE_FIELDS: Record<string, (point: DataPoint) => boolean> = {
  has_error: hasError,
  // Unchecked (null) is not invalid.
  combinations_invalid: (p) => p.state.combinations_valid === false,
  invalid_bactwin_rules: (p) => !p.state.valid_bactwin_rules,
}

/** Fields a view can search but a sequence cannot store, since they read several fields at once. */
export const VIEW_FIELDS: Record<string, (point: DataPoint) => string> = {
  'ede.name_or_description': (p) => `${p.ede.object_name ?? ''}\n${p.ede.description ?? ''}`,
}

/** Read `area.field` off a data point. Undefined for an unknown path rather than throwing. */
export function getFieldValue(point: DataPoint, field: string): unknown {
  if (field in VIEW_FIELDS) return VIEW_FIELDS[field]!(point)
  const dot = field.indexOf('.')
  const area = dot === -1 ? field : field.slice(0, dot)
  const attr = dot === -1 ? '' : field.slice(dot + 1)
  if (area === 'state' && attr in DERIVED_STATE_FIELDS) return DERIVED_STATE_FIELDS[attr]!(point)
  const obj = (point as unknown as Record<string, unknown>)[area]
  if (obj === undefined || obj === null || typeof obj !== 'object') return undefined
  return (obj as Record<string, unknown>)[attr]
}

/** Every field a filter condition or an action's `from` may read. */
export const READABLE_FIELDS: readonly string[] = [
  'source.type',
  'source.filename',
  'source.duplicated_keyname',
  'source.missing_from_source',
  ...Object.keys(EdeDataSchema.shape).map((f) => `ede.${f}`),
  'bacnet.type',
  'bacnet.unit',
  ...Object.keys(BACtwinDataSchema.shape).map((f) => `bactwin.${f}`),
  ...Object.keys(StateDataSchema.shape).filter((f) => f !== 'messages').map((f) => `state.${f}`),
  ...Object.keys(DERIVED_STATE_FIELDS).map((f) => `state.${f}`),
]

/** Fields holding true/false (or null), where "^true$" reads back as "is true" rather than equals. */
export const BOOLEAN_FIELDS = new Set<string>([
  ...STATE_FLAGS.map((f) => `state.${f}`),
  ...Object.keys(DERIVED_STATE_FIELDS).map((f) => `state.${f}`),
  'source.duplicated_keyname',
  'source.missing_from_source',
])

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const NOT_ANYWHERE = '^(?![\\s\\S]*(?:'

/** The anchored body of an equals: "|" separates trimmed alternatives. */
function equalsBody(value: string): string {
  const alts = value.split('|').map((a) => escapeRegex(a.trim()))
  return alts.length === 1 ? alts[0]! : `(?:${alts.join('|')})`
}

/**
 * The regex a rule stands for. Each operator has one fixed form, which `ruleFromCondition` reads
 * back; case-sensitivity wraps the whole form in `(?-i:...)`.
 */
export function conditionRegex(rule: FilterRule): string {
  const value = typeof rule.value === 'string' ? rule.value : (rule.value ?? []).join('|')
  switch (rule.operator) {
    case 'is_true': return rule.negated ? '^false$' : '^true$'
    case 'is_false': return rule.negated ? '^true$' : '^false$'
    case 'empty': return rule.negated ? '^(?!$)' : '^$'
    default: {
      const body = rule.operator === 'equals'
        ? (rule.negated ? `^(?!${equalsBody(value)}$)` : `^${equalsBody(value)}$`)
        : (rule.negated ? `${NOT_ANYWHERE}${value}))` : value)
      return rule.case_sensitive ? `(?-i:${body})` : body
    }
  }
}

export const toCondition = (rule: FilterRule): FilterCondition => ({ field: rule.field, regex: conditionRegex(rule) })

/** The equals value of an anchored body (`X` or `(?:A|B)`), or null when it holds regex syntax. */
function unescapeEquals(body: string): string | null {
  const inner = body.startsWith('(?:') && body.endsWith(')') ? body.slice(3, -1) : body
  let value = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '\\') value += inner[++i] ?? ''
    else if ('.*+?^${}()[]'.includes(c)) return null
    else value += c
  }
  return value
}

function candidates(field: string, regex: string): Omit<FilterRule, 'field'>[] {
  const caseSensitive = regex.startsWith('(?-i:') && regex.endsWith(')')
  const body = caseSensitive ? regex.slice(5, -1) : regex
  const rule = (operator: FilterOperator, value: string | null, negated = false) =>
    ({ operator, value, case_sensitive: caseSensitive, negated })
  const out: Omit<FilterRule, 'field'>[] = []
  if (BOOLEAN_FIELDS.has(field)) out.push(rule('is_true', null), rule('is_false', null))
  out.push(rule('empty', null), rule('empty', null, true))
  if (body.startsWith(NOT_ANYWHERE) && body.endsWith('))')) out.push(rule('regex', body.slice(NOT_ANYWHERE.length, -2), true))
  if (body.startsWith('^(?!') && body.endsWith('$)')) {
    const value = unescapeEquals(body.slice(4, -2))
    if (value !== null) out.push(rule('equals', value, true))
  }
  if (body.startsWith('^') && body.endsWith('$')) {
    const value = unescapeEquals(body.slice(1, -1))
    if (value !== null) out.push(rule('equals', value))
  }
  out.push(rule('regex', body))
  return out
}

/**
 * The rule a stored condition reads back as: the first form whose regex is exactly this one, so
 * saving it again writes the same regex. Anything else is a plain regex rule.
 */
export function ruleFromCondition({ field, regex }: FilterCondition): FilterRule {
  for (const c of candidates(field, regex)) {
    const rule = { field, ...c }
    if (conditionRegex(rule) === regex) return rule
  }
  return { field, operator: 'regex', value: regex, case_sensitive: false, negated: false }
}

export const toDsl = (conditions: FilterCondition[]): FilterDsl => ({ rules: conditions.map(ruleFromCondition) })

/** A compiled condition; an invalid regex (often half-typed) matches nothing. */
export function compileCondition({ field, regex }: FilterCondition): (point: DataPoint) => boolean {
  let re: RegExp
  try {
    re = new RegExp(regex, 'i')
  } catch {
    return () => false
  }
  return (point) => {
    const value = getFieldValue(point, field)
    return re.test(value === null || value === undefined ? '' : String(value))
  }
}

/** The points matching every condition. No conditions selects every point. */
export function selectPoints(points: DataPoint[], conditions: FilterCondition[]): DataPoint[] {
  if (conditions.length === 0) return points
  const tests = conditions.map(compileCondition)
  return points.filter((p) => tests.every((test) => test(p)))
}

/** The points a filter selects. An empty filter selects every point. */
export function applyFilter(points: DataPoint[], dsl: FilterDsl): DataPoint[] {
  return selectPoints(points, dsl.rules.map(toCondition))
}

export function countFilter(points: DataPoint[], dsl: FilterDsl): number {
  return applyFilter(points, dsl).length
}
