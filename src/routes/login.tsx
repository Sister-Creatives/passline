import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthActions } from "@convex-dev/auth/react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/login")({ component: LoginPage });

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type Credentials = z.infer<typeof credentialsSchema>;

function LoginPage() {
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const { signIn } = useAuthActions();
  const navigate = useNavigate();

  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: Credentials) {
    try {
      await signIn("password", { email: values.email, password: values.password, flow });
      // The organizer row is created inside AuthGuard once the session is
      // confirmed authenticated, which avoids racing the auth token here.
      navigate({ to: "/events" });
    } catch (error) {
      toast.error(authErrorMessage(error, flow));
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold">
            {flow === "signIn" ? "Sign in to Passline" : "Create your organizer account"}
          </h1>
          <CardDescription>
            {flow === "signIn"
              ? "Sign in to manage your events."
              : "Set up an account to start creating events."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                        placeholder="At least 8 characters"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <LoaderCircle className="animate-spin" />}
                {flow === "signIn" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="link"
            className="mx-auto"
            onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
          >
            {flow === "signIn" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
