import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/app-shell";

/** Auth-gated management layout: the shadcn sidebar shell around a page body. */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
