import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/settings/profile")({ component: SettingsProfilePage });

function SettingsProfilePage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>Organization profile</EmptyTitle>
          <EmptyDescription>Coming soon.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
