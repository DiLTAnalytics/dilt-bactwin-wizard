import { describe, expect, it } from 'vitest'
import { BACTWIN_FIELDS, fieldAbbr, fieldName } from '../src/index.js'

describe('field names', () => {
  it('names a field without its area, with hyphens', () => {
    expect(fieldName('ede.object_name')).toBe('object-name')
    expect(fieldName('bactwin.anlage_number')).toBe('anlage-nummer')
    expect(fieldName('bactwin.sub_anlage_number')).toBe('sub-anlage-nummer')
    expect(fieldName('dilt.id')).toBe('id')
  })

  it('abbreviates every BACtwin segment as the registry does, and falls back to the name', () => {
    for (const f of BACTWIN_FIELDS) expect(fieldAbbr(`bactwin.${f.id}`)).toBe(f.abbr)
    expect(fieldAbbr('ede.object_type')).toBe('obj-type')
    expect(fieldAbbr('ede.hi_limit')).toBe('hi-limit')
  })
})
