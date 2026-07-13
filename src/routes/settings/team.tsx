import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/settings/team")({ component: SettingsTeamPage });

function SettingsTeamPage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Team</EmptyTitle>
          <EmptyDescription>Coming soon.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
