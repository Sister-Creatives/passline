import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/attendees")({ component: AttendeesPage });

function AttendeesPage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Attendees</EmptyTitle>
          <EmptyDescription>
            A cross-event view of everyone who has registered. Coming soon.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
