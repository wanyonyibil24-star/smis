import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { auditLogs, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const isOwner = user.openId === ENV.ownerOpenId;
  const values: InsertUser = {
    openId: user.openId,
    username: isOwner ? "wanyonyibil24" : user.username,
    name: user.name,
    email: user.email,
    loginMethod: user.loginMethod,
    role: isOwner ? "super_admin" : user.role ?? "user",
    active: true,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };

  await db.insert(users).values(values).onDuplicateKeyUpdate({
    set: {
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      lastSignedIn: values.lastSignedIn,
      ...(isOwner ? { username: "wanyonyibil24", role: "super_admin" as const, active: true } : {}),
    },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function logAudit(input: {
  userId?: number | null;
  action: string;
  module: string;
  recordId?: string | null;
  details?: string;
  confirmed?: boolean;
  success?: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    userId: input.userId ?? null,
    action: input.action,
    module: input.module,
    recordId: input.recordId ?? null,
    details: input.details ?? null,
    confirmed: input.confirmed ?? false,
    success: input.success ?? true,
  });
}
