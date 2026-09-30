/**
 * The preview panel's page (M13, packages/vscode/src/webview.ts) around a
 * real `dev` server: the extension moves it with a hash message, and the
 * deck goes to that slide without reloading, keeping what it had drawn.
 */
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import { dev } from '../../cli/dist/index.js'
import { page as panelPage } from '../src/webview.js'

test('a hash message moves the framed deck to the slide, without a reload', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-vscode-preview-'))
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, '# One\n\n---\n\n# Two {#second}\n\nA {@1}\n\n---\n\n# Three\n')
  let server: ViteDevServer | undefined
  try {
    server = await dev(deck, { port: 0 })
    const url = server.resolvedUrls!.local[0]!
    await page.setContent(panelPage(url))
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('[data-blitz-current] h1')).toHaveText('One')
    const deckFrame = page.frames().find((f) => f.url().startsWith(url))!
    await deckFrame.waitForFunction(() => window.blitz)
    // A mark that a reload would lose.
    await deckFrame.evaluate(() => ((window as unknown as { kept: boolean }).kept = true))

    await page.evaluate(() => window.postMessage({ hash: '#/second' }, '*'))
    await expect(frame.locator('[data-blitz-current] h1')).toHaveText('Two')
    expect(await deckFrame.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
    await page.evaluate(() => window.postMessage({ hash: '#/three' }, '*'))
    await expect(frame.locator('[data-blitz-current] h1')).toHaveText('Three')
    expect(await deckFrame.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true)
    // Anything else posted to the page is ignored.
    await page.evaluate(() => window.postMessage({ nav: 'x' }, '*'))
    await page.waitForTimeout(200)
    await expect(frame.locator('[data-blitz-current] h1')).toHaveText('Three')
  } finally {
    await server?.close()
  }
})

test("in the panel, the dev panel's links go to the editor, not to the server's editor launcher", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-vscode-links-'))
  const deck = join(dir, 'talk.md')
  writeFileSync(deck, '# One\n\n```chart\ntype: bar\ndata: [{ a: 1 }]\ncolour: red\n```\n')
  // A stand-in for the server's launcher: it must not run.
  const launched = join(dir, 'launched.txt')
  const launcher = join(dir, 'editor.sh')
  writeFileSync(launcher, `#!/bin/sh\necho "$@" > '${launched}'\n`)
  chmodSync(launcher, 0o755)
  process.env.LAUNCH_EDITOR = launcher
  // What VS Code gives a webview: its messages to the extension.
  await page.addInitScript(() => {
    const w = window as unknown as { sent: unknown[]; acquireVsCodeApi: () => unknown }
    w.sent = []
    w.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => w.sent.push(m) })
  })
  let server: ViteDevServer | undefined
  let panel: Server | undefined
  try {
    server = await dev(deck, { port: 0 })
    // Loaded by navigating, as VS Code loads a webview, so the init script
    // runs; from a loopback server, since Chromium won't let a public page
    // (a fulfilled route counts as one) frame localhost.
    const html = panelPage(server.resolvedUrls!.local[0]!)
    panel = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html))
    await new Promise<void>((r) => panel!.listen(0, '127.0.0.1', r))
    await page.goto(`http://127.0.0.1:${(panel.address() as AddressInfo).port}/`)
    const at = page.frameLocator('iframe').locator('.blitz-dev-list li .blitz-dev-at')
    await expect(at).toHaveText(/talk\.md:3:1$/)
    await at.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { sent: unknown[] }).sent)).toEqual([{ open: { file: relative(process.cwd(), deck), line: 3, column: 1 } }])
    await page.waitForTimeout(300)
    expect(existsSync(launched)).toBe(false)
  } finally {
    await server?.close()
    panel?.close()
    delete process.env.LAUNCH_EDITOR
  }
})
