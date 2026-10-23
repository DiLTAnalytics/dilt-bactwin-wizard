/** Field-level write mechanics: zero-padding and marker coupling. */

import type { NameTemplate } from '../reference/index.js'
import { NOT_PRESENT_INDEX, NOT_PRESENT_MARKER } from '../types.js'

/** Digit width for a numeric field, from the template. Null when the field is not numeric. */
export function numericDigits(template: NameTemplate, column: string): number | null {
  for (const seg of template.segments) {
    if (seg.index_field === column) return seg.index_digits ?? 2
    if (seg.id === column && seg.digits) return seg.digits
  }
  return null
}

function indexFieldFor(template: NameTemplate, keyColumn: string): string | null {
  for (const seg of template.segments) {
    if (seg.id === keyColumn && seg.index_field) return seg.index_field
  }
  return null
}

/** Pad a numeric field to the width the template defines. Never truncates. */
export function normalizeValue(template: NameTemplate, column: string, value: unknown): unknown {
  const digits = numericDigits(template, column)
  if (digits && typeof value === 'string' && value !== '' && /^\d+$/.test(value)) {
    return value.padStart(digits, '0')
  }
  return value
}

/** Setting a key field to the not-present marker sets its index field to the index marker too. */
export function markerCoupling(
  template: NameTemplate,
  column: string,
  value: unknown,
): [string, string] | null {
  if (value !== NOT_PRESENT_MARKER) return null
  const idx = indexFieldFor(template, column)
  return idx ? [idx, NOT_PRESENT_INDEX] : null
}
