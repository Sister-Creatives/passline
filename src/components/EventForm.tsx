import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/DateTimePicker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const eventFormSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().min(1, "Description is required"),
    location: z.string().min(1, "Location is required"),
    // Kept as a string, like startsAt/endsAt below, and converted at submit
    // time -- avoids the react-hook-form/zod coerce generic mismatch.
    capacity: z
      .string()
      .min(1, "Capacity is required")
      .refine((value) => Number.isInteger(Number(value)) && Number(value) >= 1, {
        message: "Capacity must be a whole number of at least 1",
      }),
    startsAt: z.string().min(1, "Start date and time is required"),
    endsAt: z.string().min(1, "End date and time is required"),
  })
  .refine((values) => new Date(values.endsAt).getTime() > new Date(values.startsAt).getTime(), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });

type EventFormValues = z.infer<typeof eventFormSchema>;

/**
 * Converts epoch milliseconds to the local-time string a `datetime-local`
 * input expects: `YYYY-MM-DDTHH:mm`. Deliberately uses the local getters
 * (`getFullYear`/`getMonth`/...) rather than `toISOString`, which is UTC and
 * would shift the displayed time across timezones.
 */
function toDatetimeLocal(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

interface EventFormProps {
  /** When provided, the form edits this event instead of creating a new one. */
  event?: Doc<"events">;
  /** Called after a successful edit save (edit mode only). */
  onDone?: () => void;
}

/**
 * Create/edit event form. Collects title, description, location, capacity,
 * and a start/end window (as `datetime-local` inputs), converts the two
 * dates to epoch milliseconds, and submits either `api.events.createEvent`
 * (no `event` prop) or `api.events.updateEvent` (`event` prop supplied).
 */
export function EventForm({ event, onDone }: EventFormProps) {
  const navigate = useNavigate();
  const createEvent = useMutation(api.events.createEvent);
  const updateEvent = useMutation(api.events.updateEvent);
  const isEditMode = event !== undefined;

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event
      ? {
          title: event.title,
          description: event.description,
          location: event.location,
          capacity: String(event.capacity),
          startsAt: toDatetimeLocal(event.startsAt),
          endsAt: toDatetimeLocal(event.endsAt),
        }
      : {
          title: "",
          description: "",
          location: "",
          capacity: "1",
          startsAt: "",
          endsAt: "",
        },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: EventFormValues) {
    try {
      if (event) {
        await updateEvent({
          eventId: event._id,
          title: values.title,
          description: values.description,
          location: values.location,
          capacity: Number(values.capacity),
          startsAt: new Date(values.startsAt).getTime(),
          endsAt: new Date(values.endsAt).getTime(),
        });
        toast.success("Event updated");
        onDone?.();
      } else {
        const eventId = await createEvent({
          title: values.title,
          description: values.description,
          location: values.location,
          capacity: Number(values.capacity),
          startsAt: new Date(values.startsAt).getTime(),
          endsAt: new Date(values.endsAt).getTime(),
        });
        toast.success("Event created");
        navigate({ to: "/events/$id", params: { id: eventId } });
      }
    } catch (error) {
      const fallback = event ? "Failed to update event" : "Failed to create event";
      toast.error(error instanceof Error ? error.message : fallback);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Autumn forest gathering" {...field} />
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
                <Textarea placeholder="Tell guests what to expect" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location</FormLabel>
              <FormControl>
                <Input placeholder="Mornington Green Memorial Forest" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Starts at</FormLabel>
                <FormControl>
                  <DateTimePicker {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ends at</FormLabel>
                <FormControl>
                  <DateTimePicker {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capacity</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" />}
          {isEditMode ? "Save changes" : "Create event"}
        </Button>
      </form>
    </Form>
  );
}
