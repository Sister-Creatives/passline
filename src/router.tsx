import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

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
      <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>
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
