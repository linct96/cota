import { defineConfig } from 'vitest/config'

// Mixed suites follow their strongest external dependency.
const gitIntegrationTests = [
  'tests/git.test.ts',
  'tests/git-remote.test.ts',
  'tests/git-hosting.test.ts',
  'tests/worktrees.test.ts',
  'tests/host.test.ts',
  'tests/file-explorer.test.ts',
]
const nativeIntegrationTests = [
  'tests/native/**/*.test.ts',
  'tests/process-tree.test.ts',
  'tests/workspace-ports.test.ts',
]

export default defineConfig({
  test: {
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    retry: 0,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: [...gitIntegrationTests, ...nativeIntegrationTests],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'git',
          include: gitIntegrationTests,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'native',
          include: nativeIntegrationTests,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
})
