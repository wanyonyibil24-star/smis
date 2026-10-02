import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { MANAGE_PERMISSIONS } from "./access";
import { AdminError, AUDIT_MODULES, adminCatalog, adminOverview, changeAdminAssignment, changeAdminRole, createAdminUser, getAdminUser, getPermissionMatrixView, listAdminUsers, listAuditTrail, resetAdminPassword, setAccountState, setRolePermission, setUserPermissionOverride, updateAdminUser } from "./administration";
import { correctLockedAssessmentMark, ensureAssessment, getAssessmentEntries, getAssessmentReportCard, getClassMarklist, listAssessmentScopes, saveAssessmentMarks, setAssessmentFinalState, submitAssessment } from "./assessment";
import { adminResetIamPassword, changeIamPassword, loginWithIam, logoutIam, requestIamPasswordReset, resetIamPassword, safeAuthProfile } from "./iam";
import {
  archiveLearner,
  canViewMasterTimetable,
  createCommunication,
  generateTimetable,
  generateAutomaticTimetable,
  getAttendanceRegister,
  getAttendanceRegisterApproval,
  getAttendanceSummary,
  getPersonalTimetable,
  canManageMasterTimetable,
  getDashboardSnapshot,
  getFinanceOverview,
  getIntegratedReportCard,
  getReportCard,
  getSettings,
  getStoreOverview,
  listAlumni,
  listAllocations,
  listAcademicCatalog,
  saveTeacherAllocation,
  changeTeacherAllocationStatus,
  listAssessments,
  listAttendance,
  listAuditLogs,
  listCommunications,
  listLearners,
  createGradeClass,
  createLearningArea,
  createLearner,
  updateLearner,
  setLearnerStatus,
  previewPeopleImport,
  importPeopleRows,
  listMarks,
  listStaff,
  createStaff,
  updateStaff,
  setStaffStatus,
  updateStaffRole,
  listTimetable,
  listTeacherCodes,
  listTimetableRequirements,
  recordPayment,
  recordStoreMovement,
  saveAttendance,
  saveAttendanceBatch,
  setAttendanceRegisterStatus,
  saveMark,
  saveReportCardComments,
  saveSettings,
  setReportCardStatus,
  updateTeacherCode,
  setTimetableRequirement,
  effectivePermissions,
  userCan,
  writeAudit,
} from "./smis";
import {
  aiFacts,
  createNotification,
  financialSummary,
  getPermissionMatrix,
  listExpenditures,
  listGuardians,
  listNotifications,
  recordExpenditure,
  saveGuardian,
  setUserPermission,
} from "./smis-extension";

const currentUserId = (user: { id: number }) => user.id;
const permissionProcedure = (permission: string) => protectedProcedure.use(async ({ ctx, next }) => {
  const allowed = await userCan(ctx.user.id, ctx.user.role, permission);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: `Missing permission: ${permission}` });
  return next();
});
const superProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await userCan(ctx.user.id, ctx.user.role, MANAGE_PERMISSIONS))) {
    await writeAudit(ctx.user.id, "auth.access_denied", "permission", MANAGE_PERMISSIONS, { required: MANAGE_PERMISSIONS });
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a Super Administrator can do this." });
  }
  return next();
});
const adminCall = async <T>(fn: () => Promise<T>) => {
  try { return await fn(); } catch (error) {
    if (!(error instanceof AdminError)) throw error;
    const code = /TAKEN|CONFLICT/.test(error.message) ? "CONFLICT" : /NOT_FOUND/.test(error.message) ? "NOT_FOUND" : /ONLY_SUPER|PROTECTED|^CANNOT_/.test(error.message) ? "FORBIDDEN" : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
};
const roleEnum = z.enum(["super_admin", "admin", "teacher", "class_teacher", "finance", "other"]);
const subjectAllocations = z.array(z.object({ gradeId: z.number().int().positive(), subjectId: z.number().int().positive() })).max(40);

const masterTimetableProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!await canManageMasterTimetable(ctx.user.id, ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "MASTER_TIMETABLE_ADMIN_ONLY" });
  return next();
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => safeAuthProfile(ctx.user)),
    login: publicProcedure.input(z.object({ identifier: z.string().min(1).max(320), password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
      try {
        return await loginWithIam(input, ctx.req, ctx.res);
      } catch (error) {
        const code = error instanceof Error ? error.message : "INVALID_CREDENTIALS";
        throw new TRPCError({ code: code === "ACCOUNT_LOCKED" || code === "ACCOUNT_DISABLED" ? "FORBIDDEN" : "UNAUTHORIZED", message: code });
      }
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      void logoutIam(ctx.req, ctx.res);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    changePassword: protectedProcedure.input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) })).mutation(async ({ input, ctx }) => {
      await changeIamPassword(ctx.user.id, input.currentPassword, input.newPassword, ctx.req);
      return { success: true } as const;
    }),
    forgotPassword: publicProcedure.input(z.object({ identifier: z.string().min(1).max(320) })).mutation(({ input, ctx }) => requestIamPasswordReset(input.identifier, ctx.req)),
    resetPassword: publicProcedure.input(z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(10).max(200) })).mutation(({ input, ctx }) => resetIamPassword(input.token, input.newPassword, ctx.req).then(() => ({ success: true }) as const)),
    adminResetPassword: permissionProcedure("users.edit").input(z.object({ userId: z.number().int().positive() })).mutation(({ input, ctx }) => adminResetIamPassword(input.userId, ctx.user.id, ctx.req)),
  }),
  smis: router({
    health: publicProcedure.query(() => ({ ok: true, service: "kenyan-smis", persistence: "mysql-drizzle", modules: ["learners", "attendance", "assessments", "reports", "finance", "store", "timetable", "communication", "alumni", "users", "settings", "audit"] })),
    snapshot: permissionProcedure("dashboard.view").query(() => getDashboardSnapshot()),
    learners: router({
      list: permissionProcedure("learners.view").input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listLearners(input?.search)),
      create: permissionProcedure("learners.add").input(z.object({ fullName: z.string().min(1).max(160), admissionNumber: z.string().min(1).max(40), guardianName: z.string().max(160).nullable().optional(), guardianIdNumber: z.string().max(40).nullable().optional(), guardianPhone: z.string().max(40).nullable().optional(), gradeId: z.number().int().positive(), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => createLearner(input, currentUserId(ctx.user))),
      update: permissionProcedure("learners.edit").input(z.object({ learnerId: z.number().int().positive(), fullName: z.string().min(1).max(160), admissionNumber: z.string().min(1).max(40), guardianName: z.string().max(160).nullable().optional(), guardianIdNumber: z.string().max(40).nullable().optional(), guardianPhone: z.string().max(40).nullable().optional(), gradeId: z.number().int().positive(), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => updateLearner(input, currentUserId(ctx.user))),
      setStatus: permissionProcedure("learners.deactivate").input(z.object({ learnerId: z.number().int().positive(), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => setLearnerStatus(input, currentUserId(ctx.user))),
      previewImport: permissionProcedure("learners.add").input(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) })).query(({ input }) => previewPeopleImport({ kind: "learners", rows: input.rows })),
      import: permissionProcedure("learners.add").input(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) })).mutation(({ input, ctx }) => importPeopleRows({ kind: "learners", rows: input.rows }, currentUserId(ctx.user))),
    }),
    attendance: router({
      list: permissionProcedure("attendance.view").input(z.object({ date: z.string().optional(), session: z.enum(["morning", "afternoon"]).optional() }).optional()).query(({ input, ctx }) => listAttendance(input?.date, currentUserId(ctx.user), input?.session ?? "morning")),
      register: permissionProcedure("attendance.view").input(z.object({ date: z.string().min(10).max(10), session: z.enum(["morning", "afternoon"]).optional() })).query(({ input, ctx }) => getAttendanceRegister(input.date, currentUserId(ctx.user), input.session ?? "morning")),
      save: permissionProcedure("attendance.edit").input(z.object({ learnerId: z.number().int().positive(), status: z.enum(["present", "absent", "late", "excused"]), attendanceDate: z.string(), session: z.enum(["morning", "afternoon"]).optional(), note: z.string().max(255).nullable().optional() })).mutation(({ input, ctx }) => saveAttendance(input, currentUserId(ctx.user))),
      saveBatch: permissionProcedure("attendance.edit").input(z.object({ attendanceDate: z.string().date(), session: z.enum(["morning", "afternoon"]).optional(), entries: z.array(z.object({ learnerId: z.number().int().positive(), status: z.enum(["present", "absent", "late", "excused"]) })).min(1).max(500) })).mutation(({ input, ctx }) => saveAttendanceBatch(input, currentUserId(ctx.user))),
      summary: permissionProcedure("attendance.view").input(z.object({ period: z.enum(["weekly", "monthly", "termly", "yearly"]), gradeLevel: z.number().int().min(7).max(9).optional() })).query(({ input, ctx }) => getAttendanceSummary(input, currentUserId(ctx.user))),
      approval: permissionProcedure("attendance.view").input(z.object({ date: z.string().date(), gradeId: z.number().int().positive() })).query(({ input, ctx }) => getAttendanceRegisterApproval(input.date, input.gradeId, currentUserId(ctx.user))),
      setApproval: permissionProcedure("attendance.edit").input(z.object({ attendanceDate: z.string().date(), gradeId: z.number().int().positive(), action: z.enum(["submit", "approve", "reopen"]) })).mutation(({ input, ctx }) => setAttendanceRegisterStatus(input, currentUserId(ctx.user))),
    }),
    assessments: router({
      reviewAccess: protectedProcedure.query(({ ctx }) => userCan(ctx.user.id, ctx.user.role, "settings.edit")),
      commentAccess: protectedProcedure.query(({ ctx }) => userCan(ctx.user.id, ctx.user.role, "assessments.edit")),
      list: permissionProcedure("assessments.view").query(() => listAssessments()),
      marks: permissionProcedure("assessments.view").input(z.object({ assessmentId: z.number().int().positive().optional() }).optional()).query(({ input, ctx }) => listMarks(input?.assessmentId, currentUserId(ctx.user))),
      saveMark: permissionProcedure("assessments.edit").input(z.object({ assessmentId: z.number().int().positive(), learnerId: z.number().int().positive(), subjectId: z.number().int().positive(), midTerm: z.number().min(0).max(100), endTerm: z.number().min(0).max(100), teacherRemark: z.string().max(255).nullable().optional() })).mutation(({ input, ctx }) => saveMark(input, currentUserId(ctx.user))),
      scopes: permissionProcedure("assessments.view").query(({ ctx }) => listAssessmentScopes(currentUserId(ctx.user))),
      open: permissionProcedure("assessments.edit").input(z.object({ academicYear: z.number().int().min(2000).max(2100), term: z.string().min(1).max(40), assessmentType: z.enum(["mid_term", "end_term"]), gradeId: z.number().int().positive(), subjectId: z.number().int().positive() })).mutation(({ input, ctx }) => ensureAssessment(input, currentUserId(ctx.user))),
      entries: permissionProcedure("assessments.view").input(z.object({ assessmentId: z.number().int().positive() })).query(({ input, ctx }) => getAssessmentEntries(input.assessmentId, currentUserId(ctx.user))),
      saveRows: permissionProcedure("assessments.edit").input(z.object({ assessmentId: z.number().int().positive(), rows: z.array(z.object({ learnerId: z.number().int().positive(), score: z.number().min(0).max(100).nullable(), teacherRemark: z.string().max(255).nullable().optional() })).max(500) })).mutation(({ input, ctx }) => saveAssessmentMarks(input, currentUserId(ctx.user))),
      submit: permissionProcedure("assessments.edit").input(z.object({ assessmentId: z.number().int().positive() })).mutation(({ input, ctx }) => submitAssessment(input.assessmentId, currentUserId(ctx.user))),
      setFinalState: permissionProcedure("settings.edit").input(z.object({ assessmentId: z.number().int().positive(), status: z.enum(["approved", "locked"]) })).mutation(({ input, ctx }) => setAssessmentFinalState(input, currentUserId(ctx.user))),
      correctLockedMark: permissionProcedure("settings.edit").input(z.object({ assessmentId: z.number().int().positive(), learnerId: z.number().int().positive(), score: z.number().min(0).max(100), reason: z.string().min(10).max(500) })).mutation(({ input, ctx }) => correctLockedAssessmentMark(input, currentUserId(ctx.user))),
      classMarklist: permissionProcedure("assessments.view").input(z.object({ academicYear: z.number().int().min(2000).max(2100), term: z.string().min(1).max(40), assessmentType: z.enum(["mid_term", "end_term", "average"]), gradeId: z.number().int().positive() })).query(({ input, ctx }) => getClassMarklist(input, currentUserId(ctx.user))),
    }),
    finance: router({
      overview: permissionProcedure("finance.view").input(z.object({ learnerId: z.number().int().positive().optional() }).optional()).query(({ input }) => getFinanceOverview(input?.learnerId)),
      recordPayment: permissionProcedure("finance.edit").input(z.object({ learnerId: z.number().int().positive(), amount: z.number().positive(), paymentMethod: z.enum(["mpesa", "bank", "cash"]), reference: z.string().min(3).max(80) })).mutation(({ input, ctx }) => recordPayment(input, currentUserId(ctx.user))),
      summary: permissionProcedure("finance.view").query(() => financialSummary()),
      expenditures: permissionProcedure("finance.view").query(() => listExpenditures()),
      recordExpenditure: permissionProcedure("finance.edit").input(z.object({ expenditureDate: z.string(), amount: z.number().positive(), category: z.string().min(1).max(120), description: z.string().min(1).max(255), responsiblePerson: z.string().min(1).max(160) })).mutation(({ input, ctx }) => recordExpenditure(input, currentUserId(ctx.user))),
    }),
    people: router({
      catalog: permissionProcedure("learners.view").query(() => listAcademicCatalog()),
      guardians: permissionProcedure("learners.view").input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listGuardians(input?.search)),
      addGuardian: permissionProcedure("learners.add").input(z.object({ fullName: z.string().min(1).max(160), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), communicationPreference: z.enum(["sms", "email", "phone"]), learnerId: z.number().int().positive().optional(), relationship: z.string().max(80).optional() })).mutation(({ input, ctx }) => saveGuardian(input, currentUserId(ctx.user))),
    }),
    notifications: router({
      list: permissionProcedure("communication.edit").query(() => listNotifications()),
      create: permissionProcedure("communication.edit").input(z.object({ audience: z.enum(["parents", "staff", "learners", "all"]), title: z.string().min(1).max(160), body: z.string().min(1), status: z.enum(["draft", "published"]) })).mutation(({ input, ctx }) => createNotification(input, currentUserId(ctx.user))),
    }),
    store: router({
      overview: permissionProcedure("store.view").query(() => getStoreOverview()),
      recordMovement: permissionProcedure("store.edit").input(z.object({ itemId: z.number().int().positive(), movementType: z.enum(["received", "issued", "adjustment"]), quantity: z.number().positive(), reference: z.string().max(120).nullable().optional() })).mutation(({ input, ctx }) => recordStoreMovement(input, currentUserId(ctx.user))),
    }),
    timetable: router({
      access: protectedProcedure.query(async ({ ctx }) => {
        const canManageMaster = await canManageMasterTimetable(ctx.user.id, ctx.user.role);
        const canViewPersonal = canManageMaster || await userCan(ctx.user.id, ctx.user.role, "timetable.view");
        const canViewMaster = await canViewMasterTimetable(ctx.user.id, ctx.user.role);
        return { canManageMaster, canViewPersonal, canViewMaster };
      }),
      personal: permissionProcedure("timetable.view").query(({ ctx }) => getPersonalTimetable(currentUserId(ctx.user))),
      list: masterTimetableProcedure.query(() => listTimetable()),
      masterList: protectedProcedure.use(async ({ ctx, next }) => {
        if (!await canViewMasterTimetable(ctx.user.id, ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "MASTER_TIMETABLE_SCOPE_FORBIDDEN" });
        return next();
      }).query(() => listTimetable()),
      teacherCodes: masterTimetableProcedure.query(() => listTeacherCodes()),
      updateTeacherCode: masterTimetableProcedure.input(z.object({ staffProfileId: z.number().int().positive(), teacherCode: z.number().int().min(1).max(999) })).mutation(({ input, ctx }) => updateTeacherCode(input, currentUserId(ctx.user))),
      generate: masterTimetableProcedure.input(z.object({ entries: z.array(z.object({ gradeId: z.number().int().positive(), subjectId: z.number().int().positive(), teacherUserId: z.number().int().positive(), dayOfWeek: z.number().int().min(1).max(7), period: z.number().int().positive(), room: z.string().max(80).nullable().optional() })) })).mutation(({ input, ctx }) => generateTimetable(input.entries, currentUserId(ctx.user))),
      requirements: masterTimetableProcedure.input(z.object({ academicYear: z.number().int().optional() }).optional()).query(({ input }) => listTimetableRequirements(input?.academicYear)),
      setRequirement: masterTimetableProcedure.input(z.object({ gradeId: z.number().int().positive(), subjectId: z.number().int().positive(), academicYear: z.number().int().min(2000).max(2100), periodsPerWeek: z.number().int().min(0).max(40) })).mutation(({ input, ctx }) => setTimetableRequirement(input, currentUserId(ctx.user))),
      generateAutomatic: masterTimetableProcedure.input(z.object({ academicYear: z.number().int().min(2000).max(2100).optional(), regenerate: z.boolean(), days: z.number().int().min(1).max(7).optional(), periodsPerDay: z.number().int().min(1).max(12).optional() })).mutation(({ input, ctx }) => generateAutomaticTimetable(input, currentUserId(ctx.user))),
    }),
    communication: router({
      list: permissionProcedure("communication.edit").query(() => listCommunications()),
      create: permissionProcedure("communication.edit").input(z.object({ audience: z.enum(["parents", "staff", "learners", "all"]), channel: z.enum(["sms", "notice", "email"]), subject: z.string().min(1).max(160), body: z.string().min(1) })).mutation(({ input, ctx }) => createCommunication(input, currentUserId(ctx.user))),
    }),
    alumni: router({
      list: permissionProcedure("alumni.edit").query(() => listAlumni()),
      archive: permissionProcedure("alumni.edit").input(z.object({ learnerId: z.number().int().positive(), completionYear: z.number().int().min(2000).max(2100), destination: z.string().max(160).nullable().optional() })).mutation(({ input, ctx }) => archiveLearner(input, currentUserId(ctx.user))),
    }),
    administration: router({
      overview: permissionProcedure("administration.view").query(() => adminOverview()),
      catalog: permissionProcedure("administration.view").query(() => adminCatalog()),
      list: permissionProcedure("administration.view").input(z.object({ search: z.string().max(100).optional(), role: z.string().optional(), status: z.enum(["active", "suspended", "locked", "pending"]).optional() }).optional()).query(({ input }) => listAdminUsers(input ?? {})),
      get: permissionProcedure("administration.view").input(z.object({ userId: z.number().int().positive() })).query(({ input }) => adminCall(() => getAdminUser(input.userId))),
      create: permissionProcedure("administration.create").input(z.object({ fullName: z.string().min(2).max(160), username: z.string().min(3).max(60), staffId: z.string().min(1).max(40), role: roleEnum, department: z.string().max(120).nullable().optional(), email: z.string().email().max(320).nullable().optional().or(z.literal("")), phone: z.string().max(40).nullable().optional(), classGradeId: z.number().int().positive().nullable().optional(), subjectAllocations: subjectAllocations.optional(), status: z.enum(["active", "pending_activation", "disabled"]) })).mutation(({ input, ctx }) => adminCall(() => createAdminUser(input, ctx.user, ctx.req))),
      update: permissionProcedure("administration.edit").input(z.object({ userId: z.number().int().positive(), fullName: z.string().min(2).max(160), username: z.string().min(3).max(60), staffId: z.string().min(1).max(40), department: z.string().max(120).nullable().optional(), email: z.string().email().max(320).nullable().optional().or(z.literal("")), phone: z.string().max(40).nullable().optional() })).mutation(({ input, ctx }) => adminCall(() => updateAdminUser(input, ctx.user, ctx.req))),
      changeRole: permissionProcedure("administration.edit").input(z.object({ userId: z.number().int().positive(), role: roleEnum })).mutation(({ input, ctx }) => adminCall(() => changeAdminRole(input, ctx.user, ctx.req))),
      changeAssignment: permissionProcedure("administration.edit").input(z.object({ userId: z.number().int().positive(), classGradeId: z.number().int().positive().nullable().optional(), subjectAllocations })).mutation(({ input, ctx }) => adminCall(() => changeAdminAssignment(input, ctx.user, ctx.req))),
      setState: permissionProcedure("administration.edit").input(z.object({ userId: z.number().int().positive(), action: z.enum(["activate", "suspend", "lock", "unlock"]), reason: z.string().max(255).optional() })).mutation(({ input, ctx }) => adminCall(() => setAccountState(input, ctx.user, ctx.req))),
      resetPassword: permissionProcedure("administration.edit").input(z.object({ userId: z.number().int().positive() })).mutation(({ input, ctx }) => adminCall(() => resetAdminPassword(input, ctx.user, ctx.req))),
      matrix: permissionProcedure("administration.view").input(z.object({ role: z.string().optional(), userId: z.number().int().positive().optional() })).query(({ input }) => getPermissionMatrixView(input)),
      setRolePermission: superProcedure.input(z.object({ role: z.string(), permissionKey: z.string(), allowed: z.boolean() })).mutation(({ input, ctx }) => adminCall(() => setRolePermission(input, ctx.user, ctx.req))),
      setUserPermission: superProcedure.input(z.object({ userId: z.number().int().positive(), permissionKey: z.string(), allowed: z.boolean().nullable() })).mutation(({ input, ctx }) => adminCall(() => setUserPermissionOverride(input, ctx.user, ctx.req))),
      auditModules: permissionProcedure("administration.view").query(() => AUDIT_MODULES),
      audit: permissionProcedure("administration.view").input(z.object({ userId: z.number().int().positive().optional(), actorUserId: z.number().int().positive().optional(), action: z.string().max(80).optional(), module: z.string().max(40).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() }).optional()).query(({ input }) => listAuditTrail(input ?? {})),
    }),
    users: router({
      list: permissionProcedure("users.edit").input(z.object({ search: z.string().optional() }).optional()).query(({ input }) => listStaff(input?.search)),
      createStaff: permissionProcedure("users.edit").input(z.object({ displayName: z.string().min(1).max(160), title: z.string().max(30).nullable().optional(), designation: z.string().max(120).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), role: z.enum(["teacher", "class_teacher", "senior_teacher", "deputy_head", "head_teacher", "finance", "storekeeper", "other"]), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => createStaff(input, currentUserId(ctx.user))),
      updateStaff: permissionProcedure("users.edit").input(z.object({ staffProfileId: z.number().int().positive(), displayName: z.string().min(1).max(160), title: z.string().max(30).nullable().optional(), designation: z.string().max(120).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), role: z.enum(["teacher", "class_teacher", "senior_teacher", "deputy_head", "head_teacher", "finance", "storekeeper", "other"]), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => updateStaff(input, currentUserId(ctx.user))),
      setStaffStatus: permissionProcedure("users.edit").input(z.object({ staffProfileId: z.number().int().positive(), status: z.enum(["active", "inactive"]) })).mutation(({ input, ctx }) => setStaffStatus(input, currentUserId(ctx.user))),
      previewImport: permissionProcedure("users.edit").input(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) })).query(({ input }) => previewPeopleImport({ kind: "staff", rows: input.rows })),
      import: permissionProcedure("users.edit").input(z.object({ rows: z.array(z.record(z.string(), z.any())).max(500) })).mutation(({ input, ctx }) => importPeopleRows({ kind: "staff", rows: input.rows }, currentUserId(ctx.user))),
      updateStaffRole: permissionProcedure("users.edit").input(z.object({ staffProfileId: z.number().int().positive(), role: z.enum(["teacher", "class_teacher", "senior_teacher", "deputy_head", "head_teacher", "finance", "storekeeper", "other"]) })).mutation(({ input, ctx }) => updateStaffRole(input, currentUserId(ctx.user))),
      permissions: permissionProcedure("users.edit").input(z.object({ userId: z.number().int().positive().optional() }).optional()).query(({ input, ctx }) => input?.userId ? getPermissionMatrix(input.userId) : getPermissionMatrix(ctx.user.id)),
      setPermission: permissionProcedure("users.edit").input(z.object({ userId: z.number().int().positive(), permissionKey: z.string(), allowed: z.boolean() })).mutation(({ input, ctx }) => setUserPermission(input, currentUserId(ctx.user))),
      effectivePermissions: protectedProcedure.query(({ ctx }) => effectivePermissions(ctx.user.id, ctx.user.role)),
    }),
    allocations: router({
      catalog: permissionProcedure("allocations.view").query(() => listAcademicCatalog()),
      list: permissionProcedure("allocations.view").input(z.object({ academicYear: z.number().int().optional(), term: z.string().max(40).optional(), status: z.enum(["active", "inactive", "replaced"]).optional() }).optional()).query(({ input, ctx }) => listAllocations(input, currentUserId(ctx.user))),
      create: permissionProcedure("allocations.create").input(z.object({ teacherUserId: z.number().int().positive(), gradeId: z.number().int().positive(), subjectId: z.number().int().min(0), academicYear: z.number().int().min(2000).max(2100), term: z.string().min(2).max(40), allocationType: z.enum(["class_teacher", "learning_area", "co_teacher", "substitute", "activity"]), startsOn: z.string().date().nullable().optional(), endsOn: z.string().date().nullable().optional() })).mutation(({ input, ctx }) => saveTeacherAllocation(input, currentUserId(ctx.user))),
      changeStatus: permissionProcedure("allocations.deactivate").input(z.object({ allocationId: z.number().int().positive(), status: z.enum(["inactive", "replaced"]), replacedByUserId: z.number().int().positive().nullable().optional() })).mutation(({ input, ctx }) => changeTeacherAllocationStatus(input, currentUserId(ctx.user))),
    }),
    settings: router({
      get: permissionProcedure("dashboard.view").query(() => getSettings()),
      createGrade: permissionProcedure("settings.edit").input(z.object({ name: z.string().min(1).max(80), stream: z.string().max(80).nullable().optional() })).mutation(({ input, ctx }) => createGradeClass(input, currentUserId(ctx.user))),
      createSubject: permissionProcedure("settings.edit").input(z.object({ name: z.string().min(1).max(120), code: z.string().min(1).max(30) })).mutation(({ input, ctx }) => createLearningArea(input, currentUserId(ctx.user))),
      update: adminProcedure.input(z.object({ schoolName: z.string().min(1).max(200), motto: z.string().max(255).nullable().optional(), currentTerm: z.string().min(1).max(40), academicYear: z.number().int().min(2000).max(2100), includeFeesOnReportCard: z.boolean(), showPercentagesOnReportCard: z.boolean().optional() })).mutation(({ input, ctx }) => saveSettings(input, currentUserId(ctx.user))),
    }),
    reports: router({
      reportCard: permissionProcedure("reports.view").input(z.object({ learnerId: z.number().int().positive(), academicYear: z.number().int().min(2000).max(2100), term: z.string().min(1).max(40), assessmentType: z.enum(["mid_term", "end_term"]) })).query(({ input, ctx }) => getAssessmentReportCard(input, currentUserId(ctx.user))),
      saveReportCardComments: permissionProcedure("assessments.edit").input(z.object({ learnerId: z.number().int().positive(), academicYear: z.number().int(), term: z.string().max(40), assessmentType: z.enum(["mid_term", "end_term"]).default("end_term"), classTeacherComment: z.string().max(1000).nullable().optional(), headTeacherComment: z.string().max(1000).nullable().optional() })).mutation(({ input, ctx }) => saveReportCardComments(input, currentUserId(ctx.user))),
      setReportCardStatus: adminProcedure.input(z.object({ learnerId: z.number().int().positive(), academicYear: z.number().int(), term: z.string().max(40), assessmentType: z.enum(["mid_term", "end_term"]).default("end_term"), status: z.enum(["draft", "generated", "reviewed", "approved", "published"]) })).mutation(({ input, ctx }) => setReportCardStatus(input, currentUserId(ctx.user))),
    }),
    audit: router({
      list: adminProcedure.query(() => listAuditLogs()),
    }),
    ai: router({
      ask: permissionProcedure("ai.access").input(z.object({ question: z.string().min(1).max(500) })).query(({ input, ctx }) => aiFacts(input.question, ctx.user.id, ctx.user.role)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
