import { describe, expect, it } from 'vitest'
import type { FilterRule } from '@bactwin/mapping-engine'
import { conditionMarks, markColor, markSegments, searchMarks, SEARCH_COLOR } from './highlight'

const rule = (patch: Partial<FilterRule>): FilterRule => ({ field: 'ede.object_name', operator: 'regex', value: '', case_sensitive: false, negated: false, ...patch })

describe('condition marks', () => {
  it('give each marking condition the colour of its position, and none to the others', () => {
    const rules = [
      rule({ value: 'HH4' }),
      rule({ field: 'ede.description', operator: 'equals', value: 'Pumpe|Ventil' }),
      rule({ value: 'X', negated: true }),
      rule({ field: 'ede.unit_code', value: '62' }),
      rule({ value: '' }),
    ]
    expect(rules.map(markColor)).toEqual([0, 1, null, null, null])
    expect(conditionMarks(rules).map((m) => [m.field, m.color])).toEqual([['ede.object_name', 0], ['ede.description', 1]])
  })

  it('mark every match, keep the earlier condition where they overlap, and follow case sensitivity', () => {
    const marks = conditionMarks([rule({ value: 'HH4' }), rule({ value: 'h4_r', case_sensitive: true }), rule({ value: 'rltf' })])
    expect(markSegments('XX_HH4_RLTF1_HH4', marks)).toEqual([
      { text: 'XX_', color: null },
      { text: 'HH4', color: 0 },
      { text: '_', color: null },
      { text: 'RLTF', color: 2 },
      { text: '1_', color: null },
      { text: 'HH4', color: 0 },
    ])
  })

  it('mark a whole value for equals, and nothing for a half-typed regex', () => {
    expect(markSegments('Pumpe', conditionMarks([rule({ operator: 'equals', value: 'Ventil | Pumpe' })]))).toEqual([{ text: 'Pumpe', color: 0 }])
    expect(conditionMarks([rule({ value: '(HH' })])).toEqual([])
  })

  it('mark the search term as typed, literally and in any case, after the conditions', () => {
    const marks = [...conditionMarks([rule({ value: 'HH4' })]), ...searchMarks(' h4_r. ')]
    expect(markSegments('XX_HH4_R.LT', marks.filter((m) => m.field === 'ede.object_name'))).toEqual([
      { text: 'XX_', color: null },
      { text: 'HH4', color: 0 },
      { text: '_R.', color: SEARCH_COLOR },
      { text: 'LT', color: null },
    ])
    expect(searchMarks('  ')).toEqual([])
  })
})
