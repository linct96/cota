import { execFile } from 'node:child_process'
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../src/main/settings/config-store'
import { SourceControlService } from '../src/main/git/source-control/service'
import { CodeHostingService } from '../src/main/code-hosting/service'
import { HostingError } from '../src/main/code-hosting/cli-runner'
import type { HostingAdapter, ReviewScope } from '../src/main/code-hosting/adapter'
import {
  resolveTargetBranchRef,
  type HostedReview,
  type HostingComparison,
  type HostingRepository,
} from '../src/shared/code-hosting'
import { gitEnvironment } from '../src/main/git/git-runner'
import { gitAvailable } from './helpers/git'

const exec = promisify(execFile)
const sourceControl = new SourceControlService()
let directory: string
const git = (...args: string[]) =>
  exec('git', ['-C', directory, ...args], {
    env: { ...gitEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5000,
  })
async function hostingFixture() {
  await git('init', '--initial-branch=feature/review')
  await git(
    '-c',
    'user.name=Cota',
    '-c',
    'user.email=cota@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  )
  const file = join(directory, 'hosting-config.json')
  const config = new ConfigStore(file)
  await config.load()
  await config.remember(directory)
  const head = (await git('rev-parse', 'HEAD')).stdout.trim()
  const review = (
    number = 1,
    targetBranch = 'main',
    state: HostedReview['state'] = 'open',
  ): HostedReview => ({
    number,
    title: 'Review fixture',
    draft: false,
    state,
    sourceBranch: 'feature/review',
    targetBranch,
    head,
    url: `https://github.com/team/repo/pull/${number}`,
    checks: 'unknown',
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T01:00:00Z',
    mergedAt: state === 'merged' ? '2026-10-28T01:00:00Z' : null,
    closedAt: state !== 'open' ? '2026-10-28T01:00:00Z' : null,
  })
  const remoteBranches = ['main', 'feature/review', 'remote/feature'].map((name) => ({
    name,
    date: '2026-10-28T00:00:00Z',
  }))
  const adapter = {
    account: vi.fn(async () => 'fixture-user'),
    repository: vi.fn(async () => ({ id: 1, path: 'team/repo', defaultBranch: 'main' })),
    branches: vi.fn(async () => remoteBranches),
    listOpen: vi.fn(async (): Promise<HostedReview[]> => []),
    history: vi.fn(async () => ({
      items: [] as HostedReview[],
      nextPage: null as number | null,
      fetchedAt: Date.now(),
    })),
    get: vi.fn(async (_scope: ReviewScope, number: number) => review(number, 'main', 'merged')),
    compare: vi.fn(async (): Promise<HostingComparison> => ({ status: 'changes' })),
    branchHead: vi.fn(async (_repository: HostingRepository, _branch: string) => 'not-pushed'),
    checks: vi.fn(async () => 'success' as const),
    create: vi.fn(async (): Promise<HostedReview> => {
      throw new Error('timeout')
    }),
  } satisfies HostingAdapter
  const service = new CodeHostingService(config, sourceControl, {
    github: adapter,
    gitlab: adapter,
  })
  return { file, config, head, review, adapter, service, remoteBranches }
}

describe.skipIf(!gitAvailable)('Hosting context and creation integration (requires Git)', () => {
  let fixture: Awaited<ReturnType<typeof hostingFixture>>
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'cota-hosting-')))
    fixture = await hostingFixture()
  })
  afterEach(async () => {
    fixture?.service.close()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })
  it('checks connections and reads tracking independently from local HEAD', async () => {
    const { service, adapter, head } = fixture
    await expect(service.connection('github', 'github.com')).resolves.toEqual({
      status: 'connected',
      account: 'fixture-user',
    })
    for (const [kind, status] of [
      ['auth', 'disconnected'],
      ['cli', 'cli-unavailable'],
    ] as const) {
      adapter.account.mockRejectedValueOnce(new HostingError(kind, `${kind} fixture`))
      await expect(service.connection('gitlab', 'gitlab.example.com')).resolves.toEqual({
        status,
        message: `${kind} fixture`,
      })
    }
    for (const kind of ['network', 'forbidden', 'rate-limit', 'response'] as const) {
      adapter.account.mockRejectedValueOnce(new HostingError(kind, `${kind} fixture`))
      await expect(service.connection('github', 'github.com')).rejects.toThrow(`${kind} fixture`)
    }
    const accountCalls = adapter.account.mock.calls.length
    await expect(service.connection('github', 'https://github.com/path')).rejects.toThrow()
    expect(adapter.account).toHaveBeenCalledTimes(accountCalls)
    expect((await service.context(directory)).reason).toContain('无法自动识别')
    await git('remote', 'add', 'origin', 'git@github.com:team/repo.git')
    await git('config', 'branch.feature/review.remote', 'origin')
    await git('config', 'branch.feature/review.merge', 'refs/heads/remote/feature')
    expect(await sourceControl.repositoryContext(directory)).toEqual({
      branch: 'feature/review',
      head,
      tracking: { remote: 'origin', branch: 'remote/feature' },
    })
    await git('config', '--unset', 'branch.feature/review.remote')
    await git('config', '--unset', 'branch.feature/review.merge')
    await git('checkout', '--detach')
    expect(await sourceControl.repositoryContext(directory)).toEqual({
      branch: null,
      head,
      tracking: undefined,
    })
    await git('checkout', 'feature/review')
  }, 15000)
  describe('configured GitHub remote', () => {
    const configured = async () => {
      await git('remote', 'add', 'origin', 'git@github.com:team/repo.git')
      const context = await fixture.service.context(directory)
      const input = {
        key: context.key,
        account: 'fixture-user',
        sourceBranch: 'feature/review',
        title: 'Review fixture',
        description: '',
        targetBranch: 'main',
        draft: false,
      }
      const prepareInput = {
        key: input.key,
        account: input.account,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
      }
      fixture.adapter.compare.mockResolvedValue({
        status: 'changes',
        defaultTitle: 'Suggested title',
        defaultDescription: '',
      })
      return { ...fixture, context, input, prepareInput }
    }
    let current: Awaited<ReturnType<typeof configured>>
    beforeEach(async () => {
      current = await configured()
    })
    it('caches creation reads but revalidates account, context and selected branches', async () => {
      const { context, input, prepareInput, service, adapter, remoteBranches } = current
      const comparisonContext = {
        ...context,
        remotes: [
          { name: 'origin', repository: { ...context.target!, path: 'team/other' } },
          { name: 'upstream', repository: context.target },
        ],
      }
      const references = {
        remotes: ['origin', 'upstream'],
        branches: ['refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/upstream/main'].map(
          (ref) => ({ ref, label: ref, date: '', subject: '' }),
        ),
      }
      expect(resolveTargetBranchRef(comparisonContext, references, 'main')).toBe(
        'refs/remotes/upstream/main',
      )
      expect(
        resolveTargetBranchRef(
          comparisonContext,
          { ...references, branches: references.branches.slice(0, 2) },
          'main',
        ),
      ).toBeUndefined()
      expect(resolveTargetBranchRef(comparisonContext, undefined, 'main')).toBeUndefined()
      expect(
        resolveTargetBranchRef({ ...context, target: null }, references, 'main'),
      ).toBeUndefined()
      await expect(service.create(directory, { ...input, key: '0'.repeat(64) })).rejects.toThrow(
        '已改变',
      )
      await expect(service.create(directory, { ...input, account: 'other-user' })).rejects.toThrow(
        '账号已改变',
      )
      const creation = await service.creationContext(directory)
      expect(creation).toMatchObject({
        context,
        account: input.account,
        sourceBranches: remoteBranches,
        targetBranches: remoteBranches,
        branchesFetchedAt: expect.any(Number),
      })
      expect(adapter.branches).toHaveBeenCalledOnce()
      expect((await service.creationContext(directory)).branchesFetchedAt).toBe(
        creation.branchesFetchedAt,
      )
      expect(adapter.branches).toHaveBeenCalledOnce()
      adapter.compare.mockResolvedValue({
        status: 'changes',
        defaultTitle: 'Remote title',
        defaultDescription: 'Remote description',
      })
      const initialAccountCalls = adapter.account.mock.calls.length
      const initialRepositoryCalls = adapter.repository.mock.calls.length
      await expect(service.prepare(directory, prepareInput)).resolves.toMatchObject({
        status: 'ready',
        sourceHead: 'not-pushed',
        defaultTitle: 'Remote title',
        defaultDescription: 'Remote description',
        message: '',
      })
      expect(adapter.account).toHaveBeenCalledTimes(initialAccountCalls + 1)
      expect(adapter.repository).toHaveBeenCalledTimes(initialRepositoryCalls)
      adapter.account.mockResolvedValueOnce('other-user')
      await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
      await service.creationContext(directory)
      adapter.account.mockResolvedValueOnce('other-user')
      await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
      await service.creationContext(directory)
      const expired = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5001)
      try {
        adapter.account.mockResolvedValueOnce('other-user')
        await expect(service.prepare(directory, prepareInput)).rejects.toThrow('账号已改变')
      } finally {
        expired.mockRestore()
      }
      await service.creationContext(directory)
      adapter.account.mockResolvedValueOnce('other-user')
      await expect(service.create(directory, input)).rejects.toThrow('账号已改变')
      await expect(
        service.create(directory, { ...input, sourceBranch: '-invalid' }),
      ).rejects.toThrow()
      await expect(
        service.create(directory, { ...input, sourceBranch: undefined }),
      ).rejects.toThrow()
      expect(adapter.compare).toHaveBeenCalledWith(expect.anything(), 'not-pushed', 'not-pushed')
      expect(adapter.create).not.toHaveBeenCalled()
    }, 15000)
    it('blocks identical heads and empty or uncertain comparisons before posting', async () => {
      const { input, prepareInput, service, adapter, head } = current
      adapter.branchHead.mockResolvedValue(head)
      expect(
        (await service.prepare(directory, { ...prepareInput, targetBranch: 'feature/review' }))
          .status,
      ).toBe('blocked')
      for (const comparison of ['empty', 'unknown'] as const) {
        adapter.compare.mockResolvedValue({ status: comparison })
        expect((await service.prepare(directory, prepareInput)).status).toBe(comparison)
        await expect(service.create(directory, input)).rejects.toThrow(
          comparison === 'empty' ? '没有可评审差异' : '无法确认远端差异',
        )
      }
      expect(adapter.create).not.toHaveBeenCalled()
      adapter.compare.mockResolvedValue({
        status: 'changes',
        defaultTitle: 'Suggested title',
        defaultDescription: '',
      })
      await expect(service.prepare(directory, prepareInput)).resolves.toMatchObject({
        status: 'ready',
        defaultTitle: 'Suggested title',
        defaultDescription: '',
        message: '',
      })
    }, 15000)
    it('persists uncertain creation across restart and only recovers matching open reviews', async () => {
      const { input, prepareInput, service, adapter, head, file, review } = current
      adapter.branchHead.mockResolvedValue(head)
      adapter.branchHead.mockResolvedValueOnce('not-pushed')
      await expect(service.create(directory, input)).rejects.toThrow('重复创建保护')
      expect(adapter.create).toHaveBeenCalledOnce()
      const reopened = new ConfigStore(file)
      expect((await reopened.load()).warning).toBeUndefined()
      expect(reopened.snapshot().codeHostingPendingCreates).toHaveLength(1)
      const afterRestart = new CodeHostingService(reopened, sourceControl, {
        github: adapter,
        gitlab: adapter,
      })
      await expect(afterRestart.create(directory, input)).rejects.toThrow('阻止重复提交')
      await expect(
        afterRestart.prepare(directory, { ...prepareInput, sourceBranch: 'remote/feature' }),
      ).resolves.toMatchObject({ status: 'ready' })
      expect(adapter.create).toHaveBeenCalledOnce()
      const pending = reopened.snapshot().codeHostingPendingCreates![0]!
      if (typeof pending === 'string') throw new Error('Expected structured creation protection')
      expect(pending).toMatchObject({
        sourceBranch: input.sourceBranch,
        targetBranch: 'main',
        sourceHead: 'not-pushed',
        account: input.account,
      })
      adapter.listOpen.mockResolvedValue([review(8, 'release')])
      expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
      await expect(
        afterRestart.create(directory, { ...input, targetBranch: 'develop' }),
      ).rejects.toThrow('阻止重复提交')
      adapter.listOpen.mockResolvedValue([review(), review(8, 'release')])
      adapter.account.mockResolvedValueOnce('other-user')
      expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
      const recovered = await afterRestart.inspect(directory)
      expect(recovered.activeReviews.map((item) => item.number)).toEqual([1, 8])
      expect(recovered.creationBlocked).toBe(false)
      expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
      await afterRestart.create(directory, input)
      expect(adapter.create).toHaveBeenCalledOnce()

      adapter.listOpen.mockResolvedValue([review(), review(9)])
      expect((await afterRestart.prepare(directory, prepareInput)).existingReviews).toHaveLength(2)
      await expect(afterRestart.create(directory, input)).rejects.toThrow('多个开放评审')
      expect(adapter.create).toHaveBeenCalledOnce()
    }, 15000)
    it('allows later review rounds while locking concurrent create and clear requests', async () => {
      const { input, adapter, head, file, review } = current
      const reopened = new ConfigStore(file)
      await reopened.load()
      const afterRestart = new CodeHostingService(reopened, sourceControl, {
        github: adapter,
        gitlab: adapter,
      })
      // Merging does not permanently bind this source branch to the first PR.
      adapter.listOpen.mockResolvedValue([review(8, 'release')])
      adapter.history.mockResolvedValue({
        items: [review(1, 'main', 'merged')],
        nextPage: null,
        fetchedAt: Date.now(),
      })
      expect((await afterRestart.history(directory, input.key, 1)).items[0]?.state).toBe('merged')
      await expect(afterRestart.history(directory, 'stale', 1)).rejects.toThrow('工作区已改变')
      await expect(afterRestart.history(directory, input.key, 0)).rejects.toThrow()
      expect(await afterRestart.reviewUrl(directory, 1)).toBe(review().url)
      expect(adapter.get).toHaveBeenCalledWith(expect.anything(), 1)
      const commit = async (message: string) => {
        await git(
          '-c',
          'user.name=Cota',
          '-c',
          'user.email=cota@example.test',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--allow-empty',
          '-m',
          message,
        )
        return (await git('rev-parse', 'HEAD')).stdout.trim()
      }
      const secondHead = await commit('second review round')
      adapter.branchHead.mockImplementation(async (_repository, branch) =>
        branch === 'feature/review' ? secondHead : head,
      )
      const secondInput = { ...input, key: (await afterRestart.context(directory)).key }
      adapter.create.mockResolvedValueOnce({ ...review(18), head: secondHead })
      const secondRound = await afterRestart.create(directory, secondInput)
      expect(secondRound).toMatchObject({
        number: 18,
        sourceBranch: input.sourceBranch,
        head: secondHead,
      })
      expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])

      adapter.history.mockResolvedValue({
        items: [review(18, 'main', 'merged'), review(1, 'main', 'merged')],
        nextPage: null,
        fetchedAt: Date.now(),
      })
      const thirdHead = await commit('third review round')
      adapter.branchHead.mockImplementation(async (_repository, branch) =>
        branch === 'feature/review' ? thirdHead : head,
      )
      const thirdInput = { ...input, key: (await afterRestart.context(directory)).key }
      let finish!: (review: HostedReview) => void
      let started!: () => void
      const posting = new Promise<void>((resolve) => {
        started = resolve
      })
      adapter.create.mockImplementationOnce(() => {
        started()
        return new Promise<HostedReview>((resolve) => {
          finish = resolve
        })
      })
      const thirdRound = afterRestart.create(directory, thirdInput)
      await posting
      await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('正在创建')
      await expect(afterRestart.clearCreation(directory, thirdInput.key)).rejects.toThrow(
        '仍在进行中',
      )
      adapter.listOpen.mockResolvedValue([review(8, 'release'), { ...review(24), head: thirdHead }])
      expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
      finish({ ...review(24), head: thirdHead })
      expect(await thirdRound).toMatchObject({ number: 24, head: thirdHead })
      expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
      expect(adapter.create).toHaveBeenCalledTimes(2)
      expect(
        (await afterRestart.history(directory, thirdInput.key, 1)).items.map((item) => item.number),
      ).toEqual([18, 1])
    }, 15000)
    it('keeps merged uncertain posts protected and preserves legacy creation locks', async () => {
      const { input, service, adapter, file, review } = current
      await expect(service.create(directory, input)).rejects.toThrow('重复创建保护')
      const reopened = new ConfigStore(file)
      await reopened.load()
      const pending = reopened.snapshot().codeHostingPendingCreates![0]!
      if (typeof pending === 'string') throw new Error('Expected structured creation protection')
      const afterRestart = new CodeHostingService(reopened, sourceControl, {
        github: adapter,
        gitlab: adapter,
      })
      const thirdInput = input
      // A timed-out POST that was already merged must not be unlocked by old history.
      adapter.listOpen.mockResolvedValue([])
      adapter.history.mockResolvedValue({
        items: [review(25, 'main', 'merged')],
        nextPage: null,
        fetchedAt: Date.now(),
      })
      await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('阻止重复提交')
      await afterRestart.history(directory, thirdInput.key, 1)
      expect((await afterRestart.inspect(directory)).creationBlocked).toBe(true)
      await afterRestart.clearCreation(directory, thirdInput.key)
      adapter.create.mockRejectedValueOnce(new HostingError('rejected', '平台拒绝创建'))
      await expect(afterRestart.create(directory, thirdInput)).rejects.toThrow('平台拒绝创建')
      expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])

      const legacyFile = join(directory, 'legacy-hosting-config.json')
      await writeFile(
        legacyFile,
        JSON.stringify({ ...reopened.snapshot(), codeHostingPendingCreates: [pending.key] }),
      )
      const legacyConfig = new ConfigStore(legacyFile)
      adapter.listOpen.mockResolvedValue([review(24)])
      expect((await legacyConfig.load()).warning).toBeUndefined()
      const legacyService = new CodeHostingService(legacyConfig, sourceControl, {
        github: adapter,
        gitlab: adapter,
      })
      expect((await legacyService.inspect(directory)).creationBlocked).toBe(true)
      await legacyService.clearCreation(directory, thirdInput.key)
      expect(legacyConfig.snapshot().codeHostingPendingCreates).toEqual([])
    }, 15000)
    it('creates remote-only sources independently of the checked-out branch', async () => {
      const {
        input,
        prepareInput,
        service: afterRestart,
        config: reopened,
        adapter,
        head,
        review,
      } = current
      // A remote-only source is independent of the checked-out branch and its HEAD.
      adapter.listOpen.mockResolvedValue([])
      adapter.branchHead.mockImplementation(async (_repository, branch) =>
        branch === 'remote/feature' ? 'remote-head' : head,
      )
      const remoteInput = { ...input, sourceBranch: 'remote/feature' }
      await afterRestart.creationContext(directory)
      await expect(
        afterRestart.prepare(directory, {
          ...prepareInput,
          sourceBranch: remoteInput.sourceBranch,
        }),
      ).resolves.toMatchObject({
        status: 'ready',
        sourceHead: 'remote-head',
        defaultTitle: 'Suggested title',
        message: '',
      })
      expect(adapter.compare).toHaveBeenLastCalledWith(
        expect.objectContaining({ branch: 'remote/feature' }),
        'remote-head',
        head,
      )
      adapter.create.mockResolvedValueOnce({
        ...review(40),
        sourceBranch: remoteInput.sourceBranch,
        head: 'remote-head',
      })
      expect(await afterRestart.create(directory, remoteInput)).toMatchObject({
        number: 40,
        sourceBranch: remoteInput.sourceBranch,
        head: 'remote-head',
      })
      expect(adapter.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ branch: remoteInput.sourceBranch }),
        remoteInput,
      )
      await expect(afterRestart.create(directory, remoteInput)).rejects.toThrow('重复创建保护')
      await expect(
        afterRestart.prepare(directory, {
          ...prepareInput,
          sourceBranch: remoteInput.sourceBranch,
        }),
      ).resolves.toMatchObject({ status: 'blocked', creationBlocked: true })
      await afterRestart.clearCreation(directory, remoteInput.key, remoteInput.sourceBranch)
      expect(reopened.snapshot().codeHostingPendingCreates).toEqual([])
      await afterRestart.reviewUrl(directory, 40, remoteInput.sourceBranch)
      expect(adapter.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ branch: remoteInput.sourceBranch }),
        40,
      )
    }, 15000)
  })
})
