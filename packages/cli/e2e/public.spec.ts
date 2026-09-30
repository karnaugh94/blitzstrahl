/**
 * The `public:` folder (syntax.md §3.5; PLAN §15, M8.5): served by `dev`
 * and copied into static builds as it is, at the same path, so a demo page
 * keeps its scripts. Dotfiles and links out of the folder never go, and the
 * rest of the deck's folder stays private.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { build, dev } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const DECK = `---
title: Public
public: ./demos
---

# Demo

[Try it](./demos/app/index.html){#demo} and ![shot](./demos/shot.svg){#shot}
`

function deckFolder(deck = DECK): { dir: string; deck: string } {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-public-'))
  mkdirSync(join(dir, 'demos', 'app'), { recursive: true })
  mkdirSync(join(dir, 'private'))
  writeFileSync(join(dir, 'demos', 'app', 'index.html'), '<!doctype html><title>demo</title><link rel="stylesheet" href="style.css"><p id="out">waiting</p><script src="app.js"></script>')
  writeFileSync(join(dir, 'demos', 'app', 'app.js'), "document.getElementById('out').textContent = 'the demo ran'")
  writeFileSync(join(dir, 'demos', 'app', 'style.css'), '#out { color: rgb(1, 2, 3); }')
  writeFileSync(join(dir, 'demos', 'shot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30"/></svg>')
  writeFileSync(join(dir, 'demos', '.env'), 'SECRET=1\n')
  mkdirSync(join(dir, 'demos', '.git'))
  writeFileSync(join(dir, 'demos', '.git', 'config'), 'SECRET\n')
  writeFileSync(join(dir, 'private', 'salaries.csv'), 'SECRET\n')
  symlinkSync(join(dir, 'private', 'salaries.csv'), join(dir, 'demos', 'leak.csv'))
  symlinkSync(join(dir, 'private'), join(dir, 'demos', 'leaky'))
  symlinkSync(join(dir, 'demos'), join(dir, 'demos', 'app', 'loop'))
  const file = join(dir, 'talk.md')
  writeFileSync(file, deck)
  return { dir, deck: file }
}

async function expectRefused(request: APIRequestContext, base: string, paths: string[]) {
  for (const path of paths) {
    const res = await request.get(base + path)
    expect(res.status(), path).toBeGreaterThanOrEqual(400)
    expect(await res.text(), path).not.toContain('SECRET')
  }
}

const REFUSED = ['demos/.env', 'demos/.git/config', 'demos/leak.csv', 'demos/leaky/salaries.csv', 'demos/%2e%2e/private/salaries.csv', 'demos/app/..%2f..%2fprivate/salaries.csv', 'private/salaries.csv', 'talk.md']

test('a static build copies the folder as it is, and links into it keep their path', async ({ page, request }) => {
  const { deck } = deckFolder()
  const { url, server, result } = await buildAndServe(deck)
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.blitz)
    expect(await page.locator('#demo').getAttribute('href')).toBe('demos/app/index.html')
    expect(await page.locator('#shot').getAttribute('src')).toBe('demos/shot.svg')
    await expect.poll(() => page.locator('#shot').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)
    await page.goto(url + 'demos/app/index.html')
    await expect(page.locator('#out')).toHaveText('the demo ran')
    await expect(page.locator('#out')).toHaveCSS('color', 'rgb(1, 2, 3)')
    await expectRefused(request, url, REFUSED)
    const manifest = JSON.parse(readFileSync(join(result.outDir, '.blitzstrahl-build.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toEqual(expect.arrayContaining(['demos/app/index.html', 'demos/app/app.js', 'demos/shot.svg']))
    expect(manifest.files.filter((f) => f.startsWith('demos/')).sort()).toEqual(['demos/app/app.js', 'demos/app/index.html', 'demos/app/style.css', 'demos/shot.svg'])
    expect(existsSync(join(result.outDir, 'demos', '.env'))).toBe(false)
  } finally {
    server.close()
  }
})

test('dev serves the folder, and still nothing else in the deck\'s', async ({ page, request }) => {
  const { deck } = deckFolder()
  const server = await dev(deck, { port: 0 })
  try {
    const base = server.resolvedUrls!.local[0]!
    await page.goto(base)
    await page.waitForFunction(() => window.blitz)
    expect(await page.locator('#demo').getAttribute('href')).toBe('demos/app/index.html')
    await expect.poll(() => page.locator('#shot').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)
    await page.goto(base + 'demos/app/index.html')
    await expect(page.locator('#out')).toHaveText('the demo ran')
    await expectRefused(request, base, REFUSED)
  } finally {
    await server.close()
  }
})

test('standalone files say they leave the folder out; a missing folder or one that overlaps the output is refused', async () => {
  const { dir, deck } = deckFolder()
  const standalone = await build(deck, { standalone: true, outFile: join(dir, 'talk.html'), quiet: true, report: false, overflowCheck: false })
  expect(standalone.diagnostics).toContainEqual(expect.objectContaining({ code: 'public/standalone', span: expect.objectContaining({ start: { line: 3, column: 1 } }) }))

  const missing = deckFolder(DECK.replace('./demos', './nowhere'))
  const stopped = await build(missing.deck, { outDir: join(missing.dir, 'out'), quiet: true, report: false, overflowCheck: false })
  expect(stopped.ok).toBe(false)
  expect(stopped.diagnostics).toContainEqual(expect.objectContaining({ code: 'public/missing', severity: 'error' }))

  await expect(build(deck, { outDir: join(dir, 'demos', 'site'), quiet: true, report: false, overflowCheck: false })).rejects.toThrow(/overlap/)
})
