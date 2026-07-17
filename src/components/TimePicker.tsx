import * as React from "react";
import { ClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

type TimePickerProps = {
  /** `HH:mm` (24h), or `""` when nothing is picked yet. */
  value: string;
  /** Emits the same `HH:mm` (24h) format, always fully populated. */
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
} & Omit<
  React.ComponentPropsWithoutRef<typeof Button>,
  "value" | "onChange" | "type" | "children"
>;

/**
 * shadcn-composed time picker that replaces the native `<input type="time">`
 * so the control matches the rest of the app instead of the OS picker. Built
 * from a `Popover` + `Button` trigger and two scrollable hour/minute columns,
 * with the current selection highlighted in the app's primary colour.
 */
export const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(
  function TimePicker(
    { value, onChange, disabled, placeholder = "Set time", className, id, ...rest },
    ref,
  ) {
    const [open, setOpen] = React.useState(false);
    const [hour, minute] = value ? value.split(":") : ["", ""];

    function selectHour(nextHour: string) {
      onChange(`${nextHour}:${minute || "00"}`);
    }

    function selectMinute(nextMinute: string) {
      onChange(`${hour || "00"}:${nextMinute}`);
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            {...rest}
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "justify-between font-normal tabular-nums",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {value || placeholder}
            <ClockIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="flex divide-x divide-border">
            <TimeColumn
              label="Hour"
              options={HOURS}
              selected={hour}
              open={open}
              onSelect={selectHour}
            />
            <TimeColumn
              label="Minute"
              options={MINUTES}
              selected={minute}
              open={open}
              onSelect={selectMinute}
            />
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);

function TimeColumn({
  label,
  options,
  selected,
  open,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  open: boolean;
  onSelect: (value: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const selectedRef = React.useRef<HTMLButtonElement>(null);

  // On open, scroll the current selection to the middle of its column so the
  // list starts centred on what's already chosen (like the native picker),
  // adjusting only the column's own scroll -- never the page or the popover.
  React.useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const target = selectedRef.current;
    if (!container || !target) return;
    container.scrollTop =
      target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
  }, [open]);

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={label}
      className="relative flex max-h-56 w-16 flex-col gap-0.5 overflow-y-auto p-1 [scrollbar-width:thin]"
    >
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <button
            key={option}
            ref={isSelected ? selectedRef : undefined}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(option)}
            className={cn(
              "flex h-8 shrink-0 items-center justify-center rounded-md text-sm tabular-nums transition-colors outline-none",
              "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground active:bg-accent active:text-accent-foreground",
              isSelected
                ? "bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground active:bg-primary/90"
                : "text-foreground",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
