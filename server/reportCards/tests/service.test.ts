import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DATA, LOG, MATRIX } from "../server/nexusAdapter.ts";
import { buildReportBatch, getReportOptions, ReportError, saveReportCardComments } from "../server/reportCardService.ts";

import { U, seed } from "./fixtures.ts";
const base = { academicYear: 2026, term: "Term 2", assessmentType: "end_term" as const, includeFees: false };
const learner = (learnerId: number) => ({ kind: "learner" as const, learnerId });

beforeEach(() => seed());
const denied = (code: string) => (e: any) => e instanceof ReportError && e.code === code;
const row = (b: any, cardIdx: number, subject: string) => b.cards[cardIdx].rows.find((r: any) => r.subject === subject);

/* 1-2. data integrity and filtering */
test("learner report uses central marks for exactly the chosen year/term/type/learner/class", async () => {
  const b = await buildReportBatch({ ...base, target: learner(31) }, U.admin);
  const c = b.cards[0];
  assert.equal(c.learner.fullName, "Maryann Wangeci"); assert.equal(c.grade.label, "Grade 9 A"); assert.equal(c.classTeacher, "Class Teacher Nine");
  assert.deepEqual(c.rows.map(r => [r.subject, r.midTerm, r.endTerm, r.average, r.cbcLevel]),
    [["English", 50, 70, 60, "ME1"], ["Integrated Science", 90, 94, 92, "EE1"], ["Mathematics", 60, 80, 70, "ME1"]]);
  assert.equal(c.summary.totalAverage, 222); assert.equal(c.summary.termAverage, 74); assert.equal(c.summary.overall, "ME");
  assert.deepEqual(c.attendance, { daysOpen: 3, daysPresent: 2, daysAbsent: 1, percentage: 67 });
  assert.equal(c.comments.classTeacher, "Steady progress."); assert.equal(b.school.name, "Fixture School Name");
});
test("mid-term, other term and other year never leak into the end-term report", async () => {
  const mid = await buildReportBatch({ ...base, assessmentType: "mid_term", target: learner(31) }, U.admin);
  assert.deepEqual(mid.cards[0].rows.map(r => [r.subject, r.average]), [["Mathematics", 55]]);
  const t1 = await buildReportBatch({ ...base, term: "Term 1", target: learner(31) }, U.admin);
  assert.deepEqual(t1.cards[0].rows.map(r => [r.subject, r.average]), [["Mathematics", 11]]);
  const y25 = await buildReportBatch({ ...base, academicYear: 2025, target: learner(31) }, U.admin);
  assert.deepEqual(y25.cards[0].rows.map(r => [r.subject, r.average]), [["Mathematics", 22]]);
});
test("a class report keeps learners and classes apart; inactive learners are excluded", async () => {
  const b = await buildReportBatch({ ...base, target: { kind: "class", gradeId: 3 } }, U.admin);
  assert.deepEqual(b.cards.map(c => c.learner.id), [32, 31]);          // sorted by name: Brian, Maryann
  assert.equal(row(b, 0, "Mathematics").average, 40); assert.equal(row(b, 1, "Mathematics").average, 70);
  assert.equal(b.cards[0].rows.find(r => r.subject === "Integrated Science")!.state, "no_mark");
  assert.ok(b.cards.every(c => c.grade.id === 3));
});
test("grade report spans streams; unapproved assessments are 'pending' and show no mark", async () => {
  const g9 = await buildReportBatch({ ...base, target: { kind: "grade", gradeName: "Grade 9" } }, U.admin);
  assert.deepEqual(g9.cards.map(c => c.grade.label).sort(), ["Grade 9 A", "Grade 9 A", "Grade 9 B"]);
  const g8 = await buildReportBatch({ ...base, target: learner(21) }, U.admin);
  const sci = g8.cards[0].rows.find(r => r.subject === "Integrated Science")!;
  assert.equal(sci.state, "pending"); assert.equal(sci.average, null); assert.equal(sci.cbcLevel, null);
  assert.equal(g8.cards[0].summary.totalAverage, 77);                    // the draft 99 is not counted
});

/* 3. fees checkbox */
test("fees unchecked: no finance table is read and no fee data is in the payload", async () => {
  const b = await buildReportBatch({ ...base, includeFees: false, target: { kind: "class", gradeId: 3 } }, U.admin);
  assert.equal(b.feesStatus, "not_requested");
  assert.ok(!LOG.reads.includes("payments") && !LOG.reads.includes("feeStructures"));
  assert.ok(b.cards.every(c => !("fees" in c)));
  const { feesStatus, feesMessage, ...rest } = b as any;   // status flag only; it carries no money
  assert.equal(feesMessage, null);
  assert.ok(!/"fees"|arrears|amountPaid|balance|totalFees|35000|20000|15000/i.test(JSON.stringify(rest)));
});
test("fees checked: real totals per learner; zero balance, no-record and learner relationship are correct", async () => {
  const b = await buildReportBatch({ ...base, includeFees: true, target: { kind: "class", gradeId: 3 } }, U.admin);
  assert.equal(b.feesStatus, "ok");
  assert.deepEqual(b.cards.find(c => c.learner.id === 31)!.fees, { status: "ok", totalFees: 35000, amountPaid: 20000, balance: 15000, currency: "KES" });
  assert.deepEqual(b.cards.find(c => c.learner.id === 32)!.fees, { status: "ok", totalFees: 35000, amountPaid: 35000, balance: 0, currency: "KES" });
  const f8 = (await buildReportBatch({ ...base, includeFees: true, target: learner(21) }, U.admin)).cards[0].fees;
  assert.deepEqual(f8, { status: "ok", totalFees: 20000, amountPaid: 0, balance: 20000, currency: "KES" });
  const none = (await buildReportBatch({ ...base, includeFees: true, target: learner(41) }, U.admin)).cards[0].fees;
  assert.deepEqual(none, { status: "no_record" });
});

/* 8. cross-module: change the underlying records, regenerate */
test("a new payment, a corrected mark and a new fee item show up on the next generated report", async () => {
  const before = await buildReportBatch({ ...base, includeFees: true, target: learner(31) }, U.admin);
  assert.equal(before.cards[0].fees && (before.cards[0].fees as any).balance, 15000);
  DATA.payments.push({ learnerId: 31, amount: "5000.00" });
  DATA.marks.find(x => x.assessmentId === 1 && x.learnerId === 31)!.average = 72;
  const after = await buildReportBatch({ ...base, includeFees: true, target: learner(31) }, U.admin);
  assert.equal((after.cards[0].fees as any).amountPaid, 25000); assert.equal((after.cards[0].fees as any).balance, 10000);
  assert.equal(row(after, 0, "Mathematics").average, 72);
});

/* 4. financial authorisation (direct service/API path, not UI) */
test("fee access by role when the checkbox is ticked", async () => {
  const ask = (uid: number, learnerId: number) => buildReportBatch({ ...base, includeFees: true, target: learner(learnerId) }, uid);
  for (const uid of [U.superAdmin, U.admin, U.bursar]) { const b = await ask(uid, 31); assert.equal(b.feesStatus, "ok", `user ${uid}`); assert.equal((b.cards[0].fees as any).balance, 15000); }
  const ct = await ask(U.classTeacher, 31); assert.equal(ct.feesStatus, "ok");                         // own class + finance.view
  const ctOther = await ask(U.classTeacher, 41).catch(e => e); assert.ok(denied("REPORT_SCOPE_FORBIDDEN")(ctOther));  // not their class at all
  const owner = await ask(U.teacherOwner, 21); assert.equal(owner.feesStatus, "denied");              // owns Grade 8 but teacher role has no finance.view
  const t = await ask(U.teacherOwner, 31); assert.equal(t.feesStatus, "denied"); assert.ok(!("fees" in t.cards[0]));
  assert.ok(!/15000|35000|20000/.test(JSON.stringify(t))); assert.match(t.feesMessage!, /permission/i);
  const sci = await ask(U.scienceTeacher, 31); assert.equal(sci.feesStatus, "denied");
});
test("denied fee requests never query finance tables; class teacher without finance.view is denied", async () => {
  LOG.reads.length = 0; await buildReportBatch({ ...base, includeFees: true, target: learner(31) }, U.scienceTeacher);
  assert.ok(!LOG.reads.includes("payments") && !LOG.reads.includes("feeStructures"));
  seed(false); const b = await buildReportBatch({ ...base, includeFees: true, target: learner(31) }, U.classTeacher);
  assert.equal(b.feesStatus, "denied"); assert.ok(!("fees" in b.cards[0]));
});
test("a per-user override that removes finance.view is honoured", async () => {
  DATA.userPermissions.push({ userId: U.admin, permissionKey: "finance.view", allowed: 0 });
  const b = await buildReportBatch({ ...base, includeFees: true, target: learner(31) }, U.admin);
  assert.equal(b.feesStatus, "denied");
});

/* 5. report scope: the original REPORT_SCOPE_FORBIDDEN defect */
test("administrators are no longer refused when they have no teacher allocations", async () => {
  assert.equal(DATA.teacherAllocations.filter(a => a.teacherUserId === U.admin || a.teacherUserId === U.superAdmin).length, 0);
  for (const uid of [U.superAdmin, U.admin]) for (const id of [11, 21, 31, 41]) assert.equal((await buildReportBatch({ ...base, target: learner(id) }, uid)).cards.length, 1);
});
test("allocations for a different term/year do not lock a valid user out of their own class", async () => {
  const b = await buildReportBatch({ ...base, term: "Term 3", academicYear: 2027, target: learner(31) }, U.classTeacher);
  assert.equal(b.cards.length, 1); assert.equal(b.cards[0].rows.length, 0);
});
test("subject teacher: only allocated learning areas, only allocated classes", async () => {
  const b = await buildReportBatch({ ...base, target: learner(31) }, U.scienceTeacher);
  assert.deepEqual(b.cards[0].rows.map(r => r.subject), ["Integrated Science"]); assert.equal(b.cards[0].partial, true);
  assert.equal(b.cards[0].summary.totalAverage, 92);
  for (const id of [11, 21, 41]) assert.ok(denied("REPORT_SCOPE_FORBIDDEN")(await buildReportBatch({ ...base, target: learner(id) }, U.scienceTeacher).catch(e => e)), `learner ${id}`);
  const t = await buildReportBatch({ ...base, target: learner(31) }, U.teacherOwner);
  assert.deepEqual(t.cards[0].rows.map(r => r.subject), ["English", "Mathematics"]);
});
test("class teacher: full card for own class, nothing elsewhere; teacher-role class owner gets full card for the owned class", async () => {
  const own = await buildReportBatch({ ...base, target: { kind: "class", gradeId: 3 } }, U.classTeacher);
  assert.equal(own.cards.length, 2); assert.ok(own.cards.every(c => !c.partial && c.rows.length === 3));
  for (const g of [1, 2, 4]) assert.ok(denied("REPORT_SCOPE_FORBIDDEN")(await buildReportBatch({ ...base, target: { kind: "class", gradeId: g } }, U.classTeacher).catch(e => e)));
  const g8 = await buildReportBatch({ ...base, target: learner(21) }, U.teacherOwner);   // user 3 owns Grade 8 via grades.classTeacherUserId
  assert.equal(g8.cards[0].partial, false); assert.equal(g8.cards[0].rows.length, 2);
});
test("grade report for a scoped user returns only permitted classes and says which were skipped", async () => {
  const b = await buildReportBatch({ ...base, target: { kind: "grade", gradeName: "Grade 9" } }, U.classTeacher);
  assert.deepEqual(b.cards.map(c => c.grade.label), ["Grade 9 A", "Grade 9 A"]); assert.deepEqual(b.skippedClasses, ["Grade 9 B"]);
});
test("a user with no report permission is refused outright, before any learner data is read", async () => {
  LOG.reads.length = 0;
  assert.ok(denied("REPORT_PERMISSION_DENIED")(await buildReportBatch({ ...base, target: learner(31) }, U.nobody).catch(e => e)));
  assert.ok(denied("REPORT_PERMISSION_DENIED")(await getReportOptions(U.nobody).catch(e => e)));
  assert.ok(!LOG.reads.includes("marks") && !LOG.reads.includes("learners"));
});
test("the report_cards.view permission is accepted without a legacy reports.view grant", async () => {
  MATRIX.teacher = ["report_cards.view"];
  const batch = await buildReportBatch({ ...base, target: learner(31) }, U.teacherOwner);
  assert.equal(batch.cards.length, 1);
  assert.equal(batch.cards[0].partial, true);
  assert.deepEqual(batch.cards[0].rows.map(r => r.subject), ["English", "Mathematics"]);
});
test("report options expose only permitted classes and learners and the true fee capability", async () => {
  const sci = await getReportOptions(U.scienceTeacher); assert.deepEqual(sci.grades.map(g => g.id), [3]); assert.equal(sci.canViewFinance, false);
  const ct = await getReportOptions(U.classTeacher); assert.deepEqual(ct.learners.map(l => l.id).sort(), [31, 32]); assert.equal(ct.canViewFinance, true);
  const ad = await getReportOptions(U.admin); assert.equal(ad.grades.length, 4); assert.equal(ad.canViewFinance, true); assert.ok(!ad.learners.some(l => l.id === 33));
  const bu = await getReportOptions(U.bursar); assert.equal(bu.canViewFinance, true);
});
test("scoped users only see academic years represented in their permitted grades", async () => {
  DATA.assessments.push({ id: 99, academicYear: 2024, term: "Term 1", assessmentType: "end_term", gradeId: 1, subjectId: 1, status: "approved", teacherUserId: 3 });
  const options = await getReportOptions(U.scienceTeacher);
  assert.deepEqual(options.years, [2026, 2025]);
});
test("report generation requires real school settings and does not substitute a hard-coded identity", async () => {
  DATA.schoolSettings.length = 0;
  const error = await getReportOptions(U.admin).catch(e => e);
  assert.ok(denied("SCHOOL_SETTINGS_NOT_CONFIGURED")(error));
});
test("direct comment-save calls require assessment-edit permission and full learner scope", async () => {
  MATRIX.teacher = ["reports.view", "assessments.edit"];
  const partial = await saveReportCardComments({ learnerId: 31, academicYear: 2026, term: "Term 2", classTeacherComment: "Unauthorized" }, U.scienceTeacher).catch(e => e);
  assert.ok(denied("REPORT_SCOPE_FORBIDDEN")(partial));
  const noEdit = await saveReportCardComments({ learnerId: 31, academicYear: 2026, term: "Term 2", classTeacherComment: "Unauthorized" }, U.classTeacher).catch(e => e);
  assert.ok(denied("COMMENT_PERMISSION_DENIED")(noEdit));
  assert.deepEqual(LOG.writes, []);
});
test("excused attendance remains an absence in report-card attendance totals", async () => {
  DATA.attendances.push({ learnerId: 31, attendanceDate: "2026-05-07", session: "morning", status: "excused" });
  const card = (await buildReportBatch({ ...base, target: learner(31) }, U.admin)).cards[0];
  assert.deepEqual(card.attendance, { daysOpen: 4, daysPresent: 2, daysAbsent: 2, percentage: 50 });
});
test("unknown learner / class return proper not-found errors", async () => {
  assert.ok(denied("LEARNER_NOT_FOUND")(await buildReportBatch({ ...base, target: learner(9999) }, U.admin).catch(e => e)));
  assert.ok(denied("CLASS_NOT_FOUND")(await buildReportBatch({ ...base, target: { kind: "class", gradeId: 99 } }, U.admin).catch(e => e)));
});

/* 7/9. read-only guarantee */
test("generating reports performs no writes and leaves every record unchanged; the action is audited", async () => {
  const snap = JSON.stringify(DATA);
  await buildReportBatch({ ...base, includeFees: true, target: { kind: "grade", gradeName: "Grade 9" } }, U.admin);
  await buildReportBatch({ ...base, target: learner(31) }, U.classTeacher);
  assert.deepEqual(LOG.writes, []); assert.equal(JSON.stringify(DATA), snap);
  assert.equal(LOG.audits.length, 2); assert.equal(LOG.audits[0].action, "report_card.generate"); assert.equal(LOG.audits[0].payload.feesRequested, true);
});
