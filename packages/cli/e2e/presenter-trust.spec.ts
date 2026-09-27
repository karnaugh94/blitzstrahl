/**
 * Only a window related by opening (the presenter the deck opened, or the one
 * that opened it) may drive the deck (PLAN §15, M6.14). A frame inside the
 * deck may not: over HTTP a same-origin frame passes the origin check, and on
 * file:// there is none. In 1.0 such a frame could move the talk and take the
 * presenter's place as the deck's peer.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from '../dist/index.js'
import { buildAndServe } from './serve.js'

const FRAME = `<iframe title="probe" srcdoc="<script>setInterval(function () { parent.postMessage({ blitz: 'blitzstrahl/presenter@1', type: 'goto', slide: 2, step: 0 }, '*') }, 40)</script>"></iframe>`
const DECK = `---\ntransition: none\n---\n\n# One\n\n${FRAME}\n\n---\n\n# Two\n\n---\n\n# Three\n`

function deckFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'blitz-trust-'))
  writeFileSync(join(dir, 'talk.md'), DECK)
  return join(dir, 'talk.md')
}

async function staysPut(page: Page) {
  await page.waitForFunction(() => window.blitz)
  // The frame has posted a dozen times by now.
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 0, step: 0 })
}

test('a frame inside the deck can’t drive it (over HTTP)', async ({ page }) => {
  const { url, server } = await buildAndServe(deckFile())
  try {
    await page.goto(url)
    await staysPut(page)
    // The real presenter still does.
    const [presenter] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('p')])
    await presenter.waitForFunction(() => (window as unknown as { blitzPresenter?: { status: string } }).blitzPresenter?.status === 'connected')
    await presenter.keyboard.press('ArrowRight')
    await expect.poll(() => page.evaluate(() => window.blitz!.pos)).toEqual({ slide: 1, step: 0 })
  } finally {
    server.close()
  }
})

test('a frame inside the deck can’t drive it (from file://)', async ({ page }) => {
  const deck = deckFile()
  const out = deck.replace(/\.md$/, '.html')
  expect((await build(deck, { standalone: true, outFile: out, quiet: true, overflowCheck: false })).ok).toBe(true)
  await page.goto(pathToFileURL(out).href)
  await staysPut(page)
})
