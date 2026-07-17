import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ACCESSIBILITY_FEATURES } from "@/lib/accessibility";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const accessibilityFormSchema = z.object({
  coverImageAlt: z.string(),
  wheelchairAccessible: z.boolean(),
  signLanguage: z.boolean(),
  closedCaptions: z.boolean(),
  hearingLoop: z.boolean(),
  accessibleParking: z.boolean(),
  assistanceAnimalsWelcome: z.boolean(),
  notes: z.string(),
});

type AccessibilityFormValues = z.infer<typeof accessibilityFormSchema>;

// eventContent.get returns either the real doc or a plain "empty defaults"
// object (see convex/eventContent.ts emptyContent()) -- neither shape is
// guaranteed to carry coverImageAlt/accessibility, so this normalizes both
// into one friendly optional-fields shape, mirroring EventPagePanel's
// OrganizerEventContent.
type OrganizerAccessibilityContent = {
  coverImageAlt?: string;
  accessibility?: Doc<"eventContent">["accessibility"];
};

function toFormValues(content: OrganizerAccessibilityContent): AccessibilityFormValues {
  const a = content.accessibility;
  return {
    coverImageAlt: content.coverImageAlt ?? "",
    wheelchairAccessible: a?.wheelchairAccessible ?? false,
    signLanguage: a?.signLanguage ?? false,
    closedCaptions: a?.closedCaptions ?? false,
    hearingLoop: a?.hearingLoop ?? false,
    accessibleParking: a?.accessibleParking ?? false,
    assistanceAnimalsWelcome: a?.assistanceAnimalsWelcome ?? false,
    notes: a?.notes ?? "",
  };
}

/**
 * The accessibility form itself, prefilled from `initial`. Rendered only
 * once the initial values have loaded, mirroring EventPageForm /
 * VirtualHubForm.
 */
function AccessibilityForm({
  eventId,
  initial,
}: {
  eventId: Id<"events">;
  initial: OrganizerAccessibilityContent;
}) {
  const updateAccessibility = useMutation(api.eventContent.updateAccessibility);
  const form = useForm<AccessibilityFormValues>({
    resolver: zodResolver(accessibilityFormSchema),
    defaultValues: toFormValues(initial),
  });

  async function onSubmit(values: AccessibilityFormValues) {
    try {
      await updateAccessibility({
        eventId,
        coverImageAlt: values.coverImageAlt,
        accessibility: {
          wheelchairAccessible: values.wheelchairAccessible,
          signLanguage: values.signLanguage,
          closedCaptions: values.closedCaptions,
          hearingLoop: values.hearingLoop,
          accessibleParking: values.accessibleParking,
          assistanceAnimalsWelcome: values.assistanceAnimalsWelcome,
          notes: values.notes,
        },
      });
      toast.success("Accessibility info updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update accessibility info");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Cover image alt text</CardTitle>
            <CardDescription>
              Describe the image for screen readers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="coverImageAlt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Cover image alt text</FormLabel>
                  <FormControl>
                    <Input placeholder="A crowd cheering under stage lights" {...field} />
                  </FormControl>
                  <FormDescription>
                    Describe the image for screen readers. Leave blank to fall back to the event
                    title.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accessibility features</CardTitle>
            <CardDescription>
              Shown to attendees on the public event page when at least one feature is enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {ACCESSIBILITY_FEATURES.map(({ key, label }) => (
              <FormField
                key={key}
                control={form.control}
                name={key}
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal">{label}</FormLabel>
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any other accessibility details attendees should know (optional)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-fit">
          Save accessibility info
        </Button>
      </form>
    </Form>
  );
}

/**
 * Accessibility tab: cover-image alt text + accessibility feature checklist
 * for the public event page. Prefilled from `eventContent.get`; a Skeleton
 * is shown while loading and the form is only mounted once the initial
 * values are known.
 */
export function AccessibilityPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data, isPending } = useQuery(convexQuery(api.eventContent.get, { eventId }));

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
    <AccessibilityForm
      eventId={eventId}
      initial={(data ?? {}) as OrganizerAccessibilityContent}
    />
  );
}
