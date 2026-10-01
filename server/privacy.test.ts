import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function anonymousCaller() {
  const ctx: TrpcContext = {
    user: null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("SMIS privacy boundaries", () => {
  it.each([
    ["dashboard snapshot", (caller: ReturnType<typeof anonymousCaller>) => caller.smis.snapshot()],
    ["published notifications", (caller: ReturnType<typeof anonymousCaller>) => caller.smis.notifications.list()],
    ["alumni records", (caller: ReturnType<typeof anonymousCaller>) => caller.smis.alumni.list()],
    ["school settings", (caller: ReturnType<typeof anonymousCaller>) => caller.smis.settings.get()],
  ])("blocks anonymous access to %s", async (_name, invoke) => {
    await expect(invoke(anonymousCaller())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps the non-sensitive health probe public", async () => {
    await expect(anonymousCaller().smis.health()).resolves.toMatchObject({
      ok: true,
      service: "kenyan-smis",
    });
  });
});
