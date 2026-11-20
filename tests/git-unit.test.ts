import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHostingRemote } from '../src/main/code-hosting/remote'
import { HostingBranches } from '../src/main/code-hosting/branches'
import { parseHostingAccounts } from '../src/main/code-hosting/accounts'
import { HostingAccountsCache } from '../src/main/code-hosting/accounts-cache'
import { HostingError } from '../src/main/code-hosting/cli-runner'
import type { HostingRequest } from '../src/main/code-hosting/cli-runner'
import type { ReviewScope } from '../src/main/code-hosting/adapter'
import { GitHubAdapter } from '../src/main/code-hosting/github'
import { GitLabAdapter } from '../src/main/code-hosting/gitlab'
import { CodeHostingService } from '../src/main/code-hosting/service'
import { ConfigStore } from '../src/main/settings/config-store'
import { SourceControlService } from '../src/main/git/source-control/service'
import { hostingBranchesExpired } from '../src/shared/code-hosting'
import type {
  HostedReview,
  HostingAccounts,
  HostingContext,
  HostingRepository,
} from '../src/shared/code-hosting'
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

const REVIEW_TIME = '2026-10-28T00:00:00Z'

function reviewFixture(provider: 'github' | 'gitlab') {
  const request = vi.fn<HostingRequest>()
  const adapter = provider === 'github' ? new GitHubAdapter(request) : new GitLabAdapter(request)
  const repository = { provider, host: `${provider}.com`, path: 'team/repo' }
  const scope: ReviewScope = {
    source: repository,
    target: repository,
    branch: 'feature/review',
    sourceInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
    targetInfo: { id: 1, path: repository.path, defaultBranch: 'main' },
  }
  const time = REVIEW_TIME
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
  return { request, adapter, repository, scope, time, payload }
}

function gitlabIdentity() {
  return {
    account: {
      username: 'me',
      email: 'me@example.com',
      public_email: 'public@example.com',
      commit_email: 'private@noreply.gitlab.com',
    },
    emails: [
      { email: 'old@example.com', confirmed_at: REVIEW_TIME },
      { email: 'pending@example.com', confirmed_at: null },
    ],
  }
}

function commit(
  title: string,
  body = '',
  author = 'me@example.com',
  date = REVIEW_TIME,
  parents = ['parent'],
) {
  return {
    title,
    message: `${title}\n${body}`,
    author_email: author,
    authored_date: date,
    parent_ids: parents,
  }
}

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
            { host: 'gitlab.logged-out.example', state: 'error', token_source: 'none' },
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

  it('hosting account cache persists scans and failure states without saving CLI credentials', async () => {
    const file = join(directory, 'code-hosting-accounts.json')
    const github = parseHostingAccounts(
      'github',
      JSON.stringify({
        hosts: {
          'github.com': [
            { host: 'github.com', login: 'alice', active: true, state: 'success', token: 'secret' },
          ],
        },
      }),
    )
    const gitlab: HostingAccounts = { status: 'disconnected', message: 'no accounts' }
    const scan = vi.fn((provider: unknown): Promise<HostingAccounts> =>
      Promise.resolve(provider === 'github' ? github : gitlab),
    )
    const service = new CodeHostingService(
      new ConfigStore(join(directory, 'config.json')),
      new SourceControlService(),
      undefined,
      scan,
      new HostingAccountsCache(file),
    )
    expect((await service.readAccounts()).entries).toEqual({})
    expect(scan).not.toHaveBeenCalled()
    await Promise.all([
      service.accounts('github', false),
      service.accounts('github', false),
      service.accounts('gitlab', false),
    ])
    expect(scan).toHaveBeenCalledTimes(2)
    const original = await readFile(file, 'utf8')
    expect(original).not.toContain('secret')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)

    const restarted = new CodeHostingService(
      new ConfigStore(join(directory, 'config.json')),
      new SourceControlService(),
      undefined,
      scan,
      new HostingAccountsCache(file),
    )
    expect((await restarted.readAccounts()).entries).toEqual({
      github: { result: github, failed: false },
      gitlab: { result: gitlab, failed: false },
    })
    await restarted.readAccounts()
    expect(scan).toHaveBeenCalledTimes(2)
    scan.mockRejectedValueOnce(new Error('private-token'))
    await expect(restarted.accounts('github', true)).rejects.toThrow('private-token')
    expect((await restarted.readAccounts()).entries.github).toEqual({
      result: github,
      failed: true,
    })
    expect(await readFile(file, 'utf8')).not.toContain('private-token')
    expect((await new HostingAccountsCache(file).read()).entries.github).toEqual({
      result: github,
      failed: true,
    })
    await restarted.accounts('github', true)
    expect(scan).toHaveBeenCalledTimes(4)
    expect((await new HostingAccountsCache(file).read()).entries.github).toEqual({
      result: github,
      failed: false,
    })
    service.close()
    restarted.close()
  })

  it('hosting account cache ignores old removal marks and follows current CLI logins', async () => {
    const file = join(directory, 'code-hosting-accounts.json')
    const account = {
      host: 'github.example.com',
      account: 'alice',
      active: true,
      status: 'connected',
    } as const
    const disconnected = { status: 'disconnected', message: 'no accounts' } as const
    const detected = { status: 'detected', accounts: [account] }
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: {
          github: { result: disconnected, failed: false, removed: [{ host: account.host }] },
        },
      }),
    )
    const scan = vi.fn().mockResolvedValueOnce(detected).mockResolvedValueOnce(disconnected)
    const service = new CodeHostingService(
      new ConfigStore(join(directory, 'config.json')),
      new SourceControlService(),
      undefined,
      scan,
      new HostingAccountsCache(file),
    )
    expect(await service.readAccounts()).toEqual({
      entries: { github: { result: disconnected, failed: false } },
    })
    await expect(service.accounts('github')).resolves.toEqual(detected)
    expect((await new HostingAccountsCache(file).read()).entries.github).toEqual({
      result: detected,
      failed: false,
    })
    expect(await readFile(file, 'utf8')).not.toContain('"removed"')

    await expect(service.accounts('github')).resolves.toEqual(disconnected)
    expect((await service.readAccounts()).entries.github?.result).toEqual(disconnected)
  })

  it.each([
    ['single', [{ host: 'github.com', account: 'alice', active: true, status: 'connected' }]],
    [
      'multiple',
      [
        { host: 'github.com', account: 'alice', active: true, status: 'connected' },
        { host: 'github.example', account: 'bob', active: true, status: 'connected' },
      ],
    ],
  ] as const)(
    'hosting account cache preserves %s accounts while the CLI is unavailable',
    async (_name, accounts) => {
      const file = join(directory, 'code-hosting-accounts.json')
      const detected: HostingAccounts = { status: 'detected', accounts: [...accounts] }
      const unavailable: HostingAccounts = { status: 'cli-unavailable', message: 'CLI unavailable' }
      const scan = vi.fn().mockResolvedValue(detected)
      const service = new CodeHostingService(
        new ConfigStore(join(directory, 'config.json')),
        new SourceControlService(),
        undefined,
        scan,
        new HostingAccountsCache(file),
      )
      await service.accounts('github', true)
      scan.mockResolvedValueOnce(unavailable)
      await expect(service.accounts('github', true)).resolves.toEqual(unavailable)
      expect((await new HostingAccountsCache(file).read()).entries.github).toEqual({
        result: detected,
        failed: false,
        cliUnavailable: true,
      })

      scan.mockRejectedValueOnce(new Error('scan failed'))
      await expect(service.accounts('github', true)).rejects.toThrow('scan failed')
      expect((await service.readAccounts()).entries.github).toEqual({
        result: detected,
        failed: true,
        cliUnavailable: true,
      })
      await service.accounts('github', true)
      expect((await new HostingAccountsCache(file).read()).entries.github).toEqual({
        result: detected,
        failed: false,
      })

      scan.mockResolvedValueOnce(unavailable)
      await service.accounts('gitlab', true)
      expect((await service.readAccounts()).entries.gitlab).toEqual({
        result: unavailable,
        failed: false,
      })
      service.close()
    },
  )

  it('hosting account cache serializes refreshes, deduplicates scans and retains an initial failure', async () => {
    const file = join(directory, 'code-hosting-accounts.json')
    let finish!: (result: HostingAccounts) => void
    const pending = new Promise<HostingAccounts>((resolve) => {
      finish = resolve
    })
    const detected: HostingAccounts = {
      status: 'detected',
      accounts: [{ host: 'github.com', account: 'old-user', active: true, status: 'connected' }],
    }
    const refreshed: HostingAccounts = {
      status: 'detected',
      accounts: [{ host: 'github.com', account: 'new-user', active: true, status: 'connected' }],
    }
    const scan = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(refreshed)
      .mockRejectedValueOnce(new Error('private'))
    const service = new CodeHostingService(
      new ConfigStore(join(directory, 'config.json')),
      new SourceControlService(),
      undefined,
      scan,
      new HostingAccountsCache(file),
    )
    const scanning = service.accounts('github', false)
    const duplicate = service.accounts('github', false)
    const refreshing = service.accounts('github', true)
    finish(detected)
    expect(await Promise.all([scanning, duplicate, refreshing])).toEqual([
      detected,
      detected,
      refreshed,
    ])
    expect(scan).toHaveBeenCalledTimes(2)
    expect((await service.readAccounts()).entries.github?.result).toEqual(refreshed)
    await expect(service.accounts('gitlab', false)).rejects.toThrow('private')
    expect((await new HostingAccountsCache(file).read()).entries.gitlab).toEqual({ failed: true })
    expect(await readFile(file, 'utf8')).not.toContain('private')
    service.close()
  })

  it('hosting account cache preserves invalid files and refuses symbolic links', async () => {
    const file = join(directory, 'code-hosting-accounts.json')
    const original = '{"version":2,"entries":{}}'
    await writeFile(file, original)
    const cache = new HostingAccountsCache(file)
    expect((await cache.read()).error).toContain('无法读取代码托管缓存')
    await cache.update('github', () => ({
      result: { status: 'disconnected', message: 'no accounts' },
      failed: false,
    }))
    expect((await cache.read()).entries.github?.result?.status).toBe('disconnected')
    expect(await readFile(file, 'utf8')).toBe(original)

    if (process.platform !== 'win32') {
      const link = join(directory, 'linked-cache.json')
      await symlink(file, link)
      const linked = new HostingAccountsCache(link)
      expect((await linked.read()).error).toContain('无法读取代码托管缓存')
      await linked.update('github', () => ({ failed: true }))
      expect(await readFile(file, 'utf8')).toBe(original)
    }
  })

  it.each(['github', 'gitlab'] as const)(
    'filters %s open reviews by source identity',
    async (provider) => {
      const { request, adapter, scope, payload } = reviewFixture(provider)
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
    },
  )

  it.each(['github', 'gitlab'] as const)(
    'paginates and filters %s review history',
    async (provider) => {
      const { request, adapter, scope, time, payload } = reviewFixture(provider)
      request.mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => payload(index + 30, 'closed', 'other')),
      )
      expect(await adapter.history(scope, 1)).toMatchObject({ items: [], nextPage: 2 })
      request.mockResolvedValueOnce([
        payload(15, 'open'),
        payload(12, 'merged'),
        payload(9, 'closed'),
        payload(8, 'closed', scope.branch, 'main', 2),
      ])
      const history = await adapter.history(scope, 2)
      expect(history.nextPage).toBeNull()
      expect(history.items.map((review) => [review.number, review.state])).toEqual([
        [15, 'open'],
        [12, 'merged'],
        [9, 'closed'],
      ])
      expect(history.items[1]).toMatchObject({ createdAt: time, mergedAt: time })
      const historyRequest = request.mock.calls.at(-1)?.[1]
      expect(historyRequest).toContain('state=all')
      expect(historyRequest).toContain(
        provider === 'github' ? 'sort=created&direction=desc' : 'order_by=created_at&sort=desc',
      )
      expect(historyRequest).toContain('page=2')
      expect(historyRequest).toContain('feature%2Freview')
    },
  )

  it.each(['github', 'gitlab'] as const)(
    'reads %s review details and rejects mismatched identities',
    async (provider) => {
      const { request, adapter, scope, payload } = reviewFixture(provider)
      request.mockResolvedValueOnce(payload(12, 'merged'))
      expect((await adapter.get(scope, 12)).url).toBe(
        provider === 'github'
          ? 'https://github.com/team/repo/pull/12'
          : 'https://gitlab.com/team/repo/-/merge_requests/12',
      )
      request.mockResolvedValueOnce(payload(13, 'merged', 'other'))
      await expect(adapter.get(scope, 13)).rejects.toThrow('不匹配')
    },
  )

  describe.each(['github', 'gitlab'] as const)('%s comparisons', (provider) => {
    it.each(['empty', 'changes', 'unknown'] as const)(
      'classifies %s comparisons',
      async (status) => {
        const { request, adapter, scope } = reviewFixture(provider)
        const responses = {
          github: {
            empty: { files: [] },
            changes: { files: [{ filename: 'file' }] },
            unknown: { files: Array.from({ length: 300 }, () => ({ filename: 'file' })) },
          },
          gitlab: {
            empty: { diffs: [], commits: [] },
            changes: { diffs: [{ diff: '+line' }], commits: [] },
            unknown: { diffs: [], commits: [], compare_timeout: true },
          },
        }
        request.mockResolvedValueOnce(responses[provider][status])
        expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({ status })
      },
    )
  })

  it.each(['github', 'gitlab'] as const)(
    'merges %s reviews with the expected identity and head',
    async (provider) => {
      const { request, adapter, repository, scope, payload } = reviewFixture(provider)
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
    },
  )

  it('rejects a GitHub merge that was not completed', async () => {
    const { request, adapter, scope, payload } = reviewFixture('github')
    request.mockResolvedValueOnce(payload(12, 'open'))
    const openReview = await adapter.get(scope, 12)
    request.mockResolvedValueOnce({ merged: false })
    await expect(adapter.merge(scope, openReview)).rejects.toThrow('未合并')
  })

  it.each([
    [
      'single commit',
      [commit('Only commit', '\nSingle body\n', 'other@example.com')],
      'Only commit',
      'Single body',
    ],
    [
      'no verified author',
      [commit('First', '', 'other@example.com'), commit('Second', '', 'pending@example.com')],
      'Feature/review',
      '',
    ],
    [
      'oldest verified author',
      [
        commit('Newest', '\nMore'),
        commit('Other author', '\nNot mine', 'other@example.com', '2026-10-01T00:00:00Z'),
        commit('Oldest own commit', '\nDetails', ' OLD@EXAMPLE.COM ', '2026-10-20T00:00:00Z'),
      ],
      'Oldest own commit',
      'Details',
    ],
    [
      'oldest authored commit without a body',
      [
        commit('With body', '\nDetails'),
        commit('First', '', 'me@example.com', '2026-10-20T00:00:00Z'),
      ],
      'First',
      '',
    ],
    [
      'private and public author email',
      [
        commit('Pending', '\nUnverified', 'pending@example.com', '2026-10-01T00:00:00Z'),
        commit('Private email', '\nDetails', 'private@noreply.gitlab.com', '2026-10-20T00:00:00Z'),
        commit('Public email', '\nMore', 'public@example.com'),
      ],
      'Private email',
      'Details',
    ],
    [
      'merge commit',
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
  ] as const)(
    'derives GitLab review defaults: %s',
    async (_name, commits, defaultTitle, defaultDescription) => {
      const { request, adapter, scope } = reviewFixture('gitlab')
      const { account, emails } = gitlabIdentity()
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
    },
  )

  it.each([false, true])(
    'uses issue details for GitLab defaults when confidential is %s',
    async (confidential) => {
      const { request, adapter, scope } = reviewFixture('gitlab')
      const { account, emails } = gitlabIdentity()
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
        await adapter.compare({ ...scope, branch: '123-fix_issue' }, 'source-sha', 'target-sha'),
      ).toMatchObject({
        defaultTitle: confidential ? '123 fix issue' : 'Resolve "Fix issue"',
      })
    },
  )

  it('normalizes locked GitLab reviews as open', async () => {
    const { request, adapter, scope, payload } = reviewFixture('gitlab')
    request.mockResolvedValueOnce(payload(14, 'locked'))
    expect((await adapter.get(scope, 14)).state).toBe('open')
  })

  it('rejects unexpected GitLab review states', async () => {
    const { request, adapter, scope, payload } = reviewFixture('gitlab')
    request.mockResolvedValueOnce({ ...payload(15, 'open'), state: 'unexpected' })
    await expect(adapter.get(scope, 15)).rejects.toThrow()
  })

  it.each(['github', 'gitlab'] as const)('paginates %s remote branches', async (provider) => {
    const { request, adapter, repository, time } = reviewFixture(provider)
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
  })

  it.each(['github', 'gitlab'] as const)('reports %s remote branch failures', async (provider) => {
    const { request, adapter, repository } = reviewFixture(provider)
    request.mockRejectedValueOnce(new Error('remote branches unavailable'))
    await expect(adapter.branches(repository)).rejects.toThrow('remote branches unavailable')
  })

  it('uses the remote commit title and body as GitHub review defaults', async () => {
    const { request, adapter, scope } = reviewFixture('github')
    request.mockResolvedValueOnce({
      files: [{ filename: 'file' }],
      commits: [{ commit: { message: 'Remote commit title\n\nBody' } }],
    })
    expect(await adapter.compare(scope, 'source-sha', 'target-sha')).toMatchObject({
      defaultTitle: 'Remote commit title',
      defaultDescription: 'Body',
    })
  })

  describe('hosting merge guards (no Git required)', () => {
    function mergeFixture() {
      const repository: HostingRepository = {
        provider: 'github',
        host: 'github.com',
        path: 'team/repo',
      }
      const review: HostedReview = {
        number: 1,
        title: 'Review fixture',
        draft: false,
        state: 'open',
        sourceBranch: 'feature/review',
        targetBranch: 'main',
        head: 'a'.repeat(40),
        url: 'https://github.com/team/repo/pull/1',
        checks: 'unknown',
        createdAt: '2026-10-28T00:00:00Z',
        updatedAt: '2026-10-28T01:00:00Z',
        mergedAt: null,
        closedAt: null,
      }
      const context: HostingContext = {
        remotes: [{ name: 'origin', repository }],
        source: repository,
        target: repository,
        branch: review.sourceBranch,
        sourceBranch: review.sourceBranch,
        head: review.head,
        key: 'a'.repeat(64),
      }
      const request = vi.fn<HostingRequest>()
      const adapter = new GitHubAdapter(request)
      const account = vi.spyOn(adapter, 'account').mockResolvedValue('fixture-user')
      vi.spyOn(adapter, 'repository').mockResolvedValue({
        id: 1,
        path: repository.path,
        defaultBranch: 'main',
      })
      const get = vi.spyOn(adapter, 'get').mockResolvedValue(review)
      const merge = vi.spyOn(adapter, 'merge').mockResolvedValue({ ...review, state: 'merged' })
      const service = new CodeHostingService(
        new ConfigStore(join(directory, 'hosting-config.json')),
        new SourceControlService(),
        { github: adapter, gitlab: adapter },
      )
      const readContext = vi.spyOn(service, 'context').mockResolvedValue(context)
      const input = {
        key: context.key,
        account: 'fixture-user',
        sourceBranch: review.sourceBranch,
        targetBranch: review.targetBranch,
        number: review.number,
        head: review.head,
      }
      return { service, request, review, input, get, merge, account, readContext }
    }
    let current: ReturnType<typeof mergeFixture>
    beforeEach(() => {
      vi.stubEnv('PATH', directory)
      current = mergeFixture()
    })
    afterEach(() => {
      current.service.close()
      expect(current.request).not.toHaveBeenCalled()
    })

    it.each([
      ['number', { number: 2 }, '评审分支或远端提交已改变'],
      ['source branch', { sourceBranch: 'other' }, '评审分支或远端提交已改变'],
      ['target branch', { targetBranch: 'release' }, '评审分支或远端提交已改变'],
      ['head', { head: 'b'.repeat(40) }, '评审分支或远端提交已改变'],
      ['draft', { draft: true }, '只能合并开放且非草稿的评审'],
      ['state', { state: 'closed' }, '只能合并开放且非草稿的评审'],
    ] as const)('rejects mismatched review %s before merging', async (_field, patch, error) => {
      const { service, input, review, get, merge } = current
      get.mockResolvedValueOnce({ ...review, ...patch })
      await expect(service.merge(directory, input)).rejects.toThrow(error)
      expect(get).toHaveBeenCalledOnce()
      expect(merge).not.toHaveBeenCalled()
    })

    it('rejects an invalid merge head before reading context', async () => {
      const { service, input, readContext, get, merge } = current
      await expect(service.merge(directory, { ...input, head: 'invalid' })).rejects.toThrow()
      expect(readContext).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
      expect(merge).not.toHaveBeenCalled()
    })

    it.each([
      ['key', { key: 'b'.repeat(64) }, '仓库、远端或来源分支已改变'],
      ['account', { account: 'other' }, 'CLI 账号已改变'],
    ] as const)(
      'rejects a changed confirmed %s before reading the review',
      async (_field, patch, error) => {
        const { service, input, get, merge } = current
        await expect(service.merge(directory, { ...input, ...patch })).rejects.toThrow(error)
        expect(get).not.toHaveBeenCalled()
        expect(merge).not.toHaveBeenCalled()
      },
    )

    it('rechecks the account immediately before merging', async () => {
      const { service, input, account, readContext, merge } = current
      account.mockResolvedValueOnce('fixture-user').mockResolvedValueOnce('other')
      await expect(service.merge(directory, input)).rejects.toThrow('CLI 账号已改变')
      expect(account).toHaveBeenCalledTimes(2)
      expect(readContext).toHaveBeenCalledTimes(2)
      expect(merge).not.toHaveBeenCalled()
    })
  })

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
