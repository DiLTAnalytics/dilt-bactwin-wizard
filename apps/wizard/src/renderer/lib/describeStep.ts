/** How a recorded step reads in the sequence list. Pure; `t` is passed in. */

import { fieldName, nameFieldOrder, toDsl, type FilterRule, type NameTemplate, type SequenceStep, type SetAction } from '@bactwin/mapping-engine'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

function ruleText(r: FilterRule): string {
  const field = fieldName(r.field)
  const not = r.negated ? 'NOT ' : ''
  const aa = r.case_sensitive ? ' (Aa)' : ''
  const value = typeof r.value === 'string' ? r.value : (r.value ?? []).join('|')
  switch (r.operator) {
    case 'is_true': return `${field} = true`
    case 'is_false': return `${field} = false`
    case 'empty': return `${field} ${not}= ""`
    case 'equals': return `${field} ${not}= "${value}"${aa}`
    default: return `${field} ${not}regex "${value}"${aa}`
  }
}

export function filterSummary(step: SequenceStep, t: Translate): string {
  const { rules } = toDsl(step.filter)
  return rules.length ? rules.map(ruleText).join(' AND ') : t('sequence.filterAll')
}

const bare = (field: string) => field.slice(field.indexOf('.') + 1)

function actionText(a: SetAction, t: Translate): string {
  const target = fieldName(a.field)
  if (a.from) {
    return `${target} ← "${a.value}" ${a.from.map((s) => t('sequence.fromRegex', { pattern: s.regex, origin: fieldName(s.field) })).join(', ')}`
  }
  if (typeof a.value === 'boolean') return `${target} = ${a.value ? 'true' : 'false'}`
  return `${target} = "${a.value}"`
}

/** Every action as text, in name order. */
export function actionsVerbose(step: SequenceStep, template: NameTemplate, t: Translate): string {
  const order = nameFieldOrder(template)
  return [...step.actions]
    .sort((a, b) => (order.get(bare(a.field)) ?? Infinity) - (order.get(bare(b.field)) ?? Infinity))
    .map((a) => actionText(a, t))
    .join(', ')
}
