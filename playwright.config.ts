import { existsSync } from 'node:fs'
import { defineConfig, devices, firefox, webkit } from '@playwright/test'

// Browser tests for the runtime, driven through the real CLI (PLAN §9).
// Run `pnpm build` first: tests import the built CLI.
//
// Chromium runs everything. Firefox and WebKit run `browsers.spec.ts` (the
// presenter's windows, M12.7), when they're installed here
// (`npx playwright install firefox webkit`); otherwise they're skipped.
const cross = '*/e2e/browsers.spec.ts'
const installed = (b: { executablePath(): string }) => {
  try {
    return existsSync(b.executablePath())
  } catch {
    return false
  }
}

export default defineConfig({
  testDir: 'packages',
  testMatch: '*/e2e/**/*.spec.ts',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    ...(installed(firefox) ? [{ name: 'firefox', testMatch: cross, use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 720 } } }] : []),
    ...(installed(webkit) ? [{ name: 'webkit', testMatch: cross, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 720 } } }] : []),
  ],
})
