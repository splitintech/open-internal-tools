import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { coverageConfig } from '../../tooling/vitest-coverage.ts';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: coverageConfig,
  },
  resolve: {
    alias: {
      '@splitin/verification-adapter-sdk': fileURLToPath(
        new URL('../verification-adapter-sdk/src/index.ts', import.meta.url),
      ),
    },
  },
});
