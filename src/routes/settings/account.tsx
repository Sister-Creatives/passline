import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/settings/account")({ component: AccountSecurityPage });

function AccountSecurityPage() {
  const { data: identity } = useQuery(convexQuery(api.team.getMyIdentity, {}));
  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Account &amp; Security</h1>
          <p className="text-sm text-muted-foreground">Manage your password, email, and sessions.</p>
        </div>
        <PasswordCard />
        <EmailCard currentEmail={identity?.email} />
        <SessionsCard />
      </div>
    </DashboardLayout>
  );
}

function PasswordCard() {
  const changePassword = useAction(api.account.changePassword);
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return toast.error("Password must be at least 8 characters");
    if (next !== confirm) return toast.error("New passwords don't match");
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      toast.success("Password updated");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change the password you use to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-pw">Confirm new password</Label>
            <Input id="cf-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>Update password</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailCard({ currentEmail }: { currentEmail?: string }) {
  const startEmailChange = useAction(api.account.startEmailChange);
  const confirmEmailChange = useAction(api.account.confirmEmailChange);
  const [stage, setStage] = React.useState<"idle" | "codeSent">("idle");
  const [newEmail, setNewEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await startEmailChange({ currentPassword: password, newEmail });
      toast.success(`Code sent to ${newEmail}`);
      setStage("codeSent");
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start email change");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await confirmEmailChange({ code });
      toast.success(`Email updated to ${res.email}`);
      setStage("idle"); setNewEmail(""); setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't confirm the code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          {currentEmail ? <>Your sign-in email is <strong>{currentEmail}</strong>.</> : "Change your sign-in email."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stage === "idle" ? (
          <form onSubmit={start} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">New email</Label>
              <Input id="new-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-pw">Current password</Label>
              <Input id="email-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>Send verification code</Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the 6-digit code we sent to <strong>{newEmail}</strong>.</p>
            <div className="space-y-1.5">
              <Label htmlFor="email-code">Verification code</Label>
              <Input id="email-code" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Confirm new email</Button>
              <Button type="button" variant="ghost" onClick={() => { setStage("idle"); setCode(""); }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const signOutOthers = useAction(api.account.signOutOtherSessions);
  const [busy, setBusy] = React.useState(false);
  async function run() {
    setBusy(true);
    try {
      await signOutOthers({});
      toast.success("Signed out of other devices");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign out other devices");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Sign out everywhere except this device. Use this if you signed in on a shared or lost device.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={run} disabled={busy}>Sign out of all other devices</Button>
      </CardContent>
    </Card>
  );
}
