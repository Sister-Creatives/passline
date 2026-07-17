import { Authenticated, AuthLoading, Unauthenticated, useMutation } from "convex/react";
import { Navigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Ensures an organizer row exists for the signed-in user.
 *
 * Runs inside the authenticated boundary below, where the Convex client is
 * guaranteed to already carry the auth token. Calling it here (rather than
 * immediately after signIn) avoids racing the token propagation, which would
 * otherwise make the mutation fail with "Not authenticated" right after
 * sign-up. The mutation is idempotent, so re-running it on each guarded mount
 * is harmless.
 */
function EnsureOrganizer({ children }: { children: React.ReactNode }) {
  const ensureOrganizer = useMutation(api.organizers.ensureOrganizer);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    ensureOrganizer({}).catch(() => {
      // Permit a retry on a later mount if this attempt failed.
      ran.current = false;
    });
  }, [ensureOrganizer]);
  return <>{children}</>;
}

/**
 * Gate for organizer-only routes.
 *
 * Renders nothing but a loading placeholder while Convex Auth resolves the
 * session, redirects to `/login` once it resolves to "unauthenticated", and
 * only mounts `children` once the session is confirmed authenticated (after
 * ensuring the organizer row exists).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="flex flex-col gap-3 p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/login" />
      </Unauthenticated>
      <Authenticated>
        <EnsureOrganizer>{children}</EnsureOrganizer>
      </Authenticated>
    </>
  );
}
