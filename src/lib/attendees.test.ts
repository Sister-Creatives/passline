// src/lib/attendees.test.ts
import { expect, test } from "vitest";
import { filterAndPaginate, type MergedAttendee } from "./attendees";

function make(n: number): MergedAttendee[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: String(i), name: `Person ${i}`, email: `p${i}@example.com`, token: `t${i}`,
    bucket: i % 2 === 0 ? ("confirmed" as const) : ("waitlist" as const),
  }));
}

test("paginates with page size and reports page count", () => {
  const res = filterAndPaginate(make(25), { status: "all", search: "", page: 1, pageSize: 10 });
  expect(res.total).toBe(25);
  expect(res.pageCount).toBe(3);
  expect(res.rows).toHaveLength(10);
});

test("filters by bucket", () => {
  const res = filterAndPaginate(make(10), { status: "waitlist", search: "", page: 1, pageSize: 10 });
  expect(res.total).toBe(5);
  expect(res.rows.every((r) => r.bucket === "waitlist")).toBe(true);
});

test("search matches name or email, case-insensitive", () => {
  const res = filterAndPaginate(make(10), { status: "all", search: "PERSON 3", page: 1, pageSize: 10 });
  expect(res.total).toBe(1);
  expect(res.rows[0]?.name).toBe("Person 3");
});

test("clamps an out-of-range page to the last page", () => {
  const res = filterAndPaginate(make(25), { status: "all", search: "", page: 99, pageSize: 10 });
  expect(res.page).toBe(3);
  expect(res.rows).toHaveLength(5);
});

test("empty result yields pageCount 1 and no rows", () => {
  const res = filterAndPaginate(make(10), { status: "all", search: "nobody", page: 1, pageSize: 10 });
  expect(res.total).toBe(0);
  expect(res.pageCount).toBe(1);
  expect(res.rows).toHaveLength(0);
});
