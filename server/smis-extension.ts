import { desc, eq, like } from "drizzle-orm";
import { getDb } from "./db";
import { expenditures, guardians, learnerGuardians, notifications, permissions, userPermissions } from "../drizzle/schema";
import { effectivePermissions, permissionCatalog, requireDb, writeAudit } from "./smis";
import { attendances, learners, marks, feeStructures, payments, storeItems, storeMovements, subjects, grades } from "../drizzle/schema";

export async function listGuardians(search?: string) {
  const db = await requireDb();
  return db.select().from(guardians).where(search ? like(guardians.fullName, `%${search}%`) : undefined).orderBy(guardians.fullName);
}

export async function saveGuardian(input: { fullName: string; phone?: string | null; email?: string | null; communicationPreference: "sms" | "email" | "phone"; learnerId?: number; relationship?: string }, userId: number) {
  const db = await requireDb();
  const guardianId = (await db.insert(guardians).values(input).$returningId())[0].id;
  if (input.learnerId) await db.insert(learnerGuardians).values({ learnerId: input.learnerId, guardianId, relationship: input.relationship || "Guardian", isPrimary: 1 });
  await writeAudit(userId, "guardian.create", "guardian", guardianId, input);
  return { id: guardianId };
}

export async function listExpenditures() {
  const db = await requireDb();
  return db.select().from(expenditures).orderBy(desc(expenditures.expenditureDate)).limit(100);
}

export async function recordExpenditure(input: { expenditureDate: string; amount: number; category: string; description: string; responsiblePerson: string }, userId: number) {
  const db = await requireDb();
  if (input.amount <= 0) throw new Error("INVALID_AMOUNT");
  const row = (await db.insert(expenditures).values({ ...input, expenditureDate: new Date(input.expenditureDate), amount: String(input.amount), createdByUserId: userId }).$returningId())[0];
  await writeAudit(userId, "finance.expenditure", "expenditure", row.id, input);
  return { ok: true, id: row.id };
}

export async function financialSummary() {
  const db = await requireDb();
  const [paymentRows, expenditureRows] = await Promise.all([db.select().from(payments), db.select().from(expenditures)]);
  return { collected: paymentRows.reduce((s, row) => s + Number(row.amount), 0), expenditure: expenditureRows.reduce((s, row) => s + Number(row.amount), 0), balance: paymentRows.reduce((s, row) => s + Number(row.amount), 0) - expenditureRows.reduce((s, row) => s + Number(row.amount), 0) };
}

export async function listNotifications() {
  const db = await requireDb();
  return db.select().from(notifications).where(eq(notifications.status, "published")).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function createNotification(input: { audience: "parents" | "staff" | "learners" | "all"; title: string; body: string; status: "draft" | "published" }, userId: number) {
  const db = await requireDb();
  const row = (await db.insert(notifications).values({ ...input, createdByUserId: userId }).$returningId())[0];
  await writeAudit(userId, "notification.create", "notification", row.id, input);
  return { ok: true, id: row.id };
}

export async function getPermissionMatrix(userId?: number) {
  const db = await requireDb();
  const catalog = permissionCatalog.map(([permissionKey, description]) => ({ permissionKey, description }));
  if (!userId) return { catalog, overrides: [] };
  return { catalog, overrides: await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)) };
}

export async function setUserPermission(input: { userId: number; permissionKey: string; allowed: boolean }, actorId: number) {
  const db = await requireDb();
  if (!permissionCatalog.some(([key]) => key === input.permissionKey)) throw new Error("UNKNOWN_PERMISSION");
  await db.insert(userPermissions).values({ userId: input.userId, permissionKey: input.permissionKey, allowed: input.allowed ? 1 : 0 }).onDuplicateKeyUpdate({ set: { allowed: input.allowed ? 1 : 0 } });
  await writeAudit(actorId, "permissions.update", "user", input.userId, input);
  return { ok: true };
}

export async function aiFacts(question: string, userId: number, role: string) {
  const permissions = await effectivePermissions(userId, role);
  const canFinance = permissions.includes("*") || permissions.includes("finance.view");
  const canAcademic = permissions.includes("*") || permissions.includes("assessments.view");
  const canAttendance = permissions.includes("*") || permissions.includes("attendance.view");
  const canStore = permissions.includes("*") || permissions.includes("store.view");
  const db = await requireDb();
  const q = question.toLowerCase();
  const facts: Array<{ type: "database fact" | "calculation" | "recommendation"; text: string }> = [];
  if (q.includes("attendance") && canAttendance) {
    const rows = await db.select({ attendance: attendances, learner: learners }).from(attendances).innerJoin(learners, eq(learners.id, attendances.learnerId));
    const absent = rows.filter(row => row.attendance.status === "absent" || row.attendance.status === "late");
    facts.push({ type: "database fact", text: `${absent.length} attendance records are absent or late in the available register.` });
    facts.push({ type: "recommendation", text: "Review learners with repeated absences and record guardian follow-up as a communication item." });
  } else if ((q.includes("fee") || q.includes("finance")) && canFinance) {
    const [feeRows, paymentRows] = await Promise.all([db.select().from(feeStructures), db.select().from(payments)]);
    facts.push({ type: "calculation", text: `KES ${feeRows.reduce((s, row) => s + Number(row.amount), 0).toLocaleString()} is configured in fee structures and KES ${paymentRows.reduce((s, row) => s + Number(row.amount), 0).toLocaleString()} is recorded in payments.` });
  } else if ((q.includes("performance") || q.includes("mark") || q.includes("learning area")) && canAcademic) {
    const rows = await db.select({ mark: marks, subject: subjects }).from(marks).innerJoin(subjects, eq(subjects.id, marks.subjectId));
    const average = rows.length ? rows.reduce((s, row) => s + Number(row.mark.average), 0) / rows.length : 0;
    facts.push({ type: "calculation", text: `The current stored mark average across ${rows.length} mark rows is ${average.toFixed(1)}%.` });
  } else if (q.includes("stock") && canStore) {
    const rows = await db.select({ item: storeItems, movement: storeMovements }).from(storeItems).leftJoin(storeMovements, eq(storeItems.id, storeMovements.itemId));
    const low = rows.filter(row => row.item && Number(row.item.reorderLevel) > 0);
    facts.push({ type: "database fact", text: `${low.length} inventory item records are configured for stock monitoring.` });
  } else if ((q.includes("fee") || q.includes("finance")) && !canFinance) {
    facts.push({ type: "database fact", text: "Your role does not have permission to view financial information." });
  } else {
    facts.push({ type: "recommendation", text: "Ask about attendance, academic performance, fees, finance, or stock. NEXUS AI only reports data the current user is authorized to access." });
  }
  await writeAudit(userId, "ai.query", "ai", null, { question, role, permissionsChecked: permissions.length });
  return { question, facts, permissionsChecked: permissions };
}
