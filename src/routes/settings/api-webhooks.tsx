import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export const Route = createFileRoute("/settings/api-webhooks")({ component: SettingsApiWebhooksPage });

function SettingsApiWebhooksPage() {
  return (
    <DashboardLayout>
      <Empty className="mt-12">
        <EmptyHeader>
          <EmptyTitle>API & webhooks</EmptyTitle>
          <EmptyDescription>Coming soon.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </DashboardLayout>
  );
}
