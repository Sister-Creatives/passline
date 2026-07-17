import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Send } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const composeFormSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message is required"),
});

type ComposeFormValues = z.infer<typeof composeFormSchema>;

/**
 * Compose form: subject + body, submits api.marketing.sendEventEmail to the
 * event's distinct attendee emails (order buyers, ticket attendees, legacy
 * rsvps -- collected server-side). On success, toasts the recipient count
 * the backend reports and resets the form for the next campaign.
 */
function ComposeForm({ eventId }: { eventId: Id<"events"> }) {
  const sendEventEmail = useMutation(api.marketing.sendEventEmail);
  const form = useForm<ComposeFormValues>({
    resolver: zodResolver(composeFormSchema),
    defaultValues: { subject: "", body: "" },
  });

  async function onSubmit(values: ComposeFormValues) {
    try {
      const result = await sendEventEmail({
        eventId,
        subject: values.subject,
        body: values.body,
      });
      const count = result.recipientCount;
      toast.success(`Sent to ${count} recipient${count === 1 ? "" : "s"}`);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send email");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl>
                <Input placeholder="An update about your event" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea placeholder="Write your message to attendees" rows={6} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Delivery is a no-op until email sending is configured.
          </p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Send /> Send
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * Sent-campaigns table: subject, recipient count, and send date, newest
 * first. Mirrors OrdersPanel's Skeleton/Empty/Table shape.
 */
function CampaignsTable({ eventId }: { eventId: Id<"events"> }) {
  const { data: campaigns, isPending } = useQuery(
    convexQuery(api.marketing.listCampaigns, { eventId }),
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const rows = campaigns ?? [];

  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No campaigns sent yet</EmptyTitle>
          <EmptyDescription>Compose a message above to email your attendees.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead className="text-right">Recipients</TableHead>
          <TableHead className="text-right">Sent</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((campaign: Doc<"emailCampaigns">) => (
          <TableRow key={campaign._id}>
            <TableCell className="font-medium">{campaign.subject}</TableCell>
            <TableCell className="text-right tabular-nums">{campaign.recipientCount}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {new Date(campaign.createdAt).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const trackingPixelsFormSchema = z.object({
  metaPixelId: z.string(),
  googleAnalyticsId: z.string(),
  gtmId: z.string(),
});

type TrackingPixelsFormValues = z.infer<typeof trackingPixelsFormSchema>;

/**
 * Tracking-pixel ids form, prefilled from the event's current configuration.
 * An empty field clears that id server-side (see updateTrackingPixels).
 * Rendered only once the initial values have loaded, so defaultValues are
 * always correct on mount (mirrors EventForm's edit-mode prefill).
 */
function TrackingPixelsForm({
  eventId,
  initial,
}: {
  eventId: Id<"events">;
  initial: { metaPixelId?: string; googleAnalyticsId?: string; gtmId?: string };
}) {
  const updateTrackingPixels = useMutation(api.marketing.updateTrackingPixels);
  const form = useForm<TrackingPixelsFormValues>({
    resolver: zodResolver(trackingPixelsFormSchema),
    defaultValues: {
      metaPixelId: initial.metaPixelId ?? "",
      googleAnalyticsId: initial.googleAnalyticsId ?? "",
      gtmId: initial.gtmId ?? "",
    },
  });

  async function onSubmit(values: TrackingPixelsFormValues) {
    try {
      await updateTrackingPixels({
        eventId,
        metaPixelId: values.metaPixelId,
        googleAnalyticsId: values.googleAnalyticsId,
        gtmId: values.gtmId,
      });
      toast.success("Tracking pixels updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tracking pixels");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="metaPixelId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Meta Pixel ID</FormLabel>
              <FormControl>
                <Input placeholder="123456789012345" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="googleAnalyticsId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Google Analytics ID</FormLabel>
              <FormControl>
                <Input placeholder="G-XXXXXXXXXX" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="gtmId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Google Tag Manager ID</FormLabel>
              <FormControl>
                <Input placeholder="GTM-XXXXXXX" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-fit">
          Save tracking pixels
        </Button>
      </form>
    </Form>
  );
}

/** Tracking-pixels card: loads current ids, then renders the prefilled form. */
function TrackingPixelsCard({ eventId }: { eventId: Id<"events"> }) {
  const { data, isPending } = useQuery(convexQuery(api.marketing.getEventMarketing, { eventId }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracking pixels</CardTitle>
        <CardDescription>
          Attach analytics and ad-tracking scripts to this event's public page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <TrackingPixelsForm eventId={eventId} initial={data ?? {}} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Marketing tab: a compose card for emailing attendees, a table of past
 * campaigns, and a form to manage the event's tracking-pixel ids.
 */
export function MarketingPanel({ eventId }: { eventId: Id<"events"> }) {
  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
          <CardDescription>Email everyone who has a ticket or RSVP for this event.</CardDescription>
        </CardHeader>
        <CardContent>
          <ComposeForm eventId={eventId} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-4 text-lg font-medium">Sent campaigns</h2>
        <CampaignsTable eventId={eventId} />
      </div>

      <TrackingPixelsCard eventId={eventId} />
    </div>
  );
}
