import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  applyFilter, applyStep, emptyDataPoint, isNewer, readSequence, ReferenceData, SequenceTooNewError, runSequence, SEQUENCE_FORMAT_VERSION, SEQUENCE_SCHEMA_URL,
  sequenceJsonSchema, sequenceToFile, toCondition, toDsl, type FilterRule, type NameTemplate, type Sequence,
} from '../src/index.js'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'amev-2026', 'name-template.json')
const ref = new ReferenceData({
  library: [],
  combinations: [],
  bacnetTypes: {},
  bacnetUnits: {},
  nameTemplate: JSON.parse(readFileSync(TEMPLATE, 'utf8')) as NameTemplate,
  activeSources: [],
})

const points = ['HZG', 'hzg', 'RLT', 'ELT', 'a.b', 'axb', ''].map((g) => {
  const p = emptyDataPoint()
  p.bactwin.gewerk = g
  return p
})

const rule = (r: Partial<FilterRule>): FilterRule =>
  ({ field: 'bactwin.gewerk', operator: 'equals', value: 'HZG', case_sensitive: false, negated: false, ...r })

const sequence = (steps: unknown[]) => ({ schema_version: '1.0', steps })
const errorOf = (data: unknown) => {
  try {
    readSequence(data)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

describe('the sequence file', () => {
  it('the published JSON Schema is generated from the zod schema (update with: pnpm --filter @bactwin/mapping-engine schema:write)', async () => {
    await expect(`${JSON.stringify(sequenceJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../schema/mapping-sequence.schema.json')
  })

  it('is written with $schema, validates against the published schema, and reads back the same', () => {
    const seq: Sequence = {
      schema_version: SEQUENCE_FORMAT_VERSION,
      steps: [{
        name: 'Heizkreise',
        filter: [rule({ negated: true, case_sensitive: true }), rule({ field: 'state.ignore', operator: 'is_false', value: null })].map(toCondition),
        actions: [
          { field: 'bactwin.gewerk', value: 'HZG' },
          { field: 'bactwin.anlage_number', from: [{ field: 'ede.object_name', regex: 'HH(\\d+)' }], value: '$1' },
          { field: 'bactwin.ort', from: [{ field: 'bactwin.ort', regex: '^(.{7})' }, { field: 'ede.description', regex: '(.{8})$' }], value: '$1$2' },
          { field: 'state.reminder', value: false },
        ],
      }, { name: 'Kommentar', filter: [], actions: [{ field: 'state.comment', value: '' }] }],
    }
    const file = JSON.parse(JSON.stringify(sequenceToFile(seq))) as Record<string, unknown>
    expect(file['$schema']).toBe(SEQUENCE_SCHEMA_URL)
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(sequenceJsonSchema() as object)
    expect(validate(file), JSON.stringify(validate.errors)).toBe(true)
    expect(file['steps']).toEqual([
      {
        name: 'Heizkreise',
        filter: [{ field: 'bactwin.gewerk', regex: '(?-i:^(?!HZG$))' }, { field: 'state.ignore', regex: '^false$' }],
        actions: seq.steps[0]!.actions,
      },
      { name: 'Kommentar', filter: [], actions: [{ field: 'state.comment', value: '' }] },
    ])
    expect(readSequence(file)).toEqual(seq)
  })

  it.each([
    ['equals', rule({})],
    ['NOT case-sensitive equals', rule({ negated: true, case_sensitive: true })],
    ['alternatives', rule({ value: 'HZG|RLT', negated: true })],
    ['regex characters', rule({ value: 'a.b', negated: true })],
    ['NOT empty', rule({ operator: 'empty', value: null, negated: true })],
    ['NOT regex', rule({ operator: 'regex', value: '^a.b$', negated: true })],
  ])('a recorded %s filter replays the same selection and reads back as the same rule', (_name, r) => {
    const saved = readSequence(sequenceToFile({ schema_version: '1.0', steps: [{ name: 'x', filter: [toCondition(r)], actions: [{ field: 'state.reminder', value: true }] }] }))
    const back = toDsl(saved.steps[0]!.filter)
    expect(back.rules).toEqual([r])
    expect(applyFilter(points, back)).toEqual(applyFilter(points, { rules: [r] }))
  })

  it.each([
    ['an unknown key', [{ name: 'x', filter: [], actions: [{ field: 'bactwin.gewerk', value: 'X', vlaue: 'Y' }] }], 'step 1, actions 1'],
    ['a write at a position', [{ name: 'x', actions: [{ field: 'bactwin.ort', value: 'X', at: 3 }] }], 'step 1, actions 1'],
    ['a step without a name', [{ actions: [{ field: 'state.ignore', value: true }] }], 'step 1, name'],
    ['a blank name', [{ name: '  ', actions: [{ field: 'state.ignore', value: true }] }], 'step 1, name'],
    ['an unknown filter field', [{ name: 'x', filter: [{ field: 'ede.nope', regex: 'x' }], actions: [{ field: 'state.ignore', value: true }] }], 'step 1, filter 1, field'],
    ['a field that cannot be written', [{ name: 'x', actions: [{ field: 'state.messages', value: 'x' }] }], 'step 1, actions 1'],
    ['an invalid regex', [{ name: 'x', filter: [{ field: 'ede.object_name', regex: '(' }], actions: [{ field: 'state.ignore', value: true }] }], 'not a valid regular expression'],
    ['an invalid source regex', [{ name: 'x', actions: [{ field: 'bactwin.ort', value: '$1', from: [{ field: 'ede.description', regex: '(' }] }] }], 'not a valid regular expression'],
    ['a flag set to text', [{ name: 'x', actions: [{ field: 'state.ignore', value: 'true' }] }], 'step 1, actions 1'],
    ['text set to a flag value', [{ name: 'x', actions: [{ field: 'bactwin.gewerk', value: true }] }], 'step 1, actions 1'],
    ['a single source not in a list', [{ name: 'x', actions: [{ field: 'bactwin.gewerk', from: 'ede.object_name', value: 'X' }] }], 'step 1, actions 1, from'],
    ['an empty source list', [{ name: 'x', actions: [{ field: 'bactwin.gewerk', from: [], value: 'X' }] }], 'step 1, actions 1, from'],
    ['$0 in a template', [{ name: 'x', actions: [{ field: 'bactwin.gewerk', from: [{ field: 'ede.object_name', regex: 'x' }], value: '$0' }] }], '$0 is not a group'],
    ['a comment taken from a field', [{ name: 'x', actions: [{ field: 'state.comment', from: [{ field: 'ede.object_name', regex: '(x)' }], value: '$1' }] }], 'step 1, actions 1'],
    ['a step without actions', [{ name: 'x', filter: [] }], 'step 1, actions'],
    ['a missing value', [{ name: 'x', actions: [{ field: 'bactwin.gewerk', from: [{ field: 'ede.object_name', regex: 'x' }] }] }], 'step 1, actions 1'],
  ])('refuses %s, naming where', (_name, steps, where) => {
    expect(errorOf(sequence(steps))).toContain(where)
  })

  it('accepts $$ followed by 0 as a dollar sign and a zero', () => {
    expect(errorOf(sequence([{ name: 'x', actions: [{ field: 'bactwin.gewerk', from: [{ field: 'ede.object_name', regex: '(x)' }], value: '$$0$1' }] }]))).toBeNull()
  })

  it('refuses a file of a newer format, minor versions included, saying so', () => {
    expect(() => readSequence({ schema_version: '1.1', steps: [] })).toThrow(SequenceTooNewError)
    expect(() => readSequence({ schema_version: '2.0', steps: [] })).toThrow(SequenceTooNewError)
    expect(isNewer('5.10', '5.9')).toBe(true)
  })

  it('refuses a newer major version and an unknown top-level key', () => {
    expect(errorOf({ schema_version: '2.0', steps: [] })).toContain('2.0')
    expect(errorOf({ schema_version: '1.0', steps: [], extra: 1 })).toContain('extra')
  })

  it('knows no format before 1.0: a file without schema_version is invalid', () => {
    expect(errorOf({ version: '5.1', steps: [] })).toContain('schema_version')
  })

  it('refuses JSON that is no sequence instead of reading it as an empty old one', () => {
    for (const other of [{ name: 'x', dependencies: {} }, { header: {}, points: [] }, {}]) {
      expect(() => readSequence(other)).toThrow(/not a sequence file/)
    }
  })
})

describe('actions', () => {
  const named = (...names: string[]) => names.map((n) => {
    const p = emptyDataPoint()
    p.ede.object_name = n
    return p
  })

  it('fill a template from the capture groups of another field, and skip points where it does not match', () => {
    const pts = named('AHU01_ZUL', 'ahu07_abl', 'Boiler')
    const result = applyStep(pts, [], [{ field: 'bactwin.anlage', from: [{ field: 'ede.object_name', regex: '^AHU(\\d+)_(\\w+)' }], value: 'LA$1-$2 $$' }], ref)
    expect(pts.map((p) => p.bactwin.anlage)).toEqual(['LA01-ZUL $', 'LA07-abl $', ''])
    expect(result).toEqual({ matched: 3, changed: 2, skipped: 1 })
  })

  it('count the groups across sources in order, and skip a point when any source does not match', () => {
    const pts = named('X', 'X')
    pts[0]!.bactwin.ort = 'GS_140_xxxxxxxx_001'
    pts[0]!.ede.description = 'RT Serverr. OG 010A1914'
    pts[1]!.bactwin.ort = 'GS_140_xxxxxxxx_001'
    const result = applyStep(pts, [], [{
      field: 'bactwin.ort',
      from: [{ field: 'bactwin.ort', regex: '^(.{7})' }, { field: 'ede.description', regex: '(.{8})$' }, { field: 'bactwin.ort', regex: '^.{15}(.*)$' }],
      value: '$1$2$3',
    }], ref)
    expect(pts.map((p) => p.bactwin.ort)).toEqual(['GS_140_010A1914_001', 'GS_140_xxxxxxxx_001'])
    expect(result).toEqual({ matched: 2, changed: 1, skipped: 1 })
  })

  it('rewrite the written field itself when it is a source', () => {
    const [p] = named('x')
    p!.bactwin.ort = 'B1EG01'
    applyStep([p!], [], [{ field: 'bactwin.ort', from: [{ field: 'bactwin.ort', regex: '^(..)..(.*)$' }], value: '$1OG$2' }], ref)
    expect(p!.bactwin.ort).toBe('B1OG01')
  })

  it('write a fixed value as it is, dollar signs included', () => {
    const [p] = named('x')
    applyStep([p!], [], [{ field: 'state.comment', value: 'costs $1' }], ref)
    expect(p!.state.comment).toBe('costs $1')
  })

  it('select once, before any write', () => {
    const pts = named('a', 'b')
    const results = runSequence(
      { schema_version: '1.0', steps: [{ name: 'x', filter: [{ field: 'bactwin.gewerk', regex: '^$' }], actions: [{ field: 'bactwin.gewerk', value: 'HZG' }, { field: 'state.reminder', value: true }] }] },
      pts,
      ref,
    )
    expect(pts.every((p) => p.state.reminder)).toBe(true)
    expect(results[0]).toMatchObject({ step_index: 0, matched: 2 })
  })
})
