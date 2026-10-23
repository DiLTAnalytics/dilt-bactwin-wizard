/** The BACtwin name fields, in name order: the one list every layer derives its field lists from. */

import type { NameTemplate } from '../reference/index.js'
import type { BACtwinData, DataPoint, EdeData } from '../types.js'

export type BACtwinFieldId = Exclude<keyof BACtwinData, 'bactwin_name' | 'bactwin_description'>

export interface BACtwinField {
  id: BACtwinFieldId
  kind: 'free' | 'key' | 'number'
  /** Column and stats abbreviation; the segment's own name, so never translated. */
  abbr: string
  /** For an index number: the key field it numbers. */
  indexOf?: BACtwinFieldId
  /** Counts towards the completeness ratio. Optional segments do not. */
  counted: boolean
}

export const BACTWIN_FIELDS: readonly BACtwinField[] = [
  { id: 'ort', kind: 'free', abbr: 'ORT', counted: true },
  { id: 'gewerk', kind: 'key', abbr: 'GEW', counted: true },
  { id: 'anlage', kind: 'key', abbr: 'ANL', counted: true },
  { id: 'anlage_number', kind: 'number', abbr: '#', indexOf: 'anlage', counted: true },
  { id: 'sub_anlage_number', kind: 'number', abbr: 'SUB', counted: false },
  { id: 'baugruppe', kind: 'key', abbr: 'BGR', counted: true },
  { id: 'baugruppe_number', kind: 'number', abbr: '#', indexOf: 'baugruppe', counted: true },
  { id: 'medium_position', kind: 'key', abbr: 'M/P', counted: true },
  { id: 'aggregat', kind: 'key', abbr: 'AGG', counted: true },
  { id: 'aggregat_number', kind: 'number', abbr: '#', indexOf: 'aggregat', counted: true },
  { id: 'betriebsmittel', kind: 'key', abbr: 'BM', counted: true },
  { id: 'betriebsmittel_number', kind: 'number', abbr: '#', indexOf: 'betriebsmittel', counted: true },
  { id: 'funktion', kind: 'key', abbr: 'FKT', counted: true },
  { id: 'funktion_number', kind: 'number', abbr: '#', indexOf: 'funktion', counted: true },
  { id: 'funktion_erweiterung', kind: 'key', abbr: 'FKT.E', counted: false },
]

/*
 * The fields the UI names, one dict per area: stored id to table abbreviation. Elsewhere a field is
 * shown as fieldName(field); the abbreviation is only for table headers, where columns are narrow.
 */
export const EDE_FIELDS = {
  object_name: 'object-name',
  description: 'description',
  device_obj_instance: 'device',
  object_type: 'obj-type',
  object_instance: 'obj-instance',
  unit_code: 'unit-code',
} as const satisfies Partial<Record<keyof EdeData, string>>

export const BACNET_FIELDS = { type: 'type', unit: 'unit' } as const satisfies Partial<Record<keyof DataPoint['bacnet'], string>>

/** Built from the segments by the name template; never written directly. */
export const BACTWIN_DERIVED = {
  bactwin_name: 'bactwin-name',
  bactwin_description: 'bactwin-description',
} as const satisfies Record<Exclude<keyof BACtwinData, BACtwinFieldId>, string>

/**
 * Flags and notes on a point, by value type. Shown by a translated label rather than their name;
 * has_error, combinations_invalid and invalid_bactwin_rules are computed for filtering (DERIVED_STATE_FIELDS).
 */
export const STATE_FIELDS = {
  has_error: 'bool',
  duplicated_name: 'bool',
  ignore: 'bool',
  translation_complete: 'bool',
  reminder: 'bool',
  comment: 'text',
  combinations_invalid: 'bool',
  invalid_bactwin_rules: 'bool',
} as const satisfies Record<string, 'bool' | 'text'>

export const SOURCE_FIELDS = {
  duplicated_keyname: 'bool',
  missing_from_source: 'bool',
} as const satisfies Partial<Record<keyof DataPoint['source'], 'bool' | 'text'>>

export const FIELD_ABBR: Record<'ede' | 'bacnet' | 'bactwin', Record<string, string>> = {
  ede: EDE_FIELDS,
  bacnet: BACNET_FIELDS,
  bactwin: { ...Object.fromEntries(BACTWIN_FIELDS.map((f) => [f.id, f.abbr])), ...BACTWIN_DERIVED },
}

/**
 * A field as the user reads it: without its area, hyphens for underscores, and the stored English
 * `_number` in German (`ede.object_name` is `object-name`, `bactwin.anlage_number` is `anlage-nummer`).
 */
export const fieldName = (field: string): string =>
  field.slice(field.indexOf('.') + 1).replace(/_number$/, '_nummer').replaceAll('_', '-')

/** Table header of `area.id`; its name when the field has no abbreviation. */
export function fieldAbbr(field: string): string {
  const dot = field.indexOf('.')
  return (FIELD_ABBR as Record<string, Record<string, string> | undefined>)[field.slice(0, dot)]?.[field.slice(dot + 1)] ?? fieldName(field)
}

/** The index number field that belongs to a key field, if any. */
export const indexFieldOf = (id: BACtwinFieldId): BACtwinField | undefined =>
  BACTWIN_FIELDS.find((f) => f.indexOf === id)

/** Used when no enabled plugin supplies a template. Mirrors the AMEV 2026 structure. */
export const FALLBACK_NAME_TEMPLATE: NameTemplate = {
  version: 'fallback',
  separator: '_',
  index_default: '01',
  segments: [
    { id: 'ort', type: 'free', required: true, placeholder: '?' },
    { id: 'gewerk', type: 'key', required: true, placeholder: '???' },
    { id: 'anlage', type: 'key_indexed', required: true, placeholder: '???', index_field: 'anlage_number', index_digits: 2, index_placeholder: '??' },
    { id: 'sub_anlage_number', type: 'key', required: false, optional_display: true, digits: 2, placeholder: '???' },
    { id: 'baugruppe', type: 'key_indexed', required: true, placeholder: '???', index_field: 'baugruppe_number', index_digits: 2, index_placeholder: '??' },
    { id: 'medium_position', type: 'key', required: false, placeholder: '???' },
    { id: 'aggregat', type: 'key_indexed', required: false, placeholder: '???', index_field: 'aggregat_number', index_digits: 2, index_placeholder: '??' },
    { id: 'betriebsmittel', type: 'key_indexed', required: false, placeholder: '???', index_field: 'betriebsmittel_number', index_digits: 2, index_placeholder: '??' },
    { id: 'funktion', type: 'key_indexed', required: false, placeholder: '???', index_field: 'funktion_number', index_digits: 2, index_placeholder: '??' },
    { id: 'funktion_erweiterung', type: 'key', required: false, optional_display: true, placeholder: '???' },
  ],
}
