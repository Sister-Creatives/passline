import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for a single event. It only renders an Outlet so that the
// index route ($id.index.tsx, the manage page) and the door route
// ($id.door.tsx) render standalone as siblings rather than one nesting inside
// the other.
export const Route = createFileRoute("/events/$id")({ component: EventLayout });

function EventLayout() {
  return <Outlet />;
}
