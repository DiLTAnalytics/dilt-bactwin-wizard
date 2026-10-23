/**
 * The .bactwin project file, the single source of its format. schema/project.schema.json is
 * generated from it (pnpm --filter @bactwin/wizard schema:write; a test fails while it is stale)
 * and published with the docs.
 */

import { z } from 'zod'
import { BACtwinDataSchema, EdeDataSchema } from '@bactwin/mapping-engine'

export const PROJECT_FORMAT_VERSION = '1.0'
export const PROJECT_SCHEMA_URL = 'https://diltanalytics.github.io/dilt-bactwin-wizard/schema/project.schema.json'

const [MAJOR] = PROJECT_FORMAT_VERSION.split('.')

const SourceFields = {
  filename: z.string().describe('Name of the EDE file'),
  invalid: z
    .record(z.string(), z.string())
    .default({})
    .describe('Cells refused on import, as their original text by EDE field; each is shown as an error on the point'),
  duplicated_keyname: z
    .boolean()
    .default(false)
    .describe('The source repeated this point\'s identity; the repeat was not imported'),
  missing_from_source: z
    .boolean()
    .default(false)
    .describe('The source file was updated and no longer contains this point; it is kept, not deleted'),
}

export const StoredPointSchema = z
  .strictObject({
    source: z.strictObject(SourceFields).describe('Where the point came from'),
    ede: z.strictObject(EdeDataSchema.shape).prefault({}).describe('The imported row, typed as in the EDE row schema; absent numbers and booleans are null'),
  })
  .describe(
    'One imported data point. Fields at their default and empty areas are left out. Its translation and status are not stored: they are the result of the sequence, replayed on load.',
  )
export type StoredPoint = z.input<typeof StoredPointSchema>

const ColumnIds = z.array(z.string()).describe('Column ids, in order')

export const TableLayoutSchema = z
  .strictObject({
    pinned_left: ColumnIds.optional().describe('Columns kept at the left edge'),
    pinned_right: ColumnIds.optional().describe('Columns kept at the right edge; absent: the BACtwin name'),
    widths: z.record(z.string(), z.number().int().min(16)).optional().describe('Widths set by hand, in pixels; other columns fit their content'),
  })
  .describe('How the point table is laid out')
export type TableLayout = z.output<typeof TableLayoutSchema>

export const ProjectFileSchema = z
  .strictObject({
    $schema: z.string().optional().describe('URL of this schema, for editors'),
    schema_version: z
      .string()
      .regex(new RegExp(`^${MAJOR}\\.\\d+$`))
      .describe(`Format version. Files of a newer version, minor included, are refused; ${PROJECT_FORMAT_VERSION} is current`),
    header: z.strictObject({
      project_name: z.string().default(''),
      ede_sources: z
        .array(
          z.strictObject({
            filename: z.string(),
            imported_at: z.string().optional().describe('Import time, ISO 8601'),
            meta: z.record(z.string(), z.string()).optional().describe('The EDE file\'s own header lines (lines 2-7) as KEY: value'),
            path: z.string().optional().describe('Where the file was, relative to the project file, with / separators. Absent when it was on another drive'),
            sha256: z.string().regex(/^[0-9a-f]{64}$/).optional().describe('Checksum of the file as imported, to tell whether it changed since'),
            size: z.number().int().min(0).optional().describe('Size in bytes as imported'),
          }),
        )
        .default([])
        .describe('Imported EDE files, one entry per import. Their data is in points; the file is never needed to open the project'),
      sequences: z
        .array(z.strictObject({ path: z.string().describe('Relative to the project file, with / separators; absolute when on another drive') }))
        .default([])
        .describe('The sequence files, in the order they run. Each is a file of its own, e.g. one shared between projects'),
      layout: z
        .strictObject({ table: TableLayoutSchema.optional() })
        .optional()
        .describe('How the project is shown, so it opens the same for everyone'),
      reference: z
        .strictObject({
          template: z.string().describe('Name template version'),
          plugins: z.array(z.strictObject({ id: z.string(), version: z.string() })).describe('Enabled plugins'),
        })
        .optional()
        .describe('Reference data the project was saved with; opening with different data shows the differences'),
    }),
    points: z.array(StoredPointSchema).default([]),
  })
  .describe('A BACtwin Wizard project')

/** The JSON Schema published for the project file. */
export function projectJsonSchema(): unknown {
  return { $id: PROJECT_SCHEMA_URL, ...z.toJSONSchema(ProjectFileSchema, { io: 'input', target: 'draft-2020-12' }) }
}
