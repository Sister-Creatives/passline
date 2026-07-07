import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const rsvpFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Enter a valid email address"),
});

type RsvpFormValues = z.infer<typeof rsvpFormSchema>;

interface RsvpFormProps {
  slug: string;
  /** When the event is at capacity, the form collects a waitlist join instead. */
  isFull: boolean;
}

/**
 * Public RSVP form for the event page. Submits `api.rsvps.rsvp`, toasts the
 * result (confirmed vs. waitlisted), then routes the attendee to their
 * ticket/confirmation page keyed by the returned token.
 */
export function RsvpForm({ slug, isFull }: RsvpFormProps) {
  const navigate = useNavigate();
  const rsvp = useMutation(api.rsvps.rsvp);

  const form = useForm<RsvpFormValues>({
    resolver: zodResolver(rsvpFormSchema),
    defaultValues: { name: "", email: "" },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: RsvpFormValues) {
    try {
      const result = await rsvp({ slug, name: values.name, email: values.email });
      // A repeat RSVP is deduped server-side and returns the existing ticket, so the
      // status may be any non-cancelled state. Only a fresh waitlist entry carries a
      // position; every seat-holding status (confirmed / pending claim / checked in)
      // gets the positive message.
      if (result.status === "waitlisted") {
        toast.success(`You are #${result.waitlistPosition} on the waitlist`);
      } else {
        toast.success("You are confirmed");
      }
      navigate({ to: "/rsvp/$token", params: { token: result.token } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to RSVP");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Your name" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" />}
          {isFull ? "Join the waitlist" : "RSVP"}
        </Button>
      </form>
    </Form>
  );
}
