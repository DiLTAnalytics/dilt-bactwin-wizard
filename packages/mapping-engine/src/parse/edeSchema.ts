/**
 * The typed shape of one EDE row, read from its text cells. Types follow the EDE model of DiLT's
 * Haystack builder. Every column is given as text (an absent one as ""); an empty optional number is
 * null, an empty required cell is refused.
 */

import { z } from 'zod'

/** Why a cell was refused; also the message codes the application translates. */
export type EdeValueIssue = 'MISSING_VALUE' | 'INVALID_INT' | 'INVALID_NUMBER'

const INT = /^-?\d+$/
// Decimal comma or point (DACH exports use both); no thousands separators.
const DECIMAL = /^-?\d+(?:[.,]\d+)?$/

const required = z.string().trim().min(1, 'MISSING_VALUE')
const int = z.string().trim().regex(INT, 'INVALID_INT').transform(Number)
const decimal = z.string().trim().regex(DECIMAL, 'INVALID_NUMBER').transform((v) => Number(v.replace(',', '.')))

/** Empty is null; anything else must pass `s`, and a refusal keeps the issue code as its message. */
const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.string().trim().transform((v, ctx): z.output<T> | null => {
    if (v === '') return null
    const parsed = s.safeParse(v)
    if (parsed.success) return parsed.data
    ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]!.message })
    return z.NEVER
  })
const text = z.string().trim()

export const EdeRowSchema = z.strictObject({
  keyname: required,
  device_obj_instance: required.pipe(int),
  object_name: required,
  object_type: required.pipe(int),
  object_instance: required.pipe(int),
  description: text,
  present_value_default: optional(decimal),
  min_present_value: optional(decimal),
  max_present_value: optional(decimal),
  settable: text,
  commandable: text,
  supports_cov: text,
  hi_limit: optional(decimal),
  low_limit: optional(decimal),
  state_text_reference: optional(int),
  unit_code: optional(int),
  vendor_specific_address: optional(int),
  notification_class: optional(int),
  object_tag: optional(int),
  object_tag_text: text,
})
export type EdeRow = z.infer<typeof EdeRowSchema>

/** The columns that make a point unique, in identifier order: reordering them changes every identifier. */
export const EDE_IDENTITY_COLUMNS = ['device_obj_instance', 'object_name', 'object_type', 'object_instance'] as const

/** Columns a row cannot do without; a row missing one of them is not imported. */
export const EDE_REQUIRED_COLUMNS = ['keyname', ...EDE_IDENTITY_COLUMNS] as const

/** Fields stored as text; every other field is a number or null. */
export const EDE_TEXT_FIELDS = new Set(['keyname', 'object_name', 'description', 'settable', 'commandable', 'supports_cov', 'object_tag_text'])

/** One cell read on its own, e.g. to say why a refused cell was refused: the typed value, or the reason. An empty cell is accepted. */
export function parseEdeCell(field: string, raw: string): { value: unknown } | { issue: EdeValueIssue } {
  const schema = EdeRowSchema.shape[field as keyof EdeRow]
  if (!schema || EDE_TEXT_FIELDS.has(field)) return { value: raw.trim() }
  if (raw.trim() === '') return { value: null }
  const parsed = schema.safeParse(raw)
  return parsed.success ? { value: parsed.data } : { issue: parsed.error.issues[0]!.message as EdeValueIssue }
}
