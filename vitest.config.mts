import { defineConfig } from 'vitest/config'

const gitIntegrationTests = [
  'tests/git.test.ts',
  'tests/git-remote.test.ts',
  'tests/git-hosting.test.ts',
  'tests/worktrees.test.ts',
]

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: gitIntegrationTests,
        },
      },
      {
        test: {
          name: 'git',
          include: gitIntegrationTests,
          // Bound real Git subprocess contention; concurrency inside each test remains covered.
          fileParallelism: false,
        },
      },
    ],
  },
})
