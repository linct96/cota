import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AgentProvider } from '../../../shared/contracts'
import { AGENT_CLI_PACKAGES } from '../../../shared/agent-cli'
import { resolveCommand } from '../../system/shell'
import { isWindows } from '../../system/platform'

const agentPackageNames: Record<AgentProvider, string> = {
  pi: 'pi-coding-agent',
  codex: 'codex',
  claude: 'claude-code',
}

export type AgentCliInstallation =
  | { method: 'brew'; prefix: string; packageName: string; cask: boolean; latestUrl: string }
  | { method: 'npm'; prefix: string; latestUrl: string }
  | { method: 'scoop'; root: string; global: boolean; packageName: string; latestUrl: string }

export async function detectAgentInstallation(
  provider: AgentProvider,
  executable: string,
  env: Record<string, string>,
): Promise<AgentCliInstallation | undefined> {
  let target = await realpath(executable)
  if (isWindows && /\.exe$/i.test(target)) {
    const shim = await readFile(target.replace(/\.exe$/i, '.shim'), 'utf8').catch(() => '')
    const path = /^\s*path\s*=\s*(.+)\s*$/im.exec(shim)?.[1]?.trim().replace(/^"|"$/g, '')
    if (path) {
      const expanded = path
        .replace(/%~dp0/gi, dirname(executable) + '/')
        .replace(
          /%([^%]+)%/g,
          (original, name: string) =>
            Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ??
            original,
        )
      target = await realpath(
        isAbsolute(expanded) ? expanded : resolve(dirname(executable), expanded),
      )
    }
  }
  const normalized = target.replaceAll('\\', '/')
  // Homebrew embeds node_modules too; ownership must be checked before npm layout.
  const brew = /^(.*)\/(Cellar|Caskroom)\/([a-z0-9][\w+@.-]*)\/([^/]+)\//i.exec(normalized)
  const packageName = agentPackageNames[provider]
  // Node itself may be managed by Brew/Scoop; that does not make its global npm packages theirs.
  if (brew && (brew[3] === packageName || brew[3] === `${packageName}@latest`)) {
    const [, prefix, location, installedPackageName, version] = brew
    const cask = location.toLowerCase() === 'caskroom'
    const receipt = JSON.parse(
      await readFile(
        cask
          ? join(prefix, location, installedPackageName, '.metadata', 'INSTALL_RECEIPT.json')
          : join(prefix, location, installedPackageName, version, 'INSTALL_RECEIPT.json'),
        'utf8',
      ),
    )
    // shortcut: third-party Homebrew taps require manual updates until their catalogues are supported.
    if (receipt.source?.tap !== (cask ? 'homebrew/cask' : 'homebrew/core')) return
    return {
      method: 'brew',
      prefix,
      packageName: installedPackageName,
      cask,
      latestUrl: `https://formulae.brew.sh/api/${cask ? 'cask' : 'formula'}/${encodeURIComponent(installedPackageName)}.json`,
    }
  }
  if (isWindows) {
    const scoop = /^(.*)\/apps\/([a-z0-9][\w.-]*)\/([^/]+)\//i.exec(normalized)
    if (scoop && scoop[2] === packageName) {
      const [, root, installedPackageName, version] = scoop
      const userRoot = env.SCOOP || join(homedir(), 'scoop')
      const globalRoot = env.SCOOP_GLOBAL || join(env.ProgramData || 'C:\\ProgramData', 'scoop')
      const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
      const global = same(root, globalRoot)
      if (!global && !same(root, userRoot)) return
      const info = JSON.parse(
        await readFile(join(root, 'apps', installedPackageName, version, 'install.json'), 'utf8'),
      )
      if (typeof info.bucket !== 'string' || !/^[a-z0-9][\w.-]*$/i.test(info.bucket)) return
      const git = join(userRoot, 'buckets', info.bucket, '.git')
      const config = await readFile(join(git, 'config'), 'utf8')
      const origin = /\[remote "origin"\]([^[]*)/i.exec(config)?.[1]
      const repo =
        origin &&
        /^\s*url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/im.exec(
          origin,
        )?.[1]
      const head = /^ref: refs\/heads\/([^\r\n]+)$/.exec(
        (await readFile(join(git, 'HEAD'), 'utf8')).trim(),
      )?.[1]
      // shortcut: non-GitHub or detached Scoop buckets require manual updates until supported.
      if (!repo || !head || !/^[\w./-]+$/.test(head) || head.includes('..')) return
      return {
        method: 'scoop',
        root,
        global,
        packageName: installedPackageName,
        latestUrl: `https://raw.githubusercontent.com/${repo}/${head}/bucket/${installedPackageName}.json`,
      }
    }
  }
  const npm = /^(.*)\/lib\/node_modules\//.exec(normalized)
  const prefix = npm?.[1] ?? (isWindows ? dirname(executable) : undefined)
  if (prefix) {
    const packageRoot = join(
      prefix,
      ...(isWindows ? [] : ['lib']),
      'node_modules',
      AGENT_CLI_PACKAGES[provider],
    )
    const manifest = await readFile(join(packageRoot, 'package.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => undefined)
    const bin = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.[provider]
    if (manifest?.name === AGENT_CLI_PACKAGES[provider] && typeof bin === 'string') {
      const entry = await realpath(resolve(packageRoot, bin))
      const command = await resolveCommand(executable, [], env)
      const actual =
        isWindows && /\.(cmd|bat)$/i.test(executable) ? await realpath(command.args[0]) : target
      if (isWindows ? entry.toLowerCase() === actual.toLowerCase() : entry === actual) {
        return {
          method: 'npm',
          prefix,
          latestUrl: `https://registry.npmjs.org/${encodeURIComponent(AGENT_CLI_PACKAGES[provider])}/latest`,
        }
      }
    }
  }
}
