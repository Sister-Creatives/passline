import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { EVENT_TYPES, EVENT_CATEGORIES, isValidSlug } from "../../convex/lib/eventTaxonomy";
import { Badge } from "@/components/ui/badge";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Common ISO 4217 currency codes offered in the edit-mode Currency select.
const CURRENCY_CODES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "JPY"] as const;

// Sentinel used by the event type/category selects to represent "no
// selection" -- Radix `Select.Item` rejects an empty-string value, and an
// empty string is what clears the field server-side, so this is translated
// to `""` on submit.
const NONE_VALUE = "none";

const MAX_KEYWORDS = 10;
const MAX_SHARING_DESCRIPTION_LENGTH = 160;

/**
 * Builds the form's zod schema. The slug field is only meaningful (and only
 * rendered) in edit mode, so its format check is gated on `isEditMode` --
 * otherwise create mode's unused default slug value would fail validation.
 */
function buildEventFormSchema(isEditMode: boolean) {
  return z
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
      // Edit-only fields (see EventForm's edit-mode block below).
      slug: z.string(),
      currency: z.string(),
      eventType: z.string(),
      eventCategory: z.string(),
      hostProfileId: z.string(),
      sharingDescription: z
        .string()
        .max(MAX_SHARING_DESCRIPTION_LENGTH, "Sharing description must be 160 characters or fewer"),
      keywords: z.array(z.string()),
    })
    .refine((values) => new Date(values.endsAt).getTime() > new Date(values.startsAt).getTime(), {
      message: "End time must be after start time",
      path: ["endsAt"],
    })
    .refine((values) => !isEditMode || isValidSlug(values.slug), {
      message: "Use lowercase letters, numbers, and hyphens only",
      path: ["slug"],
    });
}

type EventFormValues = z.infer<ReturnType<typeof buildEventFormSchema>>;

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
 *
 * In edit mode only, also surfaces the F21b "Event information" fields --
 * URL slug, currency, event type/category, sharing description, and
 * keywords -- which are passed to `updateEvent` alongside the base fields.
 * Create mode stays minimal (F19 model) and never renders or submits them.
 */
export function EventForm({ event, onDone }: EventFormProps) {
  const navigate = useNavigate();
  const createEvent = useMutation(api.events.createEvent);
  const updateEvent = useMutation(api.events.updateEvent);
  const isEditMode = event !== undefined;
  const [keywordInput, setKeywordInput] = useState("");
  const { data: hostProfiles } = useQuery(convexQuery(api.hostProfiles.listMine, {}));

  const form = useForm<EventFormValues>({
    resolver: zodResolver(buildEventFormSchema(isEditMode)),
    defaultValues: event
      ? {
          title: event.title,
          description: event.description,
          location: event.location,
          capacity: String(event.capacity),
          startsAt: toDatetimeLocal(event.startsAt),
          endsAt: toDatetimeLocal(event.endsAt),
          slug: event.slug,
          currency: event.currency ?? "USD",
          eventType: event.eventType ?? NONE_VALUE,
          eventCategory: event.eventCategory ?? NONE_VALUE,
          hostProfileId: event.hostProfileId ?? NONE_VALUE,
          sharingDescription: event.sharingDescription ?? "",
          keywords: event.keywords ?? [],
        }
      : {
          title: "",
          description: "",
          location: "",
          capacity: "1",
          startsAt: "",
          endsAt: "",
          slug: "",
          currency: "USD",
          eventType: NONE_VALUE,
          eventCategory: NONE_VALUE,
          hostProfileId: NONE_VALUE,
          sharingDescription: "",
          keywords: [],
        },
  });

  const isSubmitting = form.formState.isSubmitting;

  function addKeyword(current: string[], onChange: (value: string[]) => void) {
    const trimmed = keywordInput.trim();
    if (!trimmed || current.length >= MAX_KEYWORDS || current.includes(trimmed)) {
      setKeywordInput("");
      return;
    }
    onChange([...current, trimmed]);
    setKeywordInput("");
  }

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
          slug: values.slug,
          currency: values.currency,
          eventType: values.eventType === NONE_VALUE ? "" : values.eventType,
          eventCategory: values.eventCategory === NONE_VALUE ? "" : values.eventCategory,
          hostProfileId:
            values.hostProfileId === NONE_VALUE ? null : (values.hostProfileId as Id<"hostProfiles">),
          keywords: values.keywords,
          sharingDescription: values.sharingDescription,
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
        navigate({ to: "/events/$id", params: { id: eventId }, search: { section: "tickets" } });
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
        {isEditMode && (
          <>
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event page URL</FormLabel>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">/e/</InputGroupAddon>
                    <FormControl>
                      <InputGroupInput placeholder="my-event" {...field} />
                    </FormControl>
                  </InputGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        {CURRENCY_CODES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="eventType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={NONE_VALUE}>None</SelectItem>
                          {EVENT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="eventCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={NONE_VALUE}>None</SelectItem>
                          {EVENT_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="sharingDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sharing description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Shown when this event is shared or found in search"
                      {...field}
                    />
                  </FormControl>
                  <div className="text-right text-xs text-muted-foreground">
                    {field.value.length}/{MAX_SHARING_DESCRIPTION_LENGTH}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="keywords"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keywords</FormLabel>
                  {field.value.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {field.value.map((keyword) => (
                        <Badge key={keyword} variant="secondary" className="gap-1">
                          {keyword}
                          <button
                            type="button"
                            onClick={() => field.onChange(field.value.filter((k) => k !== keyword))}
                            aria-label={`Remove ${keyword}`}
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addKeyword(field.value, field.onChange);
                        }
                      }}
                      placeholder="Add a keyword"
                      disabled={field.value.length >= MAX_KEYWORDS}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addKeyword(field.value, field.onChange)}
                      disabled={field.value.length >= MAX_KEYWORDS}
                    >
                      Add
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hostProfileId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Host profile</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={NONE_VALUE}>None</SelectItem>
                        {(hostProfiles ?? []).map((profile) => (
                          <SelectItem key={profile._id} value={profile._id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {hostProfiles?.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      <Link to="/settings/host-profiles" className="underline">
                        Create a host profile in Settings
                      </Link>{" "}
                      to show a "Hosted by" block on your event page.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" />}
          {isEditMode ? "Save changes" : "Create event"}
        </Button>
      </form>
    </Form>
  );
}
