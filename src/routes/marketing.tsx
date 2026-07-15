import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/marketing")({ component: MarketingPage });

function MarketingPage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Marketing</EmptyTitle>
          <EmptyDescription>
            Campaigns, tracking pixels, and audience tools for all your events. Coming soon.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
