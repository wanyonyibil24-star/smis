import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { computePermissions } from "./access";
import { attendanceGradeLevel, validateAttendanceBatch, type AttendanceBatchEntry } from "../shared/attendance";
import {
  alumni,
  assessments,
  attendanceRegisterApprovals,
  attendances,
  auditLogs,
  communications,
  expenditures,
  guardians,
  learnerGuardians,
  feeStructures,
  grades,
  learners,
  marks,
  notifications,
  payments,
  reportCards,
  permissions,
  schoolSettings,
  staffProfiles,
  storeItems,
  storeMovements,
  subjects,
  teacherAllocations,
  timetableEntries,
  timetableRequirements,
  userPermissions,
  users,
} from "../drizzle/schema";

export const permissionsByRole: Record<string, string[]> = {
  super_admin: ["*"],
  admin: ["dashboard.view", "learners.view", "learners.add", "learners.edit", "learners.deactivate", "attendance.view", "attendance.edit", "assessments.view", "assessments.edit", "reports.view", "finance.view", "finance.edit", "store.view", "store.edit", "timetable.view", "timetable.edit", "communication.edit", "alumni.edit", "users.edit", "settings.edit", "audit.view", "allocations.view", "allocations.create", "allocations.edit", "allocations.deactivate", "allocations.replace", "allocations.bulk"],
  teacher: ["dashboard.view", "learners.view", "attendance.view", "attendance.edit", "assessments.view", "assessments.edit", "reports.view", "timetable.view", "allocations.view"],
  finance: ["dashboard.view", "learners.view", "finance.view", "finance.edit", "reports.view"],
  storekeeper: ["dashboard.view", "store.view", "store.edit", "reports.view"],
  other: ["dashboard.view"],
};

export const permissionCatalog = [
  ["learners.view", "View learners"], ["learners.add", "Add learners"], ["learners.edit", "Edit learners"], ["learners.deactivate", "Deactivate learners"],
  ["attendance.view", "View attendance"], ["attendance.edit", "Enter and edit attendance"], ["assessments.view", "View marks"], ["assessments.edit", "Enter and edit marks"],
  ["reports.view", "View reports"], ["finance.view", "View finance"], ["finance.edit", "Record payments and expenditure"], ["store.view", "View inventory"], ["store.edit", "Manage inventory"],
  ["timetable.view", "View timetable"], ["timetable.edit", "Edit timetable"], ["allocations.view", "View teacher allocations"], ["allocations.create", "Create allocations"], ["allocations.edit", "Edit allocations"], ["allocations.deactivate", "Deactivate allocations"], ["allocations.replace", "Replace teachers"], ["allocations.bulk", "Bulk allocation"], ["communication.edit", "Manage communication"], ["alumni.edit", "Manage alumni"], ["users.edit", "Manage users"], ["settings.edit", "Manage settings"], ["ai.access", "Access NEXUS AI"], ["audit.view", "View audit logs"],
] as const;

export async function effectivePermissions(userId: number, role: string) {
  return computePermissions(userId, role);
}

export async function userCan(userId: number, role: string, permission: string) {
  const permissions = await effectivePermissions(userId, role);
  return permissions.includes("*") || permissions.includes(permission);
}

export function cbcLevel(score: number) {
  if (score >= 90) return "EE1";
  if (score >= 75) return "EE2";
  if (score >= 58) return "ME1";
  if (score >= 41) return "ME2";
  if (score >= 31) return "AE1";
  if (score >= 21) return "AE2";
  if (score >= 11) return "BE1";
  return "BE2";
}

export function assertScore(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Score must be between 0 and 100");
  return Math.round(value * 100) / 100;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

export async function writeAudit(userId: number | null, action: string, entityType: string, entityId?: string | number | null, metadata: Record<string, unknown> = {}) {
  const db = await requireDb();
  await db.insert(auditLogs).values({
    userId,
    action,
    entityType,
    entityId: entityId == null ? null : String(entityId),
    metadata: JSON.stringify(metadata),
  });
}

export async function getSettings() {
  const db = await requireDb();
  const row = (await db.select().from(schoolSettings).limit(1))[0];
  return row ?? { id: 0, schoolName: "Ebunangwe Junior School", motto: "Learn. Lead. Serve.", currentTerm: "Term 2", academicYear: 2026, includeFeesOnReportCard: 1, showPercentagesOnReportCard: 0, logoPath: null, principalSignaturePath: null, classTeacherSignaturePath: null };
}

export async function getDashboardSnapshot() {
  const db = await requireDb();
  const [settings, learnerRows, attendanceRows, paymentRows, assessmentRows, staffRows, lowStockRows] = await Promise.all([
    getSettings(),
    db.select({ learner: learners, grade: grades }).from(learners).leftJoin(grades, eq(grades.id, learners.gradeId)).where(eq(learners.status, "active")),
    db.select().from(attendances).orderBy(desc(attendances.id)).limit(100),
    db.select().from(payments).orderBy(desc(payments.paidAt)).limit(100),
    db.select().from(assessments).where(sql`${assessments.status} <> 'approved'`),
    db.select().from(staffProfiles).where(eq(staffProfiles.status, "active")),
    db.select({ item: storeItems, movement: storeMovements }).from(storeItems).leftJoin(storeMovements, eq(storeItems.id, storeMovements.itemId)),
  ]);
  const attendanceToday = attendanceRows.filter(row => String(row.attendanceDate) === new Date().toISOString().slice(0, 10));
  const present = attendanceToday.filter(row => row.status === "present").length;
  const attendanceRate = attendanceToday.length ? Math.round((present / attendanceToday.length) * 1000) / 10 : 0;
  const learnersById = new Map(learnerRows.map(row => [row.learner.id, row]));
  const recentAttendance = attendanceToday.slice(0, 8).flatMap(attendance => {
    const row = learnersById.get(attendance.learnerId);
    return row ? [{ attendance, learner: row.learner, grade: row.grade }] : [];
  });
  const collections = paymentRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const stock = new Map<number, { name: string; unit: string; quantity: number; reorderLevel: number }>();
  for (const row of lowStockRows) {
    if (!row.item) continue;
    const current = stock.get(row.item.id) ?? { name: row.item.name, unit: row.item.unit, quantity: 0, reorderLevel: Number(row.item.reorderLevel) };
    if (row.movement) current.quantity += row.movement.movementType === "issued" ? -Number(row.movement.quantity) : Number(row.movement.quantity);
    stock.set(row.item.id, current);
  }
  return {
    school: settings,
    counts: { learners: learnerRows.length, staff: staffRows.length, assessmentsPending: assessmentRows.length, collections },
    attendance: { today: attendanceToday.length, present, rate: attendanceRate },
    recentAttendance,
    lowStock: Array.from(stock.values()).filter(item => item.quantity <= item.reorderLevel),
    recentLearners: learnerRows.slice(0, 8).map(row => ({ ...row.learner, grade: row.grade ? `${row.grade.name}${row.grade.stream ? ` ${row.grade.stream}` : ""}` : "" })),
  };
}

export type LearnerStatus = "active" | "inactive";
export type PeopleStaffStatus = "active" | "inactive";
export type PeopleStaffRole = "teacher" | "class_teacher" | "senior_teacher" | "deputy_head" | "head_teacher" | "finance" | "storekeeper" | "other";

export async function listLearners(search?: string) {
  const db = await requireDb();
  const term = search?.trim();
  const rows = await db.select({ learner: learners, grade: grades }).from(learners).leftJoin(grades, eq(grades.id, learners.gradeId)).where(term ? or(like(learners.fullName, `%${term}%`), like(learners.admissionNumber, `%${term}%`), like(learners.guardianName, `%${term}%`), like(learners.status, `%${term}%`)) : undefined).orderBy(learners.fullName);
  return rows.map(row => ({ ...row.learner, grade: row.grade ? `${row.grade.name}${row.grade.stream ? ` ${row.grade.stream}` : ""}` : "" }));
}

async function resolveGrade(gradeId: number) {
  const db = await requireDb();
  const grade = (await db.select().from(grades).where(eq(grades.id, gradeId)).limit(1))[0];
  if (!grade) throw new Error("GRADE_NOT_FOUND");
  return grade;
}

async function syncPrimaryGuardian(input: { learnerId: number; fullName: string; idNumber?: string | null; phone?: string | null; userId: number }) {
  const db = await requireDb();
  const name = input.fullName.trim();
  if (!name) return;
  const existing = input.idNumber?.trim() ? (await db.select().from(guardians).where(eq(guardians.idNumber, input.idNumber.trim())).limit(1))[0] : undefined;
  const guardian = existing ? existing : (await db.insert(guardians).values({ fullName: name, idNumber: input.idNumber?.trim() || null, phone: input.phone?.trim() || null, communicationPreference: "sms" }).$returningId())[0];
  if (existing) await db.update(guardians).set({ fullName: name, idNumber: input.idNumber?.trim() || null, phone: input.phone?.trim() || null }).where(eq(guardians.id, existing.id));
  await db.insert(learnerGuardians).values({ learnerId: input.learnerId, guardianId: guardian.id, relationship: "Parent/Guardian", isPrimary: 1 }).onDuplicateKeyUpdate({ set: { relationship: "Parent/Guardian", isPrimary: 1 } });
  await writeAudit(input.userId, existing ? "guardian.update" : "guardian.create", "guardian", guardian.id, { learnerId: input.learnerId });
}

export async function createLearner(input: { fullName: string; admissionNumber: string; guardianName?: string | null; guardianIdNumber?: string | null; guardianPhone?: string | null; gradeId: number; status: LearnerStatus }, userId: number) {
  const db = await requireDb();
  const fullName = input.fullName.trim(); const admissionNumber = input.admissionNumber.trim().toUpperCase();
  if (!fullName || !admissionNumber) throw new Error("LEARNER_REQUIRED_FIELDS");
  await resolveGrade(input.gradeId);
  const duplicate = (await db.select({ id: learners.id }).from(learners).where(eq(learners.admissionNumber, admissionNumber)).limit(1))[0];
  if (duplicate) throw new Error("ADMISSION_NUMBER_EXISTS");
  const row = (await db.insert(learners).values({ fullName, admissionNumber, guardianName: input.guardianName?.trim() || null, guardianIdNumber: input.guardianIdNumber?.trim() || null, guardianPhone: input.guardianPhone?.trim() || null, gradeId: input.gradeId, status: input.status }).$returningId())[0];
  if (input.guardianName?.trim()) await syncPrimaryGuardian({ learnerId: row.id, fullName: input.guardianName, idNumber: input.guardianIdNumber, phone: input.guardianPhone, userId });
  await writeAudit(userId, "learner.create", "learner", row.id, { admissionNumber, gradeId: input.gradeId, status: input.status });
  return { ok: true, id: row.id };
}

export async function updateLearner(input: { learnerId: number; fullName: string; admissionNumber: string; guardianName?: string | null; guardianIdNumber?: string | null; guardianPhone?: string | null; gradeId: number; status: LearnerStatus }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(learners).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!current) throw new Error("LEARNER_NOT_FOUND");
  await resolveGrade(input.gradeId);
  const admissionNumber = input.admissionNumber.trim().toUpperCase();
  const duplicate = (await db.select({ id: learners.id }).from(learners).where(and(eq(learners.admissionNumber, admissionNumber), sql`${learners.id} <> ${input.learnerId}`)).limit(1))[0];
  if (duplicate) throw new Error("ADMISSION_NUMBER_EXISTS");
  await db.update(learners).set({ fullName: input.fullName.trim(), admissionNumber, guardianName: input.guardianName?.trim() || null, guardianIdNumber: input.guardianIdNumber?.trim() || null, guardianPhone: input.guardianPhone?.trim() || null, gradeId: input.gradeId, status: input.status }).where(eq(learners.id, input.learnerId));
  if (input.guardianName?.trim()) await syncPrimaryGuardian({ learnerId: input.learnerId, fullName: input.guardianName, idNumber: input.guardianIdNumber, phone: input.guardianPhone, userId });
  await writeAudit(userId, "learner.update", "learner", input.learnerId, { gradeId: input.gradeId, status: input.status });
  return { ok: true };
}

export async function setLearnerStatus(input: { learnerId: number; status: LearnerStatus }, userId: number) {
  const db = await requireDb();
  const current = (await db.select({ id: learners.id }).from(learners).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!current) throw new Error("LEARNER_NOT_FOUND");
  await db.update(learners).set({ status: input.status }).where(eq(learners.id, input.learnerId));
  await writeAudit(userId, `learner.${input.status}`, "learner", input.learnerId, input);
  return { ok: true };
}

type AttendanceSession = "morning" | "afternoon";
type AttendanceSummaryPeriod = "weekly" | "monthly" | "termly" | "yearly";

function dateWindow(period: AttendanceSummaryPeriod, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (period === "weekly") start.setDate(start.getDate() - 6);
  if (period === "monthly") start.setDate(1);
  if (period === "termly") { start.setMonth(start.getMonth() >= 8 ? 8 : start.getMonth() >= 4 ? 4 : 0, 1); }
  if (period === "yearly") start.setMonth(0, 1);
  return { start, end };
}

export async function listAttendance(date?: string, userId?: number, session: AttendanceSession = "morning") {
  const db = await requireDb();
  const rows = await db.select({ attendance: attendances, learner: learners, grade: grades }).from(attendances).innerJoin(learners, eq(learners.id, attendances.learnerId)).leftJoin(grades, eq(grades.id, attendances.gradeId)).where(and(date ? eq(attendances.attendanceDate, new Date(date)) : undefined, eq(attendances.session, session))).orderBy(desc(attendances.id));
  if (!userId) return rows.map(row => ({ ...row.attendance, learner: row.learner, grade: row.grade }));
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (actor?.role !== "user") return rows.map(row => ({ ...row.attendance, learner: row.learner, grade: row.grade }));
  const allowedGrades = new Set(await classTeacherGradeIds(userId));
  return rows.filter(row => allowedGrades.has(row.learner.gradeId)).map(row => ({ ...row.attendance, learner: row.learner, grade: row.grade }));
}

export function isAttendanceAdmin(userRole?: string | null, staffRole?: string | null) {
  return userRole === "admin" || staffRole === "admin" || staffRole === "super_admin" || staffRole === "deputy_head" || staffRole === "head_teacher";
}

export function canAccessAttendanceGrade(userRole: string | null | undefined, staffRole: string | null | undefined, allocatedGradeIds: number[], gradeId: number) {
  return isAttendanceAdmin(userRole, staffRole) || allocatedGradeIds.includes(gradeId);
}
export function canCaptureAttendance(userRole: string | null | undefined, staffRole: string | null | undefined, classTeacherGradeIds: number[], gradeId: number) {
  return isAttendanceAdmin(userRole, staffRole) || (staffRole === "class_teacher" && classTeacherGradeIds.includes(gradeId));
}
async function classTeacherGradeIds(userId: number) {
  const db = await requireDb();
  const allocations = await db.select({ gradeId: teacherAllocations.gradeId }).from(teacherAllocations).where(and(
    eq(teacherAllocations.teacherUserId, userId),
    eq(teacherAllocations.status, "active"),
    eq(teacherAllocations.allocationType, "class_teacher"),
  ));
  return Array.from(new Set(allocations.map(row => row.gradeId)));
}
export async function getAttendanceRegister(date: string, userId: number, session: AttendanceSession = "morning") {
  const db = await requireDb();
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const staff = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const isAdmin = isAttendanceAdmin(actor?.role, staff?.role);
  let allowedGradeIds: number[] | null = null;
  if (!isAdmin) {
    const profileGradeIds = await classTeacherGradeIds(userId);
    allowedGradeIds = profileGradeIds;
    if (!allowedGradeIds.length) return [];
  }
  const roster = await db.select({ learner: learners, grade: grades }).from(learners)
    .leftJoin(grades, eq(grades.id, learners.gradeId))
    .where(and(eq(learners.status, "active"), allowedGradeIds ? inArray(learners.gradeId, allowedGradeIds) : undefined))
    .orderBy(grades.name, learners.fullName);
  if (!roster.length) return [];
  const saved = await db.select().from(attendances).where(and(
    eq(attendances.attendanceDate, new Date(date)),
    eq(attendances.session, session),
    inArray(attendances.learnerId, roster.map(row => row.learner.id)),
  ));
  const savedByLearner = new Map(saved.map(row => [row.learnerId, row]));
  return roster.map(row => ({
    ...row.learner,
    grade: row.grade ? `${row.grade.name}${row.grade.stream ? ` ${row.grade.stream}` : ""}` : "",
    attendanceStatus: savedByLearner.get(row.learner.id)?.status ?? null,
    attendanceNote: savedByLearner.get(row.learner.id)?.note ?? null,
    capturedAt: savedByLearner.get(row.learner.id)?.capturedAt ?? null,
  }));
}
export async function getAttendanceRegisterApproval(date: string, gradeId: number, userId?: number) {
  if (userId) await assertAttendanceGradeScope(gradeId, userId);
  const db = await requireDb();
  return (await db.select().from(attendanceRegisterApprovals).where(and(eq(attendanceRegisterApprovals.attendanceDate, new Date(date)), eq(attendanceRegisterApprovals.gradeId, gradeId))).limit(1))[0] ?? { status: "draft" as const, attendanceDate: date, gradeId, submittedAt: null, approvedAt: null, submittedByUserId: null, approvedByUserId: null, notes: null };
}
async function assertAttendanceGradeScope(gradeId: number, userId: number) {
  const db = await requireDb();
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const staff = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const admin = isAttendanceAdmin(actor?.role, staff?.role);
  const classGrades = admin ? [gradeId] : await classTeacherGradeIds(userId);
  if (!canCaptureAttendance(actor?.role, staff?.role, classGrades, gradeId)) throw new Error("ATTENDANCE_SCOPE_FORBIDDEN");
  return { admin, db };
}
export async function setAttendanceRegisterStatus(input: { attendanceDate: string; gradeId: number; action: "submit" | "approve" | "reopen" }, userId: number) {
  const { admin, db } = await assertAttendanceGradeScope(input.gradeId, userId);
  if ((input.action === "approve" || input.action === "reopen") && !admin) throw new Error("ATTENDANCE_APPROVAL_FORBIDDEN");
  const current = await getAttendanceRegisterApproval(input.attendanceDate, input.gradeId);
  const now = new Date();
  const values = input.action === "submit"
    ? { status: "submitted" as const, submittedByUserId: userId, submittedAt: now }
    : input.action === "approve"
      ? { status: "approved" as const, approvedByUserId: userId, approvedAt: now }
      : { status: "reopened" as const, approvedByUserId: null, approvedAt: null };
  if ("id" in current) await db.update(attendanceRegisterApprovals).set(values).where(eq(attendanceRegisterApprovals.id, current.id));
  else await db.insert(attendanceRegisterApprovals).values({ attendanceDate: new Date(input.attendanceDate), gradeId: input.gradeId, ...values });
  await writeAudit(userId, `attendance.register.${input.action}`, "attendance_register", `${input.attendanceDate}:${input.gradeId}`, input);
  return getAttendanceRegisterApproval(input.attendanceDate, input.gradeId);
}
export async function getAttendanceSummary(input: { period: AttendanceSummaryPeriod; gradeLevel?: number }, userId: number) {
  const db = await requireDb();
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const staff = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const allowed = isAttendanceAdmin(actor?.role, staff?.role) ? null : new Set(await classTeacherGradeIds(userId));
  if (!allowed && !isAttendanceAdmin(actor?.role, staff?.role)) return { period: input.period, rows: [], totals: { present: 0, absent: 0, late: 0, excused: 0, sessions: 0 } };
  const window = dateWindow(input.period);
  const learnerRows = await db.select({ learner: learners, grade: grades }).from(learners).leftJoin(grades, eq(grades.id, learners.gradeId)).where(eq(learners.status, "active"));
  const rows = await db.select({ attendance: attendances }).from(attendances).where(and(gte(attendances.attendanceDate, window.start), lte(attendances.attendanceDate, window.end)));
  const grouped = new Map<number, { learnerId: number; learner: string; admissionNumber: string; grade: string; present: number; absent: number; late: number; excused: number; sessions: number }>();
  for (const row of learnerRows) {
    if (allowed && !allowed.has(row.learner.gradeId)) continue;
    const level = attendanceGradeLevel(row.grade?.name ?? "");
    if (input.gradeLevel && level !== input.gradeLevel) continue;
    grouped.set(row.learner.id, { learnerId: row.learner.id, learner: row.learner.fullName, admissionNumber: row.learner.admissionNumber, grade: row.grade ? `${row.grade.name}${row.grade.stream ? ` ${row.grade.stream}` : ""}` : "", present: 0, absent: 0, late: 0, excused: 0, sessions: 0 });
  }
  for (const row of rows) {
    const current = grouped.get(row.attendance.learnerId);
    if (current) { current[row.attendance.status] += 1; current.sessions += 1; }
  }
  const result = Array.from(grouped.values()).sort((a, b) => a.grade.localeCompare(b.grade) || a.learner.localeCompare(b.learner));
  return { period: input.period, from: window.start.toISOString().slice(0, 10), to: window.end.toISOString().slice(0, 10), rows: result, totals: result.reduce((sum, row) => ({ present: sum.present + row.present, absent: sum.absent + row.absent, late: sum.late + row.late, excused: sum.excused + row.excused, sessions: sum.sessions + row.sessions }), { present: 0, absent: 0, late: 0, excused: 0, sessions: 0 }) };
}
export async function saveAttendance(input: { learnerId: number; status: "present" | "absent" | "late" | "excused"; attendanceDate: string; session?: AttendanceSession; note?: string | null }, userId: number) {
  const db = await requireDb();
  const learner = (await db.select().from(learners).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!learner) throw new Error("LEARNER_NOT_FOUND");
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const staff = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const isAdmin = isAttendanceAdmin(actor?.role, staff?.role);
  if (!isAdmin) {
    const allowedGradeIds = await classTeacherGradeIds(userId);
    if (!canCaptureAttendance(actor?.role, staff?.role, allowedGradeIds, learner.gradeId)) throw new Error("ATTENDANCE_SCOPE_FORBIDDEN");
  }
  const session = input.session ?? "morning";
  await db.insert(attendances).values({ learnerId: input.learnerId, status: input.status, attendanceDate: new Date(input.attendanceDate), session, capturedAt: new Date(), note: input.note ?? null, gradeId: learner.gradeId }).onDuplicateKeyUpdate({ set: { status: input.status, capturedAt: new Date(), note: input.note ?? null } });
  await writeAudit(userId, "attendance.save", "learner", learner.id, input);
  return { ok: true };
}

export async function evaluateGuardianAbsenceAlerts(learnerIds: number[], userId: number) {
  const db = await requireDb();
  const uniqueIds = Array.from(new Set(learnerIds));
  if (!uniqueIds.length) return { created: 0 };
  const learnerRows = await db.select().from(learners).where(inArray(learners.id, uniqueIds));
  let created = 0;
  for (const learner of learnerRows) {
    const rows = await db.select().from(attendances).where(eq(attendances.learnerId, learner.id));
    const unexcused = rows.filter(row => row.status === "absent" || row.status === "late").length;
    if (unexcused < 3) continue;
    const title = `Guardian follow-up: ${learner.fullName}`;
    const body = `${learner.fullName} (${learner.admissionNumber}) has ${unexcused} recorded absent/late sessions. Contact ${learner.guardianName ?? "the guardian"}${learner.guardianPhone ? ` on ${learner.guardianPhone}` : ""} and record the follow-up.`;
    const existing = (await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.title, title), eq(notifications.body, body), eq(notifications.status, "published"))).limit(1))[0];
    if (!existing) {
      const row = (await db.insert(notifications).values({ audience: "parents", title, body, status: "published", createdByUserId: userId }).$returningId())[0];
      await writeAudit(userId, "attendance.guardian_alert", "notification", row.id, { learnerId: learner.id, unexcused });
      created += 1;
    }
  }
  return { created };
}

export async function saveAttendanceBatch(input: { attendanceDate: string; session?: AttendanceSession; entries: AttendanceBatchEntry[] }, userId: number) {
  const entries = validateAttendanceBatch(input.entries);
  const db = await requireDb();
  const learnerIds = entries.map(entry => entry.learnerId);
  const learnerRows = await db.select({ id: learners.id, gradeId: learners.gradeId, status: learners.status }).from(learners).where(inArray(learners.id, learnerIds));
  if (learnerRows.length !== learnerIds.length || learnerRows.some(row => row.status !== "active")) throw new Error("ACTIVE_LEARNER_NOT_FOUND");

  const gradeIds = Array.from(new Set(learnerRows.map(row => row.gradeId)));
  const gradeRows = await db.select({ id: grades.id, name: grades.name }).from(grades).where(inArray(grades.id, gradeIds));
  const gradeLevelById = new Map(gradeRows.map(row => [row.id, attendanceGradeLevel(row.name)]));
  if (gradeIds.some(gradeId => !gradeLevelById.get(gradeId))) throw new Error("ATTENDANCE_GRADE_NOT_SUPPORTED");
  if (new Set(gradeIds.map(gradeId => gradeLevelById.get(gradeId))).size !== 1) throw new Error("ATTENDANCE_BATCH_MUST_USE_ONE_GRADE");

  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const staff = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const isAdmin = isAttendanceAdmin(actor?.role, staff?.role);
  let allocatedGradeIds: number[] = [];
  if (!isAdmin) {
    allocatedGradeIds = await classTeacherGradeIds(userId);
  }
  if (learnerRows.some(row => !canCaptureAttendance(actor?.role, staff?.role, allocatedGradeIds, row.gradeId))) throw new Error("ATTENDANCE_SCOPE_FORBIDDEN");

  const counts = entries.reduce<Record<string, number>>((result, entry) => {
    result[entry.status] = (result[entry.status] ?? 0) + 1;
    return result;
  }, {});
  const values = entries.map(entry => {
    const learner = learnerRows.find(row => row.id === entry.learnerId)!;
    return { learnerId: learner.id, gradeId: learner.gradeId, attendanceDate: new Date(input.attendanceDate), session: input.session ?? "morning", capturedAt: new Date(), status: entry.status, note: null };
  });
  await db.transaction(async tx => {
    await tx.insert(attendances).values(values).onDuplicateKeyUpdate({ set: {
      status: sql.raw("VALUES(status)"),
      capturedAt: sql.raw("VALUES(capturedAt)"),
      note: sql.raw("VALUES(note)"),
    } });
    await tx.insert(auditLogs).values({
      userId,
      action: "attendance.batch_save",
      entityType: "attendance_register",
      entityId: input.attendanceDate,
      metadata: JSON.stringify({ savedCount: entries.length, session: input.session ?? "morning", gradeIds, gradeLevels: Array.from(new Set(gradeIds.map(id => gradeLevelById.get(id)))), counts }),
    });
  });
  const alerts = await evaluateGuardianAbsenceAlerts(entries.map(entry => entry.learnerId), userId);
  return { ok: true, savedCount: entries.length, counts, guardianAlertsCreated: alerts.created };
}

export async function listAssessments() {
  const db = await requireDb();
  return db.select({ assessment: assessments, grade: grades }).from(assessments).leftJoin(grades, eq(grades.id, assessments.gradeId)).orderBy(desc(assessments.id));
}

export async function listMarks(assessmentId?: number, userId?: number) {
  const db = await requireDb();
  const rows = await db.select({ mark: marks, learner: learners, subject: subjects }).from(marks).innerJoin(learners, eq(learners.id, marks.learnerId)).innerJoin(subjects, eq(subjects.id, marks.subjectId)).where(assessmentId ? eq(marks.assessmentId, assessmentId) : undefined).orderBy(learners.fullName);
  if (!userId) return rows.map(row => ({ ...row.mark, learner: row.learner, subject: row.subject }));
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (actor?.role !== "user") return rows.map(row => ({ ...row.mark, learner: row.learner, subject: row.subject }));
  const allocations = await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.teacherUserId, userId), eq(teacherAllocations.status, "active")));
  const allowed = new Set(allocations.map(row => `${row.gradeId}:${row.subjectId}`));
  return rows.filter(row => allowed.has(`${row.learner.gradeId}:${row.mark.subjectId}`)).map(row => ({ ...row.mark, learner: row.learner, subject: row.subject }));
}

export async function saveMark(input: { assessmentId: number; learnerId: number; subjectId: number; midTerm: number; endTerm: number; teacherRemark?: string | null }, userId: number) {
  const db = await requireDb();
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1))[0];
  const learner = (await db.select().from(learners).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!assessment || !learner || assessment.gradeId !== learner.gradeId) throw new Error("MARK_CONTEXT_INVALID");
  const actor = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (actor?.role === "user") {
    const allocation = (await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.teacherUserId, userId), eq(teacherAllocations.gradeId, learner.gradeId), eq(teacherAllocations.subjectId, input.subjectId), eq(teacherAllocations.status, "active"))).limit(1))[0];
    if (!allocation) throw new Error("MARK_SCOPE_FORBIDDEN");
  }
  const midTerm = assertScore(input.midTerm);
  const endTerm = assertScore(input.endTerm);
  if (assessment.status !== "draft") throw new Error("ASSESSMENT_NOT_DRAFT_USE_WORKFLOW");
  const score = assessment.assessmentType === "mid_term" ? midTerm : endTerm;
  const average = score;
  const values = { ...input, teacherUserId: assessment.teacherUserId, score: String(score), midTerm: assessment.assessmentType === "mid_term" ? String(score) : null, endTerm: assessment.assessmentType === "end_term" ? String(score) : null, average: String(average), cbcLevel: cbcLevel(average) as "EE1" | "EE2" | "ME1" | "ME2" | "AE1" | "AE2" | "BE1" | "BE2", updatedByUserId: userId };
  await db.insert(marks).values(values).onDuplicateKeyUpdate({ set: values });
  await writeAudit(userId, "assessment.save", "mark", `${input.assessmentId}:${input.learnerId}:${input.subjectId}`, { average, cbcLevel: values.cbcLevel });
  return { ...values, average, cbcLevel: values.cbcLevel };
}

export async function getFinanceOverview(learnerId?: number) {
  const db = await requireDb();
  const learnersRows = await db.select().from(learners).where(learnerId ? eq(learners.id, learnerId) : eq(learners.status, "active"));
  const feeRows = await db.select().from(feeStructures);
  const paymentRows = await db.select().from(payments).orderBy(desc(payments.paidAt));
  const byLearner = learnersRows.map(learner => {
    const required = feeRows.filter(fee => fee.gradeId === learner.gradeId).reduce((sum, fee) => sum + Number(fee.amount), 0);
    const paid = paymentRows.filter(payment => payment.learnerId === learner.id).reduce((sum, payment) => sum + Number(payment.amount), 0);
    return { learner, required, paid, balance: required - paid };
  });
  return { balances: byLearner, payments: paymentRows.slice(0, 50), totals: { required: byLearner.reduce((s, row) => s + row.required, 0), paid: byLearner.reduce((s, row) => s + row.paid, 0) } };
}

export async function recordPayment(input: { learnerId: number; amount: number; paymentMethod: "mpesa" | "bank" | "cash"; reference: string }, userId: number) {
  const db = await requireDb();
  if (input.amount <= 0) throw new Error("INVALID_AMOUNT");
  await db.insert(payments).values({ ...input, amount: String(input.amount) });
  await writeAudit(userId, "finance.payment", "payment", input.reference, input);
  return { ok: true, reference: input.reference };
}

export async function getStoreOverview() {
  const db = await requireDb();
  const rows = await db.select({ item: storeItems, movement: storeMovements }).from(storeItems).leftJoin(storeMovements, eq(storeItems.id, storeMovements.itemId));
  const items = new Map<number, { id: number; name: string; unit: string; reorderLevel: number; quantity: number }>();
  for (const row of rows) {
    if (!row.item) continue;
    const item = items.get(row.item.id) ?? { id: row.item.id, name: row.item.name, unit: row.item.unit, reorderLevel: Number(row.item.reorderLevel), quantity: 0 };
    if (row.movement) item.quantity += row.movement.movementType === "issued" ? -Number(row.movement.quantity) : Number(row.movement.quantity);
    items.set(row.item.id, item);
  }
  return Array.from(items.values());
}

export async function recordStoreMovement(input: { itemId: number; movementType: "received" | "issued" | "adjustment"; quantity: number; reference?: string | null }, userId: number) {
  const db = await requireDb();
  if (input.quantity <= 0) throw new Error("INVALID_QUANTITY");
  await db.insert(storeMovements).values({ ...input, quantity: String(input.quantity) });
  await writeAudit(userId, "store.movement", "store_item", input.itemId, input);
  return { ok: true };
}

export async function listTimetable() {
  const db = await requireDb();
  return db.select({ entry: timetableEntries, grade: grades, subject: subjects, teacher: users, staff: staffProfiles }).from(timetableEntries).leftJoin(grades, eq(grades.id, timetableEntries.gradeId)).leftJoin(subjects, eq(subjects.id, timetableEntries.subjectId)).leftJoin(users, eq(users.id, timetableEntries.teacherUserId)).leftJoin(staffProfiles, eq(staffProfiles.userId, timetableEntries.teacherUserId)).orderBy(timetableEntries.dayOfWeek, timetableEntries.period);
}

export function isMasterTimetableAdmin(userRole?: string | null, staffRole?: string | null) {
  return userRole === "admin" || staffRole === "super_admin" || staffRole === "admin" || staffRole === "deputy_head" || staffRole === "head_teacher";
}
export async function canViewMasterTimetable(userId: number, userRole?: string | null) {
  const db = await requireDb();
  const profile = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  return isMasterTimetableAdmin(userRole, profile?.role) || profile?.role === "class_teacher";
}
export async function canManageMasterTimetable(userId: number, userRole?: string | null) {
  const db = await requireDb();
  const profile = (await db.select({ role: staffProfiles.role }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  return isMasterTimetableAdmin(userRole, profile?.role);
}

export async function getPersonalTimetable(userId: number) {
  const db = await requireDb();
  const profile = (await db.select({ displayName: staffProfiles.displayName, teacherCode: staffProfiles.teacherCode }).from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1))[0];
  const user = (await db.select({ name: users.name, username: users.username }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const entries = await db.select({ entry: timetableEntries, grade: grades, subject: subjects })
    .from(timetableEntries)
    .leftJoin(grades, eq(grades.id, timetableEntries.gradeId))
    .leftJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .where(eq(timetableEntries.teacherUserId, userId))
    .orderBy(timetableEntries.dayOfWeek, timetableEntries.period);
  return { teacherName: profile?.displayName ?? user?.name ?? user?.username ?? "Teacher", teacherCode: profile?.teacherCode ?? null, entries };
}

export async function listTeacherCodes() {
  const db = await requireDb();
  const rows = await db.select({ profile: staffProfiles, user: users }).from(staffProfiles).leftJoin(users, eq(users.id, staffProfiles.userId)).orderBy(staffProfiles.createdAt, staffProfiles.id);
  const used = new Set(rows.map(row => row.profile.teacherCode).filter((code): code is number => code !== null));
  let next = 1;
  for (const row of rows) { if (row.profile.teacherCode === null) { while (used.has(next)) next += 1; await db.update(staffProfiles).set({ teacherCode: next }).where(eq(staffProfiles.id, row.profile.id)); row.profile.teacherCode = next; used.add(next); next += 1; } }
  return rows;
}

export async function updateTeacherCode(input: { staffProfileId: number; teacherCode: number }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(staffProfiles).where(eq(staffProfiles.id, input.staffProfileId)).limit(1))[0];
  if (!current) throw new Error("TEACHER_NOT_FOUND");
  const other = (await db.select().from(staffProfiles).where(eq(staffProfiles.teacherCode, input.teacherCode)).limit(1))[0];
  if (other && other.id !== input.staffProfileId) {
    await db.update(staffProfiles).set({ teacherCode: null }).where(eq(staffProfiles.id, input.staffProfileId));
    await db.update(staffProfiles).set({ teacherCode: current.teacherCode }).where(eq(staffProfiles.id, other.id));
  }
  await db.update(staffProfiles).set({ teacherCode: input.teacherCode }).where(eq(staffProfiles.id, input.staffProfileId));
  await writeAudit(userId, "timetable.teacher_code.update", "staff_profile", input.staffProfileId, input);
  return { ok: true };
}

export function timetableConflicts(entries: Array<{ dayOfWeek: number; period: number; gradeId: number; teacherUserId: number; room?: string | null }>) {
  const seen = new Set<string>();
  const conflicts: string[] = [];
  for (const entry of entries) {
    for (const key of [`grade:${entry.dayOfWeek}:${entry.period}:${entry.gradeId}`, `teacher:${entry.dayOfWeek}:${entry.period}:${entry.teacherUserId}`, entry.room ? `room:${entry.dayOfWeek}:${entry.period}:${entry.room}` : ""]) {
      if (key && seen.has(key)) conflicts.push(key);
      if (key) seen.add(key);
    }
  }
  return conflicts;
}

export async function generateTimetable(entries: Array<{ dayOfWeek: number; period: number; gradeId: number; subjectId: number; teacherUserId: number; room?: string | null }>, userId: number) {
  const conflicts = timetableConflicts(entries);
  if (conflicts.length) throw new Error(`TIMETABLE_CLASH:${conflicts.join(",")}`);
  const db = await requireDb();
  if (entries.length) await db.insert(timetableEntries).values(entries);
  await writeAudit(userId, "timetable.generate", "timetable", null, { count: entries.length });
  return { placed: entries.length, conflicts: [] };
}

export async function listTimetableRequirements(academicYear?: number) {
  const db = await requireDb();
  const year = academicYear ?? Number((await getSettings()).academicYear);
  return db.select({ requirement: timetableRequirements, grade: grades, subject: subjects }).from(timetableRequirements).innerJoin(grades, eq(grades.id, timetableRequirements.gradeId)).innerJoin(subjects, eq(subjects.id, timetableRequirements.subjectId)).where(eq(timetableRequirements.academicYear, year)).orderBy(grades.name, subjects.name);
}

export async function setTimetableRequirement(input: { gradeId: number; subjectId: number; academicYear: number; periodsPerWeek: number }, userId: number) {
  const db = await requireDb();
  if (input.periodsPerWeek <= 0) await db.delete(timetableRequirements).where(and(eq(timetableRequirements.gradeId, input.gradeId), eq(timetableRequirements.subjectId, input.subjectId), eq(timetableRequirements.academicYear, input.academicYear)));
  else await db.insert(timetableRequirements).values(input).onDuplicateKeyUpdate({ set: { periodsPerWeek: input.periodsPerWeek } });
  await writeAudit(userId, "timetable.requirement.set", "timetable_requirement", `${input.gradeId}:${input.subjectId}:${input.academicYear}`, input);
}

export async function generateAutomaticTimetable(input: { academicYear?: number; regenerate: boolean; days?: number; periodsPerDay?: number }, userId: number) {
  const db = await requireDb();
  const academicYear = input.academicYear ?? Number((await getSettings()).academicYear);
  const days = input.days ?? 5; const periodsPerDay = input.periodsPerDay ?? 9;
  if (input.regenerate) await db.delete(timetableEntries);
  const requirements = await db.select({ requirement: timetableRequirements, grade: grades, subject: subjects }).from(timetableRequirements).innerJoin(grades, eq(grades.id, timetableRequirements.gradeId)).innerJoin(subjects, eq(subjects.id, timetableRequirements.subjectId)).where(eq(timetableRequirements.academicYear, academicYear));
  const allocations = await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.academicYear, academicYear), eq(teacherAllocations.status, "active")));
  const eligibleByGradeSubject = new Map<string, number[]>();
  for (const allocation of allocations) { const key = `${allocation.gradeId}:${allocation.subjectId}`; eligibleByGradeSubject.set(key, [...(eligibleByGradeSubject.get(key) ?? []), allocation.teacherUserId]); }
  const existing = await db.select().from(timetableEntries);
  const occupied = new Set(existing.map(entry => `${entry.gradeId}:${entry.dayOfWeek}:${entry.period}`)); const teacherBusy = new Set(existing.map(entry => `${entry.teacherUserId}:${entry.dayOfWeek}:${entry.period}`)); const teacherLoad = new Map<number, number>();
  for (const entry of existing) teacherLoad.set(entry.teacherUserId, (teacherLoad.get(entry.teacherUserId) ?? 0) + 1);
  const counts = new Map<string, number>(); for (const entry of existing) counts.set(`${entry.gradeId}:${entry.subjectId}`, (counts.get(`${entry.gradeId}:${entry.subjectId}`) ?? 0) + 1);
  const unplaced: Array<{ grade: string; subject: string; missing: number }> = []; let placed = 0;
  for (const row of requirements) {
    const key = `${row.requirement.gradeId}:${row.requirement.subjectId}`; const needed = Math.max(0, row.requirement.periodsPerWeek - (counts.get(key) ?? 0)); const teachers = Array.from(new Set(eligibleByGradeSubject.get(key) ?? [])); let missing = needed;
    for (let lesson = 0; lesson < needed; lesson += 1) {
      let best: { teacherId: number; day: number; period: number; load: number } | null = null;
      for (let day = 1; day <= days; day += 1) for (let period = 1; period <= periodsPerDay; period += 1) { if (occupied.has(`${row.requirement.gradeId}:${day}:${period}`)) continue; for (const teacherId of teachers) { if (teacherBusy.has(`${teacherId}:${day}:${period}`)) continue; const load = teacherLoad.get(teacherId) ?? 0; if (!best || load < best.load) best = { teacherId, day, period, load }; } }
      if (!best) continue;
      await db.insert(timetableEntries).values({ gradeId: row.requirement.gradeId, subjectId: row.requirement.subjectId, teacherUserId: best.teacherId, dayOfWeek: best.day, period: best.period, room: null });
      occupied.add(`${row.requirement.gradeId}:${best.day}:${best.period}`); teacherBusy.add(`${best.teacherId}:${best.day}:${best.period}`); teacherLoad.set(best.teacherId, best.load + 1); placed += 1; missing -= 1;
    }
    if (missing > 0) unplaced.push({ grade: row.grade.name, subject: row.subject.name, missing });
  }
  await writeAudit(userId, "timetable.generate.automatic", "timetable", null, { academicYear, placed, unplaced, regenerate: input.regenerate });
  return { placed, unplaced, regenerated: input.regenerate, requirements: requirements.length, slots: days * periodsPerDay };
}

export async function setReportCardStatus(input: { learnerId: number; academicYear: number; term: string; assessmentType?: "mid_term" | "end_term"; status: "draft" | "generated" | "reviewed" | "approved" | "published" }, userId: number) {
  const db = await requireDb(); await db.insert(reportCards).values({ learnerId: input.learnerId, academicYear: input.academicYear, term: input.term, assessmentType: input.assessmentType ?? "end_term", status: input.status, generatedByUserId: userId }).onDuplicateKeyUpdate({ set: { status: input.status } }); await writeAudit(userId, `report_card.status.${input.status}`, "report_card", `${input.learnerId}:${input.academicYear}:${input.term}:${input.assessmentType ?? "end_term"}`, input); return { ok: true, status: input.status };
}

export async function listCommunications() {
  const db = await requireDb();
  return db.select().from(communications).orderBy(desc(communications.createdAt)).limit(100);
}

export async function createCommunication(input: { audience: "parents" | "staff" | "learners" | "all"; channel: "sms" | "notice" | "email"; subject: string; body: string }, userId: number) {
  const db = await requireDb();
  await db.insert(communications).values({ ...input, createdByUserId: userId, status: "draft" });
  await writeAudit(userId, "communication.create", "communication", null, { audience: input.audience, channel: input.channel });
  return { ok: true, status: "draft" };
}

export async function listAlumni() {
  const db = await requireDb();
  return db.select({ alumni: alumni, learner: learners }).from(alumni).innerJoin(learners, eq(learners.id, alumni.learnerId)).orderBy(desc(alumni.completionYear));
}

export async function archiveLearner(input: { learnerId: number; completionYear: number; destination?: string | null }, userId: number) {
  const db = await requireDb();
  await db.insert(alumni).values({ ...input, archivedByUserId: userId });
  await db.update(learners).set({ status: "archived" }).where(eq(learners.id, input.learnerId));
  await writeAudit(userId, "alumni.archive", "learner", input.learnerId, input);
  return { ok: true };
}

export async function listStaff(search?: string) {
  const db = await requireDb();
  const term = search?.trim();
  return db.select({ profile: staffProfiles, user: users }).from(staffProfiles).leftJoin(users, eq(users.id, staffProfiles.userId)).where(term ? or(like(staffProfiles.displayName, `%${term}%`), like(staffProfiles.email, `%${term}%`), like(staffProfiles.phone, `%${term}%`), like(staffProfiles.role, `%${term}%`), like(staffProfiles.status, `%${term}%`)) : undefined).orderBy(staffProfiles.displayName);
}

async function nextStaffCode() {
  const db = await requireDb();
  const result = (await db.select({ maxCode: sql<number>`coalesce(max(${staffProfiles.teacherCode}), 0)` }).from(staffProfiles))[0];
  return Number(result?.maxCode ?? 0) + 1;
}

function staffUsername(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 42);
  return base || `staff.${Date.now()}`;
}

export async function createStaff(input: { displayName: string; title?: string | null; designation?: string | null; phone?: string | null; email?: string | null; role: PeopleStaffRole; status: PeopleStaffStatus }, userId: number) {
  const db = await requireDb();
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("STAFF_NAME_REQUIRED");
  const code = await nextStaffCode();
  const base = staffUsername(displayName);
  let username = base; let suffix = 2;
  while ((await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)).length) username = `${base}.${suffix++}`;
  const userRow = (await db.insert(users).values({ openId: `people-staff-${randomUUID()}`, username, name: displayName, email: input.email?.trim() || null, role: "user", accountStatus: input.status === "active" ? "active" : "disabled", loginMethod: "people_registry", lastSignedIn: new Date() }).$returningId())[0];
  try {
    const staffRow = (await db.insert(staffProfiles).values({ userId: userRow.id, teacherCode: code, title: input.title?.trim() || null, displayName, designation: input.designation?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null, role: input.role, status: input.status === "active" ? "active" : "disabled" }).$returningId())[0];
    await writeAudit(userId, "staff.create", "staff_profile", staffRow.id, { userId: userRow.id, teacherCode: code, role: input.role, status: input.status });
    return { ok: true, id: staffRow.id, userId: userRow.id, teacherCode: code, username };
  } catch (error) {
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, userRow.id));
    await db.delete(users).where(eq(users.id, userRow.id));
    throw error;
  }
}

export async function updateStaff(input: { staffProfileId: number; displayName: string; title?: string | null; designation?: string | null; phone?: string | null; email?: string | null; role: PeopleStaffRole; status: PeopleStaffStatus }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(staffProfiles).where(eq(staffProfiles.id, input.staffProfileId)).limit(1))[0];
  if (!current) throw new Error("STAFF_NOT_FOUND");
  const displayName = input.displayName.trim(); if (!displayName) throw new Error("STAFF_NAME_REQUIRED");
  await db.update(staffProfiles).set({ displayName, title: input.title?.trim() || null, designation: input.designation?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null, role: input.role, status: input.status === "active" ? "active" : "disabled" }).where(eq(staffProfiles.id, input.staffProfileId));
  await db.update(users).set({ name: displayName, email: input.email?.trim() || null, accountStatus: input.status === "active" ? "active" : "disabled" }).where(eq(users.id, current.userId));
  await writeAudit(userId, "staff.update", "staff_profile", input.staffProfileId, { role: input.role, status: input.status });
  return { ok: true };
}

export async function setStaffStatus(input: { staffProfileId: number; status: PeopleStaffStatus }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(staffProfiles).where(eq(staffProfiles.id, input.staffProfileId)).limit(1))[0];
  if (!current) throw new Error("STAFF_NOT_FOUND");
  await db.update(staffProfiles).set({ status: input.status === "active" ? "active" : "disabled" }).where(eq(staffProfiles.id, input.staffProfileId));
  await db.update(users).set({ accountStatus: input.status === "active" ? "active" : "disabled" }).where(eq(users.id, current.userId));
  await writeAudit(userId, `staff.${input.status}`, "staff_profile", input.staffProfileId, input);
  return { ok: true };
}

export type PeopleImportKind = "learners" | "staff";
export type PeopleImportRow = Record<string, unknown>;

function textValue(row: PeopleImportRow, key: string) {
  const value = row[key]; return value == null ? "" : String(value).trim();
}

export async function previewPeopleImport(input: { kind: PeopleImportKind; rows: PeopleImportRow[] }) {
  const db = await requireDb();
  const errors: Array<{ row: number; message: string }> = [];
  const preview: Array<Record<string, unknown>> = [];
  if (!input.rows.length) return { kind: input.kind, total: 0, valid: 0, errors: [{ row: 0, message: "The workbook contains no data rows." }], preview };
  if (input.rows.length > 500) return { kind: input.kind, total: input.rows.length, valid: 0, errors: [{ row: 0, message: "Import limit is 500 rows per confirmation." }], preview };
  const gradeRows = await db.select().from(grades);
  const seenAdmissions = new Set<string>();
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const rowNumber = index + 2;
    if (input.kind === "learners") {
      const fullName = textValue(row, "learnerName") || textValue(row, "fullName");
      const admissionNumber = (textValue(row, "admissionNumber") || textValue(row, "admissionNo")).toUpperCase();
      const gradeName = textValue(row, "gradeName") || textValue(row, "grade");
      const stream = textValue(row, "stream");
      const grade = gradeRows.find(item => item.name.toLowerCase() === gradeName.toLowerCase() && (!stream || (item.stream ?? "").toLowerCase() === stream.toLowerCase()));
      const rawStatus = textValue(row, "status").toLowerCase();
      const status = rawStatus === "inactive" ? "inactive" : "active";
      if (rawStatus && rawStatus !== "active" && rawStatus !== "inactive") errors.push({ row: rowNumber, message: "Status must be active or inactive." });
      if (!fullName) errors.push({ row: rowNumber, message: "Learner name is required." });
      if (!admissionNumber) errors.push({ row: rowNumber, message: "Admission number is required." });
      if (seenAdmissions.has(admissionNumber)) errors.push({ row: rowNumber, message: `Duplicate admission number in workbook: ${admissionNumber}.` });
      if (admissionNumber && (await db.select({ id: learners.id }).from(learners).where(eq(learners.admissionNumber, admissionNumber)).limit(1)).length) errors.push({ row: rowNumber, message: `Admission number already exists: ${admissionNumber}.` });
      if (!grade) errors.push({ row: rowNumber, message: `Grade/class not found: ${gradeName}${stream ? ` ${stream}` : ""}.` });
      seenAdmissions.add(admissionNumber);
      if (fullName && admissionNumber && grade) preview.push({ row: rowNumber, learnerName: fullName, admissionNumber, gradeId: grade.id, grade: `${grade.name}${grade.stream ? ` ${grade.stream}` : ""}`, guardianName: textValue(row, "guardianName") || textValue(row, "parentGuardianName") || null, guardianIdNumber: textValue(row, "guardianIdNumber") || textValue(row, "parentGuardianId") || null, guardianPhone: textValue(row, "guardianPhone") || textValue(row, "parentGuardianPhone") || null, status });
    } else {
      const displayName = textValue(row, "staffName") || textValue(row, "displayName") || textValue(row, "name");
      const role = (textValue(row, "role") || "teacher") as PeopleStaffRole;
      const allowedRoles: PeopleStaffRole[] = ["teacher", "class_teacher", "senior_teacher", "deputy_head", "head_teacher", "finance", "storekeeper", "other"];
      if (!displayName) errors.push({ row: rowNumber, message: "Staff name is required." });
      if (!allowedRoles.includes(role)) errors.push({ row: rowNumber, message: `Unknown staff role: ${role}.` });
      const rawStatus = textValue(row, "status").toLowerCase();
      const email = textValue(row, "email");
      const status = rawStatus === "inactive" ? "inactive" : "active";
      if (rawStatus && rawStatus !== "active" && rawStatus !== "inactive") errors.push({ row: rowNumber, message: "Status must be active or inactive." });
      if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push({ row: rowNumber, message: "Email format is invalid." });
      if (displayName && allowedRoles.includes(role)) preview.push({ row: rowNumber, displayName, title: textValue(row, "title") || null, designation: textValue(row, "designation") || textValue(row, "roleLabel") || null, phone: textValue(row, "phone") || null, email: email || null, role, status });
    }
  }
  return { kind: input.kind, total: input.rows.length, valid: preview.length, errors, preview };
}

export async function importPeopleRows(input: { kind: PeopleImportKind; rows: PeopleImportRow[] }, userId: number) {
  const checked = await previewPeopleImport(input);
  if (checked.errors.length) throw new Error(`IMPORT_VALIDATION_FAILED:${JSON.stringify(checked.errors.slice(0, 10))}`);
  let created = 0;
  for (const row of checked.preview as Array<Record<string, unknown>>) {
    if (input.kind === "learners") {
      await createLearner({ fullName: String(row.learnerName), admissionNumber: String(row.admissionNumber), guardianName: row.guardianName ? String(row.guardianName) : null, guardianIdNumber: row.guardianIdNumber ? String(row.guardianIdNumber) : null, guardianPhone: row.guardianPhone ? String(row.guardianPhone) : null, gradeId: Number(row.gradeId), status: row.status === "inactive" ? "inactive" : "active" }, userId);
    } else {
      await createStaff({ displayName: String(row.displayName), title: row.title ? String(row.title) : null, designation: row.designation ? String(row.designation) : null, phone: row.phone ? String(row.phone) : null, email: row.email ? String(row.email) : null, role: String(row.role) as PeopleStaffRole, status: row.status === "inactive" ? "inactive" : "active" }, userId);
    }
    created += 1;
  }
  await writeAudit(userId, "people.bulk_import", input.kind, null, { rows: created });
  return { ok: true, created };
}

export type StaffRole = "teacher" | "class_teacher" | "senior_teacher" | "deputy_head" | "head_teacher" | "finance" | "storekeeper" | "other";

export async function updateStaffRole(input: { staffProfileId: number; role: StaffRole }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(staffProfiles).where(eq(staffProfiles.id, input.staffProfileId)).limit(1))[0];
  if (!current) throw new Error("STAFF_NOT_FOUND");
  await db.update(staffProfiles).set({ role: input.role }).where(eq(staffProfiles.id, input.staffProfileId));
  await writeAudit(userId, "staff.role.update", "staff_profile", input.staffProfileId, { from: current.role, to: input.role });
  return { ok: true, role: input.role };
}

export async function listAcademicCatalog() {
  const db = await requireDb();
  const [gradeRows, subjectRows] = await Promise.all([db.select().from(grades).orderBy(grades.name, grades.stream), db.select().from(subjects).orderBy(subjects.name)]);
  return { grades: gradeRows, subjects: subjectRows };
}

export async function createGradeClass(input: { name: string; stream?: string | null }, userId: number) {
  const db = await requireDb();
  const name = input.name.trim();
  const stream = input.stream?.trim() || null;
  const duplicate = (await db.select({ id: grades.id }).from(grades).where(stream
    ? and(eq(grades.name, name), eq(grades.stream, stream))
    : and(eq(grades.name, name), sql`${grades.stream} IS NULL`)).limit(1))[0];
  if (duplicate) throw new Error("GRADE_CLASS_ALREADY_EXISTS");
  await db.insert(grades).values({ name, stream });
  await writeAudit(userId, "grade.create", "grade", name, { name, stream });
  return { ok: true };
}

export async function createLearningArea(input: { name: string; code: string }, userId: number) {
  const db = await requireDb();
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const duplicate = (await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.code, code)).limit(1))[0];
  if (duplicate) throw new Error("LEARNING_AREA_CODE_ALREADY_EXISTS");
  await db.insert(subjects).values({ name, code });
  await writeAudit(userId, "learning_area.create", "subject", code, { name, code });
  return { ok: true };
}

export async function listAllocations(filters?: { academicYear?: number; term?: string; status?: "active" | "inactive" | "replaced" }, userId?: number) {
  const db = await requireDb();
  const actor = userId ? (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0] : null;
  const where = filters?.academicYear || filters?.term || filters?.status || actor?.role === "user" ? and(filters?.academicYear ? eq(teacherAllocations.academicYear, filters.academicYear) : undefined, filters?.term ? eq(teacherAllocations.term, filters.term) : undefined, filters?.status ? eq(teacherAllocations.status, filters.status) : undefined, actor?.role === "user" && userId ? eq(teacherAllocations.teacherUserId, userId) : undefined) : undefined;
  return db.select({ allocation: teacherAllocations, staff: staffProfiles, grade: grades, subject: subjects }).from(teacherAllocations).leftJoin(staffProfiles, eq(staffProfiles.userId, teacherAllocations.teacherUserId)).leftJoin(grades, eq(grades.id, teacherAllocations.gradeId)).leftJoin(subjects, eq(subjects.id, teacherAllocations.subjectId)).where(where).orderBy(desc(teacherAllocations.id));
}

export type AllocationType = "class_teacher" | "learning_area" | "co_teacher" | "substitute" | "activity";
export type AllocationStatus = "active" | "inactive" | "replaced";

export function allocationContextConflict(input: { gradeId: number; subjectId: number; allocationType: AllocationType; startsOn?: string | null; endsOn?: string | null }, existing: { gradeId: number; subjectId: number; allocationType: AllocationType; status: AllocationStatus; startsOn: string | Date | null; endsOn: string | Date | null }) {
  if (existing.status !== "active" || existing.gradeId !== input.gradeId) return false;
  if (input.allocationType === "class_teacher") return existing.allocationType === "class_teacher";
  if (existing.allocationType === "class_teacher" || existing.subjectId !== input.subjectId) return false;
  const start = input.startsOn ?? null; const end = input.endsOn ?? null;
  const existingStart = existing.startsOn ? String(existing.startsOn).slice(0, 10) : null; const existingEnd = existing.endsOn ? String(existing.endsOn).slice(0, 10) : null;
  return (!existingStart || !end || existingStart <= end) && (!existingEnd || !start || existingEnd >= start);
}

export async function saveTeacherAllocation(input: { teacherUserId: number; gradeId: number; subjectId: number; academicYear: number; term: string; allocationType: AllocationType; startsOn?: string | null; endsOn?: string | null }, userId: number) {
  const db = await requireDb();
  if (input.term.trim().length < 2) throw new Error("TERM_REQUIRED");
  if (input.allocationType !== "class_teacher" && input.subjectId <= 0) throw new Error("LEARNING_AREA_REQUIRED");
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) throw new Error("INVALID_DATE_RANGE");
  const teacher = (await db.select().from(users).where(eq(users.id, input.teacherUserId)).limit(1))[0];
  const grade = (await db.select().from(grades).where(eq(grades.id, input.gradeId)).limit(1))[0];
  if (!teacher || !grade) throw new Error("ALLOCATION_CONTEXT_NOT_FOUND");
  const active = await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.gradeId, input.gradeId), eq(teacherAllocations.academicYear, input.academicYear), eq(teacherAllocations.term, input.term), eq(teacherAllocations.status, "active")));
  const conflict = active.find(row => allocationContextConflict(input, row));
  if (conflict && conflict.teacherUserId !== input.teacherUserId) throw new Error(input.allocationType === "class_teacher" ? "CLASS_TEACHER_CONFLICT" : "LEARNING_AREA_CONFLICT");
  const existing = (await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.teacherUserId, input.teacherUserId), eq(teacherAllocations.gradeId, input.gradeId), eq(teacherAllocations.subjectId, input.subjectId), eq(teacherAllocations.academicYear, input.academicYear), eq(teacherAllocations.term, input.term), eq(teacherAllocations.allocationType, input.allocationType))).limit(1))[0];
  const values = { ...input, startsOn: input.startsOn ? new Date(input.startsOn) : null, endsOn: input.endsOn ? new Date(input.endsOn) : null, status: "active" as const };
  if (existing) await db.update(teacherAllocations).set(values).where(eq(teacherAllocations.id, existing.id));
  else await db.insert(teacherAllocations).values(values);
  await writeAudit(userId, existing ? "allocation.update" : "allocation.create", "teacher_allocation", existing?.id ?? null, input);
  return { ok: true, id: existing?.id ?? null };
}

export async function changeTeacherAllocationStatus(input: { allocationId: number; status: AllocationStatus; replacedByUserId?: number | null }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(teacherAllocations).where(eq(teacherAllocations.id, input.allocationId)).limit(1))[0];
  if (!current) throw new Error("ALLOCATION_NOT_FOUND");
  if (input.status === "replaced" && !input.replacedByUserId) throw new Error("REPLACEMENT_TEACHER_REQUIRED");
  await db.update(teacherAllocations).set({ status: input.status, replacedByUserId: input.replacedByUserId ?? null }).where(eq(teacherAllocations.id, input.allocationId));
  await writeAudit(userId, `allocation.${input.status}`, "teacher_allocation", input.allocationId, input);
  return { ok: true };
}

export async function saveSettings(input: { schoolName: string; motto?: string | null; currentTerm: string; academicYear: number; includeFeesOnReportCard: boolean; showPercentagesOnReportCard?: boolean }, userId: number) {
  const db = await requireDb();
  const current = (await db.select().from(schoolSettings).limit(1))[0];
  const values = { ...input, includeFeesOnReportCard: input.includeFeesOnReportCard ? 1 : 0, showPercentagesOnReportCard: input.showPercentagesOnReportCard ? 1 : 0 };
  if (current) await db.update(schoolSettings).set(values).where(eq(schoolSettings.id, current.id));
  else await db.insert(schoolSettings).values(values);
  await writeAudit(userId, "settings.update", "school_settings", current?.id ?? null, values);
  return getSettings();
}

export async function listAuditLogs() {
  const db = await requireDb();
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
}
