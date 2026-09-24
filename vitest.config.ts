import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom refuses `localStorage` on an opaque origin (`about:blank`), throwing
    // `SecurityError: localStorage is not available for opaque origins`. Vitest's jsdom
    // environment already defaults this to `http://localhost:3000`, so this line is a pin,
    // not a fix — but `test/setup.ts` hands jsdom's native Storage to the test global, so a
    // real origin is a hard prerequisite. Keep it explicit rather than inherited.
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' }
    },
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['lib/**', 'components/**'],
      exclude: ['lib/data/mock-data.ts', '**/*.test.*']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.')
    }
  }
});
