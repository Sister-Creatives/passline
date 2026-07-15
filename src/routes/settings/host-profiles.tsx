import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { HostProfilesPanel } from "@/components/HostProfilesPanel";

export const Route = createFileRoute("/settings/host-profiles")({
  component: SettingsHostProfilesPage,
});

function SettingsHostProfilesPage() {
  return (
    <DashboardLayout>
      <HostProfilesPanel />
    </DashboardLayout>
  );
}
