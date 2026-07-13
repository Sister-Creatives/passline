import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return (
    <AuthGuard>
      <AppShell>
        <Dashboard />
      </AppShell>
    </AuthGuard>
  );
}
