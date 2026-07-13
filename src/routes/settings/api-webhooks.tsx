import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Copy, Plus } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/settings/api-webhooks")({ component: SettingsApiWebhooksPage });

const createKeyFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type CreateKeyFormValues = z.infer<typeof createKeyFormSchema>;

/**
 * Create-key dialog. On submit, calls `api.apiKeys.create` and swaps the form
 * for a show-once view of the full secret (with a copy button and a warning
 * that it will never be shown again). Closing the dialog discards the secret
 * for good -- only the list's masked metadata remains.
 */
function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation(api.apiKeys.create);
  const form = useForm<CreateKeyFormValues>({
    resolver: zodResolver(createKeyFormSchema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: CreateKeyFormValues) {
    try {
      const result = await create({ name: values.name });
      setSecret(result.secret);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create API key");
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Reset once the dialog has closed, so the secret never lingers in state.
      setSecret(null);
      form.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> New API key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy this key now -- you won&rsquo;t be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={secret} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copySecret} aria-label="Copy">
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Name this key so you can recognize it later.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Production storefront" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Create key
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyButton({ keyId, name }: { keyId: Id<"apiKeys">; name: string }) {
  const revoke = useMutation(api.apiKeys.revoke);

  async function handleRevoke() {
    try {
      await revoke({ keyId });
      toast.success("API key revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke API key");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke &ldquo;{name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests using this key will stop working immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleRevoke}>
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SettingsApiWebhooksPage() {
  const { data: keys, isPending } = useQuery(convexQuery(api.apiKeys.list, {}));

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-lg font-medium">API keys</h1>
      <CreateKeyDialog />
    </div>
  );

  if (isPending) {
    return (
      <DashboardLayout>
        {header}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  const rows = keys ?? [];

  if (rows.length === 0) {
    return (
      <DashboardLayout>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>
              Create a key to let external apps read your events over HTTP.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((key) => {
            const revoked = key.revokedAt !== undefined;
            return (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {key.prefix}…{key.lastFour}
                </TableCell>
                <TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell>
                  <Badge variant={revoked ? "outline" : "secondary"}>
                    {revoked ? "Revoked" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {!revoked && <RevokeKeyButton keyId={key.id} name={key.name} />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DashboardLayout>
  );
}
