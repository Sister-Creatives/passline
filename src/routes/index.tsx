import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <>
      {/* A still-signed-in organizer (persisted session) goes straight to their
          dashboard instead of the marketing splash. The landing shows during
          loading and when signed out, so a logged-out visitor never flashes a
          blank screen. */}
      <AuthLoading>
        <Landing />
      </AuthLoading>
      <Unauthenticated>
        <Landing />
      </Unauthenticated>
      <Authenticated>
        <Navigate to="/events" replace />
      </Authenticated>
    </>
  );
}

function Landing() {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Passline</h1>
      <p className="text-lg text-muted-foreground">
        Free events with a live waitlist that fills itself.
      </p>
      <Button asChild>
        <Link to="/login">Organizer sign in</Link>
      </Button>
    </div>
  );
}
