/**
 * NEXUS Report Card service. Read-only against the existing NEXUS tables: learners, grades, subjects,
 * assessments, marks, attendances, fee_structures, payments, school_settings, report_cards.
 * Every authorisation decision is made here, on the server.
 */
import {
  and, eq, inArray, getDb, writeAudit, can, getAccessProfile,
  users, grades, learners, subjects, assessments, marks, attendances, feeStructures, payments, reportCards, staffProfiles, teacherAllocations, schoolSettings,
} from "./nexusAdapter";
import {
  decideFeeAccess, decideScope, summarise,
  type Attendance, type CbcLevel, type FeeBlock, type Profile, type ReportBatch, type ReportCardData, type ReportErrorCode,
  type ReportOptions, type ReportRequest, type SubjectRow,
} from "../shared/reportCard";

export class ReportError extends Error {
  constructor(public code: ReportErrorCode) { super(code); this.name = "ReportError"; }
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const label = (g: { name: string; stream: string | null }) => (g.stream ? `${g.name} ${g.stream}` : g.name);
const chunk = <T,>(xs: T[], n = 500) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function requireDb() { const db = await getDb(); if (!db) throw new Error("DATABASE_UNAVAILABLE"); return db; }

async function getReportSettings(db: Awaited<ReturnType<typeof requireDb>>) {
  const settings = (await db.select().from(schoolSettings).limit(1))[0];
  if (!settings || !String(settings.schoolName ?? "").trim()) throw new ReportError("SCHOOL_SETTINGS_NOT_CONFIGURED");
  return settings;
}

/** Resolves who is asking. Report generation needs report_cards.view (or the legacy reports.view key NEXUS routes already use). */
async function resolveActor(userId: number) {
  const db = await requireDb();
  const account = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!account) throw new ReportError("REPORT_PERMISSION_DENIED");
  const allowed = (await can(userId, account.role, "report_cards.view")) || (await can(userId, account.role, "reports.view"));
  if (!allowed) throw new ReportError("REPORT_PERMISSION_DENIED");
  const access = await getAccessProfile(userId);
  const owned = await db.select({ id: grades.id }).from(grades).where(eq(grades.classTeacherUserId, userId));
  const classAlloc = await db.select().from(teacherAllocations).where(and(eq(teacherAllocations.teacherUserId, userId), eq(teacherAllocations.status, "active"), eq(teacherAllocations.allocationType, "class_teacher")));
  const classGradeIds = Array.from(new Set([...owned.map(g => g.id), ...classAlloc.map(a => a.gradeId)]));
  const profile: Profile = { level: access.level, gradeIds: Array.from(new Set([...access.gradeIds, ...classGradeIds])), pairs: access.pairs, classGradeIds };
  const hasFinanceView = await can(userId, account.role, "finance.view");
  const hasAssessmentEdit = await can(userId, account.role, "assessments.edit");
  return { profile, hasFinanceView, hasAssessmentEdit, label: access.label };
}

/** Filters for the generation screen: only the classes and learners the user may report on. */
export async function getReportOptions(userId: number): Promise<ReportOptions> {
  const db = await requireDb();
  const actor = await resolveActor(userId);
  const settings = await getReportSettings(db);
  const unrestricted = actor.profile.level === "system" || actor.profile.level === "school";
  const gradeRows = (await db.select().from(grades)).filter(g => unrestricted || actor.profile.gradeIds.includes(g.id));
  const ids = gradeRows.map(g => g.id);
  const learnerRows = ids.length
    ? (await Promise.all(chunk(ids).map(c => db.select().from(learners).where(and(inArray(learners.gradeId, c), eq(learners.status, "active")))))).flat()
    : [];
  const yearRows = ids.length
    ? await db.select({ y: assessments.academicYear }).from(assessments).where(inArray(assessments.gradeId, ids))
    : [];
  const years = Array.from(new Set([settings.academicYear, ...yearRows.map(r => r.y)])).sort((a, b) => b - a);
  return {
    school: { name: settings.schoolName }, defaultYear: settings.academicYear, defaultTerm: settings.currentTerm, years,
    defaultIncludeFees: Number(settings.includeFeesOnReportCard) === 1,
    canViewFinance: actor.hasFinanceView && (unrestricted || actor.profile.level === "class" || actor.profile.classGradeIds.length > 0), accessLabel: actor.label,
    grades: gradeRows.map(g => ({ id: g.id, name: g.name, stream: g.stream, label: label(g) })).sort((a, b) => a.label.localeCompare(b.label)),
    learners: learnerRows.map(l => ({ id: l.id, fullName: l.fullName, admissionNumber: l.admissionNumber, gradeId: l.gradeId }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

export async function buildReportBatch(input: ReportRequest, userId: number): Promise<ReportBatch> {
  const db = await requireDb();
  const actor = await resolveActor(userId);
  const settings = await getReportSettings(db);
  const { academicYear, term, assessmentType, target } = input;

  /* 1. Resolve the learners requested and the classes they sit in. */
  const gradeRows = await db.select().from(grades);
  const gradeById = new Map(gradeRows.map(g => [g.id, g]));
  let targetLearners: Array<typeof learners.$inferSelect> = [];
  if (target.kind === "learner") {
    const l = (await db.select().from(learners).where(eq(learners.id, target.learnerId)).limit(1))[0];
    if (!l) throw new ReportError("LEARNER_NOT_FOUND");
    targetLearners = [l];
  } else {
    const gradeIds = target.kind === "class" ? gradeRows.filter(g => g.id === target.gradeId).map(g => g.id) : gradeRows.filter(g => g.name === target.gradeName).map(g => g.id);
    if (!gradeIds.length) throw new ReportError("CLASS_NOT_FOUND");
    targetLearners = await db.select().from(learners).where(and(inArray(learners.gradeId, gradeIds), eq(learners.status, "active")));
    if (!targetLearners.length) throw new ReportError("NO_LEARNERS");
  }

  /* 2. Server-side scope. Admin/school: everything. Class teacher: own class. Subject teacher: own learning areas only. */
  const decisions = new Map<number, ReturnType<typeof decideScope>>();
  for (const gid of Array.from(new Set(targetLearners.map(l => l.gradeId)))) decisions.set(gid, decideScope(actor.profile, gid));
  const skipped: string[] = [];
  if (target.kind !== "grade") {
    if (Array.from(decisions.values()).some(d => d.access === "none")) throw new ReportError("REPORT_SCOPE_FORBIDDEN");
  } else {
    for (const [gid, d] of Array.from(decisions.entries())) if (d.access === "none") skipped.push(label(gradeById.get(gid)!));
  }
  targetLearners = targetLearners.filter(l => decisions.get(l.gradeId)!.access !== "none").sort((a, b) => a.fullName.localeCompare(b.fullName));
  if (!targetLearners.length) throw new ReportError("REPORT_SCOPE_FORBIDDEN");
  const gradeIds = Array.from(new Set(targetLearners.map(l => l.gradeId)));
  const learnerIds = targetLearners.map(l => l.id);

  /* 3. Authoritative assessment records for this period. Only approved/locked marks are published on a card. */
  const periodAssessments = await db.select().from(assessments).where(and(
    inArray(assessments.gradeId, gradeIds), eq(assessments.academicYear, academicYear), eq(assessments.term, term), eq(assessments.assessmentType, assessmentType)));
  const published = periodAssessments.filter(a => a.status === "approved" || a.status === "locked");
  const markRows = published.length
    ? (await Promise.all(chunk(learnerIds).map(c => db.select().from(marks).where(and(inArray(marks.learnerId, c), inArray(marks.assessmentId, published.map(a => a.id))))))).flat()
    : [];
  const markKey = (learnerId: number, assessmentId: number) => `${learnerId}:${assessmentId}`;
  const markMap = new Map(markRows.map(m => [markKey(m.learnerId, m.assessmentId), m]));

  const subjectRows = periodAssessments.length ? await db.select().from(subjects).where(inArray(subjects.id, Array.from(new Set(periodAssessments.map(a => a.subjectId))))) : [];
  const subjectById = new Map(subjectRows.map(s => [s.id, s]));
  const staffIds = Array.from(new Set([...periodAssessments.map(a => a.teacherUserId), ...gradeRows.map(g => g.classTeacherUserId).filter((x): x is number => !!x)]));
  const staffRows = staffIds.length ? await db.select().from(staffProfiles).where(inArray(staffProfiles.userId, staffIds)) : [];
  const staffName = new Map(staffRows.map(s => [s.userId, [s.title, s.displayName].filter(Boolean).join(" ")]));

  /* 4. Attendance for the academic year, counted in school days (a day is present if any session was present/late). */
  const attRows = (await Promise.all(chunk(learnerIds).map(c => db.select().from(attendances).where(inArray(attendances.learnerId, c))))).flat()
    .filter(a => String(a.attendanceDate).startsWith(String(academicYear)));
  const attendanceOf = (learnerId: number): Attendance => {
    const days = new Map<string, { present: boolean }>();
    for (const a of attRows) if (a.learnerId === learnerId) {
      const d = days.get(String(a.attendanceDate)) ?? { present: false };
      if (a.status === "present" || a.status === "late") d.present = true;
      days.set(String(a.attendanceDate), d);
    }
    const daysOpen = days.size; const daysPresent = Array.from(days.values()).filter(d => d.present).length;
    return { daysOpen, daysPresent, daysAbsent: daysOpen - daysPresent, percentage: daysOpen ? Math.round((daysPresent / daysOpen) * 100) : null };
  };

  /* 5. Saved comments (read only: nothing is written when a report is viewed). */
  const commentRows = (await Promise.all(chunk(learnerIds).map(c => db.select().from(reportCards).where(and(
    inArray(reportCards.learnerId, c), eq(reportCards.academicYear, academicYear), eq(reportCards.term, term), eq(reportCards.assessmentType, assessmentType)))))).flat();
  const commentOf = new Map(commentRows.map(r => [r.learnerId, r]));

  /* 6. Fees: only when requested AND authorised. Otherwise no finance query runs and no fee key is returned. */
  let feesStatus: ReportBatch["feesStatus"] = "not_requested"; let feesMessage: string | null = null;
  const feeOf = new Map<number, FeeBlock>();
  if (input.includeFees) {
    const refusal = gradeIds.map(gid => decideFeeAccess({ hasFinanceView: actor.hasFinanceView, profile: actor.profile, gradeId: gid })).find(r => !r.allowed);
    if (refusal && !refusal.allowed) { feesStatus = "denied"; feesMessage = refusal.reason; }
    else {
      feesStatus = "ok";
      const structures = await db.select().from(feeStructures).where(inArray(feeStructures.gradeId, gradeIds));
      const paid = (await Promise.all(chunk(learnerIds).map(c => db.select().from(payments).where(inArray(payments.learnerId, c))))).flat();
      for (const l of targetLearners) {
        const required = structures.filter(f => f.gradeId === l.gradeId).reduce((s, f) => s + Number(f.amount), 0);
        const mine = paid.filter(p => p.learnerId === l.id); const amountPaid = mine.reduce((s, p) => s + Number(p.amount), 0);
        feeOf.set(l.id, !structures.some(f => f.gradeId === l.gradeId) && !mine.length
          ? { status: "no_record" }
          : { status: "ok", totalFees: required, amountPaid, balance: required - amountPaid, currency: "KES" });
      }
    }
  }

  /* 7. Assemble cards. */
  const cards: ReportCardData[] = targetLearners.map(l => {
    const grade = gradeById.get(l.gradeId)!; const scope = decisions.get(l.gradeId)!;
    const rows: SubjectRow[] = periodAssessments.filter(a => a.gradeId === l.gradeId && (scope.access === "full" || scope.subjectIds!.has(a.subjectId)))
      .map(a => {
        const isPublished = a.status === "approved" || a.status === "locked"; const m = isPublished ? markMap.get(markKey(l.id, a.id)) : undefined;
        return {
          subjectId: a.subjectId, subject: subjectById.get(a.subjectId)?.name ?? "Learning Area",
          midTerm: num(m?.midTerm), endTerm: num(m?.endTerm), average: num(m?.average), cbcLevel: (m?.cbcLevel ?? null) as CbcLevel | null,
          teacherRemark: m?.teacherRemark ?? null, facilitator: staffName.get(a.teacherUserId) ?? null,
          state: !isPublished ? "pending" : m ? "published" : "no_mark",
        } satisfies SubjectRow;
      }).sort((x, y) => x.subject.localeCompare(y.subject));
    const saved = commentOf.get(l.id);
    return {
      learner: { id: l.id, fullName: l.fullName, admissionNumber: l.admissionNumber, gender: l.gender },
      grade: { id: grade.id, name: grade.name, stream: grade.stream, label: label(grade) },
      classTeacher: grade.classTeacherUserId ? staffName.get(grade.classTeacherUserId) ?? null : null,
      rows, summary: summarise(rows), attendance: attendanceOf(l.id),
      comments: { classTeacher: saved?.classTeacherComment ?? null, headTeacher: saved?.headTeacherComment ?? null },
      ...(feesStatus === "ok" ? { fees: feeOf.get(l.id) } : {}),
      partial: scope.access === "partial",
    };
  });

  await writeAudit(userId, "report_card.generate", "report_card", `${target.kind}:${learnerIds.length}`, { academicYear, term, assessmentType, target, learners: learnerIds.length, feesRequested: input.includeFees, feesStatus });
  return {
    school: { name: settings.schoolName, motto: settings.motto ?? null, address: settings.address ?? null, phone: settings.phone ?? null, email: settings.email ?? null,
      logoPath: settings.logoPath ?? null, principalSignaturePath: settings.principalSignaturePath ?? null, classTeacherSignaturePath: settings.classTeacherSignaturePath ?? null },
    academicYear, term, assessmentType, feesStatus, feesMessage, cards, skippedClasses: skipped, generatedAt: new Date().toISOString(),
  };
}

/** Preserve report-comment editing while enforcing both permission and full-class scope on direct API calls. */
export async function saveReportCardComments(input: {
  learnerId: number; academicYear: number; term: string; assessmentType?: "mid_term" | "end_term";
  classTeacherComment?: string | null; headTeacherComment?: string | null;
}, userId: number) {
  const actor = await resolveActor(userId);
  if (!actor.hasAssessmentEdit) throw new ReportError("COMMENT_PERMISSION_DENIED");
  const db = await requireDb();
  const learner = (await db.select({ id: learners.id, gradeId: learners.gradeId }).from(learners).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!learner) throw new ReportError("LEARNER_NOT_FOUND");
  if (decideScope(actor.profile, learner.gradeId).access !== "full") throw new ReportError("REPORT_SCOPE_FORBIDDEN");
  const assessmentType = input.assessmentType ?? "end_term";
  await db.insert(reportCards).values({
    learnerId: input.learnerId, academicYear: input.academicYear, term: input.term, assessmentType,
    classTeacherComment: input.classTeacherComment ?? null, headTeacherComment: input.headTeacherComment ?? null,
    status: "draft", generatedByUserId: userId,
  }).onDuplicateKeyUpdate({ set: { classTeacherComment: input.classTeacherComment ?? null, headTeacherComment: input.headTeacherComment ?? null } });
  await writeAudit(userId, "report_card.comments.save", "report_card", `${input.learnerId}:${input.academicYear}:${input.term}:${assessmentType}`, {
    fields: ["classTeacherComment", "headTeacherComment"],
  });
  return { ok: true };
}
