import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/app-shell";

/** Auth-gated management layout: the shadcn sidebar shell around a page body. */
export function DashboardLayout({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <AuthGuard>
      <AppShell wide={wide}>{children}</AppShell>
    </AuthGuard>
  );
}
