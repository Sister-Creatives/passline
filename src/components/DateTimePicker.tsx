import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Used to seed the time field the first time a date is picked on a blank form. */
const DEFAULT_TIME = "18:00";

interface DateTimePickerProps {
  /** `YYYY-MM-DDTHH:mm` (local time), or `""` when nothing is picked yet. */
  value: string;
  /** Emits the same `YYYY-MM-DDTHH:mm` (local time) format. */
  onChange: (value: string) => void;
  id?: string;
}

/**
 * Splits a `YYYY-MM-DDTHH:mm` string into a `Date` (date part only) and an
 * `HH:mm` time string. The date is built from the individual Y/M/D numbers
 * (a local-time constructor), not parsed as ISO, so no timezone conversion
 * ever happens here -- the string is local time in, local time interpretation
 * out.
 */
function splitValue(value: string): { date: Date | undefined; time: string } {
  if (!value) {
    return { date: undefined, time: "" };
  }
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return { date, time: timePart ?? "" };
}

/**
 * Combines a date and an `HH:mm` string into `YYYY-MM-DDTHH:mm`, reading the
 * date back out via the local getters (`getFullYear`/`getMonth`/`getDate`)
 * rather than `toISOString`. `toISOString` normalizes to UTC, which would
 * shift the calendar day for any timezone offset -- exactly the drift this
 * component must avoid to keep the existing `datetime-local` string contract.
 */
function combine(date: Date, time: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}T${time}`;
}

/**
 * shadcn-composed date + time picker that stands in for a native
 * `datetime-local` input while keeping its exact `YYYY-MM-DDTHH:mm`
 * (local-time) string contract: a `Popover` + `Calendar` for the date, and a
 * plain `time` `Input` for the time, recombined on every change.
 */
export function DateTimePicker({ value, onChange, id }: DateTimePickerProps) {
  const { date, time } = splitValue(value);
  const timeId = id ? `${id}-time` : undefined;

  function handleDateChange(nextDate: Date | undefined) {
    if (!nextDate) {
      onChange("");
      return;
    }
    onChange(combine(nextDate, time || DEFAULT_TIME));
  }

  function handleTimeChange(nextTime: string) {
    // No date chosen yet: there is nowhere to store a time-only value inside
    // the `YYYY-MM-DDTHH:mm` contract, so only recombine once a date exists.
    // The time input stays disabled until then (see below), so this is only
    // reachable once `date` is set.
    if (!date || !nextTime) {
      return;
    }
    onChange(combine(date, nextTime));
  }

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon />
            {date ? format(date, "PP") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={date} onSelect={handleDateChange} />
        </PopoverContent>
      </Popover>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={timeId} className="sr-only">
          Time
        </Label>
        <Input
          id={timeId}
          type="time"
          value={date ? time || DEFAULT_TIME : ""}
          disabled={!date}
          onChange={(event) => handleTimeChange(event.target.value)}
          className="w-[120px]"
        />
      </div>
    </div>
  );
}
