"use client";
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";
import { CalendarIcon, SearchXIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { primaryNav, createAction, settingsGroup } from "@/components/app-shared";

const CommandPaletteContext = React.createContext<{
  open: boolean;
  setOpen: (o: boolean) => void;
} | null>(null);

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

const MAX_EVENTS = 50;

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Only fetch the event list while the palette is open -- there's no reason to
  // keep this query live behind a closed dialog on every page.
  const { data: events } = useQuery({
    ...convexQuery(api.events.listMyEvents, {}),
    enabled: open,
  });
  const eventsLoading = open && events === undefined;

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-xl">
        <CommandInput placeholder="Search events, pages, and actions…" />
        <CommandList>
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              <SearchXIcon className="size-6 opacity-60" />
              <p className="text-sm">No results found.</p>
            </div>
          </CommandEmpty>

          <CommandGroup heading="Actions">
            <CommandItem
              value="Create event new"
              onSelect={() => run(() => navigate({ to: createAction.path as string }))}
            >
              {createAction.icon}
              <span>Create event</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Go to">
            {primaryNav.map((item) => (
              <CommandItem
                key={item.path}
                value={item.title}
                onSelect={() => run(() => navigate({ to: item.path as string }))}
              >
                {item.icon}
                <span>{item.title}</span>
              </CommandItem>
            ))}
            {settingsGroup.items.map((item) => (
              <CommandItem
                key={item.path}
                value={"Settings " + item.title}
                keywords={["settings"]}
                onSelect={() => run(() => navigate({ to: item.path as string }))}
              >
                {item.icon}
                <span>{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {/* Loading rows live outside a CommandGroup: cmdk hides a group with
              no registered items, which would swallow the skeletons. */}
          {eventsLoading ? (
            <div className="p-1">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Events</div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-10" />
                </div>
              ))}
            </div>
          ) : (events ?? []).length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Events">
                {events!.slice(0, MAX_EVENTS).map((e) => (
                  <CommandItem
                    key={e._id}
                    // Include the id so duplicate titles stay distinct, and add
                    // the location as a keyword so it's searchable too.
                    value={`${e.title} ${e._id}`}
                    keywords={[e.location]}
                    onSelect={() =>
                      run(() => navigate({ to: "/events/$id", params: { id: e._id } }))
                    }
                  >
                    <CalendarIcon />
                    <span className="truncate">{e.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                      {e.status === "draft" ? (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          Draft
                        </span>
                      ) : null}
                      {e.startsAt ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {format(new Date(e.startsAt), "MMM d")}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>

        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="ml-0.5">Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span className="ml-0.5">Open</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            <span className="ml-0.5">Close</span>
          </span>
        </div>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
