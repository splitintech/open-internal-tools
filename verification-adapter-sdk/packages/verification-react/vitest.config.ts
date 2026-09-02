import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { coverageConfig } from '../../tooling/vitest-coverage.ts';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    coverage: coverageConfig,
  },
  resolve: {
    alias: {
      '@splitin/verification-adapter-sdk': fileURLToPath(
        new URL('../verification-adapter-sdk/src/index.ts', import.meta.url),
      ),
      '@splitin/verification-web': fileURLToPath(
        new URL('../verification-web/src/index.ts', import.meta.url),
      ),
    },
  },
});
