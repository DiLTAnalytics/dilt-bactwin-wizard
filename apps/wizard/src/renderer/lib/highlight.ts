/** Marking what a step's conditions match in the table, one colour per condition. */

import { conditionRegex, escapeRegex, type FilterRule } from '@bactwin/mapping-engine'

/** Colours in the order conditions get them; after the last they repeat. Each is defined in index.css. */
const CONDITION_CLASSES = [
  'bg-mark-1 ring-mark-1-line',
  'bg-mark-2 ring-mark-2-line',
  'bg-mark-3 ring-mark-3-line',
  'bg-mark-4 ring-mark-4-line',
  'bg-mark-5 ring-mark-5-line',
] as const

/** The view search's mark, an outline unlike the filled condition colours. */
export const SEARCH_COLOR = CONDITION_CLASSES.length

export const MARK_CLASSES = [...CONDITION_CLASSES, 'bg-transparent ring-accent'] as const

/** The swatch beside a condition in the editor, in its mark colour. */
export const MARK_DOT_CLASSES = ['bg-mark-1-line', 'bg-mark-2-line', 'bg-mark-3-line', 'bg-mark-4-line', 'bg-mark-5-line'] as const

/** Fields the table shows as text a condition can be marked in. */
export const MARKED_FIELDS = ['ede.object_name', 'ede.description'] as const

export interface Mark {
  field: string
  pattern: RegExp
  /** Index into MARK_CLASSES. */
  color: number
}

/** The colour of the condition at `index`, or null when it marks nothing (negated, empty, not a text match, another field). */
export function markColor(rule: FilterRule, index: number): number | null {
  const marks = (MARKED_FIELDS as readonly string[]).includes(rule.field) && !rule.negated
    && (rule.operator === 'regex' || rule.operator === 'equals') && typeof rule.value === 'string' && rule.value !== ''
  return marks ? index % CONDITION_CLASSES.length : null
}

/** A mark per condition that has a colour and a valid pattern. */
export function conditionMarks(rules: FilterRule[]): Mark[] {
  return rules.flatMap((rule, i) => {
    const color = markColor(rule, i)
    if (color === null) return []
    // The condition's own regex without the case-sensitive wrapper, which becomes the flag instead.
    const regex = conditionRegex(rule)
    const body = rule.case_sensitive ? regex.slice('(?-i:'.length, -1) : regex
    try {
      return [{ field: rule.field, pattern: new RegExp(body, rule.case_sensitive ? 'g' : 'gi'), color }]
    } catch {
      return []
    }
  })
}

/** The view search's term in name and description, as the search reads it: trimmed, case-insensitive. */
export function searchMarks(search: string): Mark[] {
  const term = search.trim()
  if (!term) return []
  return MARKED_FIELDS.map((field) => ({ field, pattern: new RegExp(escapeRegex(term), 'gi'), color: SEARCH_COLOR }))
}

export interface Segment {
  text: string
  /** Index into MARK_CLASSES, or null for unmarked text. */
  color: number | null
}

/** `text` cut into marked and unmarked pieces; where matches overlap, the earlier condition keeps its colour. */
export function markSegments(text: string, marks: Mark[]): Segment[] {
  const owner: (number | null)[] = new Array<number | null>(text.length).fill(null)
  for (const { pattern, color } of marks) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) {
      if (!m[0]) continue
      for (let i = m.index; i < m.index + m[0].length; i++) owner[i] ??= color
    }
  }
  const out: Segment[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out.at(-1)
    if (last && last.color === owner[i]) last.text += text[i]
    else out.push({ text: text[i]!, color: owner[i] ?? null })
  }
  return out
}
