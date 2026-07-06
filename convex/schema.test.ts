// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

// convex-test's default module discovery walks up from its own package
// location inside node_modules to find a sibling "convex" directory. Under
// pnpm's symlinked, nested node_modules layout that walk does not land on
// this project's convex/ directory, so the modules map is passed explicitly
// per the convex-test docs (see convexTest's JSDoc for `modules`).
const modules = import.meta.glob("./**/*.*s");

test("can insert an event row", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizers", {
      name: "Ada",
      email: "ada@example.com",
    });
    return ctx.db.insert("events", {
      organizerId: orgId,
      title: "Rooftop Jazz",
      description: "Live jazz.",
      startsAt: 1,
      endsAt: 2,
      location: "Rooftop",
      capacity: 80,
      status: "draft",
      slug: "rooftop-jazz",
    });
  });
  expect(id).toBeTruthy();
});
