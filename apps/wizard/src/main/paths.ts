/** Where the application finds its bundled resources and the user's own files. */

import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { app } from 'electron'

import type { ReferenceSources } from './project/reference.js'

/**
 * The repository root when running unpackaged: the first ancestor with `plugins` and `data`.
 * Not app.getAppPath(), which differs between `electron .`, a direct launch and Playwright.
 */
function devRoot(): string | null {
  let dir = __dirname
  const { root } = parse(dir)
  while (dir !== root) {
    if (existsSync(join(dir, 'plugins')) && existsSync(join(dir, 'data'))) return dir
    dir = dirname(dir)
  }
  return null
}

/** Where bundled resources (plugins, data, docs-site) live: beside the app, or the repo in dev. */
export function resourceRoot(): string | null {
  return app.isPackaged ? process.resourcesPath : devRoot()
}

export function userPluginDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** Bundled plugins first, then the user's, so a user plugin can override shipped vocabulary. */
export function referenceSources(): ReferenceSources {
  const root = resourceRoot()
  return {
    pluginRoots: [
      ...(root ? [{ dir: join(root, 'plugins'), origin: 'bundled' as const }] : []),
      { dir: userPluginDir(), origin: 'user' as const },
    ],
    dataDir: root && join(root, 'data'),
  }
}
