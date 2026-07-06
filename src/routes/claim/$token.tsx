import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";

// PUBLIC route: no AuthGuard. This is the claim link emailed to an attendee
// auto-promoted off the waitlist; it must work with no account.
export const Route = createFileRoute("/claim/$token")({ component: ClaimPage });

type ClaimState = "pending" | "confirmed" | "expired";

function ClaimPage() {
  const { token } = Route.useParams();
  const claimSpot = useMutation(api.rsvps.claimSpot);
  const [state, setState] = useState<ClaimState>("pending");
  // Guards against calling claimSpot more than once per mount (e.g. React
  // Strict Mode's double-invoked effects in development) -- claiming is a
  // one-time side effect, not something to repeat on re-render.
  const hasClaimedRef = useRef(false);

  useEffect(() => {
    if (hasClaimedRef.current) return;
    hasClaimedRef.current = true;
    claimSpot({ token })
      .then((result) => setState(result.status))
      .catch(() => setState("expired"));
  }, [token, claimSpot]);

  const content =
    state === "pending"
      ? {
          icon: null,
          title: "Confirming your spot…",
          message: null as string | null,
        }
      : state === "confirmed"
        ? {
            icon: <Check className="size-10 text-primary" aria-hidden="true" />,
            title: "Spot confirmed",
            message: "You are all set. See you at the event.",
          }
        : {
            icon: <X className="size-10 text-destructive" aria-hidden="true" />,
            title: "This claim link has expired",
            message: "The claim window closed before you confirmed. Contact the organizer for help.",
          };

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      {content.icon}
      <h1 className="text-2xl font-semibold">{content.title}</h1>
      {content.message && <p className="text-sm text-muted-foreground">{content.message}</p>}
    </div>
  );
}
