/**
 * The corpus's shape: every fixture against the fixture schema, every sequence it carries against
 * the published format schema, and index.json against the files. conformance.test.ts checks content.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(PKG, 'test', 'fixtures')

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const readSchema = (path: string): AnySchema => readJson(path) as AnySchema

/** Every fixture on disk, as `group/name`, in the order the index uses. */
function fixturePaths(): string[] {
  const root = FIXTURES
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .flatMap(group =>
      readdirSync(join(root, group.name))
        .filter(f => f.endsWith('.json'))
        .map(f => `${group.name}/${f.slice(0, -'.json'.length)}`),
    )
    .sort()
}

function errorsOf(validate: ValidateFunction, value: unknown): string[] {
  return validate(value) ? [] : (validate.errors ?? []).map(e => `${e.instancePath || '/'}: ${e.message}`)
}

interface Fixture {
  operation: { sequence?: unknown }
  expected: { error?: unknown }
}

describe('the conformance corpus', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  const fixtureSchema = ajv.compile(readSchema(join(PKG, 'schema/fixture.schema.json')))
  const sequenceSchema = ajv.compile(readSchema(join(PKG, 'schema/mapping-sequence.schema.json')))
  const paths = fixturePaths()

  it('is not empty', () => {
    expect(paths.length).toBeGreaterThan(0)
  })

  it.each(paths)('%s matches the fixture schema', name => {
    const fixture = readJson(join(FIXTURES, `${name}.json`))
    expect(errorsOf(fixtureSchema, fixture)).toEqual([])
  })

  it.each(paths)('%s carries a sequence in the published format', name => {
    const { operation, expected } = readJson(join(FIXTURES, `${name}.json`)) as Fixture
    // Refused files are refused on purpose.
    if (operation.sequence === undefined || expected.error !== undefined) return
    expect(errorsOf(sequenceSchema, operation.sequence)).toEqual([])
  })

  it('is listed completely in index.json', () => {
    const index = readJson(join(FIXTURES, 'index.json')) as { count: number; fixtures: string[] }
    expect(index.fixtures.slice().sort()).toEqual(paths)
    expect(index.count).toBe(paths.length)
  })
})
