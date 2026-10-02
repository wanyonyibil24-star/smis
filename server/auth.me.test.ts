import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { safeAuthProfile } from "./iam";
import type { TrpcContext } from "./_core/context";

describe("auth.me", () => {
  it("returns a safe profile without credential or account-security internals", async () => {
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "owner-private-id",
        username: "erickology",
        name: "School Administrator",
        email: "admin@example.com",
        passwordHash: "$2b$12$private-hash",
        accountStatus: "active",
        failedLoginAttempts: 0,
        accountLocked: 0,
        mustChangePassword: 0,
        passwordChangedAt: new Date(),
        loginMethod: "iam",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const profile = await appRouter.createCaller(ctx).auth.me();
    expect(profile).toMatchObject({ id: 1, username: "erickology", role: "admin" });
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile).not.toHaveProperty("openId");
    expect(profile).not.toHaveProperty("failedLoginAttempts");
    expect(profile).not.toHaveProperty("accountLocked");
    expect(safeAuthProfile(ctx.user)).toEqual(profile);
  });
});
