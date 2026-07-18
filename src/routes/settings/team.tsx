import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/settings/team")({ component: SettingsTeamPage });

type Role = "owner" | "member";

function SettingsTeamPage() {
  const { data: team } = useQuery(convexQuery(api.team.listTeam, {}));
  const { data: identity } = useQuery(convexQuery(api.team.getMyIdentity, {}));

  const isOwner = team?.myRole === "owner";
  const myEmail = identity?.email?.toLowerCase();

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            People who can manage this organization&apos;s events.
          </p>
        </div>

        {isOwner ? <AddMemberCard /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {isOwner
                ? "Owners manage the team and settings; members can run events."
                : "Only owners can add or manage teammates."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {team === undefined ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : team.members.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No teammates yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {team.members.map((m) => (
                  <MemberRow
                    key={m._id}
                    member={m}
                    isOwner={isOwner}
                    isYou={m.email.toLowerCase() === myEmail}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function AddMemberCard() {
  const addMember = useMutation(api.team.addMember);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("member");
  const [saving, setSaving] = React.useState(false);

  async function add() {
    setSaving(true);
    try {
      await addMember({ email: email.trim(), role });
      toast.success("Teammate added");
      setEmail("");
      setRole("member");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add teammate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a teammate</CardTitle>
        <CardDescription>
          They join automatically the first time they sign in with this email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim() && !saving) add();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="member-role" className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={add} disabled={saving || !email.trim()}>
            <UserPlus /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Member = { _id: Id<"memberships">; email: string; role: Role; pending: boolean };

function MemberRow({
  member,
  isOwner,
  isYou,
}: {
  member: Member;
  isOwner: boolean;
  isYou: boolean;
}) {
  const updateRole = useMutation(api.team.updateRole);
  const removeMember = useMutation(api.team.removeMember);
  const [busy, setBusy] = React.useState(false);

  async function changeRole(role: Role) {
    if (role === member.role) return;
    setBusy(true);
    try {
      await updateRole({ membershipId: member._id, role });
      toast.success("Role updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update role");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeMember({ membershipId: member._id });
      toast.success("Teammate removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove teammate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
          {member.email.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{member.email}</span>
          {isYou ? <span className="text-xs text-muted-foreground">(you)</span> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {member.pending ? (
            <Badge variant="outline" className="text-xs">
              Pending
            </Badge>
          ) : null}
        </div>
      </div>

      {isOwner ? (
        <div className="flex items-center gap-2">
          <Select
            value={member.role}
            onValueChange={(v) => changeRole(v as Role)}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={remove}
            disabled={busy}
            aria-label={`Remove ${member.email}`}
          >
            <X />
          </Button>
        </div>
      ) : (
        <Badge variant={member.role === "owner" ? "secondary" : "outline"}>{member.role}</Badge>
      )}
    </li>
  );
}
