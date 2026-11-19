import { join } from 'node:path'

export function accountPaths(configDirectory: string) {
  return {
    providers: join(configDirectory, 'providers.json'),
    auth: join(configDirectory, 'auth.json'),
  }
}

export function appPaths(configDirectory: string, userData: string) {
  const cache = join(userData, 'cota', 'cache')
  const state = join(userData, 'cota', 'state')
  return {
    config: join(configDirectory, 'config.json'),
    accounts: accountPaths(configDirectory),
    modelPricing: join(configDirectory, 'model-pricing.json'),
    worktrees: join(configDirectory, 'worktrees'),
    agentCliCache: join(cache, 'agent-cli.json'),
    hostingAccountsCache: join(cache, 'code-hosting-accounts.json'),
    usageAnalyticsCache: join(cache, 'usage-analytics'),
    usageRefreshState: join(state, 'usage-refresh-state.json'),
    worktreeSetups: join(state, 'worktree-setups'),
  }
}
