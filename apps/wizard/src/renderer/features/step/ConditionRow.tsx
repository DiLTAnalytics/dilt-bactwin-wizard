import { X } from 'lucide-react'
import type { FilterOperator, FilterRule } from '@bactwin/mapping-engine'
import { useCapabilities } from '@/hooks/useCapabilities'
import { dropLineClass, type RowDrag } from '@/hooks/useRowDrag'
import { useI18n } from '@/i18n'
import { IconButton } from '@/ui/Button'
import { DragHandle } from '@/ui/DragHandle'
import { Input, Select } from '@/ui/Field'
import { Tooltip } from '@/ui/Tooltip'
import { areaOf, fieldLabel } from '@/lib/fieldLabel'
import { MARK_DOT_CLASSES } from '@/lib/highlight'
import { BOOL_OPERATORS, FIELD_GROUPS, FILTERABLE_FIELDS, TEXT_OPERATORS } from './fields'

const operatorsFor = (type: string) => (type === 'bool' ? BOOL_OPERATORS : TEXT_OPERATORS)
const NO_VALUE: FilterOperator[] = ['empty', 'is_true', 'is_false']

/** A small on/off button inside a condition, like the match options of a search box. */
function ToggleChip({ pressed, onChange, hint, children, className = '' }: { pressed: boolean; onChange: (pressed: boolean) => void; hint: string; children: string; className?: string }) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-pressed={pressed}
        aria-label={hint}
        onClick={() => onChange(!pressed)}
        className={`h-7 shrink-0 rounded border px-1.5 text-xs font-medium ${className} ${pressed ? 'border-accent-line bg-accent-soft text-accent-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg'}`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function newRule(): FilterRule {
  return { field: 'ede.object_name', operator: 'regex', value: '', case_sensitive: false, negated: false }
}

/** One "Wenn" condition, with how many points it selects on its own. Their order changes nothing but the look. */
export function ConditionRow({ rule, count, color, drag, onChange, onRemove }: {
  rule: FilterRule
  /** Points this condition alone selects; undefined while unknown. */
  count: number | undefined
  /** The colour it marks its matches with in the table; null when it marks nothing. */
  color: number | null
  drag: RowDrag
  onChange: (r: FilterRule) => void
  onRemove: () => void
}) {
  const { t, n } = useI18n()
  const caps = useCapabilities()
  const meta = FILTERABLE_FIELDS.find((f) => f.field === rule.field) ?? FILTERABLE_FIELDS[0]!
  const isBool = meta.type === 'bool'
  const ops = operatorsFor(meta.type).map((o) => ({ value: o.value, label: t(o.labelKey) }))
  // Keep an operator the field does not offer visible, so it is not changed unseen.
  if (!ops.some((o) => o.value === rule.operator)) ops.unshift({ value: rule.operator, label: rule.operator })
  const offered = FILTERABLE_FIELDS.filter((f) => !f.requires || caps[f.requires])

  return (
    <div {...drag.rowProps} className={`flex items-center gap-1.5 border-y-2 border-transparent ${dropLineClass(drag.dropTarget)} ${drag.dragged ? 'opacity-40' : ''}`}>
      <DragHandle drag={drag} title={t('common.dragHint')} />
      {color === null ? <span className="size-2 shrink-0" /> : (
        <Tooltip content={t('step.markHint')}>
          <span role="img" aria-label={t('step.markHint')} className={`size-2 shrink-0 rounded-full ${MARK_DOT_CLASSES[color]}`} />
        </Tooltip>
      )}
      <Select
        size="sm"
        className="w-36 shrink-0"
        aria-label={t('filter.fieldLabel')}
        value={rule.field}
        onChange={(e) => {
          const next = operatorsFor(FILTERABLE_FIELDS.find((f) => f.field === e.target.value)?.type ?? 'text')
          // Operator and value stay when the new field offers the same operator; a change of type resets them.
          const keep = next.some((o) => o.value === rule.operator)
          onChange({ ...rule, field: e.target.value, operator: keep ? rule.operator : next[0]!.value, value: keep ? rule.value : null, negated: keep ? rule.negated : false })
        }}
      >
        {FIELD_GROUPS.map((group) => (
          <optgroup key={group} label={t(`filter.group.${group}`)}>
            {offered.filter((f) => areaOf(f.field) === group).map((f) => (
              <option key={f.field} value={f.field}>{fieldLabel(f.field, t)}</option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Select size="sm" className="w-20 shrink-0" aria-label={t('filter.operatorLabel')} value={rule.operator}
        onChange={(e) => onChange({ ...rule, operator: e.target.value as FilterOperator })}>
        {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      {/* A yes/no field has nothing to invert; the slot keeps the value column aligned. */}
      {isBool ? <span className="w-10 shrink-0" /> : (
        <ToggleChip pressed={!!rule.negated} onChange={(negated) => onChange({ ...rule, negated })} hint={t('filter.negateHint')} className="w-10">{t('filter.negate')}</ToggleChip>
      )}
      {NO_VALUE.includes(rule.operator) ? <div className="min-w-0 flex-1" /> : (
        <Input
          size="sm"
          className="min-w-16 flex-1 font-mono"
          aria-label={t('filter.valuePlaceholder')}
          placeholder={t('filter.valuePlaceholder')}
          value={typeof rule.value === 'string' ? rule.value : ''}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      )}
      {!isBool && (
        <ToggleChip pressed={rule.case_sensitive} onChange={(case_sensitive) => onChange({ ...rule, case_sensitive })} hint={t('filter.caseSensitiveHint')}>Aa</ToggleChip>
      )}
      <Tooltip content={count === undefined ? null : t('step.conditionCount')}>
        <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{count === undefined ? '' : n(count)}</span>
      </Tooltip>
      <IconButton size="sm" icon={X} label={t('filter.removeCondition')} tone="danger" onClick={onRemove} />
    </div>
  )
}
