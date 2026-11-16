import type { IpcHandler } from '../app/ipc'
import type { AccountService } from './service'
import type { AccountUsageScheduler } from './usage-refresh'

export function registerAccountsIPC(
  handle: IpcHandler,
  accounts: AccountService,
  usageScheduler: AccountUsageScheduler,
): void {
  handle('accounts:list', (product: unknown) => accounts.list(product))
  handle('accounts:add', (input: unknown) => accounts.add(input))
  handle('accounts:import-current', (product: unknown) => accounts.importCurrent(product))
  handle('accounts:switch', (input: unknown) => accounts.switch(input))
  handle('accounts:rename', (input: unknown) => accounts.rename(input))
  handle('accounts:remove', (id: unknown) => accounts.remove(id))
  handle('accounts:refresh', async (id: unknown) => {
    if (typeof id === 'string') usageScheduler.clearError(id)
    try {
      await accounts.refresh(id)
    } finally {
      if (typeof id === 'string') usageScheduler.clearError(id)
    }
  })
  handle('accounts:usage-refresh-statuses', () => usageScheduler.snapshot())
  handle('accounts:reorder', (product: unknown, ids: unknown) => accounts.reorder(product, ids))
  handle('accounts:oauth-start', (product: unknown, alias: unknown) =>
    accounts.startOAuth(product, alias),
  )
  handle('accounts:oauth-cancel', () => accounts.cancelOAuth())
}
