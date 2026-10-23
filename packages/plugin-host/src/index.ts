/**
 * Reference-data plugins (key libraries, combination catalogues, name templates): validating and
 * merging them. A plugin is data only, never code. Pure: the caller reads the files.
 */

import { parse } from 'csv-parse/browser/esm/sync'
import { z } from 'zod'
import { BACTWIN_FIELDS, COMBINATION_COLUMNS, ENGINE_VERSION, type CombinationRow, type LibraryEntry, type NameTemplate, type ReferenceDataInput } from '@bactwin/mapping-engine'

export const PROVIDES = ['combinations', 'keys', 'name-template'] as const
export type Provides = (typeof PROVIDES)[number]

export const PluginManifestSchema = z.object({
  /** Directory-safe identifier, unique across installed plugins. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase letters, digits and hyphens'),
  name: z.string().min(1),
  version: z.string().min(1),
  /** The `source` its library entries carry, which the active-source toggle switches on. Usually the id. */
  sourceId: z.string().min(1),
  /** Semver range of the mapping engine this plugin targets, e.g. "^1.0.0". */
  engineRange: z.string().min(1),
  /** SPDX identifier, or a LicenseRef. Shown in the About dialog. */
  license: z.string().min(1),
  provides: z.array(z.enum(PROVIDES)).min(1),
  /** Ids of plugins it builds on; it is merged only when they are enabled too. */
  requires: z.array(z.string()).default([]),
  description: z.string().optional(),
  homepage: z.string().optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

/** The fixed files a plugin folder may hold, by name. */
export const PLUGIN_FILES = {
  manifest: 'bactwin-plugin.json',
  keys: 'keys.json',
  combinations: 'combinations.csv',
  nameTemplate: 'name-template.json',
} as const

/** One plugin's files, as read by the caller; absent files are left out. */
export interface PluginFiles {
  manifest: string
  keys?: string
  combinations?: string
  nameTemplate?: string
}

export type IssueSeverity = 'error' | 'warning'

export interface PluginIssue {
  pluginId: string
  severity: IssueSeverity
  message: string
}

export interface LoadedPlugin {
  manifest: PluginManifest
  library: LibraryEntry[]
  combinations: CombinationRow[]
  nameTemplate: NameTemplate | null
}

/**
 * Parse combination CSV. An empty cell is a wildcard, so cells are trimmed but never dropped. Throws
 * when no column is a name block, e.g. a file whose separator was not recognised.
 */
export function parseCombinationCsv(text: string): CombinationRow[] {
  const { header, rows } = readCsv(text)
  if (header.length && !header.some((h) => (COMBINATION_COLUMNS as readonly string[]).includes(h))) {
    throw new Error(`none of the columns ${COMBINATION_COLUMNS.join(', ')} found in the header "${header.join('|')}"`)
  }
  return rows
}

/** A CSV file with a header row as records, every cell trimmed. */
export function parseCsv(text: string): Record<string, string>[] {
  return readCsv(text).rows
}

/**
 * Separated by commas, or by semicolons as German Excel saves it (whichever the header has more of).
 * Quoted cells may hold separators and line breaks; broken quoting or a row of another length throws, naming the line.
 */
function readCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const first = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/, 1)[0] ?? ''
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const [header = [], ...records] = parse(text, { bom: true, delimiter, trim: true, skip_empty_lines: true }) as string[][]
  return { header, rows: records.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) }
}

/** The BACnet object-type and unit tables (data/bacnet_keys). A unit with no symbol falls back to its BACnet name. */
export function parseBacnetTables(typesCsv: string, unitsCsv: string): {
  types: ReferenceDataInput['bacnetTypes']
  units: ReferenceDataInput['bacnetUnits']
} {
  const types: ReferenceDataInput['bacnetTypes'] = {}
  for (const row of parseCsv(typesCsv)) {
    const key = row['ede_object_type'] ?? ''
    if (key) {
      types[key] = {
        bacnet_object_type: row['bacnet_object_type'] ?? '',
        acronym: row['bacnet_object_acronym'] ?? '',
        description: row['bacnet_object_description'] ?? '',
      }
    }
  }
  const units: ReferenceDataInput['bacnetUnits'] = {}
  for (const row of parseCsv(unitsCsv)) {
    const key = row['ede_unit-code'] || row['ede_unit_code'] || ''
    if (key) units[key] = { unit: row['unit'] || row['bacnet_unit'] || '' }
  }
  return { types, units }
}

const LibraryEntrySchema = z.object({
  block: z.string().min(1),
  key: z.string().min(1),
  name: z.string().optional(),
  description: z.string().nullish(),
  default_gewerk: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
  source: z.string().optional(),
  key_number: z.string().optional(),
  /** Set by the AMEV export on its %% medium keys; not read by the application. */
  placeholder: z.boolean().optional(),
})

const SegmentSchema = z.object({
  id: z.string(),
  type: z.enum(['free', 'key', 'key_indexed']),
  required: z.boolean().optional(),
  optional_display: z.boolean().optional(),
  placeholder: z.string().optional(),
  index_field: z.string().optional(),
  index_digits: z.number().optional(),
  index_placeholder: z.string().optional(),
  digits: z.number().optional(),
})

const NameTemplateSchema = z.object({
  version: z.string(),
  separator: z.string(),
  index_default: z.string().optional(),
  segments: z.array(SegmentSchema).min(1),
})

/** Columns a combination file may have besides the name blocks. */
const COMBINATION_EXTRA_COLUMNS = ['object_type', 'unit_code', 'bactwin_name']

/** Keys of `value` that `schema` does not know: a typo the parse would drop silently. */
function unknownKeys(value: unknown, schema: z.ZodObject): string[] {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).filter((k) => !(k in schema.shape)) : []
}

/** "x" (3), "y" (1): unknown names with how often they occur. */
const counted = (names: string[]) => [...new Set(names)].map((n) => `"${n}" (${names.filter((x) => x === n).length})`).join(', ')

/** Load one plugin. A malformed plugin yields issues and no plugin, never a throw. */
export function loadPlugin(files: PluginFiles): { plugin: LoadedPlugin | null; issues: PluginIssue[] } {
  const issues: PluginIssue[] = []
  let raw: unknown
  try {
    raw = JSON.parse(files.manifest)
  } catch (e) {
    return { plugin: null, issues: [{ pluginId: '<unknown>', severity: 'error', message: `bactwin-plugin.json is not valid JSON: ${(e as Error).message}` }] }
  }

  const parsed = PluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '<unknown>'
    return {
      plugin: null,
      issues: parsed.error.issues.map((i) => ({
        pluginId: id,
        severity: 'error' as const,
        message: `manifest ${i.path.join('.') || '(root)'}: ${i.message}`,
      })),
    }
  }
  const manifest = parsed.data
  const fail = (message: string) => issues.push({ pluginId: manifest.id, severity: 'error', message })
  const warn = (message: string) => issues.push({ pluginId: manifest.id, severity: 'warning', message })
  const unknownManifest = unknownKeys(raw, PluginManifestSchema)
  if (unknownManifest.length) warn(`${PLUGIN_FILES.manifest}: unknown fields ${counted(unknownManifest)} ignored`)

  const compatible = satisfies(ENGINE_VERSION, manifest.engineRange)
  if (compatible === false) fail(`needs engine ${manifest.engineRange}, this is ${ENGINE_VERSION}`)
  if (compatible === null) warn(`engineRange "${manifest.engineRange}" cannot be checked; supported forms are 1.2.3, ^1.2.3, ~1.2.3, >=1.2.3`)

  const library: LibraryEntry[] = []
  const blocks = new Set<string>(BACTWIN_FIELDS.filter((f) => f.kind === 'key').map((f) => f.id))
  if (files.keys !== undefined) {
    const path = PLUGIN_FILES.keys
    let entries: unknown = null
    try {
      entries = JSON.parse(files.keys)
      if (!Array.isArray(entries)) fail(`${path}: a key library must be a JSON array`)
    } catch (e) {
      fail(`${path}: not valid JSON (${(e as Error).message})`)
    }
    const unknown: string[] = []
    const seen = new Map<string, number>()
    if (Array.isArray(entries)) entries.forEach((entry, i) => {
      unknown.push(...unknownKeys(entry, LibraryEntrySchema))
      const r = LibraryEntrySchema.safeParse(entry)
      if (!r.success) {
        fail(`${path}[${i}]: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`)
        return
      }
      // A key in an unknown block would never be offered anywhere.
      if (!blocks.has(r.data.block)) {
        fail(`${path}[${i}]: unknown block "${r.data.block}"; one of ${[...blocks].join(', ')}`)
        return
      }
      // The manifest's sourceId wins, so no entry escapes the active-source toggle.
      if (r.data.source && r.data.source !== manifest.sourceId) {
        warn(`${path}[${i}]: entry declares source "${r.data.source}" but the manifest declares "${manifest.sourceId}"; using the manifest`)
      }
      const compound = `${r.data.block}:${r.data.key}`
      if (seen.has(compound)) warn(`${path}[${i}]: ${compound} is defined again (first at [${seen.get(compound)}]); the later one is used`)
      seen.set(compound, i)
      library.push({ ...r.data, source: manifest.sourceId } as LibraryEntry)
    })
    if (unknown.length) warn(`${path}: unknown fields ${counted(unknown)} ignored`)
  }

  const combinations: CombinationRow[] = []
  if (files.combinations !== undefined) {
    try {
      combinations.push(...parseCombinationCsv(files.combinations))
      if (combinations.length === 0) warn(`${PLUGIN_FILES.combinations}: no combination rows`)
      // A misspelt block column would restrict nothing.
      const known = new Set<string>([...COMBINATION_COLUMNS, ...COMBINATION_EXTRA_COLUMNS])
      const unknown = Object.keys(combinations[0] ?? {}).filter((c) => !known.has(c))
      if (unknown.length) warn(`${PLUGIN_FILES.combinations}: unknown columns ${unknown.map((c) => `"${c}"`).join(', ')} ignored`)
    } catch (e) {
      fail(`${PLUGIN_FILES.combinations}: ${(e as Error).message}`)
    }
  }

  let nameTemplate: NameTemplate | null = null
  if (files.nameTemplate !== undefined) {
    const path = PLUGIN_FILES.nameTemplate
    const content = files.nameTemplate
    try {
      const json: unknown = JSON.parse(content)
      const segments = (json as { segments?: unknown }).segments
      const unknown = [...unknownKeys(json, NameTemplateSchema), ...(Array.isArray(segments) ? segments.flatMap((seg) => unknownKeys(seg, SegmentSchema)) : [])]
      if (unknown.length) warn(`${path}: unknown fields ${counted(unknown)} ignored`)
      const r = NameTemplateSchema.safeParse(json)
      if (r.success) {
        nameTemplate = r.data as NameTemplate
        // An unknown segment would render empty in every name.
        const known = new Set<string>(BACTWIN_FIELDS.map((f) => f.id))
        for (const seg of nameTemplate.segments) {
          for (const id of [seg.id, seg.index_field]) if (id && !known.has(id)) fail(`${path}: unknown segment "${id}"`)
        }
      } else fail(`${path}: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`)
    } catch (e) {
      fail(`${path}: not valid JSON (${(e as Error).message})`)
    }
  }

  // What the manifest promises must be there, and the other way round.
  const delivered = new Set<Provides>()
  if (library.length > 0) delivered.add('keys')
  if (combinations.length > 0) delivered.add('combinations')
  if (nameTemplate) delivered.add('name-template')
  for (const promised of manifest.provides) {
    if (!delivered.has(promised)) fail(`manifest promises "${promised}" but the plugin provides none`)
  }
  for (const found of delivered) {
    if (!manifest.provides.includes(found)) warn(`provides "${found}" without declaring it in the manifest`)
  }

  if (issues.some((i) => i.severity === 'error')) return { plugin: null, issues }
  return { plugin: { manifest, library, combinations, nameTemplate }, issues }
}

export interface MergeOptions {
  /** Only these plugin ids contribute. Absent means all of them. */
  enabled?: string[]
  bacnetTypes: ReferenceDataInput['bacnetTypes']
  bacnetUnits: ReferenceDataInput['bacnetUnits']
  /** Used when no enabled plugin provides one. */
  fallbackNameTemplate: NameTemplate
}

export interface MergeResult {
  referenceData: ReferenceDataInput
  issues: PluginIssue[]
  /** Plugin ids that contributed, in load order. */
  contributors: string[]
}

/** Merge enabled plugins into one reference-data input. A later plugin wins a `block:key` collision, which is reported. */
export function mergePlugins(plugins: LoadedPlugin[], options: MergeOptions): MergeResult {
  const issues: PluginIssue[] = []
  let enabled = options.enabled ? plugins.filter((p) => options.enabled?.includes(p.manifest.id)) : plugins
  // Drop plugins whose requirements are not enabled, until none is left out (a chain falls together).
  for (;;) {
    const ids = new Set(enabled.map((p) => p.manifest.id))
    const unmet = enabled.filter((p) => p.manifest.requires.some((r) => !ids.has(r)))
    if (unmet.length === 0) break
    for (const p of unmet) {
      const missing = p.manifest.requires.filter((r) => !ids.has(r))
      issues.push({ pluginId: p.manifest.id, severity: 'error', message: `needs ${missing.join(', ')}, which is not enabled` })
    }
    enabled = enabled.filter((p) => !unmet.includes(p))
  }

  const byCompound = new Map<string, { entry: LibraryEntry; from: string }>()
  const combinations: CombinationRow[] = []
  let nameTemplate: NameTemplate | null = null
  let templateFrom = ''

  for (const plugin of enabled) {
    const id = plugin.manifest.id
    for (const entry of plugin.library) {
      const compound = `${entry.block}:${entry.key}`
      const existing = byCompound.get(compound)
      if (existing && existing.from !== id) {
        issues.push({
          pluginId: id,
          severity: 'warning',
          message: `redefines ${compound}, previously supplied by "${existing.from}"`,
        })
      }
      byCompound.set(compound, { entry, from: id })
    }
    combinations.push(...plugin.combinations)
    if (plugin.nameTemplate) {
      if (nameTemplate) {
        issues.push({
          pluginId: id,
          severity: 'warning',
          message: `supplies a name template, but "${templateFrom}" already did; using this one`,
        })
      }
      nameTemplate = plugin.nameTemplate
      templateFrom = id
    }
  }

  return {
    referenceData: {
      library: [...byCompound.values()].map((v) => v.entry),
      combinations,
      bacnetTypes: options.bacnetTypes,
      bacnetUnits: options.bacnetUnits,
      nameTemplate: nameTemplate ?? options.fallbackNameTemplate,
      activeSources: enabled.map((p) => p.manifest.sourceId),
    },
    issues,
    contributors: enabled.map((p) => p.manifest.id),
  }
}

/** Whether `version` satisfies `range` (1.2.3, ^1.2.3, ~1.2.3, >=1.2.3); null for other forms. */
export function satisfies(version: string, range: string): boolean | null {
  const m = /^\s*(\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(range)
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!m || !v) return null
  const want = [Number(m[2]), Number(m[3]), Number(m[4])] as const
  const have = [Number(v[1]), Number(v[2]), Number(v[3])] as const
  const cmp = have[0] - want[0] || have[1] - want[1] || have[2] - want[2]
  switch (m[1]) {
    case undefined: return cmp === 0
    case '>=': return cmp >= 0
    case '~': return cmp >= 0 && have[0] === want[0] && have[1] === want[1]
    // Caret: the left-most non-zero part must stay the same (^0.1.0 allows 0.1.x, not 0.2.0).
    default: return cmp >= 0 && (want[0] > 0 ? have[0] === want[0] : want[1] > 0 ? have[1] === want[1] && have[0] === 0 : cmp === 0)
  }
}
