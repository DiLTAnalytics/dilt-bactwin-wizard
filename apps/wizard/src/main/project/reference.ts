/** Loading plugins and core data from disk into reference data, and what the UI asks of it. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { FALLBACK_NAME_TEMPLATE, ReferenceData, type NameTemplate } from '@bactwin/mapping-engine'
import {
  loadPlugin, mergePlugins, parseBacnetTables, PLUGIN_FILES, type LoadedPlugin, type PluginFiles, type PluginIssue,
} from '@bactwin/plugin-host'

import type { ReferenceStamp, Session } from './session.js'

export type PluginOrigin = 'bundled' | 'user'

export interface PluginSummary {
  id: string
  name: string
  version: string
  license: string
  sourceId: string
  provides: string[]
  /** Ids of plugins it needs enabled alongside. */
  requires: string[]
  description?: string
  origin: PluginOrigin
  enabled: boolean
}

export interface ReferenceSources {
  /** Plugin folders in load order; a later plugin overrides an earlier one, and each override is reported. */
  pluginRoots: { dir: string; origin: PluginOrigin }[]
  /** The core data folder (BACnet tables), or null if there is none. */
  dataDir: string | null
}

export interface ReferenceLoadResult {
  referenceData: ReferenceData
  plugins: PluginSummary[]
  issues: PluginIssue[]
}

export interface Capabilities {
  /** A combination catalogue is loaded, so the check runs and its UI is shown. */
  combinations: boolean
  /** Name of the plugin(s) supplying it, for labels. */
  combinationSource: string | null
}

function readPluginDir(dir: string): PluginFiles {
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined)
  const files: PluginFiles = { manifest: readFileSync(join(dir, PLUGIN_FILES.manifest), 'utf8') }
  for (const kind of ['keys', 'combinations', 'nameTemplate'] as const) {
    const content = read(PLUGIN_FILES[kind])
    if (content !== undefined) files[kind] = content
  }
  return files
}

/** BACnet tables: core data, not pluggable. */
function coreData(dataDir: string | null) {
  const read = (...parts: string[]) => {
    const path = dataDir && join(dataDir, ...parts)
    return path && existsSync(path) ? readFileSync(path, 'utf8') : null
  }
  return parseBacnetTables(read('bacnet_keys', 'bacnet_types.csv') ?? '', read('bacnet_keys', 'bacnet_unitcodes.csv') ?? '')
}

/** Discover every plugin and merge the enabled ones (all when `enabled` is absent). A broken plugin is reported and skipped. */
export function loadReferenceData(sources: ReferenceSources, enabled?: string[]): ReferenceLoadResult {
  const issues: PluginIssue[] = []
  const loaded: { plugin: LoadedPlugin; origin: PluginOrigin }[] = []

  for (const { dir, origin } of sources.pluginRoots) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir).sort()) {
      const pluginDir = join(dir, entry)
      if (!statSync(pluginDir).isDirectory() || !existsSync(join(pluginDir, PLUGIN_FILES.manifest))) continue
      try {
        const result = loadPlugin(readPluginDir(pluginDir))
        issues.push(...result.issues)
        if (result.plugin) loaded.push({ plugin: result.plugin, origin })
      } catch (e) {
        issues.push({ pluginId: entry, severity: 'error', message: `could not be read: ${(e as Error).message}` })
      }
    }
  }

  const enabledIds = enabled ?? loaded.map((l) => l.plugin.manifest.id)
  const core = coreData(sources.dataDir)
  const merged = mergePlugins(
    loaded.map((l) => l.plugin),
    {
      enabled: enabledIds,
      bacnetTypes: core.types,
      bacnetUnits: core.units,
      fallbackNameTemplate: FALLBACK_NAME_TEMPLATE,
    },
  )
  issues.push(...merged.issues)

  return {
    referenceData: new ReferenceData(merged.referenceData),
    plugins: loaded.map(({ plugin, origin }) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      license: plugin.manifest.license,
      sourceId: plugin.manifest.sourceId,
      provides: plugin.manifest.provides,
      requires: plugin.manifest.requires,
      ...(plugin.manifest.description ? { description: plugin.manifest.description } : {}),
      origin,
      enabled: enabledIds.includes(plugin.manifest.id),
    })),
    issues,
  }
}

/** Load reference data into the session; `enabled` replaces the selection when given. */
export function applyReferenceData(s: Session, sources: ReferenceSources, enabled?: string[]): ReferenceLoadResult {
  const result = loadReferenceData(sources, enabled)
  // Undo the steps with the reference data they ran with; the caller runs them again (Session.replayFrom).
  s.replay?.rewind(0)
  s.replay = null
  s.referenceData = result.referenceData
  s.plugins = result.plugins
  s.enabledPlugins = result.plugins.filter((p) => p.enabled).map((p) => p.id)
  // Reference data changing invalidates every derived value on every point.
  s.recomputeAll()
  return result
}

/**
 * Load the plugins a project names, or the defaults for a new one (`saved` absent). Named plugins
 * that are not installed stay in `missingPlugins`.
 */
export function applyProjectPlugins(s: Session, saved: ReferenceStamp['plugins'] | undefined): ReferenceLoadResult | null {
  if (!s.pluginSources) return null
  const result = applyReferenceData(s, s.pluginSources, saved ? saved.map((p) => p.id) : s.defaultPlugins)
  const installed = new Set(result.plugins.map((p) => p.id))
  s.missingPlugins = (saved ?? []).filter((p) => !installed.has(p.id))
  return result
}

/** Switch the open project to the plugins `ids`; a missing one stays only if it is still among them. Recalculates. */
export function setProjectPlugins(s: Session, ids: string[]): Promise<{ ok: true }> {
  return s.exclusive(async () => {
    s.requireProject()
    s.requireIdle()
    if (!s.pluginSources) return { ok: true as const }
    const missing = s.missingPlugins.filter((p) => ids.includes(p.id))
    applyReferenceData(s, s.pluginSources, ids)
    s.missingPlugins = missing
    s.dirty = true
    await s.replayFrom(0)
    return { ok: true as const }
  })
}

/** Optional features the loaded reference data enables; the UI hides what is off. */
export function capabilities(s: Session): Capabilities {
  if (!s.requireReferenceData().hasCombinations) return { combinations: false, combinationSource: null }
  const sources = s.plugins.filter((p) => p.enabled && p.provides.includes('combinations'))
  return { combinations: true, combinationSource: sources.map((p) => p.name).join(', ') || null }
}

export function nameTemplate(s: Session): NameTemplate {
  return s.requireReferenceData().nameTemplate
}

/** `block:key` to its label, for rendering names and descriptions. */
export function labels(s: Session): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [compound, entry] of s.requireReferenceData().library) out[compound] = entry.description || entry.key
  return out
}
