import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHostingRemote } from '../src/main/code-hosting/remote'
import { HostingBranches } from '../src/main/code-hosting/branches'
import { parseHostingAccounts } from '../src/main/code-hosting/accounts'
import { HostingError, type HostingRequest } from '../src/main/code-hosting/cli-runner'
import type { ReviewScope } from '../src/main/code-hosting/adapter'
import { GitHubAdapter } from '../src/main/code-hosting/github'
import { GitLabAdapter } from '../src/main/code-hosting/gitlab'
import { hostingBranchesExpired, type HostingRepository } from '../src/shared/code-hosting'
import { projectBranch } from '../src/main/git/branches/project-branch'
import { parseGitStatus } from '../src/main/git/source-control/status'
import { createBranchFormSchema } from '../src/renderer/src/features/source-control/lib/form-schemas'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cota-git-unit-'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('Git and hosting pure logic / mocked APIs (no Git required)', () => {
  it('isolates the platform branch cache and discards invalidated requests without retrying writes', async () => {
    const cache = new HostingBranches()
    const repository: HostingRepository = {
      provider: 'gitlab',
      host: 'gitlab.example.com',
      path: 'team/repo',
    }
    const original = [{ name: 'main' }]
    const adapter = { branches: vi.fn().mockResolvedValue(original) }
    const [first, second] = await Promise.all([
      cache.get(repository, 1, 'alice', adapter),
      cache.get(repository, 1, 'alice', adapter),
    ])
    expect(first.branches).toBe(second.branches)
    expect(adapter.branches).toHaveBeenCalledOnce()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(first.fetchedAt + 59999)
    try {
      expect(hostingBranchesExpired(first.fetchedAt)).toBe(false)
      expect(await cache.get(repository, 1, 'alice', adapter)).toMatchObject({
        stale: false,
        fetchedAt: first.fetchedAt,
      })
      clock.mockReturnValue(first.fetchedAt + 60000)
      expect(hostingBranchesExpired(first.fetchedAt)).toBe(true)
      expect(await cache.get(repository, 1, 'alice', adapter)).toMatchObject({
        stale: true,
        fetchedAt: first.fetchedAt,
      })
      expect(adapter.branches).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
    adapter.branches.mockResolvedValueOnce([{ name: 'published' }])
    expect((await cache.get(repository, 1, 'alice', adapter, true)).branches).toEqual([
      { name: 'published' },
    ])
    expect((await cache.get(repository, 1, 'bob', adapter)).branches).toEqual(original)
    expect(adapter.branches).toHaveBeenCalledTimes(3)
    adapter.branches.mockRejectedValueOnce(new HostingError('forbidden', 'permission lost'))
    await expect(cache.get(repository, 1, 'alice', adapter, true)).rejects.toThrow(
      'permission lost',
    )
    await cache.get(repository, 1, 'bob', adapter)
    expect(adapter.branches).toHaveBeenCalledTimes(5)
    cache.invalidateRemotes(['git@gitlab.example.com:team/repo.git'])
    let finish!: (value: { name: string }[]) => void
    adapter.branches.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = cache.get(repository, 1, 'bob', adapter)
    const rejected = expect(pending).rejects.toThrow('资源已失效')
    cache.clear()
    finish([{ name: 'late' }])
    await rejected
    expect((await cache.get(repository, 1, 'bob', adapter)).branches).toEqual(original)
    adapter.branches.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const firstRefresh = cache.get(repository, 1, 'bob', adapter, true)
    const forcedRefresh = cache.get(repository, 1, 'bob', adapter, true)
    finish([{ name: 'superseded' }])
    expect((await firstRefresh).branches).toEqual(original)
    expect((await forcedRefresh).branches).toEqual(original)
  })

  it('scans all hosting accounts without mistaking failed credentials for no login or exposing tokens', () => {
    const github = parseHostingAccounts(
      'github',
      JSON.stringify({
        hosts: {
          'github.com': [
            {
              host: 'github.com',
              login: 'personal',
              active: true,
              state: 'success',
              token: 'secret',
            },
            { host: 'github.com', login: 'work', active: false, state: 'success' },
          ],
          'github.example.com': [
            {
              host: 'github.example.com',
              login: 'expired',
              active: true,
              state: 'error',
              error: 'secret',
            },
          ],
        },
      }),
    )
    expect(github).toEqual({
      status: 'detected',
      accounts: [
        { host: 'github.com', account: 'personal', active: true, status: 'connected' },
        { host: 'github.com', account: 'work', active: false, status: 'connected' },
        { host: 'github.example.com', account: 'expired', active: true, status: 'error' },
      ],
    })
    expect(
      parseHostingAccounts(
        'gitlab',
        JSON.stringify({
          hosts: [
            { host: 'gitlab.com', user: 'personal', state: 'success', token: 'secret' },
            { host: 'gitlab.example.com', state: 'error', error: 'secret' },
          ],
        }),
      ),
    ).toEqual({
      status: 'detected',
      accounts: [
        { host: 'gitlab.com', account: 'personal', active: true, status: 'connected' },
        { host: 'gitlab.example.com', account: '', active: true, status: 'error' },
      ],
    })
    for (const provider of ['github', 'gitlab'] as const) {
      expect(
        parseHostingAccounts(provider, JSON.stringify({ hosts: provider === 'github' ? {} : [] }))
          .status,
      ).toBe('disconnected')
      for (const invalid of [
        'secret',
        '{}',
        '{"hosts":[{"host":"https://secret","state":"success"}]}',
      ]) {
        expect(() => parseHostingAccounts(provider, invalid)).toThrow('账号列表格式无法识别')
      }
    }
    expect(() =>
      parseHostingAccounts('gitlab', '{"hosts":[{"host":"gitlab.com","state":"success"}]}'),
    ).toThrow('账号列表格式无法识别')
  })

  it.each(['github', 'gitlab'] as const)(
    'reads %s hosting review history and merges with identity checks',
    async (provider) => {
      const request = vi.fn<HostingRequest>()
      const adapter =
        provider === 'github' ? new GitHubAdapter(request) : new GitLabAdapter(request)
      const repository = { provider, host: `${provider}.com`, path: 'team/repo' }
      const scope: ReviewScope = {
        source: repository,
        target: repository,
        branch: 'feature/review',
        sourceInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
        targetInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
      }
      const time = '2026-10-28T00:00:00Z'
      const payload = (
        number: number,
        state: 'open' | 'merged' | 'closed' | 'locked',
        branch = scope.branch,
        target = 'main',
        sourceId = 1,
      ) => ({
        title: `Review ${number}`,
        draft: false,
        created_at: time,
        updated_at: time,
        merged_at: state === 'merged' ? time : null,
        closed_at: state === 'merged' || state === 'closed' ? time : null,
        ...(provider === 'github'
          ? {
              number,
              state: state === 'open' ? 'open' : 'closed',
              head: { ref: branch, sha: 'a'.repeat(40), repo: { id: sourceId } },
              base: { ref: target, repo: { id: 1 } },
            }
          : {
              iid: number,
              state: state === 'open' ? 'opened' : state,
              source_project_id: sourceId,
              target_project_id: 1,
              source_branch: branch,
              target_branch: target,
              sha: 'a'.repeat(40),
            }),
      })
      request.mockResolvedValueOnce([
        payload(1, 'open'),
        payload(2, 'open', scope.branch, 'release'),
        payload(3, 'open', 'other'),
        payload(4, 'open', scope.branch, 'main', 2),
      ])
      expect((await adapter.listOpen(scope)).map((review) => review.targetBranch)).toEqual([
        'main',
        'release',
      ])
      request.mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => payload(index + 30, 'closed', 'other')),
      )
      expect(await adapter.history(scope, 1)).toMatchObject({ items: [], nextPage: 2 })
      request.mockResolvedValueOnce([payload(12, 'merged'), payload(9, 'closed')])
      const history = await adapter.history(scope, 2)
      expect(history.nextPage).toBeNull()
      expect(history.items.map((review) => [review.number, review.state])).toEqual([
        [12, 'merged'],
        [9, 'closed'],
      ])
      expect(history.items[0]).toMatchObject({ createdAt: time, mergedAt: time })
      expect(request.mock.calls[2]?.[1]).toContain('page=2')
      expect(request.mock.calls[2]?.[1]).toContain('feature%2Freview')
      request.mockResolvedValueOnce(payload(12, 'merged'))
      expect((await adapter.get(scope, 12)).url).toBe(
        provider === 'github'
          ? 'https://github.com/team/repo/pull/12'
          : 'https://gitlab.com/team/repo/-/merge_requests/12',
      )
      request.mockResolvedValueOnce(payload(13, 'merged', 'other'))
      await expect(adapter.get(scope, 13)).rejects.toThrow('不匹配')
      request.mockResolvedValueOnce(
        provider === 'github' ? { files: [] } : { diffs: [], commits: [] },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'empty',
      })
      request.mockResolvedValueOnce(
        provider === 'github'
          ? { files: [{ filename: 'file' }] }
          : { diffs: [{ diff: '+line' }], commits: [] },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'changes',
      })
      request.mockResolvedValueOnce(
        provider === 'github'
          ? { files: Array.from({ length: 300 }, () => ({ filename: 'file' })) }
          : { diffs: [], commits: [], compare_timeout: true },
      )
      expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
        status: 'unknown',
      })
      request.mockResolvedValueOnce(payload(12, 'open'))
      const openReview = await adapter.get(scope, 12)
      const mergeCall = request.mock.calls.length
      if (provider === 'github') {
        request.mockResolvedValueOnce({ merged: true }).mockResolvedValueOnce(payload(12, 'merged'))
      } else {
        request.mockResolvedValueOnce(payload(12, 'merged'))
      }
      expect(await adapter.merge(scope, openReview)).toMatchObject({
        state: 'merged',
        head: openReview.head,
      })
      expect(request.mock.calls[mergeCall]).toEqual([
        repository,
        provider === 'github'
          ? 'repos/team/repo/pulls/12/merge'
          : 'projects/team%2Frepo/merge_requests/12/merge',
        provider === 'github'
          ? { sha: openReview.head, merge_method: 'merge' }
          : { sha: openReview.head, squash: false, should_remove_source_branch: false },
        'PUT',
      ])
      if (provider === 'github') {
        request.mockResolvedValueOnce({ merged: false })
        await expect(adapter.merge(scope, openReview)).rejects.toThrow('未合并')
      }
      if (provider === 'gitlab') {
        const account = {
          username: 'me',
          email: 'me@example.com',
          public_email: 'public@example.com',
          commit_email: 'private@noreply.gitlab.com',
        }
        const emails = [
          { email: 'old@example.com', confirmed_at: time },
          { email: 'pending@example.com', confirmed_at: null },
        ]
        const commit = (
          title: string,
          body = '',
          author = 'me@example.com',
          date = time,
          parents = ['parent'],
        ) => ({
          title,
          message: `${title}\n${body}`,
          author_email: author,
          authored_date: date,
          parent_ids: parents,
        })
        for (const [commits, defaultTitle, defaultDescription] of [
          [
            [commit('Only commit', '\nSingle body\n', 'other@example.com')],
            'Only commit',
            'Single body',
          ],
          [
            [commit('First', '', 'other@example.com'), commit('Second', '', 'pending@example.com')],
            'Feature/review',
            '',
          ],
          [
            [
              commit('Newest', '\nMore'),
              commit('Other author', '\nNot mine', 'other@example.com', '2026-10-01T00:00:00Z'),
              commit('Oldest own commit', '\nDetails', ' OLD@EXAMPLE.COM ', '2026-10-20T00:00:00Z'),
            ],
            'Oldest own commit',
            'Details',
          ],
          [
            [
              commit('With body', '\nDetails'),
              commit('First', '', 'me@example.com', '2026-10-20T00:00:00Z'),
            ],
            'First',
            '',
          ],
          [
            [
              commit('Pending', '\nUnverified', 'pending@example.com', '2026-10-01T00:00:00Z'),
              commit(
                'Private email',
                '\nDetails',
                'private@noreply.gitlab.com',
                '2026-10-20T00:00:00Z',
              ),
              commit('Public email', '\nMore', 'public@example.com'),
            ],
            'Private email',
            'Details',
          ],
          [
            [
              commit('Feature', '\nDetails'),
              commit('Merge', '\nMerged details', 'me@example.com', '2026-10-20T00:00:00Z', [
                'one',
                'two',
              ]),
            ],
            'Merge',
            'Merged details',
          ],
        ] as const) {
          request.mockResolvedValueOnce({ diffs: [{ diff: '+line' }], commits })
          if (commits.length > 1) {
            request.mockResolvedValueOnce(account)
            request.mockResolvedValueOnce(emails)
          }
          expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toEqual({
            status: 'changes',
            defaultTitle,
            defaultDescription,
          })
        }
        for (const confidential of [false, true]) {
          request.mockResolvedValueOnce({
            diffs: [{ diff: '+line' }],
            commits: [
              commit('First', '', 'other@example.com'),
              commit('Second', '', 'other@example.com'),
            ],
          })
          request.mockResolvedValueOnce(account)
          request.mockResolvedValueOnce(emails)
          request.mockResolvedValueOnce({ title: 'Fix issue', confidential })
          expect(
            await adapter.compare(
              { ...scope, branch: '123-fix_issue' },
              'source-sha',
              'target-sha',
            ),
          ).toMatchObject({
            defaultTitle: confidential ? '123 fix issue' : 'Resolve "Fix issue"',
          })
        }
        request.mockResolvedValueOnce(payload(14, 'locked'))
        expect((await adapter.get(scope, 14)).state).toBe('open')
        request.mockResolvedValueOnce({ ...payload(15, 'open'), state: 'unexpected' })
        await expect(adapter.get(scope, 15)).rejects.toThrow()
      }
      const branchPage = (names: string[], hasNextPage: boolean) =>
        provider === 'github'
          ? {
              data: {
                repository: {
                  refs: {
                    nodes: names.map((name) => ({ name, target: { committedDate: time } })),
                    pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next-page' : null },
                  },
                },
              },
            }
          : names.map((name) => ({ name, commit: { committed_date: time } }))
      request.mockResolvedValueOnce(
        branchPage(
          Array.from({ length: 100 }, (_, index) => `branch-${index}`),
          true,
        ),
      )
      request.mockResolvedValueOnce(branchPage(['remote/only'], false))
      const branches = await adapter.branches(repository)
      expect(branches).toHaveLength(101)
      expect(branches.at(-1)).toEqual({ name: 'remote/only', date: time })
      if (provider === 'github') {
        expect(request.mock.calls.at(-1)).toEqual([
          repository,
          'graphql',
          expect.objectContaining({
            variables: { owner: 'team', name: 'repo', cursor: 'next-page' },
          }),
        ])
      } else {
        expect(request.mock.calls.at(-1)?.[1]).toContain('page=2')
      }
      request.mockRejectedValueOnce(new Error('remote branches unavailable'))
      await expect(adapter.branches(repository)).rejects.toThrow('remote branches unavailable')
      if (provider === 'github') {
        request.mockResolvedValueOnce({
          files: [{ filename: 'file' }],
          commits: [{ commit: { message: 'Remote commit title\n\nBody' } }],
        })
        expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
          defaultTitle: 'Remote commit title',
          defaultDescription: 'Body',
        })
      }
    },
  )

  it('validates hosting remote syntax without running Git', () => {
    expect(parseHostingRemote('git@gitlab.com:group/sub/project.git')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      path: 'group/sub/project',
    })
    expect(
      parseHostingRemote('git@work-alias:team/project.git', 'github', 'github.example.com'),
    ).toEqual({ provider: 'github', host: 'github.example.com', path: 'team/project' })
    for (const remote of [
      'file:///tmp/repo',
      'https://github.com/team/%2e%2e',
      'https://github.com/team/repo?token=secret',
      'git@unknown:team/repo.git',
    ])
      expect(parseHostingRemote(remote)).toBeNull()
  })

  it('validates paths before running Git', async () => {
    await expect(projectBranch('relative/path')).rejects.toThrow()
    await expect(projectBranch('/tmp/project\0git')).rejects.toThrow()
    await expect(projectBranch(join(directory, 'missing'))).rejects.toThrow()
    const oid = 'a'.repeat(40)
    expect(
      parseGitStatus(`u UU N... 100644 100644 100644 100644 ${oid} ${oid} ${oid} conflict file\0`)
        .entries,
    ).toEqual([expect.objectContaining({ path: 'conflict file', area: 'conflict', status: 'UU' })])
    expect(() => parseGitStatus('? missing-terminator')).toThrow('不完整')
    expect(() => parseGitStatus('? ../escape\0')).toThrow('路径无效')
    expect(() =>
      parseGitStatus(`2 R. N... 100644 100644 100644 ${oid} ${oid} R100 renamed\0`),
    ).toThrow('路径无效')
  })
  it('omits the branch subtitle when Git is unavailable', async () => {
    vi.stubEnv('PATH', directory)
    expect(await projectBranch(directory)).toBeNull()
  })
  it('validates and normalizes branch form names without running Git', () => {
    for (const name of [
      '-bad',
      'a..b',
      '@{-1}',
      'HEAD',
      'bad\nname',
      'a//b',
      '.hidden',
      'a.lock',
      'a b',
      'a\\b',
    ])
      expect(createBranchFormSchema.safeParse({ name }).success).toBe(false)
    expect(createBranchFormSchema.parse({ name: ' feature/新分支 ' }).name).toBe('feature/新分支')
  })
})
