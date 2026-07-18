import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Copy, Plus } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

/** API key scopes. Must match `API_SCOPES` in convex/apiKeys.ts. */
const API_SCOPE_OPTIONS = [
  { value: "read", label: "Read", desc: "GET endpoints — events, ticket types, questions, add-ons, sessions, seats" },
  { value: "orders:write", label: "Create orders", desc: "POST /v1/orders (headless checkout)" },
] as const;

const SCOPE_LABEL: Record<string, string> = {
  read: "Read",
  "orders:write": "Orders",
};

const createKeyFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  scopes: z.array(z.string()).min(1, "Select at least one scope"),
});

type CreateKeyFormValues = z.infer<typeof createKeyFormSchema>;

/** Event types a webhook may subscribe to. Must match `KNOWN_EVENT_TYPES` in convex/webhooks.ts. */
const WEBHOOK_EVENT_TYPES = [
  { value: "ticket_type.created", label: "Ticket type created" },
  { value: "ticket_type.updated", label: "Ticket type updated" },
  { value: "ticket_type.deleted", label: "Ticket type deleted" },
] as const;

const createWebhookFormSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .refine((value) => value.startsWith("https://"), "URL must start with https://"),
  subscribedEvents: z.array(z.string()).min(1, "Select at least one event"),
});

type CreateWebhookFormValues = z.infer<typeof createWebhookFormSchema>;

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
    defaultValues: { name: "", scopes: ["read", "orders:write"] },
  });

  async function onSubmit(values: CreateKeyFormValues) {
    try {
      const result = await create({ name: values.name, scopes: values.scopes });
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
                <FormField
                  control={form.control}
                  name="scopes"
                  render={() => (
                    <FormItem>
                      <FormLabel>Scopes</FormLabel>
                      <div className="flex flex-col gap-2">
                        {API_SCOPE_OPTIONS.map((scope) => (
                          <FormField
                            key={scope.value}
                            control={form.control}
                            name="scopes"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start gap-2">
                                <FormControl>
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={field.value?.includes(scope.value)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value ?? [];
                                      field.onChange(
                                        checked
                                          ? [...current, scope.value]
                                          : current.filter((value) => value !== scope.value),
                                      );
                                    }}
                                  />
                                </FormControl>
                                <div className="grid gap-0.5 leading-tight">
                                  <FormLabel className="font-normal">{scope.label}</FormLabel>
                                  <span className="text-xs text-muted-foreground">{scope.desc}</span>
                                </div>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
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

/**
 * Create-webhook dialog. On submit, calls `api.webhooks.create` and swaps the
 * form for a show-once view of the signing secret (with a copy button and a
 * warning that it will never be shown again). Closing the dialog discards the
 * secret for good -- only the list's metadata remains.
 */
function CreateWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation(api.webhooks.create);
  const form = useForm<CreateWebhookFormValues>({
    resolver: zodResolver(createWebhookFormSchema),
    defaultValues: { url: "", subscribedEvents: [] },
  });

  async function onSubmit(values: CreateWebhookFormValues) {
    try {
      const result = await create({
        url: values.url,
        subscribedEvents: values.subscribedEvents,
      });
      setSecret(result.secret);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create webhook");
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
          <Plus /> New webhook
        </Button>
      </DialogTrigger>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook created</DialogTitle>
              <DialogDescription>
                Copy this signing secret now -- you won&rsquo;t be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={secret} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copySecret} aria-label="Copy">
                <Copy />
              </Button>
            </div>
            <p className="text-sm text-destructive">
              Store this secret securely. It is used to verify the{" "}
              <code className="font-mono text-xs">X-Passline-Signature</code> header on incoming
              deliveries and will not be shown again.
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New webhook</DialogTitle>
              <DialogDescription>
                We&rsquo;ll POST a signed payload to this URL whenever a subscribed event occurs.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://example.com/webhooks/passline" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subscribedEvents"
                  render={() => (
                    <FormItem>
                      <FormLabel>Events</FormLabel>
                      <div className="flex flex-col gap-2">
                        {WEBHOOK_EVENT_TYPES.map((eventType) => (
                          <FormField
                            key={eventType.value}
                            control={form.control}
                            name="subscribedEvents"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center gap-2">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(eventType.value)}
                                    onCheckedChange={(checked) => {
                                      const current = field.value ?? [];
                                      field.onChange(
                                        checked
                                          ? [...current, eventType.value]
                                          : current.filter((value) => value !== eventType.value),
                                      );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal">{eventType.label}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Create webhook
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

function RemoveWebhookButton({ webhookId, url }: { webhookId: Id<"webhooks">; url: string }) {
  const remove = useMutation(api.webhooks.remove);

  async function handleRemove() {
    try {
      await remove({ webhookId });
      toast.success("Webhook removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove webhook");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove &ldquo;{url}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Passline will stop sending event deliveries to this URL. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleRemove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ApiKeysSection() {
  const { data: keys, isPending } = useQuery(convexQuery(api.apiKeys.list, {}));

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">API keys</h2>
      <CreateKeyDialog />
    </div>
  );

  if (isPending) {
    return (
      <div>
        {header}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  const rows = keys ?? [];

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>
              Create a key to let external apps read your events over HTTP.
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
            <TableHead>Key</TableHead>
            <TableHead>Scopes</TableHead>
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
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes === undefined ? (
                      <Badge variant="secondary">Full access</Badge>
                    ) : (
                      key.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {SCOPE_LABEL[scope] ?? scope}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell>
                  <Badge variant={revoked ? "outline" : "default"}>
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
    </div>
  );
}

function WebhooksSection() {
  const { data: webhooks, isPending } = useQuery(convexQuery(api.webhooks.list, {}));

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-medium">Webhooks</h2>
      <CreateWebhookDialog />
    </div>
  );

  if (isPending) {
    return (
      <div>
        {header}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  const rows = webhooks ?? [];

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No webhooks yet</EmptyTitle>
            <EmptyDescription>
              Register an endpoint to receive signed notifications when your ticket types change.
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
            <TableHead>URL</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((webhook) => (
            <TableRow key={webhook.id}>
              <TableCell className="max-w-xs truncate font-mono text-xs">{webhook.url}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {webhook.subscribedEvents.map((eventType) => (
                    <Badge key={eventType} variant="secondary">
                      {eventType}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={webhook.active ? "default" : "outline"}>
                  {webhook.active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>{new Date(webhook.createdAt).toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <RemoveWebhookButton webhookId={webhook.id} url={webhook.url} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const API_BASE =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  "https://<your-deployment>.convex.site";

const API_ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/v1/events", desc: "List your events" },
  { method: "GET", path: "/v1/events/{eventId}/ticket-types", desc: "An event's ticket types" },
  { method: "GET", path: "/v1/events/{eventId}/questions", desc: "Checkout questions" },
  { method: "GET", path: "/v1/events/{eventId}/add-ons", desc: "Add-ons" },
  { method: "GET", path: "/v1/events/{eventId}/sessions", desc: "Sessions" },
  { method: "GET", path: "/v1/events/{eventId}/seats", desc: "Seats" },
  { method: "POST", path: "/v1/orders", desc: "Create an order (headless checkout)" },
];

const WEBHOOK_EVENTS: { type: string; desc: string }[] = [
  { type: "ticket_type.created", desc: "A ticket type was created" },
  { type: "ticket_type.updated", desc: "A ticket type's details or price changed" },
  { type: "ticket_type.deleted", desc: "A ticket type was deleted" },
];

/** A copy-to-clipboard code block; monospace, horizontally scrollable. */
function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }
  return (
    <div className="group/code relative">
      {label ? (
        <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      ) : null}
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label="Copy"
        className="absolute right-1.5 top-1.5 text-muted-foreground"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function ApiReferenceCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Using the API</CardTitle>
        <CardDescription>
          A read API over HTTP, authenticated with a Bearer key. Create a key above, then:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CodeBlock label="Base URL" code={API_BASE} />
        <CodeBlock
          label="Authenticate every request"
          code={'Authorization: Bearer pl_live_your_key_here'}
        />
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Endpoints</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableBody>
                {API_ENDPOINTS.map((e) => (
                  <TableRow key={`${e.method} ${e.path}`}>
                    <TableCell className="w-14 py-2 align-top">
                      <Badge variant={e.method === "POST" ? "default" : "secondary"} className="font-mono text-[0.7rem]">
                        {e.method}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-xs">{e.path}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{e.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Scopes</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableBody>
                {API_SCOPE_OPTIONS.map((s) => (
                  <TableRow key={s.value}>
                    <TableCell className="w-32 py-2 align-top">
                      <Badge variant="secondary" className="font-mono text-[0.7rem]">{s.value}</Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{s.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Choose a key&apos;s scopes when you create it. A request with a key missing the
            required scope is rejected with <code className="font-mono">403</code>.
          </p>
        </div>
        <CodeBlock
          label="Example"
          code={`curl ${API_BASE}/v1/events \\\n  -H "Authorization: Bearer pl_live_your_key_here"`}
        />
      </CardContent>
    </Card>
  );
}

function WebhooksReferenceCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receiving webhooks</CardTitle>
        <CardDescription>
          When you register an endpoint, Passline POSTs a signed JSON body on these events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Event types</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableBody>
                {WEBHOOK_EVENTS.map((e) => (
                  <TableRow key={e.type}>
                    <TableCell className="py-2 font-mono text-xs">{e.type}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{e.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Each delivery includes an{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              X-Passline-Signature
            </code>{" "}
            header: a hex HMAC-SHA256 of the raw request body, keyed by the{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">whsec_…</code>{" "}
            secret shown once when you create the webhook. Recompute it over the raw body and
            compare in constant time before trusting the payload.
          </p>
        </div>
        <CodeBlock
          label="Verify a delivery (Node)"
          code={`import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", webhookSecret)
  .update(rawBody)          // the exact bytes received
  .digest("hex");
const received = req.headers["x-passline-signature"];
const ok =
  expected.length === received.length &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(received));`}
        />
      </CardContent>
    </Card>
  );
}

function SettingsApiWebhooksPage() {
  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API &amp; webhooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programmatic access to your events, and signed notifications when they change.
          </p>
        </div>

        <ApiKeysSection />
        <ApiReferenceCard />
        <WebhooksSection />
        <WebhooksReferenceCard />
      </div>
    </DashboardLayout>
  );
}
