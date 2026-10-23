import { describe, expect, it } from 'vitest'

import { applyFilter, conditionRegex, emptyDataPoint, READABLE_FIELDS, ruleFromCondition, selectPoints, toCondition, type FilterRule } from '../src/index.js'

const points = ['HZG', 'hzg', 'RLT', 'ELT', 'a.b', 'axb', ''].map((g) => {
  const p = emptyDataPoint()
  p.bactwin.gewerk = g
  return p
})

const rule = (r: Partial<FilterRule>): FilterRule =>
  ({ field: 'bactwin.gewerk', operator: 'equals', value: 'HZG', case_sensitive: false, negated: false, ...r })

const gewerks = (selected: typeof points) => selected.map((p) => p.bactwin.gewerk)

describe('each filter rule is exactly one regex', () => {
  it.each([
    ['equals', rule({}), '^HZG$', ['HZG', 'hzg']],
    ['NOT equals', rule({ negated: true }), '^(?!HZG$)', ['RLT', 'ELT', 'a.b', 'axb', '']],
    ['case-sensitive equals', rule({ case_sensitive: true }), '(?-i:^HZG$)', ['HZG']],
    ['alternatives', rule({ value: 'HZG|RLT' }), '^(?:HZG|RLT)$', ['HZG', 'hzg', 'RLT']],
    ['regex characters in equals', rule({ value: 'a.b' }), '^a\\.b$', ['a.b']],
    ['regex', rule({ operator: 'regex', value: 'z' }), 'z', ['HZG', 'hzg']],
    ['NOT regex', rule({ operator: 'regex', value: 'z|L', negated: true }), '^(?![\\s\\S]*(?:z|L))', ['a.b', 'axb', '']],
    ['NOT case-sensitive regex', rule({ operator: 'regex', value: 'z', negated: true, case_sensitive: true }), '(?-i:^(?![\\s\\S]*(?:z)))', ['HZG', 'RLT', 'ELT', 'a.b', 'axb', '']],
    ['empty', rule({ operator: 'empty', value: null }), '^$', ['']],
    ['NOT empty', rule({ operator: 'empty', value: null, negated: true }), '^(?!$)', ['HZG', 'hzg', 'RLT', 'ELT', 'a.b', 'axb']],
  ])('%s', (_name, r, regex, selected) => {
    expect(conditionRegex(r)).toBe(regex)
    expect(gewerks(applyFilter(points, { rules: [r] }))).toEqual(selected)
    expect(ruleFromCondition(toCondition(r))).toEqual(r)
  })

  it('flags are true or false, and read back as such only on boolean fields', () => {
    const flag = rule({ field: 'state.ignore', operator: 'is_true', value: null })
    expect(conditionRegex(flag)).toBe('^true$')
    expect(ruleFromCondition({ field: 'state.ignore', regex: '^false$' })).toEqual({ ...flag, operator: 'is_false' })
    expect(ruleFromCondition({ field: 'bactwin.gewerk', regex: '^true$' })).toEqual(rule({ value: 'true' }))
    const ignored = emptyDataPoint()
    ignored.state.ignore = true
    expect(selectPoints([ignored, emptyDataPoint()], [toCondition(flag)])).toEqual([ignored])
  })

  it('reads any regex back as a rule that writes the same regex', () => {
    for (const regex of ['^HZ.$', '^(?:HZG)$', '^HZG', '(?-i:x', '^a\\|b$', '^ x$', '(?-i:^(?!$))', '^(?![\\s\\S]*(?:a)', '[']) {
      const back = ruleFromCondition({ field: 'bactwin.gewerk', regex })
      expect(conditionRegex(back), regex).toBe(regex)
    }
    expect(ruleFromCondition({ field: 'bactwin.gewerk', regex: '^HZ.$' })).toEqual(rule({ operator: 'regex', value: '^HZ.$' }))
  })

  it('an invalid regex selects nothing', () => {
    expect(selectPoints(points, [{ field: 'bactwin.gewerk', regex: '[' }])).toEqual([])
  })
})

describe('the view search field', () => {
  it('finds a point by its object name or its description, and is not storable in a sequence', () => {
    const point = (name: string, description: string) => {
      const p = emptyDataPoint()
      p.ede.object_name = name
      p.ede.description = description
      return p
    }
    const all = [point('AHU01_ZUTF', 'Zuluft Temperatur'), point('AHU01_ABTF', 'Abluft'), point('X', 'Zulufttemperatur')]
    const search = rule({ field: 'ede.name_or_description', operator: 'regex', value: 'zul' })
    expect(applyFilter(all, { rules: [search] }).map((p) => p.ede.object_name)).toEqual(['AHU01_ZUTF', 'X'])
    expect(applyFilter(all, { rules: [{ ...search, value: 'abtf' }] }).map((p) => p.ede.object_name)).toEqual(['AHU01_ABTF'])
    expect(READABLE_FIELDS).not.toContain('ede.name_or_description')
  })
})
