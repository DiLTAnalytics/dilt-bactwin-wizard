/** Per-user settings, stored beside the application's other user data. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export interface Settings {
  enabledPlugins?: string[]
  /** Last-used directory per save or open action, since different actions go to different places. */
  folders: Record<string, string>
  windowBounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean }
  recentProjects?: string[]
  appearance?: Appearance
}

export type Appearance = 'system' | 'light' | 'dark'

const defaults = (): Settings => ({ folders: {} })

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export const readSettings = (): Settings => readSettingsFrom(settingsPath())
export const writeSettings = (settings: Settings): void => writeSettingsTo(settingsPath(), settings)

export function readSettingsFrom(path: string): Settings {
  try {
    if (!existsSync(path)) return defaults()
    return { ...defaults(), ...(JSON.parse(readFileSync(path, 'utf8')) as Settings) }
  } catch {
    // Corrupt settings must not stop the application starting.
    return defaults()
  }
}

export function writeSettingsTo(path: string, settings: Settings): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(settings, null, 2))
  } catch {
    // A convenience: failing to persist is not worth interrupting the work.
  }
}

export function rememberFolder(actionId: string, filePath: string): void {
  const settings = readSettings()
  settings.folders[actionId] = dirname(filePath)
  writeSettings(settings)
}

const RECENT_LIMIT = 8

/** Most recent first, without duplicates. */
export function rememberRecentProject(path: string): void {
  const settings = readSettings()
  settings.recentProjects = [path, ...(settings.recentProjects ?? []).filter((p) => p !== path)].slice(0, RECENT_LIMIT)
  writeSettings(settings)
}

export function lastFolder(actionId: string): string | undefined {
  return readSettings().folders[actionId]
}
