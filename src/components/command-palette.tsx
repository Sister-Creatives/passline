"use client";
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { CalendarIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
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

  const { data: events } = useQuery(convexQuery(api.events.listMyEvents, {}));

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search events, pages, actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => run(() => navigate({ to: createAction.path as string }))}>
              {createAction.icon}
              <span>Create event</span>
            </CommandItem>
          </CommandGroup>
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
                onSelect={() => run(() => navigate({ to: item.path as string }))}
              >
                {item.icon}
                <span>{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          {events && events.length > 0 && (
            <CommandGroup heading="Events">
              {events.slice(0, 20).map((e) => (
                <CommandItem
                  key={e._id}
                  value={"event " + e.title}
                  onSelect={() =>
                    run(() => navigate({ to: "/events/$id", params: { id: e._id } }))
                  }
                >
                  <CalendarIcon />
                  <span className="truncate">{e.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
