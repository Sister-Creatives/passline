import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/settings/profile")({ component: SettingsProfilePage });

function SettingsProfilePage() {
  const { data: me } = useQuery(convexQuery(api.organizers.getMe, {}));
  const updateProfile = useMutation(api.organizers.updateProfile);

  const [name, setName] = React.useState("");
  const [image, setImage] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!me) return;
    setName(me.name ?? "");
    setImage(me.image ?? "");
  }, [me]);

  async function save() {
    setSaving(true);
    try {
      await updateProfile({ name: name.trim(), image: image.trim() || undefined });
      toast.success("Profile updated");
    } catch {
      toast.error("Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organization profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How your organization appears to attendees.
        </p>
      </div>

      {me === undefined ? (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <Skeleton className="size-14 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <Avatar className="size-14 rounded-lg">
              {image ? <AvatarImage src={image} /> : null}
              <AvatarFallback className="rounded-lg text-lg">
                {(name || "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-2">
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Logo URL</Label>
              <Input
                id="logo"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://…"
              />
              <p className="text-xs text-muted-foreground">Shown on your public event pages.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={me?.email ?? ""} disabled />
            </div>

            <Button onClick={save} disabled={saving || !name.trim()}>
              Save changes
            </Button>
          </CardContent>
        </Card>
      )}
      </div>
    </DashboardLayout>
  );
}
