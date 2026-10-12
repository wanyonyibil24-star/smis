import { and, desc, eq, inArray } from "drizzle-orm";
import { assessments, attendances, grades, learners, marks, reportCards, schoolSettings, staffProfiles, subjects, teacherAllocations, users } from "../drizzle/schema";
import { getDb } from "./db";
import { assertScore, cbcLevel, getSettings, writeAudit } from "./smis";

export type AssessmentType = "mid_term" | "end_term";
export type MarklistType = AssessmentType | "average";
export type AssessmentScope = {
  academicYear: number;
  term: string;
  assessmentType: AssessmentType;
  gradeId: number;
  subjectId: number;
  teacherUserId?: number;
};

export function assessmentScopeKey(scope: Omit<AssessmentScope, "teacherUserId">) {
  return `${scope.academicYear}:${scope.term}:${scope.assessmentType}:${scope.gradeId}:${scope.subjectId}`;
}

export function missingAssessmentLearners(rosterIds: number[], rows: Array<{ learnerId: number; score: number | string | null }>) {
  const entered = new Set(rows.filter(row => row.score !== null).map(row => row.learnerId));
  return rosterIds.filter(id => !entered.has(id));
}

export function canTransitionAssessment(from: string, to: "approved" | "locked") {
  return to === "approved" ? from === "submitted" : from === "approved";
}

export function averageAssessmentScores(midTerm: number | null, endTerm: number | null) {
  return midTerm === null || endTerm === null ? null : Math.round(((midTerm + endTerm) / 2) * 100) / 100;
}

type ActorAccess = { isAdmin: boolean; profileRole: string | null };

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

async function actorAccess(userId: number): Promise<ActorAccess> {
  const db = await requireDb();
  const row = (await db.select({ userRole: users.role, profileRole: staffProfiles.role })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(eq(users.id, userId)).limit(1))[0];
  const profileRole = row?.profileRole ?? null;
  return {
    isAdmin: row?.userRole === "admin" || ["admin", "super_admin", "head_teacher", "deputy_head"].includes(profileRole ?? ""),
    profileRole,
  };
}

async function allocationForScope(scope: AssessmentScope, userId: number, isAdmin: boolean) {
  const db = await requireDb();
  const filters = [
    eq(teacherAllocations.academicYear, scope.academicYear),
    eq(teacherAllocations.term, scope.term),
    eq(teacherAllocations.gradeId, scope.gradeId),
    eq(teacherAllocations.subjectId, scope.subjectId),
    eq(teacherAllocations.status, "active"),
  ];
  if (!isAdmin) filters.push(eq(teacherAllocations.teacherUserId, userId));
  else if (scope.teacherUserId) filters.push(eq(teacherAllocations.teacherUserId, scope.teacherUserId));
  const allocation = (await db.select().from(teacherAllocations).where(and(...filters)).orderBy(desc(teacherAllocations.id)).limit(1))[0];
  if (!allocation) throw new Error("ASSESSMENT_SCOPE_FORBIDDEN");
  return allocation;
}

async function assertAssessmentAccess(assessment: AssessmentScope, userId: number, isAdmin: boolean) {
  if (isAdmin) return;
  const db = await requireDb();
  const allocation = (await db.select({ id: teacherAllocations.id }).from(teacherAllocations).where(and(
    eq(teacherAllocations.teacherUserId, userId),
    eq(teacherAllocations.academicYear, assessment.academicYear),
    eq(teacherAllocations.term, assessment.term),
    eq(teacherAllocations.gradeId, assessment.gradeId),
    eq(teacherAllocations.subjectId, assessment.subjectId),
  )).limit(1))[0];
  if (!allocation) throw new Error("ASSESSMENT_SCOPE_FORBIDDEN");
}

async function assessmentForScope(scope: AssessmentScope) {
  const db = await requireDb();
  return (await db.select().from(assessments).where(and(
    eq(assessments.academicYear, scope.academicYear),
    eq(assessments.term, scope.term),
    eq(assessments.assessmentType, scope.assessmentType),
    eq(assessments.gradeId, scope.gradeId),
    eq(assessments.subjectId, scope.subjectId),
  )).limit(1))[0] ?? null;
}

export async function listAssessmentScopes(userId: number) {
  const db = await requireDb();
  const access = await actorAccess(userId);
  const filters = [] as ReturnType<typeof eq>[];
  if (!access.isAdmin) filters.push(eq(teacherAllocations.teacherUserId, userId));
  const rows = await db.select({ allocation: teacherAllocations, grade: grades, subject: subjects, staff: staffProfiles })
    .from(teacherAllocations)
    .innerJoin(grades, eq(grades.id, teacherAllocations.gradeId))
    .innerJoin(subjects, eq(subjects.id, teacherAllocations.subjectId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, teacherAllocations.teacherUserId))
    .where(and(...filters))
    .orderBy(desc(teacherAllocations.academicYear), grades.name, subjects.name);
  return rows.map(row => ({
    allocationId: row.allocation.id,
    academicYear: row.allocation.academicYear,
    term: row.allocation.term,
    gradeId: row.grade.id,
    gradeName: row.grade.name,
    gradeStream: row.grade.stream,
    subjectId: row.subject.id,
    subjectName: row.subject.name,
    subjectCode: row.subject.code,
    teacherUserId: row.allocation.teacherUserId,
    teacherName: row.staff?.displayName ?? `User ${row.allocation.teacherUserId}`,
  }));
}

export async function ensureAssessment(scope: AssessmentScope, userId: number) {
  const db = await requireDb();
  const access = await actorAccess(userId);
  const existing = await assessmentForScope(scope);
  if (existing) {
    await assertAssessmentAccess(existing, userId, access.isAdmin);
    return existing;
  }
  const allocation = await allocationForScope(scope, userId, access.isAdmin);

  const grade = (await db.select().from(grades).where(eq(grades.id, scope.gradeId)).limit(1))[0];
  const subject = (await db.select().from(subjects).where(eq(subjects.id, scope.subjectId)).limit(1))[0];
  if (!grade || !subject) throw new Error("ASSESSMENT_MASTER_RECORD_NOT_FOUND");
  const title = `${grade.name}${grade.stream ? ` ${grade.stream}` : ""} · ${subject.name} · ${scope.assessmentType.replace("_", " ")}`;
  try {
    const inserted = (await db.insert(assessments).values({
      title,
      term: scope.term,
      academicYear: scope.academicYear,
      gradeId: scope.gradeId,
      subjectId: scope.subjectId,
      teacherUserId: allocation.teacherUserId,
      assessmentType: scope.assessmentType,
      status: "draft",
    }).$returningId())[0];
    await writeAudit(userId, "assessment.create", "assessment", inserted.id, { academicYear: scope.academicYear, term: scope.term, assessmentType: scope.assessmentType, gradeId: scope.gradeId, subjectId: scope.subjectId });
  } catch (error) {
    // Another user may have created the unique period/class/subject concurrently.
    const raced = await assessmentForScope(scope);
    if (raced) return raced;
    throw error;
  }
  const created = await assessmentForScope(scope);
  if (!created) throw new Error("ASSESSMENT_CREATE_FAILED");
  return created;
}

export async function getAssessmentEntries(assessmentId: number, userId: number) {
  const db = await requireDb();
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1))[0];
  if (!assessment) throw new Error("ASSESSMENT_NOT_FOUND");
  const access = await actorAccess(userId);
  await assertAssessmentAccess(assessment, userId, access.isAdmin);
  const roster = await db.select().from(learners).where(and(eq(learners.gradeId, assessment.gradeId), eq(learners.status, "active"))).orderBy(learners.fullName);
  const saved = await db.select().from(marks).where(eq(marks.assessmentId, assessmentId));
  const byLearner = new Map(saved.map(mark => [mark.learnerId, mark]));
  return {
    assessment,
    learners: roster.map(learner => {
      const mark = byLearner.get(learner.id);
      return {
        learnerId: learner.id,
        fullName: learner.fullName,
        admissionNumber: learner.admissionNumber,
        score: mark?.score == null ? null : Number(mark.score),
        teacherRemark: mark?.teacherRemark ?? "",
        missing: mark?.score == null,
        updatedAt: mark?.updatedAt ?? null,
      };
    }),
  };
}

export async function saveAssessmentMarks(input: { assessmentId: number; rows: Array<{ learnerId: number; score: number | null; teacherRemark?: string | null }> }, userId: number) {
  const db = await requireDb();
  if (new Set(input.rows.map(row => row.learnerId)).size !== input.rows.length) throw new Error("DUPLICATE_LEARNER_MARK");
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1))[0];
  if (!assessment) throw new Error("ASSESSMENT_NOT_FOUND");
  const access = await actorAccess(userId);
  await assertAssessmentAccess(assessment, userId, access.isAdmin);
  if (assessment.status === "locked") throw new Error("ASSESSMENT_LOCKED_USE_CORRECTION");
  if (assessment.status === "approved") throw new Error("ASSESSMENT_APPROVED_USE_CORRECTION");
  if (assessment.status === "submitted" && !access.isAdmin) throw new Error("ASSESSMENT_SUBMITTED");

  const roster = await db.select({ id: learners.id }).from(learners).where(and(eq(learners.gradeId, assessment.gradeId), eq(learners.status, "active")));
  const allowedLearners = new Set(roster.map(row => row.id));
  for (const row of input.rows) {
    if (!allowedLearners.has(row.learnerId)) throw new Error("LEARNER_OUTSIDE_ASSESSMENT_CLASS");
    if (row.score !== null) assertScore(row.score);
    const score = row.score === null ? null : String(row.score);
    const values = {
      assessmentId: assessment.id,
      learnerId: row.learnerId,
      subjectId: assessment.subjectId,
      teacherUserId: userId,
      score,
      midTerm: assessment.assessmentType === "mid_term" ? score : null,
      endTerm: assessment.assessmentType === "end_term" ? score : null,
      average: score,
      cbcLevel: row.score === null ? null : cbcLevel(row.score) as "EE1" | "EE2" | "ME1" | "ME2" | "AE1" | "AE2" | "BE1" | "BE2",
      teacherRemark: row.teacherRemark?.trim() || null,
      updatedByUserId: userId,
      updatedAt: new Date(),
    };
    await db.insert(marks).values(values).onDuplicateKeyUpdate({ set: values });
  }
  await writeAudit(userId, "assessment.marks.save", "assessment", assessment.id, { rowsUpdated: input.rows.length, assessmentType: assessment.assessmentType, gradeId: assessment.gradeId, subjectId: assessment.subjectId });
  return { ok: true, rowsUpdated: input.rows.length };
}

export async function submitAssessment(assessmentId: number, userId: number) {
  const db = await requireDb();
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1))[0];
  if (!assessment) throw new Error("ASSESSMENT_NOT_FOUND");
  const access = await actorAccess(userId);
  await assertAssessmentAccess(assessment, userId, access.isAdmin);
  if (assessment.status === "locked" || assessment.status === "approved") throw new Error("ASSESSMENT_STATUS_FINAL");
  const roster = await db.select({ id: learners.id }).from(learners).where(and(eq(learners.gradeId, assessment.gradeId), eq(learners.status, "active")));
  const saved = await db.select({ learnerId: marks.learnerId, score: marks.score }).from(marks).where(eq(marks.assessmentId, assessment.id));
  const missingCount = missingAssessmentLearners(roster.map(row => row.id), saved).length;
  if (!roster.length) throw new Error("ASSESSMENT_CLASS_HAS_NO_ACTIVE_LEARNERS");
  if (missingCount) throw new Error(`ASSESSMENT_HAS_MISSING_MARKS:${missingCount}`);
  await db.update(assessments).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(assessments.id, assessment.id));
  await writeAudit(userId, "assessment.submit", "assessment", assessment.id, { academicYear: assessment.academicYear, term: assessment.term, assessmentType: assessment.assessmentType, gradeId: assessment.gradeId, subjectId: assessment.subjectId });
  return { ok: true, status: "submitted" as const, learnerCount: roster.length };
}

export async function setAssessmentFinalState(input: { assessmentId: number; status: "approved" | "locked" }, userId: number) {
  const db = await requireDb();
  const access = await actorAccess(userId);
  if (!access.isAdmin) throw new Error("ASSESSMENT_ADMIN_REQUIRED");
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1))[0];
  if (!assessment) throw new Error("ASSESSMENT_NOT_FOUND");
  if (!canTransitionAssessment(assessment.status, input.status)) {
    throw new Error(input.status === "approved" ? "ASSESSMENT_MUST_BE_SUBMITTED" : "ASSESSMENT_MUST_BE_APPROVED");
  }
  if (input.status === "approved") {
    const roster = await db.select({ id: learners.id }).from(learners).where(and(eq(learners.gradeId, assessment.gradeId), eq(learners.status, "active")));
    const saved = await db.select({ learnerId: marks.learnerId, score: marks.score }).from(marks).where(eq(marks.assessmentId, assessment.id));
    if (!roster.length || missingAssessmentLearners(roster.map(row => row.id), saved).length) throw new Error("ASSESSMENT_INCOMPLETE_CANNOT_APPROVE");
  }
  const now = new Date();
  await db.update(assessments).set(input.status === "approved"
    ? { status: "approved", verifiedByUserId: userId, verifiedAt: now, updatedAt: now }
    : { status: "locked", lockedAt: now, updatedAt: now }).where(eq(assessments.id, assessment.id));
  await writeAudit(userId, `assessment.${input.status}`, "assessment", assessment.id, { from: assessment.status, to: input.status });
  return { ok: true, status: input.status };
}

export async function correctLockedAssessmentMark(input: { assessmentId: number; learnerId: number; score: number; reason: string }, userId: number) {
  const db = await requireDb();
  const access = await actorAccess(userId);
  if (!access.isAdmin) throw new Error("ASSESSMENT_ADMIN_REQUIRED");
  if (input.reason.trim().length < 10) throw new Error("CORRECTION_REASON_REQUIRED");
  const assessment = (await db.select().from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1))[0];
  if (!assessment || assessment.status !== "locked") throw new Error("ASSESSMENT_NOT_LOCKED");
  const existing = (await db.select().from(marks).where(and(eq(marks.assessmentId, input.assessmentId), eq(marks.learnerId, input.learnerId))).limit(1))[0];
  if (!existing) throw new Error("MARK_NOT_FOUND");
  const score = assertScore(input.score);
  const level = cbcLevel(score) as "EE1" | "EE2" | "ME1" | "ME2" | "AE1" | "AE2" | "BE1" | "BE2";
  await db.update(marks).set({
    score: String(score),
    midTerm: assessment.assessmentType === "mid_term" ? String(score) : null,
    endTerm: assessment.assessmentType === "end_term" ? String(score) : null,
    average: String(score),
    cbcLevel: level,
    updatedByUserId: userId,
    updatedAt: new Date(),
  }).where(eq(marks.id, existing.id));
  await writeAudit(userId, "assessment.locked_mark.correct", "mark", existing.id, {
    assessmentId: assessment.id,
    learnerId: input.learnerId,
    oldScore: existing.score == null ? null : Number(existing.score),
    newScore: score,
    reason: input.reason.trim(),
  });
  return { ok: true, score, cbcLevel: level };
}

export async function getClassMarklist(input: { academicYear: number; term: string; assessmentType: MarklistType; gradeId: number }, userId: number) {
  const db = await requireDb();
  const access = await actorAccess(userId);
  const filters = [
    eq(teacherAllocations.academicYear, input.academicYear),
    eq(teacherAllocations.term, input.term),
    eq(teacherAllocations.gradeId, input.gradeId),
  ];
  if (!access.isAdmin) filters.push(eq(teacherAllocations.teacherUserId, userId));
  const allocationRows = await db.select({ allocation: teacherAllocations, subject: subjects, staff: staffProfiles })
    .from(teacherAllocations)
    .innerJoin(subjects, eq(subjects.id, teacherAllocations.subjectId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, teacherAllocations.teacherUserId))
    .where(and(...filters))
    .orderBy(subjects.name);
  if (!allocationRows.length) throw new Error("MARKLIST_SCOPE_FORBIDDEN");

  const grade = (await db.select().from(grades).where(eq(grades.id, input.gradeId)).limit(1))[0];
  if (!grade) throw new Error("GRADE_NOT_FOUND");
  const school = (await db.select().from(schoolSettings).limit(1))[0] ?? null;
  const roster = await db.select().from(learners).where(and(eq(learners.gradeId, input.gradeId), eq(learners.status, "active"))).orderBy(learners.fullName);
  const subjectRows = Array.from(new Map(allocationRows.map(row => [row.subject.id, {
    id: row.subject.id,
    name: row.subject.name,
    code: row.subject.code,
    assessmentId: null as number | null,
    status: "missing" as string,
    teacherName: row.staff?.displayName ?? `User ${row.allocation.teacherUserId}`,
  }])).values());
  const selectedAssessmentTypes: AssessmentType[] = input.assessmentType === "average" ? ["mid_term", "end_term"] : [input.assessmentType];
  const assessmentsForPeriod = await db.select().from(assessments).where(and(
    eq(assessments.academicYear, input.academicYear),
    eq(assessments.term, input.term),
    inArray(assessments.assessmentType, selectedAssessmentTypes),
    eq(assessments.gradeId, input.gradeId),
  ));
  const assessmentBySubjectType = new Map(assessmentsForPeriod.map(row => [`${row.subjectId}:${row.assessmentType}`, row]));
  for (const subject of subjectRows) {
    if (input.assessmentType === "average") {
      const periodRecords = selectedAssessmentTypes.map(type => assessmentBySubjectType.get(`${subject.id}:${type}`));
      const statuses = periodRecords.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(row => row.status);
      subject.status = periodRecords.some(row => !row) ? "missing" : statuses.every(status => status === "locked") ? "locked" : statuses.every(status => status === "approved" || status === "locked") ? "approved" : statuses.includes("submitted") ? "submitted" : "draft";
    } else {
      const record = assessmentBySubjectType.get(`${subject.id}:${input.assessmentType}`);
      if (record) {
        subject.assessmentId = record.id;
        subject.status = record.status;
      }
    }
  }
  const assessmentIds = assessmentsForPeriod.map(row => row.id);
  const saved = assessmentIds.length
    ? await db.select().from(marks).where(inArray(marks.assessmentId, assessmentIds))
    : [];
  const assessmentTypeById = new Map(assessmentsForPeriod.map(row => [row.id, row.assessmentType]));
  const marksBySubjectLearnerType = new Map(saved.map(row => [`${row.subjectId}:${row.learnerId}:${assessmentTypeById.get(row.assessmentId)}`, row]));
  const classList = roster.map(learner => {
    const subjectMarks = subjectRows.map(subject => {
      const mid = marksBySubjectLearnerType.get(`${subject.id}:${learner.id}:mid_term`);
      const end = marksBySubjectLearnerType.get(`${subject.id}:${learner.id}:end_term`);
      const selected = input.assessmentType === "average" ? null : marksBySubjectLearnerType.get(`${subject.id}:${learner.id}:${input.assessmentType}`);
      const midScore = mid?.score == null ? null : Number(mid.score);
      const endScore = end?.score == null ? null : Number(end.score);
      const score = input.assessmentType === "average"
        ? averageAssessmentScores(midScore, endScore)
        : selected?.score == null ? null : Number(selected.score);
      return { subjectId: subject.id, score, cbcLevel: score === null ? null : cbcLevel(score), missing: score === null };
    });
    const entered = subjectMarks.filter(mark => mark.score !== null);
    const total = entered.reduce((sum, mark) => sum + (mark.score ?? 0), 0);
    return {
      learnerId: learner.id,
      admissionNumber: learner.admissionNumber,
      fullName: learner.fullName,
      marks: subjectMarks,
      enteredCount: entered.length,
      missingCount: subjectMarks.length - entered.length,
      total: entered.length ? Math.round(total * 100) / 100 : null,
      average: entered.length ? Math.round((total / entered.length) * 100) / 100 : null,
    };
  });
  return {
    schoolName: school?.schoolName ?? "School",
    academicYear: input.academicYear,
    term: input.term,
    assessmentType: input.assessmentType,
    grade: { id: grade.id, name: grade.name, stream: grade.stream },
    subjects: subjectRows,
    learners: classList,
    missingCount: classList.reduce((sum, row) => sum + row.missingCount, 0),
  };
}

export async function getAssessmentReportCard(input: { learnerId: number; academicYear: number; term: string; assessmentType: AssessmentType }, userId: number) {
  const db = await requireDb();
  const learnerRow = (await db.select({ learner: learners, grade: grades }).from(learners)
    .leftJoin(grades, eq(grades.id, learners.gradeId)).where(eq(learners.id, input.learnerId)).limit(1))[0];
  if (!learnerRow) throw new Error("LEARNER_NOT_FOUND");
  const access = await actorAccess(userId);
  const canViewWholeClass = access.isAdmin || learnerRow.grade?.classTeacherUserId === userId;
  const allocationFilters = [
    eq(teacherAllocations.gradeId, learnerRow.learner.gradeId),
    eq(teacherAllocations.academicYear, input.academicYear),
    eq(teacherAllocations.term, input.term),
  ];
  if (!access.isAdmin) allocationFilters.push(eq(teacherAllocations.teacherUserId, userId));
  const allocations = await db.select({ allocation: teacherAllocations, subject: subjects, staff: staffProfiles })
    .from(teacherAllocations).innerJoin(subjects, eq(subjects.id, teacherAllocations.subjectId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, teacherAllocations.teacherUserId))
    .where(and(...allocationFilters)).orderBy(subjects.name);
  const classSubjects = canViewWholeClass
    ? await db.select({ subject: subjects }).from(subjects).orderBy(subjects.name)
    : [];
  const reportSubjects = classSubjects.length ? classSubjects : allocations;
  if (!reportSubjects.length && !canViewWholeClass) throw new Error("REPORT_SCOPE_FORBIDDEN");
  const allocationBySubject = new Map(allocations.map(row => [row.subject.id, row]));

  const periodAssessments = await db.select().from(assessments).where(and(
    eq(assessments.gradeId, learnerRow.learner.gradeId),
    eq(assessments.academicYear, input.academicYear),
    eq(assessments.term, input.term),
    eq(assessments.assessmentType, input.assessmentType),
  ));
  const publishedAssessments = periodAssessments.filter(row => row.status === "approved" || row.status === "locked");
  const ids = publishedAssessments.map(row => row.id);
  const saved = ids.length
    ? await db.select().from(marks).where(and(eq(marks.learnerId, input.learnerId), inArray(marks.assessmentId, ids)))
    : [];
  const savedBySubject = new Map(saved.map(row => [row.subjectId, row]));
  const marksheet = Array.from(new Map(reportSubjects.map(row => [row.subject.id, row])).values()).map(row => {
    const assessment = publishedAssessments.find(item => item.subjectId === row.subject.id);
    const mark = savedBySubject.get(row.subject.id);
    const assignment = allocationBySubject.get(row.subject.id);
    return {
      subject: row.subject,
      score: mark?.score == null ? null : Number(mark.score),
      midTerm: mark?.midTerm == null ? null : Number(mark.midTerm),
      endTerm: mark?.endTerm == null ? null : Number(mark.endTerm),
      average: mark?.average == null ? null : Number(mark.average),
      cbcLevel: mark?.cbcLevel ?? null,
      teacherRemark: mark?.teacherRemark ?? null,
      assessmentStatus: assessment?.status ?? periodAssessments.find(item => item.subjectId === row.subject.id)?.status ?? "missing",
      teacherName: assignment?.staff?.displayName ?? null,
    };
  });
  const attendanceRows = await db.select().from(attendances).where(eq(attendances.learnerId, input.learnerId));
  const present = attendanceRows.filter(row => row.status === "present" || row.status === "late").length;
  const absent = attendanceRows.filter(row => row.status === "absent").length;
  const classTeacher = learnerRow.grade?.classTeacherUserId
    ? (await db.select().from(staffProfiles).where(eq(staffProfiles.userId, learnerRow.grade.classTeacherUserId)).limit(1))[0]?.displayName ?? null
    : null;
  const existing = (await db.select().from(reportCards).where(and(
    eq(reportCards.learnerId, input.learnerId),
    eq(reportCards.academicYear, input.academicYear),
    eq(reportCards.term, input.term),
    eq(reportCards.assessmentType, input.assessmentType),
  )).limit(1))[0];
  if (!existing) {
    await db.insert(reportCards).values({ ...input, status: "draft", generatedByUserId: userId });
  }
  const report = existing ?? (await db.select().from(reportCards).where(and(
    eq(reportCards.learnerId, input.learnerId),
    eq(reportCards.academicYear, input.academicYear),
    eq(reportCards.term, input.term),
    eq(reportCards.assessmentType, input.assessmentType),
  )).limit(1))[0] ?? null;
  const statuses = marksheet.map(row => row.assessmentStatus);
  const assessmentStatus = statuses.includes("missing") ? "incomplete" : statuses.includes("draft") ? "draft" : statuses.includes("submitted") ? "submitted" : statuses.includes("approved") ? "approved" : "locked";
  const settings = await getSettings();
  return {
    learner: learnerRow.learner,
    grade: learnerRow.grade,
    settings,
    academicYear: input.academicYear,
    term: input.term,
    assessmentType: input.assessmentType,
    marksheet,
    missingCount: marksheet.filter(row => row.score === null).length,
    assessmentStatus,
    attendance: { openingDays: attendanceRows.length, present, absent },
    classTeacher,
    report,
  };
}
