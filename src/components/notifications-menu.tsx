"use client";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { BellIcon, CalendarPlusIcon, UserMinusIcon, CircleCheckIcon, ClockIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICONS = {
  rsvp: CalendarPlusIcon,
  waitlist: ClockIcon,
  sold_out: CircleCheckIcon,
  cancellation: UserMinusIcon,
} as const;

export function NotificationsMenu() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useQuery(convexQuery(api.notifications.list, {}));
  const { data: unread = 0 } = useQuery(convexQuery(api.notifications.unreadCount, {}));
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  function openNotification(n: Doc<"notifications">) {
    if (!n.read) void markRead({ notificationId: n._id });
    if (n.eventId) {
      void navigate({ to: "/events/$id", params: { id: n.eventId }, search: { section: "attendees" } });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Notifications" size="icon-sm" variant="ghost" className="relative text-muted-foreground">
          <BellIcon />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void markAllRead({})}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            notifications.map((n) => {
              const Icon = ICONS[n.type];
              return (
                <button
                  key={n._id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className="flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left last:border-0 hover:bg-accent"
                >
                  <span className="mt-0.5 text-muted-foreground"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      {!n.read ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
