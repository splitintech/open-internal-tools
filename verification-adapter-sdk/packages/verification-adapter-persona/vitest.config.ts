import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { coverageConfig } from '../../tooling/vitest-coverage.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: coverageConfig,
  },
  resolve: {
    alias: {
      '@splitin/verification-adapter-sdk': path.resolve(root, '../verification-adapter-sdk/src/index.ts'),
    },
  },
});
