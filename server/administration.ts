import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { Request } from "express";
import { getDb } from "./db";
import { auditLogs, grades, iamPasswordResets, iamSessions, rolePermissions, staffProfiles, subjects, teacherAllocations, userPermissions, users } from "../drizzle/schema";
import { ACTIONS, ASSIGNABLE_ROLES, MANAGE_PERMISSIONS, MATRIX_KEYS, MODULES, ROLE_LABELS, computePermissions, getAccessProfile, permissionRole, roleMatrix, type StaffRole } from "./access";
import { getSettings, saveTeacherAllocation, writeAudit } from "./smis";

export class AdminError extends Error {}
const fail = (code: string): never => { throw new AdminError(code); };
async function requireDb() { const db = await getDb(); if (!db) throw new Error("DATABASE_UNAVAILABLE"); return db; }

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const clientMeta = (req?: Request) => (req ? { ip: req.ip ?? null, userAgent: (req.get("user-agent") ?? "").slice(0, 160) } : {});
const SECRET_KEYS = /pass|hash|token|secret/i;
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.test(k)));

async function audit(actorId: number, action: string, targetUserId: number | null, details: Record<string, unknown>, req?: Request) {
  await writeAudit(actorId, action, "user", targetUserId, { ...clean(details), ...clientMeta(req) });
}

type AccountState = "active" | "suspended" | "locked" | "pending";
const stateOf = (u: { accountStatus: string; accountLocked: number }): AccountState =>
  u.accountLocked || u.accountStatus === "locked" ? "locked" : u.accountStatus === "disabled" ? "suspended" : u.accountStatus === "pending_activation" ? "pending" : "active";

/* ------------------------------------------------------------------ Register */

export async function adminCatalog() {
  const db = await requireDb();
  const settings = await getSettings();
  return {
    roles: ASSIGNABLE_ROLES.map(value => ({ value, label: ROLE_LABELS[value] })),
    grades: (await db.select().from(grades).orderBy(grades.name)).map(g => ({ id: g.id, name: `${g.name}${g.stream ? ` ${g.stream}` : ""}` })),
    subjects: await db.select({ id: subjects.id, name: subjects.name, code: subjects.code }).from(subjects).orderBy(subjects.name),
    academicYear: settings.academicYear, term: settings.currentTerm,
    departments: Array.from(new Set((await db.select({ d: staffProfiles.department }).from(staffProfiles)).map(r => r.d).filter(Boolean))) as string[],
  };
}

async function assignmentsByUser(userIds?: number[]) {
  const db = await requireDb();
  const rows = await db.select({ a: teacherAllocations, g: grades, s: subjects }).from(teacherAllocations)
    .leftJoin(grades, eq(grades.id, teacherAllocations.gradeId)).leftJoin(subjects, eq(subjects.id, teacherAllocations.subjectId))
    .where(and(eq(teacherAllocations.status, "active"), userIds?.length ? inArray(teacherAllocations.teacherUserId, userIds) : undefined));
  const map = new Map<number, { classes: { gradeId: number; name: string; type: string }[]; subjects: { id: number; name: string; gradeId: number }[] }>();
  for (const { a, g, s } of rows) {
    const entry = map.get(a.teacherUserId) ?? { classes: [], subjects: [] };
    const gradeName = g ? `${g.name}${g.stream ? ` ${g.stream}` : ""}` : "";
    if (a.allocationType === "class_teacher") entry.classes.push({ gradeId: a.gradeId, name: gradeName, type: "class_teacher" });
    else if (s) entry.subjects.push({ id: s.id, name: `${s.name}${gradeName ? ` (${gradeName})` : ""}`, gradeId: a.gradeId });
    map.set(a.teacherUserId, entry);
  }
  return map;
}

export async function listAdminUsers(filter: { search?: string; role?: string; status?: AccountState } = {}) {
  const db = await requireDb();
  const rows = await db.select({
    id: users.id, username: users.username, name: users.name, email: users.email, accountStatus: users.accountStatus, accountLocked: users.accountLocked,
    passwordChangedAt: users.passwordChangedAt, createdAt: users.createdAt, accountRole: users.role,
    profileId: staffProfiles.id, displayName: staffProfiles.displayName, staffId: staffProfiles.staffId, department: staffProfiles.department, role: staffProfiles.role, phone: staffProfiles.phone,
  }).from(users).leftJoin(staffProfiles, eq(staffProfiles.userId, users.id)).orderBy(users.id);
  const logins = new Map((await db.select({ userId: iamSessions.userId, last: sql<Date>`max(${iamSessions.loginAt})` }).from(iamSessions).groupBy(iamSessions.userId)).map(r => [r.userId, r.last]));
  const assignments = await assignmentsByUser();
  const term = filter.search?.trim().toLowerCase();
  return rows.map(r => {
    const role = (r.role ?? "other") as StaffRole;
    const a = assignments.get(r.id);
    return {
      userId: r.id, staffProfileId: r.profileId, fullName: r.displayName ?? r.name ?? r.username ?? `User ${r.id}`, username: r.username, email: r.email, phone: r.phone,
      staffId: r.staffId, role, roleLabel: ROLE_LABELS[role], department: r.department, classes: a?.classes ?? [], subjects: a?.subjects ?? [],
      status: stateOf(r), lastLogin: logins.get(r.id) ? new Date(logins.get(r.id)!) : null, passwordChangedAt: r.passwordChangedAt, createdAt: r.createdAt,
    };
  }).filter(u => (!filter.role || permissionRole(u.role) === filter.role) && (!filter.status || u.status === filter.status)
    && (!term || [u.fullName, u.username, u.staffId, u.department, u.roleLabel, u.email].some(v => v?.toLowerCase().includes(term))));
}

export async function getAdminUser(userId: number) {
  const row = (await listAdminUsers()).find(u => u.userId === userId);
  if (!row) return fail("USER_NOT_FOUND");
  const db = await requireDb();
  const sessions = await db.select({ loginAt: iamSessions.loginAt, logoutAt: iamSessions.logoutAt, ipAddress: iamSessions.ipAddress, status: iamSessions.status }).from(iamSessions).where(eq(iamSessions.userId, userId)).orderBy(desc(iamSessions.loginAt)).limit(5);
  return { ...row, recentSessions: sessions, effectivePermissions: await computePermissions(userId, (await db.select({ r: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0]?.r ?? "user") };
}

/* ------------------------------------------------------------------- Guards */

type Actor = { id: number };
async function actorRole(actor: Actor) { return (await getAccessProfile(actor.id)).role; }
async function hasManagePermissions(role: string) { return (await roleMatrix(role)).has(MANAGE_PERMISSIONS); }

async function assertCanManage(actor: Actor, targetUserId: number) {
  const db = await requireDb();
  if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1))[0]) fail("USER_NOT_FOUND");
  const target = await getAccessProfile(targetUserId);
  const manager = await getAccessProfile(actor.id);
  if (target.level === "system" && manager.level !== "system") fail("ONLY_SUPER_ADMIN_MANAGES_SUPER_ADMIN");
  return target.role;
}
async function activePermissionManagers() {
  const active = await listAdminUsers({ status: "active" });
  const managers = [];
  for (const user of active) if (await hasManagePermissions(user.role)) managers.push(user);
  return managers;
}
async function assertNotLastPermissionManager(targetUserId: number) {
  const managers = await activePermissionManagers();
  if (managers.length <= 1 && managers[0]?.userId === targetUserId) fail("LAST_SUPER_ADMIN_PROTECTED");
}

export function assertStrongPassword(password: string) {
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) fail("PASSWORD_TOO_WEAK");
}

/* ------------------------------------------------------------------- Create */

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,59}$/;
export type CreateUserInput = { fullName: string; username: string; staffId: string; role: (typeof ASSIGNABLE_ROLES)[number]; department?: string | null; email?: string | null; phone?: string | null; classGradeId?: number | null; subjectAllocations?: { gradeId: number; subjectId: number }[]; status: "active" | "pending_activation" | "disabled" };

async function assertUnique(input: { username?: string; staffId?: string | null }, exceptUserId?: number) {
  const db = await requireDb();
  if (input.username) {
    const hit = (await db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).limit(1))[0];
    if (hit && hit.id !== exceptUserId) fail("USERNAME_TAKEN");
  }
  if (input.staffId) {
    const hit = (await db.select({ userId: staffProfiles.userId }).from(staffProfiles).where(eq(staffProfiles.staffId, input.staffId)).limit(1))[0];
    if (hit && hit.userId !== exceptUserId) fail("STAFF_ID_TAKEN");
  }
}

async function nextTeacherCode() {
  const db = await requireDb();
  return Number((await db.select({ m: sql<number>`coalesce(max(${staffProfiles.teacherCode}), 0)` }).from(staffProfiles))[0]?.m ?? 0) + 1;
}

/** Replaces the user's active class/subject allocations using the existing allocation rules (conflict checks included). */
async function applyAssignments(actorId: number, userId: number, role: string, classGradeId: number | null | undefined, subjectAllocations: { gradeId: number; subjectId: number }[] | undefined) {
  const db = await requireDb();
  const settings = await getSettings();
  const pr = permissionRole(role);
  if (pr !== "teacher" && pr !== "class_teacher" && (classGradeId || subjectAllocations?.length)) fail("ROLE_CANNOT_HAVE_ASSIGNMENTS");
  if (pr === "class_teacher" && !classGradeId) fail("CLASS_REQUIRED_FOR_CLASS_TEACHER");
  await db.update(teacherAllocations).set({ status: "inactive" }).where(and(eq(teacherAllocations.teacherUserId, userId), eq(teacherAllocations.status, "active"), eq(teacherAllocations.academicYear, settings.academicYear), eq(teacherAllocations.term, settings.currentTerm)));
  if (classGradeId) {
    const g = (await db.select().from(grades).where(eq(grades.id, classGradeId)).limit(1))[0] ?? fail("GRADE_NOT_FOUND");
    await saveTeacherAllocation({ teacherUserId: userId, gradeId: g.id, subjectId: 0, academicYear: settings.academicYear, term: settings.currentTerm, allocationType: "class_teacher" }, actorId);
    await db.update(grades).set({ classTeacherUserId: userId }).where(eq(grades.id, g.id));
  }
  for (const item of subjectAllocations ?? []) {
    await saveTeacherAllocation({ teacherUserId: userId, gradeId: item.gradeId, subjectId: item.subjectId, academicYear: settings.academicYear, term: settings.currentTerm, allocationType: "learning_area" }, actorId);
  }
}

async function issueSetupToken(userId: number, hours: number) {
  const db = await requireDb();
  await db.update(iamPasswordResets).set({ usedAt: new Date() }).where(and(eq(iamPasswordResets.userId, userId), sql`${iamPasswordResets.usedAt} is null`));
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await db.insert(iamPasswordResets).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { setupToken: token, expiresAt };
}

export async function createAdminUser(input: CreateUserInput, actor: Actor, req?: Request) {
  const db = await requireDb();
  const fullName = input.fullName.trim(); if (!fullName) fail("NAME_REQUIRED");
  const username = input.username.trim().toLowerCase(); if (!USERNAME_RE.test(username)) fail("USERNAME_INVALID");
  const staffId = input.staffId.trim(); if (!staffId) fail("STAFF_ID_REQUIRED");
  if (await hasManagePermissions(input.role) && !await hasManagePermissions(await actorRole(actor))) fail("ONLY_SUPER_ADMIN_MANAGES_SUPER_ADMIN");
  await assertUnique({ username, staffId });
  const userRow = (await db.insert(users).values({
    openId: `iam-${crypto.randomUUID()}`, username, name: fullName, email: input.email?.trim().toLowerCase() || null, role: await hasManagePermissions(input.role) || permissionRole(input.role) === "admin" ? "admin" : "user",
    accountStatus: input.status, loginMethod: "password", mustChangePassword: 0,
  }).$returningId())[0];
  try {
    await db.insert(staffProfiles).values({ userId: userRow.id, teacherCode: await nextTeacherCode(), staffId, displayName: fullName, department: input.department?.trim() || null, email: input.email?.trim().toLowerCase() || null, phone: input.phone?.trim() || null, role: input.role, status: input.status === "disabled" ? "disabled" : "active" });
    await applyAssignments(actor.id, userRow.id, input.role, input.classGradeId, input.subjectAllocations);
  } catch (error) {
    await db.delete(teacherAllocations).where(eq(teacherAllocations.teacherUserId, userRow.id));
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, userRow.id));
    await db.delete(users).where(eq(users.id, userRow.id));
    throw error;
  }
  const setup = await issueSetupToken(userRow.id, 72);
  await audit(actor.id, "admin.user.create", userRow.id, { username, staffId, role: input.role, status: input.status, department: input.department ?? null }, req);
  return { userId: userRow.id, ...setup };
}

/* --------------------------------------------------------------------- Edit */

export async function updateAdminUser(input: { userId: number; fullName: string; username: string; staffId: string; department?: string | null; email?: string | null; phone?: string | null }, actor: Actor, req?: Request) {
  const db = await requireDb();
  await assertCanManage(actor, input.userId);
  const username = input.username.trim().toLowerCase(); if (!USERNAME_RE.test(username)) fail("USERNAME_INVALID");
  const fullName = input.fullName.trim(); if (!fullName) fail("NAME_REQUIRED");
  const staffId = input.staffId.trim(); if (!staffId) fail("STAFF_ID_REQUIRED");
  await assertUnique({ username, staffId }, input.userId);
  const before = (await listAdminUsers()).find(u => u.userId === input.userId)!;
  const email = input.email?.trim().toLowerCase() || null;
  await db.update(users).set({ username, name: fullName, email }).where(eq(users.id, input.userId));
  const values = { displayName: fullName, staffId, department: input.department?.trim() || null, email, phone: input.phone?.trim() || null };
  if (before.staffProfileId) await db.update(staffProfiles).set(values).where(eq(staffProfiles.userId, input.userId));
  else await db.insert(staffProfiles).values({ ...values, userId: input.userId, teacherCode: await nextTeacherCode(), role: before.role, status: "active" });
  const changed = Object.fromEntries(Object.entries({ fullName, username, staffId, department: values.department, email }).filter(([k, v]) => (before as any)[k] !== v).map(([k, v]) => [k, { from: (before as any)[k] ?? null, to: v }]));
  await audit(actor.id, "admin.user.update", input.userId, { changed }, req);
  return { ok: true };
}

export async function changeAdminRole(input: { userId: number; role: (typeof ASSIGNABLE_ROLES)[number] }, actor: Actor, req?: Request) {
  const db = await requireDb();
  const current = await assertCanManage(actor, input.userId);
  const superActor = await hasManagePermissions(await actorRole(actor));
  if (input.userId === actor.id) fail("CANNOT_CHANGE_OWN_ROLE");
  const nextIsManager = await hasManagePermissions(input.role);
  if (nextIsManager && !superActor) fail("ONLY_SUPER_ADMIN_MANAGES_SUPER_ADMIN");
  if (await hasManagePermissions(current) && !nextIsManager) await assertNotLastPermissionManager(input.userId);
  const profile = (await db.select().from(staffProfiles).where(eq(staffProfiles.userId, input.userId)).limit(1))[0];
  const u = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  if (profile) await db.update(staffProfiles).set({ role: input.role }).where(eq(staffProfiles.userId, input.userId));
  else await db.insert(staffProfiles).values({ userId: input.userId, teacherCode: await nextTeacherCode(), displayName: u.name ?? u.username ?? `User ${u.id}`, role: input.role, status: "active" });
  await db.update(users).set({ role: nextIsManager || permissionRole(input.role) === "admin" ? "admin" : "user" }).where(eq(users.id, input.userId));
  if (permissionRole(input.role) !== "teacher" && permissionRole(input.role) !== "class_teacher") await db.update(teacherAllocations).set({ status: "inactive" }).where(and(eq(teacherAllocations.teacherUserId, input.userId), eq(teacherAllocations.status, "active")));
  await audit(actor.id, "admin.role.change", input.userId, { from: current, to: input.role }, req);
  return { ok: true };
}

export async function changeAdminAssignment(input: { userId: number; classGradeId?: number | null; subjectAllocations: { gradeId: number; subjectId: number }[] }, actor: Actor, req?: Request) {
  const role = await assertCanManage(actor, input.userId);
  await applyAssignments(actor.id, input.userId, role, input.classGradeId, input.subjectAllocations);
  await audit(actor.id, "admin.assignment.change", input.userId, { classGradeId: input.classGradeId ?? null, subjectAllocations: input.subjectAllocations }, req);
  return { ok: true };
}

/* ---------------------------------------------------- Account state, passwords */

export async function setAccountState(input: { userId: number; action: "activate" | "suspend" | "lock" | "unlock"; reason?: string }, actor: Actor, req?: Request) {
  const db = await requireDb();
  const role = await assertCanManage(actor, input.userId);
  const u = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  const state = stateOf(u);
  if (input.userId === actor.id && input.action !== "activate") fail("CANNOT_RESTRICT_OWN_ACCOUNT");
  if (await hasManagePermissions(role) && (input.action === "suspend" || input.action === "lock")) await assertNotLastPermissionManager(input.userId);
  const revoke = () => db.update(iamSessions).set({ status: "revoked", logoutAt: new Date() }).where(and(eq(iamSessions.userId, input.userId), eq(iamSessions.status, "active")));
  const staffStatus = (status: "active" | "disabled") => db.update(staffProfiles).set({ status }).where(eq(staffProfiles.userId, input.userId));
  if (input.action === "activate") {
    if (state === "active") fail("ALREADY_ACTIVE");
    if (state === "pending") fail("USER_HAS_NOT_SET_PASSWORD");
    await db.update(users).set({ accountStatus: "active", accountLocked: 0, failedLoginAttempts: 0 }).where(eq(users.id, input.userId)); await staffStatus("active");
  } else if (input.action === "suspend") {
    if (state === "suspended") fail("ALREADY_SUSPENDED");
    await db.update(users).set({ accountStatus: "disabled" }).where(eq(users.id, input.userId)); await staffStatus("disabled"); await revoke();
  } else if (input.action === "lock") {
    if (state === "locked") fail("ALREADY_LOCKED");
    await db.update(users).set({ accountStatus: "locked", accountLocked: 1 }).where(eq(users.id, input.userId)); await revoke();
  } else {
    if (state !== "locked") fail("NOT_LOCKED");
    await db.update(users).set({ accountStatus: "active", accountLocked: 0, failedLoginAttempts: 0 }).where(eq(users.id, input.userId));
  }
  await audit(actor.id, `admin.account.${input.action}`, input.userId, { from: state, reason: input.reason ?? null }, req);
  return { ok: true };
}

/** Issues a single-use setup link code. The user chooses their own password; no password is ever generated, shown or stored in plaintext. */
export async function resetAdminPassword(input: { userId: number }, actor: Actor, req?: Request) {
  const db = await requireDb();
  await assertCanManage(actor, input.userId);
  await db.update(iamSessions).set({ status: "revoked", logoutAt: new Date() }).where(and(eq(iamSessions.userId, input.userId), eq(iamSessions.status, "active")));
  const setup = await issueSetupToken(input.userId, 24);
  await audit(actor.id, "admin.password.reset", input.userId, { method: "single_use_setup_link", expiresAt: setup.expiresAt }, req);
  return setup;
}

/* ------------------------------------------------------------ Permission matrix */

export async function getPermissionMatrixView(input: { role?: string; userId?: number }) {
  const db = await requireDb();
  const roles = [...ASSIGNABLE_ROLES];
  const base = { modules: MODULES.map(([key, label]) => ({ key, label })), actions: [...ACTIONS], roles: roles.map(r => ({ value: r, label: ROLE_LABELS[r] })) };
  if (input.userId) {
    const role = (await getAccessProfile(input.userId)).role;
    const granted = await roleMatrix(role);
    const overrides = await db.select().from(userPermissions).where(eq(userPermissions.userId, input.userId));
    const o = new Map(overrides.map(r => [r.permissionKey, !!r.allowed]));
    return { ...base, subject: { type: "user" as const, userId: input.userId, role, locked: granted.has(MANAGE_PERMISSIONS) }, granted: MATRIX_KEYS.filter(k => o.has(k) ? o.get(k) : granted.has(k)), inherited: MATRIX_KEYS.filter(k => granted.has(k)), overrides: Object.fromEntries(o) };
  }
  const role = permissionRole(input.role ?? "teacher");
  const granted = await roleMatrix(role);
  return { ...base, subject: { type: "role" as const, role, locked: granted.has(MANAGE_PERMISSIONS) }, granted: MATRIX_KEYS.filter(k => granted.has("*") || granted.has(k)), inherited: MATRIX_KEYS.filter(k => granted.has("*") || granted.has(k)), overrides: {} };
}

export async function setRolePermission(input: { role: string; permissionKey: string; allowed: boolean }, actor: Actor, req?: Request) {
  const db = await requireDb();
  const role = permissionRole(input.role);
  if (!MATRIX_KEYS.includes(input.permissionKey)) fail("UNKNOWN_PERMISSION");
  if (input.permissionKey === MANAGE_PERMISSIONS) fail("PROTECTED_PERMISSION");
  if (await hasManagePermissions(role)) fail("SUPER_ADMIN_PERMISSIONS_ARE_FIXED");
  if (!ROLE_LABELS[role]) fail("UNKNOWN_ROLE");
  await db.insert(rolePermissions).values({ role, permissionKey: input.permissionKey, allowed: input.allowed ? 1 : 0 }).onDuplicateKeyUpdate({ set: { allowed: input.allowed ? 1 : 0 } });
  await audit(actor.id, "admin.permission.change", null, { scope: "role", role, permissionKey: input.permissionKey, allowed: input.allowed }, req);
  return { ok: true };
}

export async function setUserPermissionOverride(input: { userId: number; permissionKey: string; allowed: boolean | null }, actor: Actor, req?: Request) {
  const db = await requireDb();
  if (!MATRIX_KEYS.includes(input.permissionKey)) fail("UNKNOWN_PERMISSION");
  const role = await assertCanManage(actor, input.userId);
  if (input.permissionKey === MANAGE_PERMISSIONS) fail("PROTECTED_PERMISSION");
  if (await hasManagePermissions(role)) fail("SUPER_ADMIN_PERMISSIONS_ARE_FIXED");
  await db.delete(userPermissions).where(and(eq(userPermissions.userId, input.userId), eq(userPermissions.permissionKey, input.permissionKey)));
  if (input.allowed !== null) await db.insert(userPermissions).values({ userId: input.userId, permissionKey: input.permissionKey, allowed: input.allowed ? 1 : 0 });
  await audit(actor.id, "admin.permission.change", input.userId, { scope: "user", permissionKey: input.permissionKey, allowed: input.allowed }, req);
  return { ok: true };
}

/* ---------------------------------------------------------------- Audit trail */

const MODULE_PREFIXES: Record<string, string[]> = {
  learners: ["learner.", "guardian."], attendance: ["attendance."], assessments: ["assessment."], marklists: ["marklist."], report_cards: ["report."],
  finance: ["finance.", "store."], timetable: ["timetable."], allocations: ["allocation."], administration: ["admin.", "staff.", "IAM_", "auth."],
  ai: ["ai."], reports: ["report."], settings: ["settings."],
};
export const AUDIT_MODULES = MODULES.map(([key, label]) => ({ key, label }));

export async function listAuditTrail(f: { actorUserId?: number; subjectUserId?: number; userId?: number; action?: string; module?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const db = await requireDb();
  const conds: (SQL | undefined)[] = [];
  if (f.userId) conds.push(or(eq(auditLogs.userId, f.userId), and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, String(f.userId))), and(eq(auditLogs.entityType, "iam"), eq(auditLogs.entityId, String(f.userId)))));
  if (f.actorUserId) conds.push(eq(auditLogs.userId, f.actorUserId));
  if (f.action) conds.push(like(auditLogs.action, `%${f.action}%`));
  if (f.module && MODULE_PREFIXES[f.module]) conds.push(or(...MODULE_PREFIXES[f.module].map(p => like(auditLogs.action, `${p}%`))));
  if (f.from) conds.push(gte(auditLogs.createdAt, new Date(`${f.from}T00:00:00`)));
  if (f.to) conds.push(lte(auditLogs.createdAt, new Date(`${f.to}T23:59:59`)));
  const where = and(...conds);
  const total = Number((await db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(where))[0]?.n ?? 0);
  const rows = await db.select({ log: auditLogs, actorName: users.name, actorUsername: users.username }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId)).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(Math.min(f.limit ?? 50, 200)).offset(f.offset ?? 0);
  return {
    total,
    rows: rows.map(({ log, actorName, actorUsername }) => {
      let details: Record<string, unknown> = {};
      try { details = clean(JSON.parse(log.metadata ?? "{}")); } catch { /* legacy rows without JSON metadata */ }
      const module = Object.entries(MODULE_PREFIXES).find(([, ps]) => ps.some(p => log.action.startsWith(p)))?.[0] ?? "administration";
      return { id: log.id, at: log.createdAt, action: log.action, module, actorUserId: log.userId, actor: actorName ?? actorUsername ?? (log.userId ? `User ${log.userId}` : "Unauthenticated"), target: log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : null, details };
    }),
  };
}

export async function adminOverview() {
  const list = await listAdminUsers();
  const count = (s: AccountState) => list.filter(u => u.status === s).length;
  return { total: list.length, active: count("active"), suspended: count("suspended"), locked: count("locked"), pending: count("pending") };
}
