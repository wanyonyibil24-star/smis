import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { computePermissions, getAccessProfile, ROLE_LABELS } from "./access";
import {
  assessments,
  attendances,
  expenditures,
  feeStructures,
  grades,
  learners,
  marks,
  payments,
  rolePermissions,
  schoolSettings,
  staffProfiles,
  storeItems,
  storeMovements,
  subjects,
  userPermissions,
} from "../drizzle/schema";

export type DashboardInput = {
  days?: 7 | 30;
  academicYear?: number;
  term?: string;
  gradeId?: number;
};

const roleNames: Record<string, string> = {
  super_admin: "Super Administrator",
  admin: "Administrator",
  head_teacher: "Head Teacher",
  deputy_head: "Deputy Head Teacher",
  senior_teacher: "Senior Teacher",
  class_teacher: "Class Teacher",
  teacher: "Teacher",
  finance: "Bursar",
  storekeeper: "Storekeeper",
  other: "School Staff",
};

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const dateKey = (value: Date | string) => typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const isLeaderRole = (role: string) => ["super_admin", "admin", "head_teacher", "deputy_head"].includes(role);
const isTeachingRole = (role: string) => ["teacher", "class_teacher", "senior_teacher"].includes(role);
const labelGrade = (grade: { name: string; stream: string | null }) => `${grade.name}${grade.stream ? ` ${grade.stream}` : ""}`;

export async function getDashboardSnapshot(userId: number, input: DashboardInput = {}) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");

  const [access, configuredSchool, permissionRows] = await Promise.all([
    getAccessProfile(userId),
    db.select().from(schoolSettings).limit(1).then(rows => rows[0] ?? null),
    computePermissions(userId, "user"),
  ]);
  const grants = new Set(permissionRows);
  const allowed = (permission: string) => grants.has("*") || grants.has(permission);
  const role = access.role;
  const scoped = access.level === "class" || access.level === "allocated";
  const allowedGradeIds = scoped ? Array.from(new Set(access.gradeIds)) : null;
  const canLearners = allowed("learners.view");
  const canAttendance = allowed("attendance.view");
  const canAssessments = allowed("assessments.view");
  const canFinance = allowed("finance.view");
  const canStore = allowed("store.view");
  const canAdministration = allowed("administration.view");
  const canManagePermissions = grants.has("*") || grants.has("administration.manage_permissions");
  const leader = isLeaderRole(role) || access.level === "system";
  const teaching = isTeachingRole(role);

  const needsGrades = canLearners || canAttendance || canAssessments || canFinance;
  const allGradeRows = needsGrades && (!scoped || (allowedGradeIds?.length ?? 0) > 0)
    ? await db.select().from(grades).where(scoped ? inArray(grades.id, allowedGradeIds ?? []) : undefined).orderBy(grades.name, grades.stream)
    : [];
  const usableGrades = input.gradeId == null ? allGradeRows : allGradeRows.filter(grade => grade.id === input.gradeId);
  const selectedGradeId = input.gradeId != null && usableGrades.length ? input.gradeId : null;
  const selectedGradeIds = selectedGradeId != null ? [selectedGradeId] : scoped ? allowedGradeIds ?? [] : null;
  const gradeCondition = (column: typeof learners.gradeId | typeof attendances.gradeId | typeof assessments.gradeId | typeof feeStructures.gradeId) => {
    if (selectedGradeIds === null) return undefined;
    return selectedGradeIds.length ? inArray(column, selectedGradeIds) : sql`1 = 0`;
  };

  const needLearnerCounts = canLearners || canAttendance || canAssessments || canFinance;
  const learnerRows = needLearnerCounts && (!scoped || (selectedGradeIds?.length ?? 0) > 0)
    ? await db.select({ id: learners.id, gradeId: learners.gradeId, fullName: learners.fullName, admissionNumber: learners.admissionNumber })
      .from(learners)
      .where(and(eq(learners.status, "active"), gradeCondition(learners.gradeId)))
    : [];
  const learnerCountsByGrade = new Map<number, number>();
  for (const learner of learnerRows) learnerCountsByGrade.set(learner.gradeId, (learnerCountsByGrade.get(learner.gradeId) ?? 0) + 1);

  const days = input.days === 30 ? 30 : 7;
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const rangeStart = new Date(todayStart);
  rangeStart.setDate(rangeStart.getDate() - days + 1);
  const todayKey = localDateKey(today);

  let attendanceRows: Array<{ id: number; learnerId: number; gradeId: number; attendanceDate: Date; status: string; note: string | null; capturedAt: Date }> = [];
  if (canAttendance && (leader || teaching) && (!scoped || (selectedGradeIds?.length ?? 0) > 0)) {
    attendanceRows = await db.select({
      id: attendances.id,
      learnerId: attendances.learnerId,
      gradeId: attendances.gradeId,
      attendanceDate: attendances.attendanceDate,
      status: attendances.status,
      note: attendances.note,
      capturedAt: attendances.capturedAt,
    }).from(attendances).where(and(
      gte(attendances.attendanceDate, rangeStart),
      lte(attendances.attendanceDate, todayEnd),
      gradeCondition(attendances.gradeId),
    )).orderBy(desc(attendances.attendanceDate), desc(attendances.id));
  }

  const gradeNameById = new Map(allGradeRows.map(grade => [grade.id, labelGrade(grade)]));
  const learnerById = new Map(learnerRows.map(learner => [learner.id, learner]));
  const dailyAttendance = new Map<string, { present: number; absent: number; total: number }>();
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(rangeStart);
    day.setDate(rangeStart.getDate() + offset);
    dailyAttendance.set(localDateKey(day), { present: 0, absent: 0, total: 0 });
  }
  for (const row of attendanceRows) {
    const key = dateKey(row.attendanceDate);
    const current = dailyAttendance.get(key);
    if (!current) continue;
    current.total += 1;
    if (row.status === "present" || row.status === "late") current.present += 1;
    if (row.status === "absent") current.absent += 1;
  }
  const todayRows = attendanceRows.filter(row => dateKey(row.attendanceDate) === todayKey);
  const todayPresent = todayRows.filter(row => row.status === "present" || row.status === "late").length;
  const todayRecorded = todayRows.length;
  const expectedLearners = canLearners || canAttendance ? learnerRows.length : null;
  const attendanceTrend = Array.from(dailyAttendance.entries()).map(([date, counts]) => ({
    date,
    present: counts.present,
    absent: counts.absent,
    total: counts.total,
    rate: counts.total ? Math.round(counts.present / counts.total * 1000) / 10 : null,
  }));
  const recentAttendance = canLearners && canAttendance && (leader || teaching)
    ? todayRows.slice(0, 6).flatMap(row => {
      const learner = learnerById.get(row.learnerId);
      if (!learner) return [];
      return [{ id: row.id, learner: learner.fullName, admissionNumber: learner.admissionNumber, grade: gradeNameById.get(row.gradeId) ?? "", status: row.status, note: row.note, capturedAt: row.capturedAt }];
    })
    : [];

  let accessibleAssessments: Array<{
    id: number; title: string; term: string; academicYear: number; gradeId: number; subjectId: number;
    status: string; grade: string; subject: string;
  }> = [];
  if (canAssessments && (!scoped || (selectedGradeIds?.length ?? 0) > 0)) {
    const gradeRules = selectedGradeIds === null ? [] : selectedGradeIds.map(id => eq(assessments.gradeId, id));
    const pairRules = access.pairs.map(pair => {
      const [gradeId, subjectId] = pair.split(":").map(Number);
      return and(eq(assessments.gradeId, gradeId), eq(assessments.subjectId, subjectId));
    }).filter(Boolean);
    const needsPairLimit = scoped && role !== "class_teacher";
    const scopeRules = [
      selectedGradeIds === null ? undefined : gradeRules.length ? or(...gradeRules) : sql`1 = 0`,
      needsPairLimit ? pairRules.length ? or(...pairRules) : sql`1 = 0` : undefined,
    ];
    const rows = await db.select({
      id: assessments.id,
      title: assessments.title,
      term: assessments.term,
      academicYear: assessments.academicYear,
      gradeId: assessments.gradeId,
      subjectId: assessments.subjectId,
      status: assessments.status,
      grade: grades.name,
      stream: grades.stream,
      subject: subjects.name,
    }).from(assessments)
      .innerJoin(grades, eq(grades.id, assessments.gradeId))
      .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
      .where(and(...scopeRules))
      .orderBy(desc(assessments.academicYear), desc(assessments.updatedAt));
    accessibleAssessments = rows.map(row => ({ ...row, grade: labelGrade({ name: row.grade, stream: row.stream }) }));
  }

  const availablePeriodsMap = new Map<string, { academicYear: number; term: string }>();
  for (const row of accessibleAssessments) availablePeriodsMap.set(`${row.academicYear}:${row.term}`, { academicYear: row.academicYear, term: row.term });
  if (canAssessments && configuredSchool) availablePeriodsMap.set(`${configuredSchool.academicYear}:${configuredSchool.currentTerm}`, { academicYear: configuredSchool.academicYear, term: configuredSchool.currentTerm });
  const availablePeriods = Array.from(availablePeriodsMap.values()).sort((a, b) => b.academicYear - a.academicYear || a.term.localeCompare(b.term));
  const requestedPair = input.academicYear != null && input.term ? `${input.academicYear}:${input.term}` : null;
  const defaultPeriod = availablePeriods.find(period => period.academicYear === configuredSchool?.academicYear && period.term === configuredSchool?.currentTerm) ?? availablePeriods[0] ?? null;
  const selectedPeriod = requestedPair ? availablePeriods.find(period => `${period.academicYear}:${period.term}` === requestedPair) ?? defaultPeriod : defaultPeriod;
  const selectedAssessments = selectedPeriod ? accessibleAssessments.filter(row => row.academicYear === selectedPeriod.academicYear && row.term === selectedPeriod.term) : [];
  const assessmentIds = selectedAssessments.map(row => row.id);
  const markCounts = new Map<number, number>();
  if (assessmentIds.length) {
    const counts = await db.select({ assessmentId: marks.assessmentId, count: sql<number>`count(*)` })
      .from(marks).where(inArray(marks.assessmentId, assessmentIds)).groupBy(marks.assessmentId);
    for (const count of counts) markCounts.set(count.assessmentId, Number(count.count));
  }
  const assessmentTasks = selectedAssessments.flatMap(row => {
    const expected = learnerCountsByGrade.get(row.gradeId) ?? 0;
    const marked = markCounts.get(row.id) ?? 0;
    const incomplete = expected > marked;
    const needsReview = leader && row.status === "submitted";
    const needsEntry = teaching && row.status === "draft" && incomplete;
    if (!needsReview && !needsEntry) return [];
    return [{
      id: row.id,
      title: row.title,
      grade: row.grade,
      subject: row.subject,
      status: row.status,
      marked,
      expected,
      percent: expected ? Math.round(marked / expected * 100) : null,
      action: needsReview ? "Review submitted marklist" : "Complete marklist",
    }];
  }).slice(0, 8);
  const assessmentsOpen = selectedAssessments.filter(row => row.status === "draft" || row.status === "submitted").length;
  const averageMarks = assessmentIds.length
    ? await db.select({ average: sql<number>`avg(${marks.average})` })
      .from(marks).where(inArray(marks.assessmentId, assessmentIds)).then(rows => rows[0]?.average == null ? null : Math.round(Number(rows[0].average) * 10) / 10)
    : null;
  const assignedClasses = teaching ? allGradeRows.map(grade => ({ id: grade.id, label: labelGrade(grade), learners: learnerCountsByGrade.get(grade.id) ?? 0 })) : [];

  let finance: null | { collected: number; required: number; balance: number; expenditure: number | null; trend: Array<{ date: string; collected: number; expenditure: number | null }>; recentPayments: Array<{ id: number; learner: string; amount: number; method: string; reference: string; paidAt: Date }> } = null;
  if (canFinance) {
    const canSeeSchoolFinance = access.level === "school" || access.level === "system";
    const financeLearnerRows = selectedGradeIds === null
      ? learnerRows
      : learnerRows.filter(learner => selectedGradeIds.includes(learner.gradeId));
    const ids = financeLearnerRows.map(row => row.id);
    const [paymentRows, feeRows] = await Promise.all([
      db.select({ id: payments.id, learnerId: payments.learnerId, amount: payments.amount, paymentMethod: payments.paymentMethod, reference: payments.reference, paidAt: payments.paidAt, learnerName: learners.fullName })
        .from(payments).innerJoin(learners, eq(learners.id, payments.learnerId))
        .where(selectedGradeIds === null ? undefined : ids.length ? inArray(payments.learnerId, ids) : sql`1 = 0`)
        .orderBy(desc(payments.paidAt)),
      db.select().from(feeStructures).where(gradeCondition(feeStructures.gradeId)),
    ]);
    const expenditureRows = canSeeSchoolFinance ? await db.select().from(expenditures).orderBy(desc(expenditures.expenditureDate)) : [];
    const feeRequired = feeRows.reduce((sum, fee) => sum + Number(fee.amount) * (learnerCountsByGrade.get(fee.gradeId) ?? 0), 0);
    const paid = paymentRows.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const expenditureTotal = canSeeSchoolFinance ? expenditureRows.reduce((sum, row) => sum + Number(row.amount), 0) : null;
    const trendMap = new Map<string, { collected: number; expenditure: number | null }>();
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(rangeStart);
      date.setDate(rangeStart.getDate() + offset);
      trendMap.set(localDateKey(date), { collected: 0, expenditure: canSeeSchoolFinance ? 0 : null });
    }
    for (const payment of paymentRows) {
      const bucket = trendMap.get(dateKey(payment.paidAt));
      if (bucket) bucket.collected += Number(payment.amount);
    }
    for (const row of expenditureRows) {
      const bucket = trendMap.get(dateKey(row.expenditureDate));
      if (bucket && bucket.expenditure !== null) bucket.expenditure += Number(row.amount);
    }
    finance = {
      collected: paid,
      required: feeRequired,
      balance: feeRequired - paid,
      expenditure: expenditureTotal,
      trend: Array.from(trendMap.entries()).map(([date, amount]) => ({ date, ...amount })),
      recentPayments: paymentRows.slice(0, 5).map(payment => ({ id: payment.id, learner: payment.learnerName, amount: Number(payment.amount), method: payment.paymentMethod, reference: payment.reference, paidAt: payment.paidAt })),
    };
  }

  let inventory: null | { total: number; lowStock: number; alerts: Array<{ name: string; quantity: number; unit: string; reorderLevel: number }>; movements: Array<{ id: number; item: string; movementType: string; quantity: number; reference: string | null; createdAt: Date }> } = null;
  if (canStore) {
    const [stockRows, recentMovements] = await Promise.all([
      db.select({ item: storeItems, movement: storeMovements })
        .from(storeItems).leftJoin(storeMovements, eq(storeItems.id, storeMovements.itemId)),
      db.select({ movement: storeMovements, itemName: storeItems.name }).from(storeMovements)
        .innerJoin(storeItems, eq(storeItems.id, storeMovements.itemId))
        .orderBy(desc(storeMovements.createdAt), desc(storeMovements.id)).limit(6),
    ]);
    const stock = new Map<number, { id: number; name: string; unit: string; quantity: number; reorderLevel: number }>();
    for (const row of stockRows) {
      if (!row.item) continue;
      const item = stock.get(row.item.id) ?? { id: row.item.id, name: row.item.name, unit: row.item.unit, quantity: 0, reorderLevel: Number(row.item.reorderLevel) };
      if (row.movement) item.quantity += row.movement.movementType === "issued" ? -Number(row.movement.quantity) : Number(row.movement.quantity);
      stock.set(row.item.id, item);
    }
    const items = Array.from(stock.values());
    const alerts = items.filter(item => item.quantity <= item.reorderLevel).sort((a, b) => a.quantity - a.reorderLevel - (b.quantity - b.reorderLevel)).slice(0, 6).map(({ name, quantity, unit, reorderLevel }) => ({ name, quantity, unit, reorderLevel }));
    inventory = { total: items.length, lowStock: items.filter(item => item.quantity <= item.reorderLevel).length, alerts, movements: recentMovements.map(({ movement, itemName }) => ({ id: movement.id, item: itemName, movementType: movement.movementType, quantity: Number(movement.quantity), reference: movement.reference, createdAt: movement.createdAt })) };
  }

  const superAdmin = role === "super_admin" || access.level === "system";
  let configuration: null | { rolePolicies: number; userOverrides: number } = null;
  if (superAdmin && canManagePermissions) {
    const [policies, overrides] = await Promise.all([db.select().from(rolePermissions), db.select().from(userPermissions)]);
    configuration = { rolePolicies: policies.length, userOverrides: overrides.length };
  }

  return {
    user: { role, roleLabel: roleNames[role] ?? ROLE_LABELS[role] ?? "School Staff", leader, teaching, superAdmin },
    school: configuredSchool ? { name: configuredSchool.schoolName, motto: configuredSchool.motto, term: configuredSchool.currentTerm, academicYear: configuredSchool.academicYear } : null,
    permissions: { learners: canLearners, attendance: canAttendance, assessments: canAssessments, finance: canFinance, store: canStore, administration: canAdministration, audit: allowed("administration.view"), managePermissions: canManagePermissions, timetable: allowed("timetable.view"), communication: allowed("communication.edit"), clockIn: allowed("dashboard.view") },
    filters: {
      days,
      gradeId: selectedGradeId,
      academicYear: selectedPeriod?.academicYear ?? null,
      term: selectedPeriod?.term ?? null,
      grades: (canLearners || canAttendance || canAssessments || canFinance) ? allGradeRows.map(grade => ({ id: grade.id, label: labelGrade(grade) })) : [],
      periods: availablePeriods,
    },
    metrics: {
      learners: canLearners && (leader || teaching) ? learnerRows.length : null,
      staff: canAdministration ? (await db.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(staffProfiles.status, "active"))).length : null,
      attendance: canAttendance && (leader || teaching) ? {
        present: todayPresent,
        absent: todayRows.filter(row => row.status === "absent").length,
        late: todayRows.filter(row => row.status === "late").length,
        recorded: todayRecorded,
        expected: expectedLearners,
        rate: todayRecorded ? Math.round(todayPresent / todayRecorded * 1000) / 10 : null,
      } : null,
      openAssessments: canAssessments && (leader || teaching) ? assessmentsOpen : null,
      averageMarks: canAssessments && (leader || teaching) ? averageMarks : null,
      pendingMarklists: assessmentTasks.length,
      collections: canFinance ? finance?.collected ?? null : null,
      outstanding: canFinance ? finance?.balance ?? null : null,
      expenditure: canFinance ? finance?.expenditure ?? null : null,
      inventoryItems: canStore ? inventory?.total ?? null : null,
      lowStock: canStore ? inventory?.lowStock ?? null : null,
    },
    attendanceTrend: canAttendance && (leader || teaching) ? attendanceTrend : [],
    recentAttendance,
    assessmentTasks,
    assignedClasses,
    finance,
    inventory,
    administration: canAdministration ? { systemDatabase: superAdmin ? "connected" : null, configuration } : null,
  };
}
