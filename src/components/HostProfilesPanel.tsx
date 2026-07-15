import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const MAX_BIO_LENGTH = 600;

/** An optional URL field: empty is fine, but a non-empty value must be `https://`. */
const optionalHttpsUrl = z
  .string()
  .refine((v) => v.trim() === "" || v.trim().startsWith("https://"), {
    message: "Must start with https://",
  });

const hostProfileFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  bio: z.string().max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or fewer`),
  logoUrl: optionalHttpsUrl,
  websiteUrl: optionalHttpsUrl,
});

type HostProfileFormValues = z.infer<typeof hostProfileFormSchema>;

/** Trims a form string to `undefined` when empty, otherwise the trimmed value. */
function toOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Create/edit host profile form. Fields: name, bio (Textarea, max 600),
 * logo URL, website URL. Submits either `api.hostProfiles.create` (no
 * `hostProfile` prop) or `api.hostProfiles.update` (`hostProfile` prop
 * supplied). Mirrors TicketTypesPanel's TicketTypeEditor.
 */
function HostProfileEditor({
  hostProfile,
  onDone,
}: {
  hostProfile?: Doc<"hostProfiles">;
  onDone: () => void;
}) {
  const create = useMutation(api.hostProfiles.create);
  const update = useMutation(api.hostProfiles.update);
  const form = useForm<HostProfileFormValues>({
    resolver: zodResolver(hostProfileFormSchema),
    defaultValues: hostProfile
      ? {
          name: hostProfile.name,
          bio: hostProfile.bio ?? "",
          logoUrl: hostProfile.logoUrl ?? "",
          websiteUrl: hostProfile.websiteUrl ?? "",
        }
      : {
          name: "",
          bio: "",
          logoUrl: "",
          websiteUrl: "",
        },
  });

  async function onSubmit(values: HostProfileFormValues) {
    const bio = toOptional(values.bio);
    const logoUrl = toOptional(values.logoUrl);
    const websiteUrl = toOptional(values.websiteUrl);
    try {
      if (hostProfile) {
        await update({
          hostProfileId: hostProfile._id,
          name: values.name,
          bio,
          logoUrl,
          websiteUrl,
        });
        toast.success("Host profile updated");
      } else {
        await create({ name: values.name, bio, logoUrl, websiteUrl });
        toast.success("Host profile created");
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save host profile");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 p-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Acme Events" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio (optional)</FormLabel>
              <FormControl>
                <Textarea placeholder="Tell attendees about this host" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="logoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Logo URL (optional)</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com/logo.png" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="websiteUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Website URL (optional)</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {hostProfile ? "Save changes" : "Create host profile"}
        </Button>
      </form>
    </Form>
  );
}

/**
 * Host profiles settings panel: a Table of the organizer's reusable host
 * profiles (name, bio preview, website), a create Sheet, per-row edit Sheet,
 * and AlertDialog-confirmed removal. Mirrors TicketTypesPanel/
 * CheckoutQuestionsPanel's Skeleton/Empty/Table shape.
 */
export function HostProfilesPanel() {
  const { data: profiles, isPending } = useQuery(convexQuery(api.hostProfiles.listMine, {}));
  const remove = useMutation(api.hostProfiles.remove);
  const [editing, setEditing] = useState<Doc<"hostProfiles"> | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleDelete(hostProfileId: Id<"hostProfiles">) {
    try {
      await remove({ hostProfileId });
      toast.success("Host profile deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete host profile");
    }
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const rows = profiles ?? [];

  // Rendered above both the table and the empty state so "New host profile"
  // is always reachable, even with zero profiles.
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Host profiles</h2>
      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetTrigger asChild>
          <Button size="sm">
            <Plus /> New host profile
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New host profile</SheetTitle>
          </SheetHeader>
          <HostProfileEditor onDone={() => setCreating(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No host profiles yet</EmptyTitle>
            <EmptyDescription>
              Create a reusable host profile to attach to your events.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Bio</TableHead>
            <TableHead>Website</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((profile) => (
            <TableRow key={profile._id}>
              <TableCell className="font-medium">{profile.name}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">
                {profile.bio ?? "—"}
              </TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">
                {profile.websiteUrl ?? "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Sheet
                    open={editing?._id === profile._id}
                    onOpenChange={(open) => setEditing(open ? profile : null)}
                  >
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                    </SheetTrigger>
                    <SheetContent>
                      <SheetHeader>
                        <SheetTitle>Edit host profile</SheetTitle>
                      </SheetHeader>
                      <HostProfileEditor
                        hostProfile={profile}
                        onDone={() => setEditing(null)}
                      />
                    </SheetContent>
                  </Sheet>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete">
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{profile.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This cannot be undone. Any events using this host profile will have it
                          cleared.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(profile._id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
