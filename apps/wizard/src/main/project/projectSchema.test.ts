import Ajv2020 from 'ajv/dist/2020.js'
import { expect, it } from 'vitest'

import { importEde } from './importing.js'
import { serializeProject } from './projectFile.js'
import { PROJECT_SCHEMA_URL, projectJsonSchema } from './projectSchema.js'
import { applySet } from './editing.js'
import { DEMO_EDE, testSession } from './testing.js'

it('the published JSON Schema is generated from the zod schema (update with: pnpm --filter @bactwin/wizard schema:write)', async () => {
  await expect(`${JSON.stringify(projectJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../schema/project.schema.json')
})

it('a saved project carries $schema and validates against the published JSON Schema', async () => {
  const s = testSession()
  await importEde(s, [DEMO_EDE], { mode: 'new' })
  applySet(s, { filter: { rules: [] }, actions: [{ field: 'bactwin.gewerk', value: 'HZG' }], note: 'step' })
  const file = JSON.parse(serializeProject(s)) as { $schema: string }
  expect(file.$schema).toBe(PROJECT_SCHEMA_URL)
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(projectJsonSchema() as object)
  expect(validate(file), JSON.stringify(validate.errors)).toBe(true)
})
