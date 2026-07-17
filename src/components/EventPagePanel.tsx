import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useFieldArray, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isValidHexColor, parseVideoEmbed } from "../../convex/lib/eventContent";
import { ImageDropzone } from "@/components/ImageDropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const pageFormSchema = z.object({
  brandColor: z.string().refine((v) => v.trim() === "" || isValidHexColor(v.trim()), {
    message: "Must be a 6-digit hex code like #1a2b3c",
  }),
  ctaLabel: z.string(),
  videoUrl: z.string().refine((v) => v.trim() === "" || parseVideoEmbed(v.trim()) !== null, {
    message: "Must be a YouTube or Vimeo link",
  }),
  agenda: z.array(
    z.object({ time: z.string(), title: z.string(), description: z.string() }),
  ),
  speakers: z.array(
    z.object({ name: z.string(), title: z.string(), bio: z.string(), imageUrl: z.string() }),
  ),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
});

type PageFormValues = z.infer<typeof pageFormSchema>;

// eventContent.get returns either the real doc or a plain "empty defaults"
// object (see convex/eventContent.ts emptyContent()) -- those two shapes only
// structurally share the array fields, so this normalizes both into one
// friendly optional-fields shape, same as the public page's PublicEventContent.
type OrganizerEventContent = {
  coverImageUrl?: string;
  brandColor?: string;
  ctaLabel?: string;
  videoUrl?: string;
  agenda: Doc<"eventContent">["agenda"];
  speakers: Doc<"eventContent">["speakers"];
  faqs: Doc<"eventContent">["faqs"];
};

function toFormValues(content: OrganizerEventContent): PageFormValues {
  return {
    brandColor: content.brandColor ?? "",
    ctaLabel: content.ctaLabel ?? "",
    videoUrl: content.videoUrl ?? "",
    agenda: content.agenda.map((row) => ({
      time: row.time,
      title: row.title,
      description: row.description ?? "",
    })),
    speakers: content.speakers.map((row) => ({
      name: row.name,
      title: row.title ?? "",
      bio: row.bio ?? "",
      imageUrl: row.imageUrl ?? "",
    })),
    faqs: content.faqs.map((row) => ({ question: row.question, answer: row.answer })),
  };
}

/** Repeatable agenda-row editor: time, title, description, add/remove. */
function AgendaEditor({ control }: { control: Control<PageFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "agenda" });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((row, index) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
          <div className="grid flex-1 gap-2 sm:grid-cols-[8rem_1fr]">
            <FormField
              control={control}
              name={`agenda.${index}.time`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Time</FormLabel>
                  <FormControl>
                    <Input placeholder="10:00 AM" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`agenda.${index}.title`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Doors open" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`agenda.${index}.description`}
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel className="sr-only">Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Optional description" {...field} />
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
            aria-label="Remove agenda item"
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
        onClick={() => append({ time: "", title: "", description: "" })}
      >
        <Plus /> Add agenda item
      </Button>
    </div>
  );
}

/** Repeatable speaker-row editor: name, title, bio, image URL, add/remove. */
function SpeakersEditor({ control }: { control: Control<PageFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "speakers" });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((row, index) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <FormField
              control={control}
              name={`speakers.${index}.name`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Speaker name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`speakers.${index}.title`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Title / role (optional)" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`speakers.${index}.imageUrl`}
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel className="sr-only">Image URL</FormLabel>
                  <FormControl>
                    <Input placeholder="Photo URL (optional)" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`speakers.${index}.bio`}
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel className="sr-only">Bio</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Bio (optional)" {...field} />
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
            aria-label="Remove speaker"
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
        onClick={() => append({ name: "", title: "", bio: "", imageUrl: "" })}
      >
        <Plus /> Add speaker
      </Button>
    </div>
  );
}

/** Repeatable FAQ-row editor: question, answer, add/remove. */
function FaqsEditor({ control }: { control: Control<PageFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "faqs" });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((row, index) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
          <div className="grid flex-1 gap-2">
            <FormField
              control={control}
              name={`faqs.${index}.question`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Question</FormLabel>
                  <FormControl>
                    <Input placeholder="Question" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`faqs.${index}.answer`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Answer</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Answer" {...field} />
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
            aria-label="Remove FAQ"
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
        onClick={() => append({ question: "", answer: "" })}
      >
        <Plus /> Add FAQ
      </Button>
    </div>
  );
}

/**
 * The page/branding form itself, prefilled from `initial`. Rendered only
 * once the initial values have loaded, so defaultValues are always correct
 * on mount (mirrors EventForm's edit-mode prefill / MarketingPanel's
 * TrackingPixelsForm).
 */
function EventPageForm({
  eventId,
  initial,
}: {
  eventId: Id<"events">;
  initial: OrganizerEventContent;
}) {
  const update = useMutation(api.eventContent.update);
  const setCoverImage = useMutation(api.eventContent.setCoverImage);
  const form = useForm<PageFormValues>({
    resolver: zodResolver(pageFormSchema),
    defaultValues: toFormValues(initial),
  });

  const brandColor = form.watch("brandColor");
  const coverUrl = initial.coverImageUrl;

  async function handleRemoveCover() {
    try {
      await setCoverImage({ eventId, storageId: null });
      toast.success("Cover image removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove cover image");
    }
  }

  async function onSubmit(values: PageFormValues) {
    try {
      await update({
        eventId,
        brandColor: values.brandColor,
        ctaLabel: values.ctaLabel,
        videoUrl: values.videoUrl,
        agenda: values.agenda,
        speakers: values.speakers,
        faqs: values.faqs,
      });
      toast.success("Event page updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update event page");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <FormLabel>Cover image</FormLabel>
              {coverUrl ? (
                <div className="relative overflow-hidden rounded-lg border">
                  <img src={coverUrl} alt="Cover preview" className="max-h-48 w-full object-cover" />
                  <div className="absolute right-2 top-2 flex gap-2">
                    <ImageDropzone
                      eventId={eventId}
                      label="Replace"
                      className="border-0 bg-background/80 p-2 backdrop-blur"
                      onUploaded={async (storageId) => {
                        await setCoverImage({ eventId, storageId });
                      }}
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={handleRemoveCover}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <ImageDropzone
                  eventId={eventId}
                  onUploaded={async (storageId) => {
                    await setCoverImage({ eventId, storageId });
                  }}
                />
              )}
            </div>
            <FormField
              control={form.control}
              name="brandColor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Brand color</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={isValidHexColor(brandColor.trim()) ? brandColor.trim() : "#000000"}
                        onChange={(e) => field.onChange(e.target.value)}
                        aria-label="Brand color swatch"
                        className="h-9 w-10 shrink-0 rounded-md border border-input bg-transparent p-1"
                      />
                      <Input placeholder="#1a2b3c" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ctaLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Call-to-action label</FormLabel>
                  <FormControl>
                    <Input placeholder="Register" {...field} />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agenda</CardTitle>
          </CardHeader>
          <CardContent>
            <AgendaEditor control={form.control} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Speakers</CardTitle>
          </CardHeader>
          <CardContent>
            <SpeakersEditor control={form.control} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>FAQs</CardTitle>
          </CardHeader>
          <CardContent>
            <FaqsEditor control={form.control} />
          </CardContent>
        </Card>

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-fit">
          Save page
        </Button>
      </form>
    </Form>
  );
}

/**
 * Page tab: branding + content editor for the public event page. Prefilled
 * from `eventContent.get`; a Skeleton is shown while loading and the form is
 * only mounted once the initial values are known.
 */
export function EventPagePanel({ eventId }: { eventId: Id<"events"> }) {
  const { data, isPending } = useQuery(convexQuery(api.eventContent.get, { eventId }));

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <EventPageForm eventId={eventId} initial={(data ?? { agenda: [], speakers: [], faqs: [] }) as OrganizerEventContent} />;
}
