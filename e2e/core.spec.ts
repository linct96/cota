import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test, expect } from './desktop.fixture'

async function text(path: string) {
  return readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })
}

test('启动、取消选择与打开真实项目', async ({ desktop }) => {
  const { page } = desktop
  await expect(page.getByText('没有打开的项目', { exact: true })).toBeVisible()
  await desktop.openProject(null)
  await expect(page.getByText('没有打开的项目', { exact: true })).toBeVisible()
  expect((await desktop.config()).recentProjects).toEqual([])

  await desktop.openProject()
  await expect(page.getByRole('tablist', { name: '工作区标签' }).getByRole('tab')).toHaveCount(1)
  expect((await desktop.config()).recentProjects).toEqual([desktop.repo])
  expect(await desktop.git('status', '--porcelain')).toBe('')
})

test('终端经 UI 输入，真实 PTY 输出并写入项目目录', async ({ desktop }) => {
  await desktop.openProject()
  await desktop.terminalCommand(
    'printf "%s\\n" "$$:$PWD" > terminal.txt; printf "COTA_%s\\n" READY',
  )
  await expect(desktop.page.locator('.terminal-view:visible .xterm-rows')).toContainText(
    'COTA_READY',
  )
  await expect
    .poll(() => text(join(desktop.repo, 'terminal.txt')))
    .toMatch(new RegExp(`^\\d+:${desktop.repo}\\n$`))
  await desktop.terminalCommand('exit 7')
  await expect(
    desktop.page.getByText('Exited · 退出码 7 · 请新建终端继续。', { exact: true }),
  ).toBeVisible()
})

test('工作区切换保留独立终端与活动标签', async ({ desktop }) => {
  await desktop.openProject()
  const { page } = desktop
  const project = page.getByRole('region', { name: 'sample-project 项目', exact: true })
  const first = project.locator('.project-item-button').first()
  const firstName = await first.getAttribute('aria-label')
  await desktop.terminalCommand('export E2E_WORKSPACE=first; printf "COTA_%s\\n" FIRST')
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText('COTA_FIRST')
  const firstTab = await page.locator('.terminal-tab[aria-selected="true"]').getAttribute('id')

  await page.getByRole('button', { name: 'sample-project 更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建工作区', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建工作区', exact: true })
  await dialog.getByLabel('工作区名称').fill('second-workspace')
  await dialog.getByRole('button', { name: '创建工作区', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText('cota-e2e$')
  await desktop.terminalCommand('printf "COTA_%s_%s\\n" SECOND "${E2E_WORKSPACE-unset}"')
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText(
    'COTA_SECOND_unset',
  )
  const secondTab = await page.locator('.terminal-tab[aria-selected="true"]').getAttribute('id')
  expect(secondTab).not.toBe(firstTab)

  // The accessible label changes with terminal state; retain the workspace's name prefix.
  await project
    .getByRole('button', { name: firstName!.split('，')[0] + '，', exact: false })
    .click()
  await expect(page.locator('.terminal-tab[aria-selected="true"]')).toHaveAttribute('id', firstTab!)
  await desktop.terminalCommand('printf "COTA_%s_%s\\n" BACK "$E2E_WORKSPACE"')
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText('COTA_BACK_first')
  await expect(page.locator('.terminal-view:visible .xterm-rows')).not.toContainText(
    'COTA_SECOND_unset',
  )
})

test('文件预览复用，双击固定后不被后续预览替换', async ({ desktop }) => {
  await desktop.openProject()
  const { page } = desktop
  const expand = page.getByRole('button', { name: '展开右侧面板', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('tab', { name: '文件', exact: true }).click()
  const tree = page.getByRole('tree', { name: 'sample-project 文件树', exact: true })
  await tree.getByRole('treeitem', { name: 'README.md', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'README.md 预览', exact: true })).toBeVisible()
  await expect(page.locator('.file-preview-monaco .view-lines')).toContainText('COTA_ORIGINAL')
  await tree.getByRole('treeitem', { name: 'notes.txt', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'README.md 预览', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'notes.txt 预览', exact: true })).toBeVisible()
  await expect(page.locator('.file-preview-monaco .view-lines')).toContainText('COTA_NOTES')
  await tree.getByRole('treeitem', { name: 'notes.txt', exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: 'notes.txt', exact: true })).toBeVisible()
  await tree.getByRole('treeitem', { name: 'README.md', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'notes.txt', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'README.md 预览', exact: true })).toBeVisible()
})

test('外部文件变化驱动 Git 状态、Diff 与真实暂存操作', async ({ desktop }) => {
  await desktop.openProject()
  const { page } = desktop
  const expand = page.getByRole('button', { name: '展开右侧面板', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('tab', { name: 'Git', exact: true }).click()
  const panel = page.getByRole('region', { name: /源代码管理$/ })
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await writeFile(join(desktop.repo, 'README.md'), 'COTA_MODIFIED\n')
  await panel.getByRole('treeitem', { name: 'README.md', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'README.md（Diff） 预览', exact: true })).toBeVisible()
  await expect(page.locator('.source-control-diff .monaco-diff-editor')).toContainText(
    'COTA_ORIGINAL',
  )
  await expect(page.locator('.source-control-diff .monaco-diff-editor')).toContainText(
    'COTA_MODIFIED',
  )
  await panel.getByRole('treeitem', { name: 'README.md', exact: true }).hover()
  await panel.getByRole('button', { name: '添加暂存 README.md', exact: true }).click()
  await expect.poll(() => desktop.git('diff', '--cached', '--name-only')).toBe('README.md')
  await panel.getByRole('treeitem', { name: 'README.md', exact: true }).hover()
  await panel.getByRole('button', { name: '取消暂存 README.md', exact: true }).click()
  await expect.poll(() => desktop.git('diff', '--cached', '--name-only')).toBe('')
})

test('设置保存后正常退出，再启动仍保留', async ({ desktop }) => {
  await desktop.openProject()
  await desktop.page.getByRole('button', { name: '打开设置', exact: true }).click()
  const setting = desktop.page.getByRole('switch', { name: '允许复用预览标签', exact: true })
  await expect(setting).toBeChecked()
  await setting.click()
  await expect(setting).not.toBeChecked()
  await expect(setting).toBeEnabled()
  await expect.poll(async () => (await desktop.config()).preferences.reusePreviewTabs).toBe(false)
  await desktop.restart()
  await desktop.page.getByRole('button', { name: '打开设置', exact: true }).click()
  await expect(
    desktop.page.getByRole('switch', { name: '允许复用预览标签', exact: true }),
  ).not.toBeChecked()
  expect((await desktop.config()).recentProjects).toEqual([desktop.repo])
})

test('工作树创建、切换和删除均作用于隔离 Home', async ({ desktop }) => {
  await desktop.openProject()
  const { page } = desktop
  await page.getByRole('button', { name: 'sample-project 新建工作树', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建工作树', exact: true })
  await dialog.getByLabel('工作区名称', { exact: true }).fill('e2e-worktree')
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(dialog).toBeHidden()
  const workspace = page.getByRole('button', { name: /^sample-project e2e-worktree，Git Worktree/ })
  await expect(workspace).toHaveAttribute('aria-current', 'page')
  const config = await desktop.config()
  expect(config.worktreeRecords).toHaveLength(1)
  const record = config.worktreeRecords[0]
  expect(relative(desktop.home, record.path)).not.toMatch(/^\.\./)
  expect(await desktop.git('worktree', 'list', '--porcelain')).toContain(record.path)
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText('cota-e2e$')
  await desktop.terminalCommand(
    'printf "%s\\n" "$PWD" > "$HOME/worktree-cwd"; printf "COTA_%s\\n" WORKTREE',
  )
  await expect(page.locator('.terminal-view:visible .xterm-rows')).toContainText('COTA_WORKTREE')
  await expect.poll(() => text(join(desktop.home, 'worktree-cwd'))).toBe(`${record.path}\n`)
  await workspace.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除工作树', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: '删除工作树', exact: true })
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await expect(workspace).toHaveCount(0)
  await expect.poll(() => desktop.git('worktree', 'list', '--porcelain')).not.toContain(record.path)
  expect(
    await stat(record.path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return false
      },
    ),
  ).toBe(false)
  expect((await desktop.config()).worktreeRecords).toEqual([])
})

test('Renderer 重载后恢复同一终端和 Shell，不重复创建', async ({ desktop }) => {
  await desktop.openProject()
  await desktop.terminalCommand(
    'export E2E_RESTORED=yes; printf "%s\\n" "$$" > before.pid; printf "COTA_%s\\n" BEFORE_RELOAD',
  )
  await expect(desktop.page.locator('.terminal-view:visible .xterm-rows')).toContainText(
    'COTA_BEFORE_RELOAD',
  )
  const tabId = await desktop.page.locator('.terminal-tab[aria-selected="true"]').getAttribute('id')
  await expect
    .poll(async () => (await desktop.config()).layout?.tabs.map((tab) => `terminal-tab-${tab.id}`))
    .toContain(tabId)
  await desktop.page.reload()
  await expect(desktop.page.locator('.terminal-tab[aria-selected="true"]')).toHaveAttribute(
    'id',
    tabId!,
  )
  await expect(desktop.page.locator('.terminal-view:visible .xterm-rows')).toContainText(
    'COTA_BEFORE_RELOAD',
  )
  await desktop.terminalCommand(
    'printf "%s\\n" "$$" > after.pid; printf "COTA_%s_%s\\n" RESTORED "$E2E_RESTORED"',
  )
  await expect(desktop.page.locator('.terminal-view:visible .xterm-rows')).toContainText(
    'COTA_RESTORED_yes',
  )
  await expect
    .poll(() => text(join(desktop.repo, 'after.pid')))
    .toBe(await text(join(desktop.repo, 'before.pid')))
  expect(await desktop.sessions()).toHaveLength(1)
})
