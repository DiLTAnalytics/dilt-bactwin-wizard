/**
 * Build the user documentation (docs/user) into a static site for GitHub Pages and the in-app Help.
 *
 *   node scripts/build-docs.mjs [outDir]     default: docs-site/
 *
 * The bundled copy is opened off disk without a network: relative links only, all styles inline.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(REPO, 'docs', 'user')
const OUT = join(REPO, process.argv[2] ?? 'docs-site')
const REPO_URL = 'https://github.com/DiLTAnalytics/dilt-bactwin-wizard'

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

/** Prefix that leads from a page back to the site root. */
const upPath = (relPath) => '../'.repeat(relPath.split(sep).length - 1)

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return markdownFiles(full)
    return e.name.endsWith('.md') ? [relative(DOCS, full)] : []
  })
}

/** First `# heading`, falling back to the filename. */
function titleOf(source, relPath) {
  const heading = source.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : relPath.replace(/\.md$/, '')
}

/** `.md` links point at the built `.html`; links into the source tree go to the repository. */
function rewriteLinks(html, relPath) {
  const up = upPath(relPath)
  return html
    .replace(/(href=")([^"#?]+)\.md((?:#[^"]*)?")/g, (_m, a, path, rest) => `${a}${path}.html${rest}`)
    .replace(/(href=")((?:apps|packages|plugins|examples|data|scripts|docs)\/[^"]+)(")/g,
      (_m, a, path, z) => `${a}${REPO_URL}/blob/main/${path}${z}`)
    .replace(/(href=")\/([^"]*)(")/g, (_m, a, path, z) => `${a}${up}${path}${z}`)
}

const STYLE = `
:root { color-scheme: light dark; --fg:#1e293b; --bg:#fff; --muted:#64748b; --line:#e2e8f0;
  --accent:#2563eb; --code-bg:#f8fafc; }
@media (prefers-color-scheme: dark) { :root { --fg:#e2e8f0; --bg:#0f172a; --muted:#94a3b8;
  --line:#1e293b; --accent:#60a5fa; --code-bg:#1e293b; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui,-apple-system,
  "Segoe UI",Roboto,sans-serif; }
.wrap { max-width: 52rem; margin:0 auto; padding: 2rem 1.25rem 5rem; }
nav.top { border-bottom:1px solid var(--line); padding:.75rem 1.25rem; font-size:.875rem;
  display:flex; gap:1rem; flex-wrap:wrap; align-items:center; }
nav.top a { color:var(--muted); text-decoration:none; }
nav.top a:hover { color:var(--accent); }
nav.top strong { color:var(--fg); }
h1,h2,h3,h4 { line-height:1.25; margin:2rem 0 .75rem; }
h1 { font-size:1.9rem; margin-top:0; }
h2 { font-size:1.4rem; border-bottom:1px solid var(--line); padding-bottom:.3rem; }
h3 { font-size:1.15rem; }
a { color:var(--accent); }
code { background:var(--code-bg); padding:.15em .35em; border-radius:3px; font-size:.875em;
  font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { background:var(--code-bg); padding:1rem; border-radius:6px; overflow-x:auto;
  border:1px solid var(--line); }
pre code { background:none; padding:0; }
table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; margin:1rem 0; }
th,td { border:1px solid var(--line); padding:.4rem .6rem; text-align:left; font-size:.9rem;
  vertical-align:top; }
th { background:var(--code-bg); }
blockquote { border-left:3px solid var(--line); margin:1rem 0; padding:.25rem 1rem;
  color:var(--muted); }
ul.index { list-style:none; padding:0; }
ul.index li { border-bottom:1px solid var(--line); padding:.6rem 0; }
ul.index a { text-decoration:none; font-weight:500; }
.lede { color:var(--muted); }
`

function page({ title, body, relPath }) {
  return `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} - BACtwin Wizard</title>
<style>${STYLE}</style>
<nav class="top">
  <strong>BACtwin Wizard</strong>
  <a href="${upPath(relPath)}index.html">Übersicht</a>
  <a href="${REPO_URL}">GitHub</a>
</nav>
<div class="wrap">
${body}
</div>
`
}

// --- build ---------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const files = markdownFiles(DOCS).sort()
const entries = []

for (const relPath of files) {
  const source = readFileSync(join(DOCS, relPath), 'utf8')
  const title = titleOf(source, relPath)
  const htmlRel = relPath.replace(/\.md$/, '.html')
  mkdirSync(dirname(join(OUT, htmlRel)), { recursive: true })
  writeFileSync(join(OUT, htmlRel), page({ title, body: rewriteLinks(md.render(source), relPath), relPath }))
  entries.push({ relPath, href: htmlRel.split(sep).join('/'), title })
}

const guides = entries.map((e) => `<li><a href="${e.href}">${md.renderInline(e.title)}</a></li>`).join('\n')

// File-format schemas, at the URL saved files name in `$schema`.
mkdirSync(join(OUT, 'schema'), { recursive: true })
copyFileSync(join(REPO, 'apps', 'wizard', 'schema', 'project.schema.json'), join(OUT, 'schema', 'project.schema.json'))
copyFileSync(join(REPO, 'packages', 'mapping-engine', 'schema', 'mapping-sequence.schema.json'), join(OUT, 'schema', 'mapping-sequence.schema.json'))

writeFileSync(join(OUT, 'index.html'), page({
  title: 'Dokumentation',
  relPath: 'index.html',
  body: `<h1>BACtwin Wizard - Dokumentation</h1>
<p class="lede">BACnet-EDE-Datenpunktnamen auf den BACtwin-Namensstandard übersetzen und diese
Übersetzung als wiederholbare Mapping-Sequenz aufzeichnen.</p>
<ul class="index">
${guides}
</ul>

<p class="lede">Diese Kopie ist auch in der Anwendung enthalten und funktioniert ohne Netzwerk.</p>`,
}))

console.log(`built ${files.length} pages into ${relative(REPO, OUT) || OUT}`)
