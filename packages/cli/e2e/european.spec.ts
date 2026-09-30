/**
 * M7's exit test (PLAN §15): the European sample deck, in both built-in
 * themes. Every glyph on every slide is drawn in a font the theme ships,
 * as Chromium reports it (not merely loaded: drawn), so line breaks don't
 * depend on the machine. And German numbers read and write as German:
 * `3,5` charts as 3.5, tables sort, count-up counts, the live region speaks.
 */
import type { Server } from 'node:http'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** A copy of the example, set to `theme`. */
function themed(theme: string): string {
  const dir = mkdtempSync(join(tmpdir(), `blitz-european-${theme}-`))
  cpSync(join(root, 'examples/european'), dir, { recursive: true })
  const deck = join(dir, 'deck.md')
  writeFileSync(deck, readFileSync(deck, 'utf8').replace(/^---\n/, `---\ntheme: ${theme}\n`))
  return deck
}

/**
 * The fonts Chromium drew the current slide's text with, per element: the
 * DevTools protocol knows which face each glyph run came from.
 */
async function drawnFonts(page: Page): Promise<Array<{ text: string; fonts: Array<{ familyName: string; isCustomFont: boolean }> }>> {
  const texts = await page.evaluate(() => {
    document.querySelectorAll('[data-probe]').forEach((e) => e.removeAttribute('data-probe'))
    const slide = document.querySelector<HTMLElement>('.blitz-slide[aria-current], .blitz-slide.is-current') ?? [...document.querySelectorAll<HTMLElement>('.blitz-slide')].find((s) => s.checkVisibility())!
    const out: string[] = []
    for (const el of slide.querySelectorAll('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim()).join('')
      if (!own || !(el as HTMLElement).checkVisibility?.({ opacityProperty: false, visibilityProperty: true })) continue
      el.setAttribute('data-probe', String(out.length))
      out.push(own)
    }
    return out
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: doc.nodeId, selector: '[data-probe]' })
  const out = []
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId })
    const i = Number(attributes[attributes.indexOf('data-probe') + 1])
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    out.push({ text: texts[i]!, fonts: fonts.map((f) => ({ familyName: f.familyName, isCustomFont: f.isCustomFont })) })
  }
  await cdp.detach()
  return out
}

for (const theme of ['aurora', 'broadsheet']) {
  test.describe(theme, () => {
    let url = ''
    let server: Server
    test.beforeAll(async () => {
      ;({ url, server } = await buildAndServe(themed(theme)))
    })
    test.afterAll(() => server?.close())
    test.use({ reducedMotion: 'reduce' })

    test('every glyph on every slide is drawn in a shipped font', async ({ page }) => {
      await page.goto(url)
      await page.waitForFunction(() => window.blitz)
      const steps = await page.evaluate(() => window.blitz!.steps)
      const fallbacks: string[] = []
      let drawn = 0
      for (const [i, last] of steps.entries()) {
        await page.evaluate(([s, t]) => window.blitz!.goto(s!, t!), [i, last])
        await page.evaluate(() => document.fonts.ready)
        // Charts draw after entry; wait for their text.
        if (await page.locator('.blitz-slide [data-blitz-block="chart"], .blitz-slide [data-blitz-block]').count()) await page.waitForTimeout(300)
        for (const { text, fonts } of await drawnFonts(page)) {
          drawn++
          for (const f of fonts) if (!f.isCustomFont) fallbacks.push(`slide ${i + 1}: "${text.slice(0, 40)}" in ${f.familyName}`)
        }
      }
      expect(drawn).toBeGreaterThan(20)
      expect(fallbacks).toEqual([])
    })
  })
}

test.describe('German numbers', () => {
  let url = ''
  let server: Server
  test.beforeAll(async () => {
    ;({ url, server } = await buildAndServe(join(root, 'examples/european/deck.md')))
  })
  test.afterAll(() => server?.close())

  test('3,5 charts as 3.5, tables sort, count-up counts, and the live region speaks German', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${url}#/radverkehr`)
    await page.waitForFunction(() => window.blitz)
    const labels = page.locator('#rad svg text')
    await expect(labels.filter({ hasText: /^3,5 %$/ })).toHaveCount(1)
    await expect(labels.filter({ hasText: /^42,1 %$/ })).toHaveCount(1)
    await expect(page.locator('.blitz-sr')).toHaveText('Radverkehr (4 von 6)')

    await page.goto(`${url}#/wege`)
    await page.locator('#wege-tabelle th', { hasText: 'Wege pro Tag' }).locator('button').click()
    await expect(page.locator('#wege-tabelle tbody td:first-child')).toHaveText(['Utrecht', 'Leipzig', 'Praha', 'Kraków', 'Αθήνα'])

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(`${url}#/blick`)
    await page.waitForFunction(() => window.blitz)
    await page.keyboard.press('ArrowRight')
    const halfway = await page.evaluate(async () => {
      const el = document.getElementById('athen')!
      for (const a of el.getAnimations()) {
        a.pause()
        a.currentTime = (a.effect!.getComputedTiming().duration as number) / 2
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return el.textContent
    })
    // Counting, in German: dots between the thousands, not yet the target.
    expect(halfway).toMatch(/^\d{1,3}(\.\d{3})+$/)
    expect(halfway).not.toBe('1.450.250')
  })
})

// M8: arrows, comparisons and ticks come from Inter's symbols face, not
// the machine's fonts (Fontsource's subsets leave most of them out).
for (const theme of ['aurora', 'broadsheet']) {
  test(`${theme}: arrows, ≠ ≤ and ticks are drawn in a shipped font`, async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), `blitz-symbols-${theme}-`))
    const deck = join(dir, 'deck.md')
    writeFileSync(deck, `---\ntheme: ${theme}\n---\n\n# From → to ✓\n\nx ≠ y ≤ z ← ½ ✗\n`)
    const { url, server } = await buildAndServe(deck)
    try {
      await page.goto(url)
      await page.waitForFunction(() => window.blitz)
      await page.evaluate(() => document.fonts.ready)
      const drawn = await drawnFonts(page)
      expect(drawn.map((d) => d.text)).toEqual(['From → to ✓', 'x ≠ y ≤ z ← ½ ✗'])
      expect(drawn.flatMap((d) => d.fonts.filter((f) => !f.isCustomFont).map((f) => `"${d.text}" in ${f.familyName}`))).toEqual([])
    } finally {
      server.close()
    }
  })
}
