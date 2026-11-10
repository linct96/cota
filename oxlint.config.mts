import { defineConfig } from 'oxlint'
import { tanstackConfig } from '@tanstack/oxlint-config'

export default defineConfig({
  ...tanstackConfig,
  plugins: [...(tanstackConfig.plugins ?? []), 'react', 'jsx-a11y'],
  categories: { correctness: 'error' },
  ignorePatterns: [
    ...tanstackConfig.ignorePatterns,
    'out/**',
    'release/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
    '.*/**',
  ],
  rules: {
    ...tanstackConfig.rules,
    'typescript/array-type': ['error', { default: 'array', readonly: 'array' }],
    'typescript/no-unnecessary-condition': 'error',
    'typescript/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/unbound-method': 'error',
    'unicorn/no-useless-spread': 'error',
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'error',
  },
  overrides: [
    ...(tanstackConfig.overrides ?? []),
    {
      files: ['**/*.cjs'],
      rules: { 'import/no-commonjs': 'off' },
    },
  ],
})
