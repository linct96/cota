import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  type RouterHistory,
} from '@tanstack/react-router'
import { App } from './App'
import { Settings } from './components/Settings'

const rootRoute = createRootRoute({
  component: App,
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

const routeTree = rootRoute.addChildren([workspaceRoute, settingsRoute])

export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
