import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { permissions, staffProfiles, users } from "../drizzle/schema";
import { permissionCatalog } from "./smis";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; bootstrap uses only the real administrator identity supplied by the environment.`);
  return value;
}

async function main() {
  const openId = required("NEXUS_SEED_OPEN_ID");
  const username = required("NEXUS_SEED_USERNAME");
  const name = required("NEXUS_SEED_NAME");
  const email = required("NEXUS_SEED_EMAIL");
  const password = required("NEXUS_SEED_PASSWORD");
  if (openId.length > 64 || username.length > 120 || name.length > 200 || email.length > 320) {
    throw new Error("One or more administrator identity fields exceed the NEXUS schema limits.");
  }
  if (password.length < 12) throw new Error("NEXUS_SEED_PASSWORD must contain at least 12 characters.");

  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await db.transaction(async tx => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
    if (existing.length) return { id: existing[0].id, created: false };

    const usernameOwner = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (usernameOwner.length) throw new Error("NEXUS_SEED_USERNAME is already assigned to a different account.");

    const inserted = await tx.insert(users).values({
      openId,
      username,
      name,
      email,
      passwordHash,
      loginMethod: "iam",
      role: "admin",
      accountStatus: "active",
      mustChangePassword: 1,
    }).$returningId();
    const userId = inserted[0].id;

    await tx.insert(staffProfiles).values({ userId, displayName: name, role: "super_admin", status: "active" });
    for (const [permissionKey, description] of permissionCatalog) {
      const found = await tx.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, permissionKey)).limit(1);
      if (!found.length) await tx.insert(permissions).values({ permissionKey, description });
    }
    return { id: userId, created: true };
  });

  console.info(result.created
    ? `Initial administrator account created (user ID ${result.id}); no school or learner data was added.`
    : `Administrator account ${result.id} already exists; no account or school data was changed.`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
