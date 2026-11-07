import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Live end-to-end suite against a running console (see test/live/scenarios.live.test.ts).
// Skipped unless MACP_UI_BASE_URL is set; never part of `npm test` or CI.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/live/**/*.live.test.ts'],
    exclude: ['node_modules', '.next'],
    // A run takes seconds, but launches past the proxy's quota wait out its 429 retry-after (up to 10 min).
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.')
    }
  }
});
