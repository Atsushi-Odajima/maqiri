import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts/,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './.artifacts/test-results'
});
