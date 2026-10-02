import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { auditLogs, iamPasswordResets, iamSessions, users, type User } from "../drizzle/schema";
import type { Request, Response } from "express";

export const IAM_COOKIE_NAME = "nexus_iam_session";
const MAX_FAILED_LOGINS = 5;
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export function safeAuthProfile(user: User | null) {
  return user ? {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    loginMethod: user.loginMethod,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
  } : null;
}

type LoginInput = { identifier: string; password: string };

function cookieOptions() {
  return { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", maxAge: SESSION_MAX_AGE_MS };
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getCookie(req: Request) {
  const value = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${IAM_COOKIE_NAME}=`));
  return value ? decodeURIComponent(value.slice(IAM_COOKIE_NAME.length + 1)) : null;
}

async function audit(userId: number | null, action: string, metadata: Record<string, unknown>, req: Request) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({ userId, action, entityType: "iam", entityId: userId == null ? null : String(userId), metadata: JSON.stringify(metadata) });
}

export async function authenticateIamRequest(req: Request) {
  const token = getCookie(req);
  if (!token) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ session: iamSessions, user: users }).from(iamSessions).innerJoin(users, eq(users.id, iamSessions.userId)).where(and(eq(iamSessions.sessionHash, tokenHash(token)), eq(iamSessions.status, "active"))).limit(1);
  const row = rows[0];
  if (!row || row.user.accountStatus !== "active" || row.user.accountLocked) return null;
  return row.user;
}

export async function loginWithIam(input: LoginInput, req: Request, res: Response) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const identifier = input.identifier.trim().toLowerCase();
  const row = (await db.select().from(users).where(or(eq(users.username, identifier), eq(users.email, identifier))).limit(1))[0];
  if (!row || !row.passwordHash) {
    await audit(null, "IAM_LOGIN_FAILED", { reason: "invalid_credentials" }, req);
    throw new Error("INVALID_CREDENTIALS");
  }
  if (row.accountStatus === "disabled" || row.accountStatus === "pending_activation") throw new Error("ACCOUNT_DISABLED");
  if (row.accountLocked) throw new Error("ACCOUNT_LOCKED");
  const valid = await bcrypt.compare(input.password, row.passwordHash);
  if (!valid) {
    const failed = row.failedLoginAttempts + 1;
    await db.update(users).set({ failedLoginAttempts: failed, accountLocked: failed >= MAX_FAILED_LOGINS ? 1 : 0, accountStatus: failed >= MAX_FAILED_LOGINS ? "locked" : row.accountStatus }).where(eq(users.id, row.id));
    await audit(row.id, failed >= MAX_FAILED_LOGINS ? "IAM_ACCOUNT_LOCKED" : "IAM_LOGIN_FAILED", { attempts: failed }, req);
    throw new Error(failed >= MAX_FAILED_LOGINS ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS");
  }
  const token = crypto.randomBytes(48).toString("base64url");
  await db.update(users).set({ failedLoginAttempts: 0, accountLocked: 0, lastSignedIn: new Date() }).where(eq(users.id, row.id));
  await db.insert(iamSessions).values({ userId: row.id, sessionHash: tokenHash(token), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
  res.cookie(IAM_COOKIE_NAME, token, cookieOptions());
  await audit(row.id, "IAM_LOGIN_SUCCESS", {}, req);
  return safeAuthProfile(row);
}

export async function logoutIam(req: Request, res: Response) {
  const token = getCookie(req);
  const db = await getDb();
  if (db && token) await db.update(iamSessions).set({ status: "revoked", logoutAt: new Date() }).where(eq(iamSessions.sessionHash, tokenHash(token)));
  res.clearCookie(IAM_COOKIE_NAME, cookieOptions());
}

export async function changeIamPassword(userId: number, currentPassword: string, newPassword: string, req: Request) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new Error("INVALID_CURRENT_PASSWORD");
  if (newPassword.length < 10) throw new Error("PASSWORD_TOO_SHORT");
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: 0, passwordChangedAt: new Date() }).where(eq(users.id, userId));
  await audit(userId, "IAM_PASSWORD_CHANGED", {}, req);
}

export async function adminResetIamPassword(targetUserId: number, actorUserId: number, req: Request) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const target = (await db.select().from(users).where(eq(users.id, targetUserId)).limit(1))[0];
  if (!target) throw new Error("USER_NOT_FOUND");
  const temporaryPassword = `Nexus-${crypto.randomBytes(8).toString("base64url")}`;
  await db.update(users).set({ passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: 1, accountLocked: 0, failedLoginAttempts: 0, accountStatus: "active" }).where(eq(users.id, targetUserId));
  await db.update(iamSessions).set({ status: "revoked", logoutAt: new Date() }).where(and(eq(iamSessions.userId, targetUserId), eq(iamSessions.status, "active")));
  await audit(actorUserId, "IAM_ADMIN_PASSWORD_RESET", { targetUserId }, req);
  return { temporaryPassword };
}

export async function requestIamPasswordReset(identifier: string, req: Request) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const normalized = identifier.trim().toLowerCase();
  const user = (await db.select().from(users).where(or(eq(users.username, normalized), eq(users.email, normalized))).limit(1))[0];
  // Always return the same public result so usernames cannot be enumerated.
  if (!user || user.accountStatus === "disabled") return { accepted: true } as const;
  const token = crypto.randomBytes(48).toString("base64url");
  await db.insert(iamPasswordResets).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  await audit(user.id, "IAM_PASSWORD_RESET_REQUESTED", {}, req);
  // Delivery is intentionally not logged or returned; connect this token to the configured mail/SMS provider.
  return { accepted: true } as const;
}

export async function resetIamPassword(token: string, newPassword: string, req: Request) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (newPassword.length < 10) throw new Error("PASSWORD_TOO_SHORT");
  const reset = (await db.select().from(iamPasswordResets).where(and(eq(iamPasswordResets.tokenHash, tokenHash(token)))).limit(1))[0];
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) throw new Error("INVALID_OR_EXPIRED_RESET");
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: 0, passwordChangedAt: new Date(), accountLocked: 0, failedLoginAttempts: 0, accountStatus: "active" }).where(eq(users.id, reset.userId));
  await db.update(iamPasswordResets).set({ usedAt: new Date() }).where(eq(iamPasswordResets.id, reset.id));
  await db.update(iamSessions).set({ status: "revoked", logoutAt: new Date() }).where(and(eq(iamSessions.userId, reset.userId), eq(iamSessions.status, "active")));
  await audit(reset.userId, "IAM_PASSWORD_RESET_COMPLETED", {}, req);
}
