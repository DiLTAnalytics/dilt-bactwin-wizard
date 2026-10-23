/**
 * Third-party notices for the packages bundled into the app. Each Vite build (main, renderer)
 * records its own packages; packaging merges them into one file beside the Chromium notices.
 * The build fails on a licence outside the allowlist or a package without a licence text.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import license, { type Dependency } from 'rollup-plugin-license'

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt'

const PARTS = join(import.meta.dirname, '.vite', 'notices')

/** Permissive licences, compatible with AGPL-3.0 distribution. */
const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'CC0-1.0', 'CC-BY-4.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0', 'MPL-2.0',
])

type Entry = { name: string; version: string; license: string; homepage: string; text: string }

/** Licence texts for packages whose release ships none, taken from their repository. */
const SUPPLIED_TEXTS: Record<string, string> = {
  'react-remove-scroll-bar': `MIT License

Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
}

const isOwn = (d: Dependency) => d.name?.startsWith('@bactwin/') ?? false

function toEntry(d: Dependency): Entry {
  const licenseText = d.licenseText || SUPPLIED_TEXTS[d.name ?? '']
  if (!licenseText) throw new Error(`${d.name}@${d.version} ships no licence text; add it to the notices by hand or replace the package`)
  return {
    name: d.name ?? '',
    version: d.version ?? '',
    license: d.license ?? '',
    homepage: d.homepage ?? '',
    text: [licenseText, d.noticeText].filter(Boolean).join('\n\n').trim(),
  }
}

/** Vite plugin: checks and records the third-party packages bundled into one part of the app. */
export function thirdPartyNotices(part: 'main' | 'renderer') {
  return license({
    thirdParty: {
      multipleVersions: true,
      allow: { test: (d) => isOwn(d) || ALLOWED.has(d.license ?? ''), failOnUnlicensed: true, failOnViolation: true },
      output: (deps) => {
        mkdirSync(PARTS, { recursive: true })
        writeFileSync(join(PARTS, `${part}.json`), JSON.stringify(deps.filter((d) => !isOwn(d)).map(toEntry)))
      },
    },
  })
}

/** Merge the parts' lists into `dir`/THIRD-PARTY-NOTICES.txt, one entry per package version. */
export function writeNotices(dir: string): void {
  const parts = existsSync(PARTS) ? readdirSync(PARTS).filter((f) => f.endsWith('.json')) : []
  if (parts.length < 2) throw new Error(`third-party notices missing in ${PARTS}; the Vite builds did not run`)
  const entries = new Map<string, Entry>()
  for (const f of parts) {
    for (const e of JSON.parse(readFileSync(join(PARTS, f), 'utf8')) as Entry[]) entries.set(`${e.name}@${e.version}`, e)
  }
  const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const rule = '-'.repeat(80)
  writeFileSync(join(dir, NOTICES_FILE), [
    'BACtwin Wizard - third-party notices',
    '',
    'The application includes the following packages. The notices for Electron and Chromium are in',
    'LICENSE and LICENSES.chromium.html in this folder.',
    '',
    ...sorted.flatMap((e) => [rule, `${e.name} ${e.version} (${e.license})`, ...(e.homepage ? [e.homepage] : []), '', e.text, '']),
  ].join('\n'))
}
