/** Replay the conformance corpus: the engine must reproduce every fixture exactly. Only the test reads files. */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  DataPointSchema,
  ReferenceData,
  applyActions,
  exportReplacementCsv,
  selectForExport,
  xlsxColumns,
  emptyFilter,
  markDuplicateNames,
  parseEde,
  readSequence,
  runSequence,
  serializeDataPoint,
  translateBacnetFields,
  validOptionsBulk,
  validOptionsFree,
  validOptionsGewerkSpecific,
  validateAndUpdate,
  buildBACtwinDescription,
  buildBACtwinName,
  isNameComplete,
  applyFilter,
  FilterDslSchema,
  EdeFormatError,
  SequenceFormatError,
  type CombinationRow,
  type DataPoint,
  type LibraryEntry,
  type NameTemplate,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const CORPUS = HERE
const DATA = join(REPO, 'data')

// --- reference-data bundles ------------------------------------------------------------

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/** Minimal CSV reader for the reference tables. They have no quoted fields. */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = (lines[0] ?? '').split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()))
    return row
  })
}

function bacnetTables() {
  const types: Record<string, { bacnet_object_type: string; acronym: string; description: string }> = {}
  for (const row of readCsv(join(DATA, 'bacnet_keys', 'bacnet_types.csv'))) {
    const key = (row['ede_object_type'] ?? '').trim()
    if (!key) continue
    types[key] = {
      bacnet_object_type: row['bacnet_object_type'] ?? '',
      acronym: row['bacnet_object_acronym'] ?? '',
      description: row['bacnet_object_description'] ?? '',
    }
  }
  const units: Record<string, { unit: string }> = {}
  for (const row of readCsv(join(DATA, 'bacnet_keys', 'bacnet_unitcodes.csv'))) {
    const key = (row['ede_unit-code'] ?? row['ede_unit_code'] ?? '').trim()
    if (!key) continue
    units[key] = { unit: row['unit'] || row['bacnet_unit'] || '' }
  }
  return { types, units }
}

const PLUGINS = join(REPO, 'plugins')

const nameTemplate = (): NameTemplate =>
  readJson<NameTemplate>(join(PLUGINS, 'amev-2026', 'name-template.json'))

/** Read every plugin's keys and combinations, the way the application will. */
function readPlugins(): { library: LibraryEntry[]; combinations: CombinationRow[] } {
  const library: LibraryEntry[] = []
  const combinations: CombinationRow[] = []
  for (const id of readdirSync(PLUGINS).sort()) {
    if (existsSync(join(PLUGINS, id, 'keys.json'))) library.push(...readJson<LibraryEntry[]>(join(PLUGINS, id, 'keys.json')))
    if (existsSync(join(PLUGINS, id, 'combinations.csv'))) combinations.push(...readCsv(join(PLUGINS, id, 'combinations.csv')))
  }
  return { library, combinations }
}

const bundleCache = new Map<string, ReferenceData>()

function loadBundle(name: string): ReferenceData {
  const cached = bundleCache.get(name)
  if (cached) return cached

  const { types, units } = bacnetTables()
  let ref: ReferenceData

  if (name === 'bundled') {
    const { library, combinations } = readPlugins()
    ref = new ReferenceData({
      library,
      combinations,
      bacnetTypes: types,
      bacnetUnits: units,
      nameTemplate: nameTemplate(),
      activeSources: [...new Set(library.map((e) => e.source ?? '').filter(Boolean))],
    })
  } else {
    const bundle = readJson<{
      library: LibraryEntry[]
      combinations: CombinationRow[]
      activeSources: string[]
    }>(join(CORPUS, 'reference', `${name}.json`))
    ref = new ReferenceData({
      library: bundle.library,
      combinations: bundle.combinations,
      bacnetTypes: types,
      bacnetUnits: units,
      nameTemplate: nameTemplate(),
      activeSources: bundle.activeSources,
    })
  }

  bundleCache.set(name, ref)
  return ref
}

// --- fixtures --------------------------------------------------------------------------

interface Fixture {
  id: string
  title: string
  why: string
  referenceData: string
  operation: Record<string, any>
  expected: Record<string, any>
}

function loadFixtures(): Fixture[] {
  const root = join(CORPUS, 'fixtures')
  const out: Fixture[] = []
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const file of readdirSync(join(root, group.name)).sort()) {
      if (file.endsWith('.json')) out.push(readJson<Fixture>(join(root, group.name, file)))
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

const parsePoints = (raw: unknown[]): DataPoint[] => raw.map((p) => DataPointSchema.parse(p))
const dump = (points: DataPoint[]) => points.map(serializeDataPoint)

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Run one fixture and return what this engine produced, in the corpus's own shape. */
function run(fixture: Fixture): Record<string, unknown> {
  const ref = loadBundle(fixture.referenceData)
  const op = fixture.operation

  switch (op['kind']) {
    case 'parse_ede': {
      const input: string | Uint8Array = op['contentHex'] ? hexToBytes(op['contentHex']) : op['content']
      try {
        const res = parseEde(input, { filename: op['filename'] })
        return { points: dump(res.points), warnings: res.warnings, meta: res.meta }
      } catch (e) {
        if (e instanceof EdeFormatError) return { error: { type: 'EDEFormatError', code: e.code, message: e.message } }
        throw e
      }
    }

    case 'filter': {
      const points = parsePoints(op['points'])
      const matched = applyFilter(points, FilterDslSchema.parse(op['filter']))
      return { matched: matched.map((p) => points.indexOf(p)) }
    }

    case 'build_name': {
      const point = DataPointSchema.parse(op['point'])
      return {
        name: buildBACtwinName(ref.nameTemplate, point.bactwin),
        description: buildBACtwinDescription(ref.nameTemplate, point.bactwin, ref.library),
        complete: isNameComplete(ref.nameTemplate, point.bactwin),
      }
    }

    case 'valid_options': {
      const points = parsePoints(op['points'])
      const field = op['field'] as string
      if (op['mode'] === 'free') return { result: { options: validOptionsFree(field, ref) } }
      if (op['mode'] === 'combination') {
        return { result: validOptionsBulk(points, field, ref, undefined, true) }
      }
      return { result: validOptionsGewerkSpecific(points, field, ref) }
    }

    case 'validate': {
      const points = parsePoints(op['points'])
      translateBacnetFields(points, ref)
      validateAndUpdate(points, ref)
      return { points: dump(points) }
    }

    case 'validate_and_mark_duplicates': {
      const points = parsePoints(op['points'])
      validateAndUpdate(points, ref)
      markDuplicateNames(points)
      return { duplicated: points.flatMap((p, i) => (p.state.duplicated_name ? [i] : [])) }
    }

    case 'apply_set': {
      const points = parsePoints(op['points'])
      const result = applyActions(applyFilter(points, FilterDslSchema.parse(op['filter'])), op['actions'], ref)
      return { points: dump(points), result }
    }

    case 'apply_sequence': {
      const points = parsePoints(op['points'])
      const sequence = readSequence(op['sequence'])
      const results = runSequence(sequence, points, ref)
      return 'results' in fixture.expected ? { points: dump(points), results } : { points: dump(points) }
    }

    case 'export': {
      const points = parsePoints(op['points'])
      const selected = selectForExport(points, op['scope'], emptyFilter())
      if (op['format'] === 'replacement') return exportReplacementCsv(selected)
      // The column set is pinned, not the XLSX bytes.
      return { columns: xlsxColumns() }
    }

    case 'load_sequence': {
      try {
        readSequence(op['sequence'])
        return { loaded: true }
      } catch (e) {
        // Only the error class is pinned, not the message.
        return { error: { type: e instanceof SequenceFormatError ? 'ValidationError' : (e as Error).name } }
      }
    }

    default:
      throw new Error(`unknown operation kind: ${op['kind']}`)
  }
}

// --- the suite -------------------------------------------------------------------------

const fixtures = loadFixtures()

describe('conformance corpus', () => {
  it('loads every fixture', () => {
    const index = readJson<{ count: number }>(join(CORPUS, 'fixtures', 'index.json'))
    expect(fixtures.length).toBe(index.count)
    expect(fixtures.length).toBeGreaterThan(0)
  })

  const groups = [...new Set(fixtures.map((f) => f.id.split('/')[0] as string))].sort()
  for (const group of groups) {
    describe(group, () => {
      for (const fixture of fixtures.filter((f) => f.id.startsWith(`${group}/`))) {
        it(fixture.title, () => {
          const actual = run(fixture)
          for (const [key, expected] of Object.entries(fixture.expected)) {
            // Messages may differ; the error class and everything else must match.
            if (key === 'error') {
              const error = actual['error'] as { type?: string; code?: string } | undefined
              expect(error?.type, fixture.why).toBeDefined()
              // A fixture may pin the error code; the message is never pinned.
              const code = (expected as { code?: string }).code
              if (code !== undefined) expect(error?.code, `${fixture.id}: ${fixture.why}`).toBe(code)
              continue
            }
            expect(actual[key], `${fixture.id}: ${fixture.why}`).toEqual(expected)
          }
        })
      }
    })
  }
})
