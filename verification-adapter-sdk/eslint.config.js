import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.import/**',
      '**/node_modules/**',
      'docs/generated/**',
      'coverage/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'examples/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        Request: 'readonly',
        crypto: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx', 'examples/**/*.ts', 'examples/**/*.tsx', 'scripts/**/*.mjs'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
