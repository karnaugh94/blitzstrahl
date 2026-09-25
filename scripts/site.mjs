// The docs site and examples gallery, built locally into site/dist
// (decisions.md: hosting is decided once there's a remote).
//
// - Docs: docs/*.md rendered to HTML. `docs/x.md` code spans and `.md`
//   links become links; every internal link and anchor is checked, and a
//   broken one fails the build.
// - Gallery: every example deck, built by blitzstrahl itself, with a
//   thumbnail of its first slide and its markdown alongside.
//
// Usage: pnpm build && pnpm site   (then serve site/dist over HTTP)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import rehypeShiki from '@shikijs/rehype'
import { chromium } from '@playwright/test'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { build } from '../packages/cli/dist/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'site/dist')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The docs, in reading order. */
const DOCS = [
  ['syntax.md', 'Syntax'],
  ['cli.md', 'Command line'],
  ['presenting.md', 'Presenting'],
  ['themes.md', 'Themes'],
  ['plugins.md', 'Plugins'],
  ['renderers/chart.md', 'Charts'],
  ['renderers/map.md', 'Maps'],
  ['renderers/table.md', 'Tables'],
  ['renderers/embed.md', 'Embeds'],
  ['renderers/mermaid.md', 'Mermaid'],
]

/** The gallery: example folder, its deck, and a line about it. */
const GALLERY = [
  ['thin-slice', 'talk.md', 'A short talk: steps, a chart, speaker notes.'],
  ['palette', 'deck.md', 'Every kind of content: code, tables, charts, maps, an embedded page.'],
  ['auto-animate', 'deck.md', 'Elements that glide between slides, and code that morphs.'],
  ['layouts', 'deck.md', 'All twelve built-in layouts.'],
  ['editorial', 'deck.md', 'An annual report in the light, editorial broadsheet theme.'],
]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// ---------------------------------------------------------------- docs

const htmlPath = (md) => md.replace(/\.md$/, '.html')
/** `docs/renderers/map.md` or `renderers/map.md#x`, relative to `from` (a doc path), → an href. */
const hrefTo = (from, target) => relative(dirname(join('docs', from)), join('docs', target)).replace(/\.md(?=$|#)/, '.html') || '.'

/** Turn `docs/…md` code spans into links, and `.md` hrefs into `.html` ones. */
function docLinks(from) {
  return (tree) => {
    visit(tree, 'inlineCode', (node, index, parent) => {
      const m = /^docs\/([\w/-]+\.md|renderers\/)$/.exec(node.value)
      if (!m || !parent || parent.type === 'link') return
      const target = m[1].endsWith('/') ? 'renderers/chart.md' : m[1]
      parent.children[index] = { type: 'link', url: hrefTo(from, target), children: [node] }
    })
    visit(tree, 'link', (node) => {
      if (!/^[a-z]+:/i.test(node.url) && /\.md($|#)/.test(node.url)) node.url = node.url.replace(/\.md(?=$|#)/, '.html')
    })
  }
}

const pages = []
for (const [path, title] of DOCS) {
  const md = readFileSync(join(root, 'docs', path), 'utf8')
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(docLinks, path)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false, fallbackLanguage: 'text' })
    .use(rehypeStringify)
    .process(md)
  pages.push({ path: htmlPath(path), title, body: String(file) })
}

const nav = (here) => {
  const up = relative(dirname(join(out, here)), out) || '.'
  const link = (href, label, active) => `<a href="${up}/${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`
  return `<nav class="docs-nav">${DOCS.map(([p, t]) => link(htmlPath(p), t, htmlPath(p) === here)).join('')}</nav>`
}

for (const p of pages) {
  const up = relative(dirname(join(out, p.path)), out) || '.'
  write(p.path, page(`${p.title} · blitzstrahl`, up, `<div class="docs">${nav(p.path)}<article class="prose">${p.body}</article></div>`))
}

// ---------------------------------------------------------------- gallery

const cards = []
for (const [name, deck, blurb] of GALLERY) {
  const src = join(root, 'examples', name, deck)
  const outDir = join(out, 'gallery', name)
  const r = await build(src, { outDir, quiet: true, report: false, overflowCheck: false })
  if (!r.ok) throw new Error(`examples/${name} didn't build`)
  cpSync(src, join(outDir, 'deck.md'))
  const md = readFileSync(src, 'utf8')
  const title = /^title:\s*(.+)$/m.exec(md)?.[1] ?? name
  const theme = /^theme:\s*(.+)$/m.exec(md)?.[1] ?? 'aurora'
  cards.push({ name, title, theme, blurb })
}

// Thumbnails: the first slide of each built deck, over HTTP (static builds need it).
const server = createServer((req, res) => {
  let file = join(out, normalize(decodeURIComponent(req.url.split('?')[0])))
  if (existsSync(file) && !extname(file)) file = join(file, 'index.html')
  if (!file.startsWith(out) || !existsSync(file)) return void res.writeHead(404).end()
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch()
try {
  const shot = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.5, reducedMotion: 'reduce' })
  for (const c of cards) {
    await shot.goto(`http://127.0.0.1:${server.address().port}/gallery/${c.name}/`)
    await shot.waitForFunction(() => window.blitz)
    await shot.evaluate(() => document.fonts.ready)
    await shot.screenshot({ path: join(out, 'gallery', `${c.name}.png`) })
  }
} finally {
  await browser.close()
  server.close()
}

// ---------------------------------------------------------------- home

write(
  'index.html',
  page(
    'blitzstrahl: Markdown in, a deck worth watching out',
    '.',
    `<header class="hero">
  <h1>Markdown in.<br>A deck worth watching out.</h1>
  <p>blitzstrahl turns a Markdown file into an HTML slide deck: real charts and maps, build steps and motion, a presenter view on a second screen, and a PDF or a single file to send afterwards.</p>
  <pre class="quick"><code>npx blitzstrahl dev talk.md
npx blitzstrahl build talk.md --standalone</code></pre>
  <p class="links"><a class="button" href="syntax.html">Write your first deck</a> <a href="cli.html">Command line</a> <a href="presenting.html">Presenting</a></p>
</header>
<section id="gallery">
  <h2>Gallery</h2>
  <p class="lede">Every deck here was built from the Markdown beside it. Open one and press <kbd>→</kbd>, <kbd>?</kbd> for the keys, <kbd>P</kbd> for the presenter view.</p>
  <ul class="gallery">
${cards
  .map(
    (c) => `    <li>
      <a href="gallery/${c.name}/"><img src="gallery/${c.name}.png" width="640" height="360" alt="The first slide of ${esc(c.title)}"></a>
      <h3><a href="gallery/${c.name}/">${esc(c.title)}</a></h3>
      <p>${esc(c.blurb)}</p>
      <p class="meta">${esc(c.theme)} · <a href="gallery/${c.name}/deck.md">Markdown</a></p>
    </li>`,
  )
  .join('\n')}
  </ul>
</section>
<section>
  <h2>Documentation</h2>
  <ul class="doc-list">${DOCS.map(([p, t]) => `<li><a href="${htmlPath(p)}">${t}</a></li>`).join('')}</ul>
</section>`,
  ),
)

// ---------------------------------------------------------------- check links

cpSync(join(root, 'site/site.css'), join(out, 'site.css'))

const broken = []
for (const file of [...pages.map((p) => p.path), 'index.html']) {
  const html = readFileSync(join(out, file), 'utf8')
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^[a-z]+:/i.test(href) || href.startsWith('#') && ids(html).has(href.slice(1))) continue
    if (href.startsWith('#')) {
      broken.push(`${file}: ${href}`)
      continue
    }
    const [path, anchor] = href.split('#')
    let target = join(dirname(join(out, file)), path)
    if (path.endsWith('/')) target = join(target, 'index.html')
    if (!existsSync(target)) broken.push(`${file}: ${href}`)
    else if (anchor && !ids(readFileSync(target, 'utf8')).has(anchor)) broken.push(`${file}: ${href} (no #${anchor})`)
  }
}
if (broken.length) throw new Error(`broken links:\n  ${broken.join('\n  ')}`)
process.stdout.write(`site: ${pages.length} docs, ${cards.length} decks in ${relative(root, out)}/\n`)

function ids(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
}

function write(path, html) {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  writeFileSync(join(out, path), html)
}

function page(title, up, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${up}/site.css">
</head>
<body>
<header class="top"><a class="brand" href="${up}/index.html">blitzstrahl</a><nav><a href="${up}/index.html#gallery">Gallery</a><a href="${up}/syntax.html">Docs</a></nav></header>
<main>
${body}
</main>
<footer>blitzstrahl is licensed under the EUPL-1.2.</footer>
</body>
</html>
`
}

