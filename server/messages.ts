import { and, desc, eq, like, or, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { grades, guardians, learners, learnerGuardians, nexusMessageRecipients, nexusMessages, staffProfiles, users } from "../drizzle/schema";
import { requireDb, writeAudit } from "./smis";

type RecipientKind = "guardian" | "learner" | "staff" | "grade" | "guardian_grade";
export type MessageRecipient = { id: number; type: Exclude<RecipientKind, "grade" | "guardian_grade">; label: string; detail?: string | null };

export async function listMessageRecipients(kind: RecipientKind, search?: string, gradeId?: number) {
  const db = await requireDb();
  const q = search?.trim() ? `%${search.trim()}%` : null;
  if (kind === "learner") return db.select({ id: learners.id, label: learners.fullName, detail: learners.admissionNumber }).from(learners).where(and(q ? or(like(learners.fullName, q), like(learners.admissionNumber, q)) : undefined, gradeId ? eq(learners.gradeId, gradeId) : undefined, eq(learners.status, "active"))).orderBy(learners.fullName).limit(100);
  if (kind === "staff") return db.select({ id: staffProfiles.userId, label: staffProfiles.displayName, detail: staffProfiles.designation }).from(staffProfiles).where(and(q ? or(like(staffProfiles.displayName, q), like(staffProfiles.email, q)) : undefined, eq(staffProfiles.status, "active"))).orderBy(staffProfiles.displayName).limit(100);
  if (kind === "guardian" || kind === "guardian_grade") {
    const rows = await db.select({ id: guardians.id, label: guardians.fullName, detail: guardians.phone, gradeId: learners.gradeId }).from(guardians).innerJoin(learnerGuardians, eq(learnerGuardians.guardianId, guardians.id)).innerJoin(learners, eq(learners.id, learnerGuardians.learnerId)).where(and(q ? or(like(guardians.fullName, q), like(guardians.phone, q)) : undefined, kind === "guardian_grade" && gradeId ? eq(learners.gradeId, gradeId) : undefined)).orderBy(guardians.fullName).limit(200);
    return Array.from(new Map(rows.map(row => [row.id, { id: row.id, label: row.label, detail: row.detail }])).values());
  }
  return [];
}

export async function listMessageGrades() {
  const db = await requireDb();
  return db.select({ id: grades.id, label: grades.name, stream: grades.stream }).from(grades).orderBy(grades.name, grades.stream);
}

export async function previewMessageRecipients(kind: RecipientKind, ids: number[], gradeId: number | undefined) {
  if (kind === "grade" || kind === "guardian_grade") return listMessageRecipients(kind, undefined, gradeId);
  if (!ids.length) return [];
  const rows = await listMessageRecipients(kind);
  return rows.filter(row => ids.includes(row.id));
}

export async function queueNexusMessage(input: { category: string; channel: "sms" | "email" | "in_app" | "whatsapp"; body: string; kind: RecipientKind; ids: number[]; gradeId?: number }, userId: number) {
  const body = input.body.trim();
  if (!body) throw new Error("MESSAGE_BODY_REQUIRED");
  const recipients = await previewMessageRecipients(input.kind, input.ids, input.gradeId);
  if (!recipients.length) throw new Error("MESSAGE_RECIPIENTS_REQUIRED");
  const db = await requireDb();
  const inserted = (await db.insert(nexusMessages).values({ category: input.category.trim() || "announcement", channel: input.channel, body, status: "queued", selectionJson: JSON.stringify({ kind: input.kind, ids: input.ids, gradeId: input.gradeId ?? null }), createdByUserId: userId }).$returningId())[0];
  await db.insert(nexusMessageRecipients).values(recipients.map(row => ({ messageId: inserted.id, recipientType: input.kind === "guardian_grade" ? "guardian" : input.kind === "grade" ? "learner" : input.kind, recipientId: row.id, label: row.label, status: "queued" as const })));
  await writeAudit(userId, "message.queued", "nexus_message", inserted.id, { channel: input.channel, recipientCount: recipients.length, kind: input.kind });
  return { id: inserted.id, status: "queued", recipientCount: recipients.length, note: "Queued in NEXUS. External delivery is not enabled until an approved provider is configured." };
}

export async function listNexusMessages() {
  const db = await requireDb();
  return db.select({ message: nexusMessages, recipients: nexusMessageRecipients }).from(nexusMessages).leftJoin(nexusMessageRecipients, eq(nexusMessageRecipients.messageId, nexusMessages.id)).orderBy(desc(nexusMessages.createdAt)).limit(300);
}
