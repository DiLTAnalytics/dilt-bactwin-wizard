/** Assembling the BACtwin name and its human-readable description from a template. */

import type { NameTemplate } from '../reference/index.js'
import type { BACtwinData } from '../types.js'

function seg(bt: BACtwinData, id: string): string {
  return (bt as unknown as Record<string, unknown>)[id] as string ?? ''
}

/** True when every segment shown in the name is filled, index fields included; validity is not considered. */
export function isNameComplete(template: NameTemplate, bt: BACtwinData): boolean {
  for (const s of template.segments) {
    if (s.optional_display) continue
    if (!seg(bt, s.id)) return false
    if (s.type === 'key_indexed' && s.index_field && !seg(bt, s.index_field)) return false
  }
  return true
}

/** The assembled name, or "" when anything required is missing: a half-built name would pass for a finished one. */
export function buildBACtwinName(template: NameTemplate, bt: BACtwinData): string {
  const sep = template.separator ?? '_'

  for (const s of template.segments) {
    if (s.required && !seg(bt, s.id)) return ''
  }

  const parts: string[] = []
  for (const s of template.segments) {
    const value = seg(bt, s.id)
    if (!value) continue // an unset optional segment is left out entirely, no dangling separator
    if (s.type === 'key_indexed') {
      const idx = s.index_field ? seg(bt, s.index_field) : ''
      // Key without index: incomplete. No default index is invented.
      if (!idx) return ''
      parts.push(`${value}${idx}`)
    } else {
      parts.push(value)
    }
  }
  return parts.length > 0 ? parts.join(sep) : ''
}

/** `ort` and `gewerk` keep their literal value in the description; everything else is labelled. */
const DESCRIPTION_VERBATIM_SEGMENTS = new Set(['ort', 'gewerk'])

/** A key's human-readable label, falling back to the key itself. */
export function resolveLabel(
  block: string,
  key: string,
  library: ReadonlyMap<string, { description?: string | null }>,
): string {
  return (library.get(`${block}:${key}`)?.description || key).trim()
}

/** One piece of a displayed name segment; `filled` is false for a placeholder. */
export interface NamePart {
  text: string
  filled: boolean
}

export interface NameSegmentParts {
  id: string
  parts: NamePart[]
}

/** The name as segments of parts, placeholders included, for display; with `label`, keys show by label as in the description. */
export function buildNameParts(
  template: NameTemplate,
  bt: BACtwinData,
  label?: (block: string, key: string) => string,
): NameSegmentParts[] {
  const out: NameSegmentParts[] = []
  for (const s of template.segments) {
    const value = seg(bt, s.id)
    if (!value && s.optional_display) continue
    const text = !value
      ? s.placeholder || '???'
      : label && !DESCRIPTION_VERBATIM_SEGMENTS.has(s.id)
        ? label(s.id, value)
        : value
    const parts: NamePart[] = [{ text, filled: !!value }]
    if (s.type === 'key_indexed') {
      const idx = s.index_field ? seg(bt, s.index_field) : ''
      parts.push({ text: idx || s.index_placeholder || '??', filled: !!idx })
    }
    out.push({ id: s.id, parts })
  }
  return out
}

/** The description variant of the name, produced even when unfinished, with placeholders for what is missing. */
export function buildBACtwinDescription(
  template: NameTemplate,
  bt: BACtwinData,
  library: ReadonlyMap<string, { description?: string | null }>,
): string {
  return buildNameParts(template, bt, (block, key) => resolveLabel(block, key, library))
    .map((s) => s.parts.map((p) => p.text).join(''))
    .join(template.separator ?? '_')
}
