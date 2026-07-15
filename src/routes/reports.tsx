import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

function ReportsPage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Reports</EmptyTitle>
          <EmptyDescription>
            Sales, check-ins, and attendance analytics across all your events. Coming soon.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
