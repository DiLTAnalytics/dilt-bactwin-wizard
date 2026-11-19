/** How a recorded step reads in the sequence list. Pure; `t` is passed in. */

import { COMMAND_FIELD, nameFieldOrder, toDsl, type FilterRule, type NameTemplate, type SequenceStep, type SetAction } from '@bactwin/mapping-engine'
import { fieldLabel, type Translate } from './fieldLabel'

export type { Translate }

function ruleText(r: FilterRule, t: Translate): string {
  const field = fieldLabel(r.field, t)
  const not = r.negated ? 'NOT ' : ''
  const aa = r.case_sensitive ? ' (Aa)' : ''
  const value = typeof r.value === 'string' ? r.value : (r.value ?? []).join('|')
  switch (r.operator) {
    case 'is_true': return `${field} = ${t('step.yes')}`
    case 'is_false': return `${field} = ${t('step.no')}`
    case 'empty': return `${field} ${not}= ""`
    case 'equals': return `${field} ${not}= "${value}"${aa}`
    default: return `${field} ${not}regex "${value}"${aa}`
  }
}

export function filterSummary(step: SequenceStep, t: Translate): string {
  const { rules } = toDsl(step.filter)
  return rules.length ? rules.map((r) => ruleText(r, t)).join(' AND ') : t('sequence.filterAll')
}

const bare = (field: string) => field.slice(field.indexOf('.') + 1)

function actionText(a: SetAction, t: Translate): string {
  const target = fieldLabel(a.field, t)
  if (a.from) {
    return `${target} ← "${a.value}" ${a.from.map((s) => t('sequence.fromRegex', { pattern: s.regex, origin: fieldLabel(s.field, t) })).join(', ')}`
  }
  if (typeof a.value === 'boolean') return `${target} = ${t(a.value ? 'step.yes' : 'step.no')}`
  if (a.field === COMMAND_FIELD) return `${target} = ${t(`command.${a.value}`)}`
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
