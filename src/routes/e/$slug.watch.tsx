import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LoaderCircle } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { VirtualHubView, type VirtualHubViewData } from "@/components/VirtualHubView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// PUBLIC route: no AuthGuard. This is the password-gated entry point for
// visitors who aren't ticket holders (ticket holders use their order link,
// /orders/$token, instead) -- see F14 spec §5.
export const Route = createFileRoute("/e/$slug/watch")({ component: WatchPage });

const passwordFormSchema = z.object({
  password: z.string().min(1, "Enter the access password"),
});

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function WatchPage() {
  const { slug } = Route.useParams();
  const convex = useConvex();
  const [hub, setHub] = useState<VirtualHubViewData | null>(null);
  const [denied, setDenied] = useState(false);

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "" },
  });

  // getWithPassword is a read-only query, not a mutation -- there's no state
  // to change on the server, just a one-off "does this password unlock the
  // hub" check, so it's called imperatively via the Convex client rather
  // than wired up as a reactive subscription.
  async function onSubmit(values: PasswordFormValues) {
    setDenied(false);
    try {
      const result = await convex.query(api.virtualHub.getWithPassword, {
        slug,
        password: values.password,
      });
      if (result) {
        setHub(result as VirtualHubViewData);
      } else {
        setDenied(true);
      }
    } catch {
      setDenied(true);
    }
  }

  if (hub) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <VirtualHubView hub={hub} />
      </div>
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Watch online</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the event's access password to view the virtual hub.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="off" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isSubmitting} className="w-fit">
            {isSubmitting && <LoaderCircle className="animate-spin" />}
            Watch
          </Button>
        </form>
      </Form>

      {denied && !isSubmitting && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Incorrect password</EmptyTitle>
            <EmptyDescription>
              Check the password and try again, or use the link from your order confirmation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
