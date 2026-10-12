import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { alumni, assessments, attendances, communications, expenditures, feeStructures, grades, guardians, learnerGuardians, learners, marks, notifications, payments, permissions, schoolSettings, staffProfiles, storeItems, storeMovements, subjects, teacherAllocations, timetableEntries, userPermissions, users } from "../drizzle/schema";
import { permissionCatalog } from "./smis";

async function main() {
const seedUsername = process.env.NEXUS_SEED_USERNAME ?? "superadmin";
const seedPassword = process.env.NEXUS_SEED_PASSWORD;
const db = await getDb();
if (!db) throw new Error("DATABASE_UNAVAILABLE");

	const existingUsers = await db.select().from(users).where(eq(users.openId, "demo-owner")).limit(1);
	if (!existingUsers[0] && !seedPassword) throw new Error("NEXUS_SEED_PASSWORD is required when creating the initial IAM administrator");
	const owner = existingUsers[0] ?? (await db.insert(users).values({ openId: "demo-owner", username: seedUsername, name: "Erickology", email: "admin@ebunangwe.school", passwordHash: await bcrypt.hash(seedPassword!, 12), loginMethod: "iam", role: "admin", accountStatus: "active", mustChangePassword: 1 }).$returningId())[0];
	const ownerId = owner.id;
	const ownerRecord = (await db.select().from(users).where(eq(users.id, ownerId)).limit(1))[0];
	if (ownerRecord && (!ownerRecord.username || !ownerRecord.passwordHash)) {
	  if (!seedPassword) throw new Error("NEXUS_SEED_PASSWORD is required to provision the initial IAM administrator");
	  await db.update(users).set({ username: seedUsername, passwordHash: await bcrypt.hash(seedPassword, 12), loginMethod: "iam", accountStatus: "active", mustChangePassword: 1 }).where(eq(users.id, ownerId));
	}

for (const [permissionKey, description] of permissionCatalog) {
  if (!(await db.select().from(permissions).where(eq(permissions.permissionKey, permissionKey)).limit(1)).length) await db.insert(permissions).values({ permissionKey, description });
}

if (!(await db.select().from(schoolSettings).limit(1)).length) await db.insert(schoolSettings).values({ schoolName: "Ebunangwe Junior School", motto: "See the school day clearly.", currentTerm: "Term 2", academicYear: 2026, includeFeesOnReportCard: 1 });

	const gradeRows = await db.select().from(grades);
	const ensureGrade = async (name: string, stream: string) => gradeRows.find(row => row.name === name) ?? (await db.insert(grades).values({ name, stream, classTeacherUserId: ownerId }).$returningId())[0];
	const grade8 = await ensureGrade("Grade 8", "Blue");
	const grade7 = await ensureGrade("Grade 7", "Green");
	const grade9 = await ensureGrade("Grade 9", "Red");
const subjectRows = await db.select().from(subjects);
const subjectSeeds = [
  { name: "Mathematics", code: "MAT" },
  { name: "English", code: "ENG" },
  { name: "Integrated Science", code: "SCI" },
  { name: "Social Studies", code: "SST" },
];
for (const subject of subjectSeeds) if (!subjectRows.some(row => row.code === subject.code)) await db.insert(subjects).values(subject);
const subjectsNow = await db.select().from(subjects);

const staffExisting = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, ownerId)).limit(1);
if (!staffExisting.length) await db.insert(staffProfiles).values({ userId: ownerId, displayName: "Erickology", phone: "+254 700 000 001", role: "super_admin", status: "active" });

const learnerSeeds = [
  { admissionNumber: "G8-024", fullName: "Amina Mwende", guardianName: "Mary Mwende", guardianPhone: "+254 711 000 024", gradeId: grade8.id },
  { admissionNumber: "G8-031", fullName: "John Otieno", guardianName: "Otieno Peter", guardianPhone: "+254 711 000 031", gradeId: grade8.id },
  { admissionNumber: "G8-042", fullName: "Wanjiku Njeri", guardianName: "Jane Njeri", guardianPhone: "+254 711 000 042", gradeId: grade8.id },
	  { admissionNumber: "G8-051", fullName: "David Kiptoo", guardianName: "Kiptoo Amos", guardianPhone: "+254 711 000 051", gradeId: grade8.id },
	  { admissionNumber: "G7-014", fullName: "Faith Naliaka", guardianName: "Naliaka Ruth", guardianPhone: "+254 711 000 014", gradeId: grade7.id },
	  { admissionNumber: "G9-009", fullName: "Maryann Wangechi", guardianName: "Wangechi Jane", guardianPhone: "+254 711 000 009", gradeId: grade9.id },
];
for (const learner of learnerSeeds) {
  if (!(await db.select().from(learners).where(eq(learners.admissionNumber, learner.admissionNumber)).limit(1)).length) await db.insert(learners).values(learner);
}
const learnersNow = await db.select().from(learners);
if (!(await db.select().from(guardians).limit(1)).length) {
  const guardianId = (await db.insert(guardians).values({ fullName: "Mary Mwende", phone: "+254 711 000 024", email: "mary.mwende@example.test", communicationPreference: "sms" }).$returningId())[0].id;
  await db.insert(learnerGuardians).values({ learnerId: learnersNow[0].id, guardianId, relationship: "Mother", isPrimary: 1 });
}
if (!(await db.select().from(userPermissions).where(eq(userPermissions.userId, ownerId)).limit(1)).length) await db.insert(userPermissions).values({ userId: ownerId, permissionKey: "ai.access", allowed: 1 });
const assessmentExisting = await db.select().from(assessments).limit(1);
const assessment = assessmentExisting[0] ?? (await db.insert(assessments).values({ title: "Term 2 End Term", term: "Term 2", academicYear: 2026, gradeId: grade8.id, subjectId: subjectsNow[0]?.id ?? 1, teacherUserId: ownerId, assessmentType: "end_term", status: "draft" }).$returningId())[0];
for (const learner of learnersNow) {
  const present = learner.admissionNumber !== "G8-031";
  if (!(await db.select().from(attendances).where(eq(attendances.learnerId, learner.id)).limit(1)).length) await db.insert(attendances).values({ learnerId: learner.id, gradeId: learner.gradeId, attendanceDate: new Date(), status: present ? "present" : "absent", note: present ? null : "Guardian follow-up required" });
  for (let index = 0; index < Math.min(subjectsNow.length, 3); index += 1) {
    const subject = subjectsNow[index];
    if (!(await db.select().from(marks).where(eq(marks.learnerId, learner.id)).limit(1)).length) {
      const score = 62 + ((learner.id + index * 7) % 31);
      const level = score >= 90 ? "EE1" : score >= 75 ? "EE2" : score >= 58 ? "ME1" : "ME2";
      await db.insert(marks).values({ assessmentId: assessment.id, learnerId: learner.id, subjectId: subject.id, teacherUserId: assessment.teacherUserId, score: String(score), midTerm: String(score - 4), endTerm: String(score), average: String(score - 2), cbcLevel: level, teacherRemark: "Keep building confidence.", updatedByUserId: ownerId });
    }
  }
}
if (!(await db.select().from(feeStructures).limit(1)).length) {
  await db.insert(feeStructures).values([
    { gradeId: grade8.id, term: "Term 2", academicYear: 2026, itemName: "Tuition and activities", amount: "18000" },
    { gradeId: grade8.id, term: "Term 2", academicYear: 2026, itemName: "Lunch programme", amount: "6500" },
    { gradeId: grade7.id, term: "Term 2", academicYear: 2026, itemName: "Tuition and activities", amount: "18000" },
  ]);
}
if (!(await db.select().from(payments).limit(1)).length) await db.insert(payments).values([{ learnerId: learnersNow[0].id, amount: "12500", paymentMethod: "mpesa", reference: "NEXUS-DEMO-001" }, { learnerId: learnersNow[1].id, amount: "9000", paymentMethod: "cash", reference: "NEXUS-DEMO-002" }]);
if (!(await db.select().from(storeItems).limit(1)).length) {
  const itemIds = await db.insert(storeItems).values([{ name: "Exercise books", unit: "cartons", reorderLevel: "3" }, { name: "Chalk", unit: "boxes", reorderLevel: "5" }, { name: "First aid kits", unit: "kits", reorderLevel: "2" }]).$returningId();
  await db.insert(storeMovements).values([{ itemId: itemIds[0].id, movementType: "received", quantity: "18", reference: "Opening stock" }, { itemId: itemIds[0].id, movementType: "issued", quantity: "7", reference: "Grade 8" }, { itemId: itemIds[1].id, movementType: "received", quantity: "4", reference: "Opening stock" }, { itemId: itemIds[2].id, movementType: "received", quantity: "3", reference: "Opening stock" }]);
}
if (!(await db.select().from(teacherAllocations).limit(1)).length) await db.insert(teacherAllocations).values(subjectsNow.slice(0, 3).map(subject => ({ teacherUserId: ownerId, gradeId: grade8.id, subjectId: subject.id, academicYear: 2026 })));
if (!(await db.select().from(timetableEntries).limit(1)).length) await db.insert(timetableEntries).values([{ gradeId: grade8.id, subjectId: subjectsNow[0].id, teacherUserId: ownerId, dayOfWeek: 1, period: 1, room: "Room 8B" }, { gradeId: grade8.id, subjectId: subjectsNow[1].id, teacherUserId: ownerId, dayOfWeek: 1, period: 2, room: "Room 8B" }]);
if (!(await db.select().from(communications).limit(1)).length) await db.insert(communications).values({ audience: "parents", channel: "notice", subject: "Term 2 progress update", body: "CBC marklists are being reviewed this week. Please check in with the class teacher for any questions.", status: "draft", createdByUserId: ownerId });
if (!(await db.select().from(expenditures).limit(1)).length) await db.insert(expenditures).values({ expenditureDate: new Date(), amount: "8500", category: "Learning materials", description: "Term 2 exercise books and chalk", responsiblePerson: "Erickology", createdByUserId: ownerId });
if (!(await db.select().from(notifications).limit(1)).length) await db.insert(notifications).values({ audience: "all", title: "Term 2 marklist review", body: "Teachers should complete marklist review before Friday.", status: "published", createdByUserId: ownerId });

console.log("Seeded Kenyan SMIS modules", { ownerId, learners: learnersNow.length, subjects: subjectsNow.length });
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
