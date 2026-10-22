import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  type RouterHistory,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { App } from './App'
import { AppError } from './components/AppError'
import { Settings } from './components/Settings'

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
  component: Settings,
})

const cortanaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cortana',
  component: lazyRouteComponent(() => import('./features/cortana/CortanaLayout'), 'CortanaLayout'),
  beforeLoad: ({ location }) => {
    if (location.pathname === '/cortana') throw redirect({ to: '/cortana/accounts' })
  },
})

const accountsRoute = createRoute({
  getParentRoute: () => cortanaRoute,
  path: '/accounts',
  component: lazyRouteComponent(
    () => import('./features/cortana/accounts/AccountsPage'),
    'AccountsPage',
  ),
})

const routeTree = rootRoute.addChildren([
  workspaceRoute,
  settingsRoute,
  cortanaRoute.addChildren([accountsRoute]),
])

export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, defaultErrorComponent: AppError })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
