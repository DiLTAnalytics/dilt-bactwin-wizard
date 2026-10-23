import { SCHEME } from './protocol.js'

/**
 * The Content-Security-Policy, sent as a header. Production allows no inline script and no
 * network. Development allows Vite's http origin and its inline Fast Refresh preamble, without
 * which React silently fails to mount.
 */
export function cspFor(isDev: boolean, devOrigin?: string): string {
  if (!isDev) {
    return (
      "default-src 'self'; " +
      `script-src 'self' ${SCHEME}:; ` +
      // Inline styles only, never inline scripts.
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "font-src 'self' data:; " +
      "connect-src 'self'; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
  }
  const origin = devOrigin ?? 'http://localhost:*'
  const ws = origin.replace(/^http/, 'ws')
  return (
    `default-src 'self' ${origin}; ` +
    `script-src 'self' 'unsafe-inline' ${origin}; ` +
    `style-src 'self' 'unsafe-inline' ${origin}; ` +
    `img-src 'self' data: ${origin}; ` +
    `font-src 'self' data: ${origin}; ` +
    `connect-src 'self' ${origin} ${ws}; ` +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  )
}
