/**
 * `reveal=rows` shows nothing of the rows still to come, not even their
 * rules (PLAN §15, M6.10): a collapsed table paints a hidden cell's borders,
 * so 1.0 drew an empty ruled line for every row to come.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { buildAndServe } from './serve.js'

const TABLE = '# Rows\n\n| Land | Rate |\n|---|---|\n| ES | 3,5 |\n| DE | 12,25 |\n| FR | 4,0 |\n\n{reveal=rows @1}\n'

/** How far the pixels along a row's bottom edge are from those just inside the row. */
async function edgeContrast(page: Page, row: number): Promise<number> {
  const r = await page.locator('[data-blitz-current] tbody tr').nth(row).boundingBox()
  // A collapsed 1px rule lands on the row's last pixel or the next one, depending on how the table rounds.
  const png = await page.screenshot({ clip: { x: r!.x + 10, y: r!.y + r!.height - 6, width: 200, height: 8 } })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const inside = g.getImageData(0, 1, c.width, 1).data
    let max = 0
    for (const y of [c.height - 4, c.height - 3, c.height - 2]) {
      const edge = g.getImageData(0, y, c.width, 1).data
      for (let i = 0; i < edge.length; i += 4) for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(edge[i + k]! - inside[i + k]!))
    }
    return max
  }, png.toString('base64'))
}

for (const theme of ['aurora', 'broadsheet']) {
  test(`${theme}: rows still to come leave no rule`, async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), 'blitz-reveal-'))
    const deck = join(dir, 'talk.md')
    writeFileSync(deck, `---\ntheme: ${theme}\ntransition: none\n---\n\n# Title\n\n---\n\n${TABLE}`)
    const { url, server } = await buildAndServe(deck)
    try {
      await page.goto(`${url}#/rows/1`)
      await page.waitForFunction(() => window.blitz?.pos?.step === 1)
      await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
      // The one row shown keeps its rule (so the test can see a rule at all)…
      expect(await edgeContrast(page, 0)).toBeGreaterThan(20)
      // …and the two still to come show none.
      expect(await edgeContrast(page, 1)).toBeLessThan(8)
      expect(await edgeContrast(page, 2)).toBeLessThan(8)
    } finally {
      server.close()
    }
  })
}
