import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useFieldArray, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseVideoEmbed } from "../../convex/lib/eventContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const hubFormSchema = z.object({
  enabled: z.boolean(),
  heading: z.string(),
  description: z.string(),
  videoUrl: z.string().refine((v) => v.trim() === "" || parseVideoEmbed(v.trim()) !== null, {
    message: "Must be a YouTube or Vimeo link",
  }),
  meetingUrl: z.string().refine((v) => v.trim() === "" || v.trim().startsWith("https://"), {
    message: "Must start with https://",
  }),
  resources: z.array(z.object({ title: z.string(), url: z.string() })),
  accessPassword: z.string(),
});

type HubFormValues = z.infer<typeof hubFormSchema>;

// virtualHub.get returns either the real doc or a plain "empty defaults"
// object (see convex/virtualHub.ts emptyHub()) -- those two shapes only
// structurally share `enabled`/`resources`, so this normalizes both into one
// friendly optional-fields shape, mirroring EventPagePanel's
// OrganizerEventContent.
type OrganizerHubData = {
  enabled: boolean;
  heading?: string;
  description?: string;
  videoUrl?: string;
  meetingUrl?: string;
  resources: { title: string; url: string }[];
  accessPassword?: string;
};

function toFormValues(hub: OrganizerHubData): HubFormValues {
  return {
    enabled: hub.enabled,
    heading: hub.heading ?? "",
    description: hub.description ?? "",
    videoUrl: hub.videoUrl ?? "",
    meetingUrl: hub.meetingUrl ?? "",
    resources: hub.resources.map((row) => ({ title: row.title, url: row.url })),
    accessPassword: hub.accessPassword ?? "",
  };
}

/** Repeatable resource-row editor: title, url, add/remove. */
function ResourcesEditor({ control }: { control: Control<HubFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "resources" });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((row, index) => (
        <div
          key={row.id}
          className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start"
        >
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <FormField
              control={control}
              name={`resources.${index}.title`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Slides" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`resources.${index}.url`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => remove(index)}
            aria-label="Remove resource"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => append({ title: "", url: "" })}
      >
        <Plus /> Add resource
      </Button>
    </div>
  );
}

/**
 * The virtual hub form itself, prefilled from `initial`. Rendered only once
 * the initial values have loaded, mirroring EventPageForm.
 */
function VirtualHubForm({ eventId, initial }: { eventId: Id<"events">; initial: OrganizerHubData }) {
  const update = useMutation(api.virtualHub.update);
  const form = useForm<HubFormValues>({
    resolver: zodResolver(hubFormSchema),
    defaultValues: toFormValues(initial),
  });

  async function onSubmit(values: HubFormValues) {
    try {
      await update({
        eventId,
        enabled: values.enabled,
        heading: values.heading,
        description: values.description,
        videoUrl: values.videoUrl,
        meetingUrl: values.meetingUrl,
        resources: values.resources,
        accessPassword: values.accessPassword,
      });
      toast.success("Virtual hub updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update virtual hub");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Virtual hub</CardTitle>
            <CardDescription>
              A gated page where ticket holders (and anyone with the access password) can join
              the stream, jump to the meeting link, and download resources.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Enabled</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Show the hub to ticket holders and password-gated visitors.
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="heading"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Heading</FormLabel>
                  <FormControl>
                    <Input placeholder="Join us online" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What attendees will find here (optional)" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="videoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Video URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://youtube.com/watch?v=…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="meetingUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meeting URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://zoom.us/j/…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access password</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Shared password for non-ticket-holders (optional)"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-sm text-muted-foreground">
                    Stored as plain text -- this is a shared lobby gate, not a user credential.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourcesEditor control={form.control} />
          </CardContent>
        </Card>

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-fit">
          Save virtual hub
        </Button>
      </form>
    </Form>
  );
}

/**
 * Virtual hub tab: config editor for the F14 gated event hub. Prefilled from
 * `virtualHub.get`; a Skeleton is shown while loading and the form is only
 * mounted once the initial values are known, mirroring EventPagePanel.
 */
export function VirtualHubPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data, isPending } = useQuery(convexQuery(api.virtualHub.get, { eventId }));

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <VirtualHubForm
      eventId={eventId}
      initial={(data ?? { enabled: false, resources: [] }) as OrganizerHubData}
    />
  );
}
