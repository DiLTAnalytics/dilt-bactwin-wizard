/** A data point's identity: the EDE columns that tell points apart. */

import { EDE_IDENTITY_COLUMNS } from '../parse/edeSchema.js'
import type { EdeData } from '../types.js'
import { escapeRegex, type FilterDsl } from '../filter/index.js'

const cell = (ede: EdeData, f: (typeof EDE_IDENTITY_COLUMNS)[number]) => String(ede[f] ?? '')

/** The internal key of a data point: unique per identity. */
export function pointKey(ede: EdeData): string {
  return JSON.stringify(EDE_IDENTITY_COLUMNS.map((f) => cell(ede, f)))
}

/** A filter matching exactly this one point: case-sensitive anchored regexes, since equals splits on "|" and trims. */
export function identityFilter(ede: EdeData): FilterDsl {
  return {
    rules: EDE_IDENTITY_COLUMNS.map((f) => ({
      field: `ede.${f}`,
      operator: 'regex' as const,
      value: `^${escapeRegex(cell(ede, f))}$`,
      case_sensitive: true,
      negated: false,
    })),
  }
}
