/**
 * Serving the renderer over a custom `app://` scheme rather than `file://`: the page gets a real
 * origin, so the CSP applies and the navigation guards can tell our requests apart.
 */

import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { protocol } from 'electron'

export const SCHEME = 'app'
export const ORIGIN = `${SCHEME}://bundle`

/** Registered before `app.ready`, which is the only time it can be. */
export function registerSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: false,
      },
    },
  ])
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function registerProtocolHandler(rendererRoot: string): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const requested = decodeURIComponent(url.pathname)

    // Every request stays inside the bundle, or the renderer could read any file.
    const resolved = normalize(join(rendererRoot, requested))
    if (!resolved.startsWith(rendererRoot + sep) && resolved !== rendererRoot) {
      return new Response('Forbidden', { status: 403 })
    }

    try {
      const ext = resolved.slice(resolved.lastIndexOf('.'))
      const body = await readFile(resolved)
      return new Response(body, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } })
    } catch {
      // Single-page application: an unknown path is a route, not a missing file.
      const html = await readFile(join(rendererRoot, 'index.html'))
      return new Response(html, { headers: { 'content-type': MIME['.html'] as string } })
    }
  })
}
