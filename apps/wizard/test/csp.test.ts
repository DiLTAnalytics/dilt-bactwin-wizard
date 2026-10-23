/** The production CSP stays strict; only the development branch may allow Vite's inline script. */

import { describe, expect, it } from 'vitest'
import { cspFor } from '../src/main/csp.js'

function directive(policy: string, name: string): string {
  const found = policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))
  return found ?? ''
}

describe('production CSP', () => {
  const prod = cspFor(false)

  it('does not allow inline script', () => {
    expect(directive(prod, 'script-src')).not.toContain ("'unsafe-inline'")
  })

  it('does not allow eval', () => {
    expect(prod).not.toContain ("'unsafe-eval'")
  })

  it('allows no network origin', () => {
    // The app makes no network requests.
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self'")
  })

  it('locks down the remaining vectors', () => {
    expect(prod).toContain ("object-src 'none'")
    expect(prod).toContain ("base-uri 'none'")
    expect(prod).toContain ("frame-ancestors 'none'")
  })

  it('mentions no localhost', () => {
    expect(prod).not.toContain('localhost')
  })
})

describe('development CSP', () => {
  const dev = cspFor(true, 'http://localhost:5173')

  it('allows the inline preamble Vite needs', () => {
    expect(directive(dev, 'script-src')).toContain ("'unsafe-inline'")
  })

  it('allows the HMR websocket', () => {
    expect(directive(dev, 'connect-src')).toContain('ws://localhost:5173')
  })

  it('still blocks objects and framing', () => {
    expect(dev).toContain ("object-src 'none'")
    expect(dev).toContain ("frame-ancestors 'none'")
  })
})
