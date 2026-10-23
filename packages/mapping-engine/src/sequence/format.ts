/**
 * The sequence file (a recipe: no results, no timestamps), the single source of its format.
 * schema/mapping-sequence.schema.json is generated from it (pnpm --filter @bactwin/mapping-engine
 * schema:write; a test fails while it is stale) and published with the docs.
 */

import { z } from 'zod'
import { FLAG_FIELDS, WRITABLE_FIELDS } from '../apply/index.js'
import type { CombinationMode } from '../combinations/index.js'
import { READABLE_FIELDS } from '../filter/index.js'
import { SequenceFormatError, SequenceTooNewError } from './error.js'

export { SequenceFormatError, SequenceTooNewError }

export const SEQUENCE_FORMAT_VERSION = '1.0'
export const SEQUENCE_SCHEMA_URL = 'https://diltanalytics.github.io/dilt-bactwin-wizard/schema/mapping-sequence.schema.json'

const compiles = (regex: string) => {
  try {
    new RegExp(regex, 'i')
    return true
  } catch {
    return false
  }
}

const Regex = z.string().refine(compiles, 'not a valid regular expression')
const ReadableField = z.enum(READABLE_FIELDS as [string, ...string[]]).meta({ id: 'readable_field', description: 'A field of a data point, as area.field' })
const COMMENT_FIELD = 'state.comment'
const TEMPLATE_FIELDS = WRITABLE_FIELDS.filter((f) => !FLAG_FIELDS.includes(f) && f !== COMMENT_FIELD)

/** Whether a template refers to `$0`, which is not a capture group. */
const usesWholeMatch = (template: string) => [...template.matchAll(/\$(\$|\d)/g)].some((m) => m[1] === '0')

export const ConditionSchema = z
  .strictObject({
    field: ReadableField.describe('The field read, as area.field'),
    regex: Regex.describe(
      'Must match the field\'s value as text (absent is ""), case-insensitively unless written inside (?-i:...)',
    ),
  })
  .describe('A point is selected when every condition matches')

const FlagActionSchema = z.strictObject({
  field: z.enum(FLAG_FIELDS as [string, ...string[]]).describe('The flag switched'),
  value: z.boolean(),
})

const CommentActionSchema = z.strictObject({
  field: z.literal(COMMENT_FIELD).describe('The comment written'),
  value: z.string().describe('Written as it is'),
})

export const ActionSourceSchema = z
  .strictObject({
    field: ReadableField.describe('The field read, as area.field; may be the written field itself'),
    regex: Regex.describe('Must match the field\'s value as text (absent is ""), case-insensitively unless written inside (?-i:...); a point where it does not match is skipped'),
  })
  .describe('A field the value is taken from')

const FieldActionSchema = z
  .strictObject({
    field: z.enum(TEMPLATE_FIELDS as [string, ...string[]]).describe('The field written'),
    value: z
      .string()
      .describe('Written as it is; with from a template where $1-$9 are the capture groups of all sources, counted in order, and $$ a dollar sign'),
    from: z.array(ActionSourceSchema).min(1).optional().describe('The sources the template reads, in order'),
  })
  .refine((a) => a.from === undefined || !usesWholeMatch(a.value), { message: "$0 is not a group; capture the whole match as (...) and use its number", path: ['value'] })

export const SetActionSchema = z.discriminatedUnion('field', [FlagActionSchema, CommentActionSchema, FieldActionSchema]).describe('One write onto every selected point')

/** Which keys the step editor offers. */
export const CombinationModeSchema = z.enum(['combination', 'gewerk_specific', 'free'] as const satisfies readonly CombinationMode[])

export const StepSchema = z
  .strictObject({
    name: z.string().trim().min(1).describe('What the step does, shown in the sequence list'),
    filter: z.array(ConditionSchema).default([]).describe('No conditions selects every point'),
    actions: z.array(SetActionSchema).min(1).describe('Applied in order to the points the filter selected before any of them'),
    disabled: z.boolean().optional().describe('Kept in the sequence but passed over when it is replayed'),
    combination_mode: CombinationModeSchema
      .optional()
      .describe('Which keys the editor offered when the step was written: those the combinations allow, those common for the trade, or all. Does not change what the step does'),
  })
  .describe('Select points, then write onto them')
export type SequenceStep = z.output<typeof StepSchema>

export const SequenceSchema = z
  .strictObject({
    $schema: z.string().optional().describe('URL of this schema, for editors'),
    schema_version: z.string().regex(/^1\.\d+$/).describe(`Format version. Files of a newer version, minor included, are refused; ${SEQUENCE_FORMAT_VERSION} is current`),
    steps: z.array(StepSchema).describe('Replayed in order: a later step sees what earlier ones wrote'),
  })
  .describe('A BACtwin Wizard mapping sequence')
export type Sequence = z.output<typeof SequenceSchema>

export function emptySequence(): Sequence {
  return { schema_version: SEQUENCE_FORMAT_VERSION, steps: [] }
}

/** "steps.3.actions.0.regex" as "step 4, actions 1, regex". */
function issuePath(path: PropertyKey[]): string {
  const parts: string[] = []
  for (let i = 0; i < path.length; i++) {
    const key = String(path[i])
    const next = path[i + 1]
    if (typeof next === 'number') {
      parts.push(`${key === 'steps' ? 'step' : key} ${next + 1}`)
      i++
    } else {
      parts.push(key)
    }
  }
  return parts.join(', ') || '/'
}

/** Whether format version `a` ("major.minor") is newer than `b`. */
export function isNewer(a: string, b: string): boolean {
  const [am = 0, an = 0] = a.split('.').map(Number)
  const [bm = 0, bn = 0] = b.split('.').map(Number)
  return am > bm || (am === bm && an > bn)
}

/** A sequence file's content; a file of a newer format is refused. */
export function readSequence(data: unknown): Sequence {
  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data)
  if (isObject && !('schema_version' in data) && !('steps' in data)) {
    throw new SequenceFormatError('not a sequence file: it has neither "schema_version" nor "steps"')
  }
  const version = isObject && 'schema_version' in data ? data.schema_version : null
  if (typeof version === 'string' && isNewer(version, SEQUENCE_FORMAT_VERSION)) throw new SequenceTooNewError(version)
  const parsed = SequenceSchema.safeParse(data)
  if (!parsed.success) {
    throw new SequenceFormatError(parsed.error.issues.map((i) => {
      const keys = i.code === 'unrecognized_keys' ? ` (${i.keys.join(', ')})` : ''
      return `${issuePath(i.path)}: ${i.message}${keys}`
    }).join('; '))
  }
  const { $schema: _, ...sequence } = parsed.data
  return { ...sequence, schema_version: SEQUENCE_FORMAT_VERSION }
}

/** A sequence as written to disk. Inside a project file it goes without `$schema`. */
export function sequenceToFile(sequence: Sequence, { embedded = false } = {}): unknown {
  return {
    ...(embedded ? {} : { $schema: SEQUENCE_SCHEMA_URL }),
    schema_version: SEQUENCE_FORMAT_VERSION,
    steps: sequence.steps.map((s) => ({
      name: s.name,
      filter: s.filter,
      actions: s.actions,
      ...(s.disabled ? { disabled: true } : {}),
      ...(s.combination_mode ? { combination_mode: s.combination_mode } : {}),
    })),
  }
}

/** The JSON Schema published for the sequence file. */
export function sequenceJsonSchema(): unknown {
  return { $id: SEQUENCE_SCHEMA_URL, ...z.toJSONSchema(SequenceSchema, { io: 'input', target: 'draft-2020-12' }) }
}
