import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const base = { id: 1, openId: "test", name: "Test", email: "test@example.com", loginMethod: "test", username: "wanyonyibil24", active: true, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

function context(role: "super_admin" | "teacher" | "user"): TrpcContext {
  return { user: { ...base, role }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("NEXUS role protection", () => {
  it("permits Super Admin through the admin guard", async () => {
    const caller = appRouter.createCaller(context("super_admin"));
    await expect(caller.users.list()).resolves.toBeInstanceOf(Array);
  });

  it("denies teachers from user administration before database access", async () => {
    const caller = appRouter.createCaller(context("teacher"));
    await expect(caller.users.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies unauthenticated dashboard access", async () => {
    const ctx = context("user");
    ctx.user = null;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.summary()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
