import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*profile.spec.ts', workers: 1, timeout: 120_000,
  outputDir: '../../test-results/performance',
  use: { baseURL: 'http://127.0.0.1:1421', viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 },
  webServer: { command: 'npx vite --config tests/performance/vite.config.ts', cwd: '../..', url: 'http://127.0.0.1:1421', reuseExistingServer: false },
});
