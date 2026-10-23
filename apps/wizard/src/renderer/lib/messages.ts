/** A point's validation message as text. */

import type { ValidationMessage } from '@bactwin/mapping-engine'
import type { Translate } from './fieldLabel'

export function messageText(msg: ValidationMessage, t: Translate): string {
  // A violation names the field that breaks it, and what it clashes with unless the value is in no row at all.
  const key = msg.code === 'COMBINATION_VIOLATION' && msg.params['field']
    ? msg.params['with'] ? 'COMBINATION_VIOLATION_WITH' : 'COMBINATION_VIOLATION_ALONE'
    : msg.code
  return t(`validation.${key}`, msg.params)
}

/** Errors first, so a cut list keeps them. */
export const byLevel = (messages: ValidationMessage[]) =>
  [...messages].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'))

const EDE_COLUMNS = new Set(['object_type', 'unit_code'])

/** The field a message is about, as area.field; null for one about the point as a whole. */
export function messageField(msg: ValidationMessage): string | null {
  const p = msg.params
  switch (msg.code) {
    case 'UNKNOWN_KEY':
    case 'DEPRECATED_KEY': return p['block'] ? `bactwin.${p['block']}` : null
    case 'COMBINATION_VIOLATION': return p['field'] ? `${EDE_COLUMNS.has(p['field']) ? 'ede' : 'bactwin'}.${p['field']}` : null
    case 'UNKNOWN_OBJECT_TYPE': return 'ede.object_type'
    case 'UNKNOWN_UNIT_CODE': return 'ede.unit_code'
    default: return p['column'] ? `ede.${p['column']}` : null
  }
}
