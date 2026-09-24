import { defineConfig, devices } from '@playwright/test'

// Browser tests for the runtime, driven through the real CLI (PLAN §9).
// Run `pnpm build` first: tests import the built CLI.
export default defineConfig({
  testDir: 'packages',
  testMatch: '*/e2e/**/*.spec.ts',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
})
