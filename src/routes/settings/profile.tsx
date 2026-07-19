import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useTheme } from "next-themes";
import { useAuthActions } from "@convex-dev/auth/react";
import { toast } from "sonner";
import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ImageDropzone } from "@/components/ImageDropzone";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const Route = createFileRoute("/settings/profile")({ component: SettingsProfilePage });

type Me = NonNullable<FunctionReturnType<typeof api.organizers.getMe>>;

const CURRENCY_CODES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "JPY"] as const;

function SettingsProfilePage() {
  const { data: me } = useQuery(convexQuery(api.organizers.getMe, {}));

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your organization profile, event defaults, and account.
          </p>
        </div>

        {!me ? (
          <SettingsSkeleton />
        ) : (
          <>
            <OrganizationSection me={me} />
            <EventDefaultsSection me={me} />
            <AppearanceSection />
            <AccountSection email={me.email} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function OrganizationSection({ me }: { me: Me }) {
  const updateProfile = useMutation(api.organizers.updateProfile);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const setImage = useMutation(api.organizers.setImage);

  const [name, setName] = React.useState(me.name ?? "");
  const [saving, setSaving] = React.useState(false);
  const logoUrl = me.image ?? undefined;

  async function save() {
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated");
    } catch {
      toast.error("Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>How your organization appears to attendees.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Avatar className="size-14">
          {logoUrl ? <AvatarImage src={logoUrl} className="object-cover" /> : null}
          <AvatarFallback className="text-lg">
            {(name || "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="space-y-2">
          <Label htmlFor="name">Organization name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Logo</Label>
          <ImageDropzone
            getUploadUrl={() => generateUploadUrl({})}
            onUploaded={async (storageId) => {
              await setImage({ storageId });
              toast.success("Logo updated");
            }}
            label={logoUrl ? "Drop a new image to replace" : "Drag an image here, or click to upload"}
          />
          {logoUrl ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await setImage({ storageId: null });
                  toast.success("Logo removed");
                } catch {
                  toast.error("Could not remove the logo");
                }
              }}
            >
              Remove logo
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">Shown on your public event pages.</p>
        </div>

        <Button onClick={save} disabled={saving || !name.trim()}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

function EventDefaultsSection({ me }: { me: Me }) {
  const updatePreferences = useMutation(api.organizers.updatePreferences);

  const [location, setLocation] = React.useState(me.defaultLocation ?? "");
  const [capacity, setCapacity] = React.useState(
    me.defaultCapacity !== undefined ? String(me.defaultCapacity) : "",
  );
  const [currency, setCurrency] = React.useState(me.defaultCurrency ?? "USD");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const capacityNum = Number(capacity);
      await updatePreferences({
        defaultLocation: location.trim(),
        defaultCurrency: currency,
        defaultCapacity:
          capacity.trim() && Number.isFinite(capacityNum) && capacityNum >= 1
            ? Math.floor(capacityNum)
            : undefined,
      });
      toast.success("Event defaults saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save defaults");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event defaults</CardTitle>
        <CardDescription>
          Prefilled when you create a new event, so you don&apos;t retype them each time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="default-location">Default location</Label>
          <Input
            id="default-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Melbourne Town Hall"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="default-capacity">Default capacity</Label>
            <Input
              id="default-capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 100"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-currency">Default currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="default-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={save} disabled={saving}>
          Save defaults
        </Button>
      </CardContent>
    </Card>
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes resolves the active theme only on the client; render the
  // control's selection after mount so the server/first paint doesn't disagree.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose how Passline looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        {mounted ? (
          <ToggleGroup
            type="single"
            variant="outline"
            value={theme ?? "system"}
            onValueChange={(v) => v && setTheme(v)}
            className="justify-start"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} className="h-9 gap-1.5 px-3">
                <Icon className="size-4" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <Skeleton className="h-9 w-64" />
        )}
      </CardContent>
    </Card>
  );
}

function AccountSection({ email }: { email: string }) {
  const { signOut } = useAuthActions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your sign-in details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={email} disabled />
          <p className="text-xs text-muted-foreground">
            Your email and password are managed through sign-in.
          </p>
        </div>
        <Button variant="outline" onClick={() => signOut()}>
          <LogOut /> Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1 h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
