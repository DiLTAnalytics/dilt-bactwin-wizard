/** The engine stays pure: no I/O, ambient state or non-determinism (a test, as a lint rule is easy to silence). */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Comments are stripped first, or their mentions of fs/Date would trip the check. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /from\s+['"]node:/, why: 'a Node built-in - the engine must run in a browser too' },
  { pattern: /\brequire\s*\(/, why: 'a CommonJS require' },
  { pattern: /\bprocess\.(env|cwd|argv|platform)\b/, why: 'ambient process state' },
  { pattern: /\bDate\.now\s*\(/, why: 'a clock read - results must not depend on when they run' },
  { pattern: /\bnew Date\s*\(\s*\)/, why: 'a clock read - results must not depend on when they run' },
  { pattern: /\bMath\.random\s*\(/, why: 'randomness - results must be reproducible' },
  { pattern: /\blocaleCompare\s*\(/, why: 'locale-dependent sorting - results must not depend on the machine' },
  { pattern: /\btoLocale(?:Date|Time|)String\s*\(/, why: 'locale-dependent formatting' },
  { pattern: /\bconsole\.(log|warn|error|info|debug)\s*\(/, why: 'console output - the engine returns results, it does not report them' },
]

describe('the engine is pure', () => {
  const files = sourceFiles(SRC)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const { pattern, why } of FORBIDDEN) {
    it(`contains no ${why}`, () => {
      const offenders = files
        .filter((f) => pattern.test(code(f)))
        .map((f) => f.slice(SRC.length + 1))
      expect(offenders, `${offenders.join(', ')} uses ${why}`).toEqual([])
    })
  }

  it('declares no runtime dependency other than zod and csv-parse (its browser build, for EDE rows)', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['csv-parse', 'zod'])
  })
})
