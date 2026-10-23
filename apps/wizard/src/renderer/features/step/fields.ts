import { FIELD_ABBR, SOURCE_FIELDS, STATE_FIELDS, type FilterOperator } from '@bactwin/mapping-engine'

/** Area order in the field dropdown. */
export const FIELD_GROUPS = ['ede', 'bacnet', 'bactwin', 'state', 'source'] as const

export interface FilterableField {
  field: string
  type: 'text' | 'bool'
  /** Only offered when this capability is on. */
  requires?: 'combinations'
}

/** Every field of the registry: data fields as text, flags and notes by their type. */
export const FILTERABLE_FIELDS: FilterableField[] = [
  ...Object.entries(FIELD_ABBR).flatMap(([area, ids]) => Object.keys(ids).map((id) => ({ field: `${area}.${id}`, type: 'text' as const }))),
  ...Object.entries(STATE_FIELDS).map(([id, type]) => ({ field: `state.${id}`, type, ...(id === 'combinations_invalid' ? { requires: 'combinations' as const } : {}) })),
  ...Object.entries(SOURCE_FIELDS).map(([id, type]) => ({ field: `source.${id}`, type })),
]

export const TEXT_OPERATORS: { value: FilterOperator; labelKey: string }[] = [
  { value: 'regex', labelKey: 'filter.op.regex' },
  { value: 'equals', labelKey: 'filter.op.equals' },
  { value: 'empty', labelKey: 'filter.op.empty' },
]

export const BOOL_OPERATORS: { value: FilterOperator; labelKey: string }[] = [
  { value: 'is_true', labelKey: 'filter.op.isTrue' },
  { value: 'is_false', labelKey: 'filter.op.isFalse' },
]
