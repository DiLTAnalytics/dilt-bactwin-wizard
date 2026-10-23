/**
 * The domain model. Field names are the BACtwin standard's German vocabulary, used as literal keys
 * in catalogues, libraries, templates and saved projects. Text fields
 * default to "", never undefined or null, as the partner system expects; EDE numbers are null when
 * absent.
 */

import { z } from 'zod'

/** Deliberately-absent marker for a name segment, and its index counterpart. */
export const NOT_PRESENT_MARKER = '###'
export const NOT_PRESENT_INDEX = '##'

const str = z.string().default('')

const int = z.number().int().nullable().default(null)
const num = z.number().nullable().default(null)

/** As read by parse/edeSchema.ts. Device, type and instance can be null in points of old projects. */
export const EdeDataSchema = z.object({
  keyname: str,
  device_obj_instance: int,
  object_name: str,
  object_type: int,
  object_instance: int,
  description: str,
  present_value_default: num,
  min_present_value: num,
  max_present_value: num,
  settable: str,
  commandable: str,
  supports_cov: str,
  hi_limit: num,
  low_limit: num,
  state_text_reference: int,
  unit_code: int,
  vendor_specific_address: int,
  notification_class: int,
  object_tag: int,
  object_tag_text: str,
})
export type EdeData = z.infer<typeof EdeDataSchema>

export const BACtwinDataSchema = z.object({
  ort: str,
  gewerk: str,
  anlage: str,
  anlage_number: str,
  sub_anlage_number: str,
  baugruppe: str,
  baugruppe_number: str,
  medium_position: str,
  aggregat: str,
  aggregat_number: str,
  betriebsmittel: str,
  betriebsmittel_number: str,
  funktion: str,
  funktion_number: str,
  funktion_erweiterung: str,
  /** Assembled standard name. Empty unless every required segment is filled - all or nothing. */
  bactwin_name: str,
  /** Human-readable variant. Always produced, with placeholders for what is missing. */
  bactwin_description: z.string().nullable().default(null),
})
export type BACtwinData = z.infer<typeof BACtwinDataSchema>

/** Text the user sees is built from `code` and `params` by the application's translations. */
export const ValidationMessageSchema = z.object({
  level: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  params: z.record(z.string(), z.string()).default({}),
})
export type ValidationMessage = z.infer<typeof ValidationMessageSchema>

/** The engineer's working status and the computed validation results. */
export const StateDataSchema = z.object({
  ignore: z.boolean().default(false),
  reminder: z.boolean().default(false),
  comment: str,
  translation_complete: z.boolean().default(false),
  /** Null when not checked: no catalogue is loaded, or nothing identifying is set yet. */
  combinations_valid: z.boolean().nullable().default(null),
  valid_bactwin_rules: z.boolean().default(false),
  duplicated_name: z.boolean().default(false),
  messages: z.array(ValidationMessageSchema).default([]),
})
export type StateData = z.infer<typeof StateDataSchema>

export const DataPointSchema = z.object({
  source: z
    .object({
      type: str,
      filename: str,
      /** Cells refused on import, as their original text by field; each becomes an error message. */
      invalid: z.record(z.string(), z.string()).default({}),
      /** Set on import when the source repeated this point's identity; the repeat was not imported. */
      duplicated_keyname: z.boolean().default(false),
      /** Set when the source file was updated and no longer contains this point. */
      missing_from_source: z.boolean().default(false),
    })
    .default({ type: '', filename: '', invalid: {}, duplicated_keyname: false, missing_from_source: false }),
  ede: EdeDataSchema.prefault({}),
  bacnet: z.object({ type: str, unit: str }).default({ type: '', unit: '' }),
  bactwin: BACtwinDataSchema.prefault({}),
  state: StateDataSchema.prefault({}),
})
export type DataPoint = z.infer<typeof DataPointSchema>

/** A problem worth telling the user about, as a translatable code plus its values. */
export interface Notice {
  code: string
  params: Record<string, string>
}

/** An error the user sees, carried as a code the application translates. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string> = {},
  ) {
    super(`${code} ${JSON.stringify(params)}`)
  }
}

/** Derived, not stored: a point has an error when any message is at error level. */
export function hasError(point: DataPoint): boolean {
  return point.state.messages.some((m) => m.level === 'error')
}

export const STATE_FLAGS = [
  'ignore',
  'reminder',
  'translation_complete',
  'combinations_valid',
  'valid_bactwin_rules',
  'duplicated_name',
] as const
export type StateFlag = (typeof STATE_FLAGS)[number]

/** Every area of a data point that a filter or an action can address. */
export type Area = 'source' | 'ede' | 'bacnet' | 'bactwin' | 'state'

export function emptyDataPoint(): DataPoint {
  return DataPointSchema.parse({})
}

/** The canonical JSON shape, including the derived `has_error` that exports and the corpus carry. */
/** A data point as it crosses a boundary (IPC, export, corpus): the model plus derived `has_error`. */
export type SerializedDataPoint = DataPoint & { state: DataPoint['state'] & { has_error: boolean } }

export function serializeDataPoint(p: DataPoint): SerializedDataPoint {
  return {
    source: { type: p.source.type, filename: p.source.filename, invalid: { ...p.source.invalid }, duplicated_keyname: p.source.duplicated_keyname, missing_from_source: p.source.missing_from_source },
    ede: { ...p.ede },
    bacnet: { type: p.bacnet.type, unit: p.bacnet.unit },
    bactwin: { ...p.bactwin },
    state: {
      ignore: p.state.ignore,
      reminder: p.state.reminder,
      comment: p.state.comment,
      translation_complete: p.state.translation_complete,
      combinations_valid: p.state.combinations_valid,
      valid_bactwin_rules: p.state.valid_bactwin_rules,
      duplicated_name: p.state.duplicated_name,
      messages: p.state.messages.map((m) => ({ ...m })),
      has_error: hasError(p),
    },
  }
}
