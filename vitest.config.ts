import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom refuses `localStorage` on an opaque origin, and its default document URL
    // (`about:blank`) is opaque — accessing the property throws
    // `SecurityError: localStorage is not available for opaque origins`. Zustand's
    // `persist` middleware touches it at import time, so every test importing a
    // preferences/presets store fails without a real origin here.
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
