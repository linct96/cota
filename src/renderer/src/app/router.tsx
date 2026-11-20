import {
  Navigate,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'
import { App } from './App'
import { AppError } from './AppError'

const rootRoute = createRootRoute({
  component: App,
  errorComponent: AppError,
  notFoundComponent: () => <Navigate to="/" replace />,
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // The layout keeps terminal views mounted while settings are open.
  component: () => null,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: 'open-with' | 'quick-commands' | 'source-control' } =>
    search.section === 'open-with' ||
    search.section === 'quick-commands' ||
    search.section === 'source-control'
      ? { section: search.section }
      : {},
  component: lazyRouteComponent(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
})

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: lazyRouteComponent(() => import('@/features/agents/AgentsLayout'), 'AgentsLayout'),
  beforeLoad: ({ location }) => {
    if (location.pathname === '/agents') throw redirect({ to: '/agents/accounts' })
  },
})

const accountsRoute = createRoute({
  getParentRoute: () => agentsRoute,
  path: '/accounts',
  component: lazyRouteComponent(
    () => import('@/features/agents/accounts/AccountsPage'),
    'AccountsPage',
  ),
})

const analyticsRoute = createRoute({
  getParentRoute: () => agentsRoute,
  path: '/analytics',
  component: lazyRouteComponent(
    () => import('@/features/agents/analytics/AnalyticsPage'),
    'AnalyticsPage',
  ),
})

const routeTree = rootRoute.addChildren([
  workspaceRoute,
  settingsRoute,
  agentsRoute.addChildren([accountsRoute, analyticsRoute]),
])

export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, defaultErrorComponent: AppError })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
