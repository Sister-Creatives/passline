// src/lib/attendees.ts
export type AttendeeBucket = "confirmed" | "pending" | "waitlist" | "checkedIn";
export type AttendeeStatusFilter = "all" | AttendeeBucket;

export interface MergedAttendee {
  _id: string;
  name: string;
  email: string;
  token: string;
  bucket: AttendeeBucket;
  checkedInAt?: number;
}

export interface AttendeePage {
  rows: MergedAttendee[];
  page: number;
  pageCount: number;
  total: number;
}

/** Filter by status bucket + name/email search, then slice to a page. Pure. */
export function filterAndPaginate(
  attendees: MergedAttendee[],
  opts: { status: AttendeeStatusFilter; search: string; page: number; pageSize: number },
): AttendeePage {
  const search = opts.search.trim().toLowerCase();
  const filtered = attendees.filter((a) => {
    if (opts.status !== "all" && a.bucket !== opts.status) return false;
    if (search && !`${a.name} ${a.email}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pageCount);
  const start = (page - 1) * opts.pageSize;
  return { rows: filtered.slice(start, start + opts.pageSize), page, pageCount, total };
}
