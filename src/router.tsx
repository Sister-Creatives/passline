import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider, type TokenStorage } from '@convex-dev/auth/react'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

// Persist the auth token in localStorage (guarded for SSR) so the session
// survives closing the tab. This is a stable, module-level reference so the
// provider never falls back to its in-memory storage -- that fallback is what
// logs the user out on every tab close. window is read at call time (not render
// time), so it is safe on the server, where these methods just no-op to null.
const authStorage: TokenStorage = {
  getItem: (key) =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
  },
}

export function getRouter() {
  const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string
  if (!CONVEX_URL) {
    throw new Error('Missing VITE_CONVEX_URL environment variable')
  }

  // Create per-request clients so SSR never shares state across requests.
  const convexClient = new ConvexReactClient(CONVEX_URL)
  const convexQueryClient = new ConvexQueryClient(convexClient)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient, convexClient, convexQueryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // App-wide auth context. setupRouterSsrQueryIntegration composes a
    // QueryClientProvider around this, so both auth and queries are available
    // everywhere.
    Wrap: ({ children }) => (
      <ConvexAuthProvider client={convexClient} storage={authStorage}>
        {children}
      </ConvexAuthProvider>
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
