import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Navigate } from "@tanstack/react-router";

/**
 * Gate for organizer-only routes.
 *
 * Renders nothing but a loading placeholder while Convex Auth resolves the
 * session, redirects to `/login` once it resolves to "unauthenticated", and
 * only mounts `children` once the session is confirmed authenticated.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/login" />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
