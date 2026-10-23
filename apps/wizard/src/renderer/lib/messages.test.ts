import { describe, expect, it } from 'vitest'
import { messageField } from './messages'

const msg = (code: string, params: Record<string, string> = {}) => ({ level: 'error' as const, code, params })

describe('which field a message is about', () => {
  it.each([
    [msg('UNKNOWN_KEY', { value: 'X', block: 'anlage' }), 'bactwin.anlage'],
    [msg('DEPRECATED_KEY', { value: 'X', block: 'gewerk' }), 'bactwin.gewerk'],
    [msg('COMBINATION_VIOLATION', { field: 'baugruppe', value: 'X', with: '' }), 'bactwin.baugruppe'],
    [msg('COMBINATION_VIOLATION', { field: 'object_type', value: '3', with: '' }), 'ede.object_type'],
    [msg('COMBINATION_VIOLATION'), null],
    [msg('UNKNOWN_OBJECT_TYPE', { value: '99' }), 'ede.object_type'],
    [msg('UNKNOWN_UNIT_CODE', { value: '999' }), 'ede.unit_code'],
    [msg('INVALID_INT', { column: 'unit_code', value: 'x' }), 'ede.unit_code'],
    [msg('MISSING_FROM_SOURCE', { file: 'a.csv' }), null],
  ])('%j', (message, field) => {
    expect(messageField(message)).toBe(field)
  })
})
