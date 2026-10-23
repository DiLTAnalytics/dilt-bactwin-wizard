/** Check that the built docs work off disk: every internal link resolves to a file, nothing loads from the network. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', process.argv[2] ?? 'docs-site')

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [],
  )
}

const all = pages(SITE)
let broken = 0
let external = 0
let checked = 0

for (const page of all) {
  const html = readFileSync(page, 'utf8')

  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = m[1]
    if (target.startsWith('#') || target.startsWith('mailto:')) continue
    if (/^https?:\/\//.test(target)) continue
    checked += 1
    const file = resolve(dirname(page), decodeURIComponent(target.split('#')[0]))
    if (!existsSync(file)) {
      console.error(`broken: ${relative(SITE, page)} -> ${target}`)
      broken += 1
    }
  }

  // Anything fetched over the network at render time: a stylesheet, a font, a script.
  for (const m of html.matchAll(/<(?:link|script|img)[^>]*(?:href|src)="(https?:\/\/[^"]+)"/g)) {
    console.error(`external resource: ${relative(SITE, page)} -> ${m[1]}`)
    external += 1
  }
}

if (broken || external) {
  console.error(`\n${broken} broken link(s), ${external} external resource(s)`)
  process.exit(1)
}
console.log(`OK - ${checked} internal links across ${all.length} pages, no external resources`)
