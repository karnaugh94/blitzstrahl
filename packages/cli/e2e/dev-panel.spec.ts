/**
 * Diagnostics on the page in `dev` (PLAN §15, M8.1; docs/cli.md `dev`): a
 * save's errors appear within a second, each opening the editor at its
 * line, with a banner while the deck won't build. Only this machine can
 * open files, and only the deck's.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import { dev } from '../dist/index.js'

const CLEAN = '# One\n\n---\n\n# Two\n'
/** An unknown chart key: an error at the block, line 7. */
const BROKEN = '# One\n\n---\n\n# Two\n\n```chart\ntype: bar\ndata: [{ a: 1 }]\ncolour: red\n```\n'
/** An unknown deck key: a warning, and the deck still builds. */
const WARNED = '---\ncolour: red\n---\n\n# One\n\n---\n\n# Two\n'

function folder(): { dir: string; deck: string; editorLog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-dev-panel-'))
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, CLEAN)
  writeFileSync(join(dir, 'private.txt'), 'SECRET\n')
  // A stand-in editor: it writes down what it was asked to open.
  const editorLog = join(dir, 'opened.txt')
  const editor = join(dir, 'editor.sh')
  writeFileSync(editor, `#!/bin/sh\necho "$@" > '${editorLog}'\n`)
  chmodSync(editor, 0o755)
  process.env.LAUNCH_EDITOR = editor
  return { dir, deck, editorLog }
}

test('a save with an error shows on the page within a second, and its link opens the editor there', async ({ page }) => {
  const { deck, editorLog } = folder()
  let server: ViteDevServer | undefined
  try {
    server = await dev(deck, { port: 0 })
    await page.goto(server.resolvedUrls!.local[0]!)
    await page.waitForFunction(() => window.blitz)
    await expect(page.locator('.blitz-dev-panel')).toBeHidden()
    await expect(page.locator('.blitz-dev-banner')).toBeHidden()

    const saved = Date.now()
    writeFileSync(deck, BROKEN)
    await expect(page.locator('.blitz-dev-banner')).toBeVisible({ timeout: 1000 })
    expect(Date.now() - saved).toBeLessThan(1000)
    await expect(page.locator('.blitz-dev-banner')).toHaveText("This deck has errors: build and export stop until they’re fixed.")
    // A new error opens the panel by itself.
    const item = page.locator('.blitz-dev-list li')
    await expect(item).toHaveCount(1)
    await expect(item).toHaveAttribute('data-severity', 'error')
    await expect(item.locator('.blitz-dev-at')).toHaveText(/talk\.md:7:1$/)
    await expect(item.locator('.blitz-dev-message')).toContainText('unknown key `colour`')
    await expect(page.locator('.blitz-dev-toggle')).toHaveText('Errors: 1')

    await item.locator('.blitz-dev-at').click()
    await expect.poll(() => (existsSync(editorLog) ? readFileSync(editorLog, 'utf8').trim() : '')).toBe(`${deck} 7 1`)

    // Space on a focused panel button presses it; the deck stays on its slide.
    rmSync(editorLog)
    await item.locator('.blitz-dev-at').focus()
    await page.keyboard.press('Space')
    await expect.poll(() => existsSync(editorLog)).toBe(true)
    expect(await page.evaluate(() => location.hash)).toBe('#/one')

    // The toggle folds the list away.
    await page.locator('.blitz-dev-toggle').click()
    await expect(page.locator('.blitz-dev-list')).toBeHidden()

    writeFileSync(deck, CLEAN)
    await expect(page.locator('.blitz-dev-banner')).toBeHidden()
    await expect(page.locator('.blitz-dev-panel')).toBeHidden()
  } finally {
    await server?.close()
  }
})

test("warnings show folded, without the banner; the panel speaks the browser's language and stays out of mirrors", async ({ browser }) => {
  const { deck } = folder()
  writeFileSync(deck, WARNED)
  const context = await browser.newContext({ locale: 'de-DE' })
  let server: ViteDevServer | undefined
  try {
    server = await dev(deck, { port: 0 })
    const base = server.resolvedUrls!.local[0]!
    const page = await context.newPage()
    await page.goto(base)
    await page.waitForFunction(() => window.blitz)
    await expect(page.locator('.blitz-dev-toggle')).toHaveText('Warnungen: 1')
    await expect(page.locator('.blitz-dev-list')).toBeHidden()
    await expect(page.locator('.blitz-dev-banner')).toBeHidden()

    writeFileSync(deck, BROKEN)
    await expect(page.locator('.blitz-dev-banner')).toContainText('Diese Präsentation hat Fehler')

    const mirror = await context.newPage()
    await mirror.goto(base + '#mirror')
    await mirror.waitForFunction(() => window.blitz)
    await expect(mirror.locator('.blitz-dev-panel, .blitz-dev-banner')).toHaveCount(0)
  } finally {
    await context.close()
    await server?.close()
  }
})

test("only the deck's files open, only from this machine, and Vite's own route is closed", async ({ request }) => {
  const { dir, deck, editorLog } = folder()
  let server: ViteDevServer | undefined
  try {
    server = await dev(deck, { port: 0, host: true })
    const base = server.resolvedUrls!.local[0]!
    const port = new URL(base).port
    const status = async (url: string) => (await request.get(url)).status()
    expect(await status(`${base}__open-in-editor?file=${encodeURIComponent(join(dir, 'private.txt'))}`)).toBe(404)
    expect(await status(`${base}_blitz/open?file=private.txt`)).toBe(404)
    expect(await status(`${base}_blitz/open?file=${encodeURIComponent(join(dir, 'private.txt'))}`)).toBe(404)
    expect(existsSync(editorLog)).toBe(false)
    // Diagnostics name the deck as the command line did, relative to where it ran.
    const name = encodeURIComponent(relative(process.cwd(), deck))
    expect(await status(`${base}_blitz/open?file=${name}&line=3&column=2`)).toBe(204)
    await expect.poll(() => (existsSync(editorLog) ? readFileSync(editorLog, 'utf8').trim() : '')).toBe(`${deck} 3 2`)

    // Asked from another address of this machine, as a phone on the network would.
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
    test.skip(!lan, 'no network address to ask from')
    expect(await status(`http://${lan!.address}:${port}/_blitz/open?file=${name}`)).toBe(403)
  } finally {
    await server?.close()
  }
})
