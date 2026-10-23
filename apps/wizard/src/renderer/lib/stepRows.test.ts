import { describe, expect, it } from 'vitest'
import { BACTWIN_FIELDS } from '@bactwin/mapping-engine'
import { emptyRow, fromAction, moveSource, removeSource, sourceGroups, toAction, type SetRow } from './stepRows'

const ort = BACTWIN_FIELDS.find((f) => f.id === 'ort')!
const row = (patterns: string[], template: string): SetRow =>
  fromAction({ field: 'bactwin.ort', value: template, from: patterns.map((regex, i) => ({ field: i % 2 ? 'ede.description' : 'bactwin.ort', regex })) })!

describe('a row with several sources', () => {
  it('reads and writes the sources in order', () => {
    const action = { field: 'bactwin.ort', value: '$1$2', from: [{ field: 'bactwin.ort', regex: '^(.{7})' }, { field: 'ede.description', regex: '(.{8})$' }] }
    expect(toAction(fromAction(action)!)).toEqual(action)
    expect(emptyRow(ort).sources).toHaveLength(1)
  })

  it('keeps spaces at the ends of a pattern, since they match', () => {
    const action = { field: 'bactwin.ort', value: '$1', from: [{ field: 'ede.object_name', regex: ' (UEBL)' }] }
    expect(toAction(fromAction(action)!)).toEqual(action)
  })

  it('numbers the groups across sources', () => {
    expect(sourceGroups(row(['^(..)(..)', 'x', '(.{3})$'], '').sources)).toEqual([{ first: 1, last: 2 }, { first: 3, last: 2 }, { first: 3, last: 3 }])
    expect(sourceGroups(row(['(', 'x'], '').sources)).toEqual([null, null])
  })

  it('renumbers the template when a source moves, so it writes the same value', () => {
    const moved = moveSource(row(['^(..)(..)', '(.{3})$', '^.{4}(.*)$'], 'A$1-$2/$3+$4$$1'), 0, 2)
    expect(moved.sources.map((s) => s.pattern)).toEqual(['(.{3})$', '^.{4}(.*)$', '^(..)(..)'])
    expect(moved.template).toBe('A$3-$4/$1+$2$$1')
  })

  it('takes a removed source\'s groups out of the template and moves the later ones down', () => {
    const removed = removeSource(row(['^(.{7})', '(.{8})$', '^.{15}(.*)$'], '$1$2$3'), 1)
    expect(removed.sources.map((s) => s.pattern)).toEqual(['^(.{7})', '^.{15}(.*)$'])
    expect(removed.template).toBe('$1$2')
  })

  it('leaves the template alone while a pattern is invalid', () => {
    expect(moveSource(row(['(', '(x)'], '$1$2'), 0, 1).template).toBe('$1$2')
  })
})
