import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-4xl font-bold">Passline</h1>
      <p className="text-lg text-muted-foreground">
        Free events with a live waitlist that fills itself.
      </p>
      <Button asChild>
        <Link to="/login">Organizer sign in</Link>
      </Button>
    </div>
  );
}
