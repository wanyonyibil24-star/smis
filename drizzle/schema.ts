import {
  bigint,
  date,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Manus OAuth users. This table is provided by the WebDev full-stack template. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 120 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  accountStatus: mysqlEnum("accountStatus", ["active", "disabled", "locked", "pending_activation"]).notNull().default("active"),
  failedLoginAttempts: int("failedLoginAttempts").notNull().default(0),
  accountLocked: int("accountLocked").notNull().default(0),
  mustChangePassword: int("mustChangePassword").notNull().default(0),
  passwordChangedAt: timestamp("passwordChangedAt"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const schoolSettings = mysqlTable("school_settings", {
  id: int("id").autoincrement().primaryKey(),
  schoolName: varchar("schoolName", { length: 200 }).notNull(),
  motto: varchar("motto", { length: 255 }),
  currentTerm: varchar("currentTerm", { length: 40 }).notNull(),
  academicYear: int("academicYear").notNull(),
  includeFeesOnReportCard: int("includeFeesOnReportCard").notNull().default(1),
  showPercentagesOnReportCard: int("showPercentagesOnReportCard").notNull().default(0),
  logoPath: varchar("logoPath", { length: 255 }),
  principalSignaturePath: varchar("principalSignaturePath", { length: 255 }),
  classTeacherSignaturePath: varchar("classTeacherSignaturePath", { length: 255 }),
  address: varchar("address", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  geofenceRadiusMeters: int("geofenceRadiusMeters").notNull().default(150),
  enabledSchoolLevels: varchar("enabledSchoolLevels", { length: 255 }).notNull().default("ECDE,Primary,Junior School,Senior School"),
});

export const staffProfiles = mysqlTable("staff_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  teacherCode: int("teacherCode").unique(),
  staffId: varchar("staffId", { length: 40 }),
  department: varchar("department", { length: 120 }),
  title: varchar("title", { length: 30 }),
  displayName: varchar("displayName", { length: 160 }).notNull(),
  designation: varchar("designation", { length: 120 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 40 }),
  role: mysqlEnum("role", ["super_admin", "admin", "teacher", "class_teacher", "senior_teacher", "deputy_head", "head_teacher", "finance", "storekeeper", "other"]).notNull().default("other"),
  status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const grades = mysqlTable("grades", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  stream: varchar("stream", { length: 80 }),
  classTeacherUserId: int("classTeacherUserId"),
});

export const subjects = mysqlTable("subjects", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  code: varchar("code", { length: 30 }).notNull().unique(),
});

export const learners = mysqlTable("learners", {
  id: int("id").autoincrement().primaryKey(),
  admissionNumber: varchar("admissionNumber", { length: 40 }).notNull().unique(),
  fullName: varchar("fullName", { length: 160 }).notNull(),
  guardianName: varchar("guardianName", { length: 160 }),
  guardianIdNumber: varchar("guardianIdNumber", { length: 40 }),
  guardianPhone: varchar("guardianPhone", { length: 40 }),
  gender: mysqlEnum("gender", ["male", "female", "other"]),
  dateOfBirth: date("dateOfBirth"),
  contactAddress: varchar("contactAddress", { length: 255 }),
  gradeId: int("gradeId").notNull(),
  status: mysqlEnum("status", ["active", "inactive", "archived"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const guardians = mysqlTable("guardians", {
  id: int("id").autoincrement().primaryKey(),
  fullName: varchar("fullName", { length: 160 }).notNull(),
  idNumber: varchar("idNumber", { length: 40 }),
  phone: varchar("phone", { length: 40 }),
  email: varchar("email", { length: 320 }),
  communicationPreference: mysqlEnum("communicationPreference", ["sms", "email", "phone"]).notNull().default("sms"),
});

export const learnerGuardians = mysqlTable("learner_guardians", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  guardianId: int("guardianId").notNull(),
  relationship: varchar("relationship", { length: 80 }).notNull(),
  isPrimary: int("isPrimary").notNull().default(0),
}, table => ({ learnerGuardianUnique: uniqueIndex("learner_guardian_unique").on(table.learnerId, table.guardianId) }));

export const teacherAllocations = mysqlTable("teacher_allocations", {
  id: int("id").autoincrement().primaryKey(),
  teacherUserId: int("teacherUserId").notNull(),
  gradeId: int("gradeId").notNull(),
  subjectId: int("subjectId").notNull(),
  academicYear: int("academicYear").notNull(),
  term: varchar("term", { length: 40 }).notNull().default("Term 1"),
  allocationType: mysqlEnum("allocationType", ["class_teacher", "learning_area", "co_teacher", "substitute", "activity"]).notNull().default("learning_area"),
  status: mysqlEnum("status", ["active", "inactive", "replaced"]).notNull().default("active"),
  startsOn: date("startsOn"),
  endsOn: date("endsOn"),
  replacedByUserId: int("replacedByUserId"),
}, table => ({ teacherAllocationScopeUnique: uniqueIndex("teacher_allocation_scope_unique").on(table.teacherUserId, table.gradeId, table.subjectId, table.academicYear, table.term, table.allocationType) }));

export const assessments = mysqlTable("assessments", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  term: varchar("term", { length: 40 }).notNull(),
  academicYear: int("academicYear").notNull(),
  gradeId: int("gradeId").notNull(),
  subjectId: int("subjectId").notNull(),
  teacherUserId: int("teacherUserId").notNull(),
  assessmentType: mysqlEnum("assessmentType", ["mid_term", "end_term"]).notNull().default("end_term"),
  status: mysqlEnum("status", ["draft", "submitted", "approved", "locked"]).notNull().default("draft"),
  submittedAt: timestamp("submittedAt"),
  verifiedByUserId: int("verifiedByUserId"),
  verifiedAt: timestamp("verifiedAt"),
  lockedAt: timestamp("lockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ assessmentScopeUnique: uniqueIndex("assessment_scope_unique").on(table.academicYear, table.term, table.assessmentType, table.gradeId, table.subjectId) }));

export const marks = mysqlTable("marks", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  assessmentId: int("assessmentId").notNull(),
  learnerId: int("learnerId").notNull(),
  subjectId: int("subjectId").notNull(),
  teacherUserId: int("teacherUserId").notNull(),
  score: decimal("score", { precision: 5, scale: 2 }),
  midTerm: decimal("midTerm", { precision: 5, scale: 2 }),
  endTerm: decimal("endTerm", { precision: 5, scale: 2 }),
  average: decimal("average", { precision: 5, scale: 2 }),
  cbcLevel: mysqlEnum("cbcLevel", ["EE1", "EE2", "ME1", "ME2", "AE1", "AE2", "BE1", "BE2"]),
  teacherRemark: varchar("teacherRemark", { length: 255 }),
  updatedByUserId: int("updatedByUserId"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ markUnique: uniqueIndex("mark_unique").on(table.assessmentId, table.learnerId, table.subjectId) }));

export const attendances = mysqlTable("attendances", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  gradeId: int("gradeId").notNull(),
  attendanceDate: date("attendanceDate").notNull(),
  session: mysqlEnum("session", ["morning", "afternoon"]).notNull().default("morning"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
  status: mysqlEnum("status", ["present", "absent", "late", "excused"]).notNull(),
  note: varchar("note", { length: 255 }),
}, table => ({ attendanceUnique: uniqueIndex("attendance_unique").on(table.learnerId, table.attendanceDate, table.session) }));
export const attendanceRegisterApprovals = mysqlTable("attendance_register_approvals", {
  id: int("id").autoincrement().primaryKey(),
  attendanceDate: date("attendanceDate").notNull(),
  gradeId: int("gradeId").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "approved", "reopened"]).notNull().default("draft"),
  submittedByUserId: int("submittedByUserId"),
  submittedAt: timestamp("submittedAt"),
  approvedByUserId: int("approvedByUserId"),
  approvedAt: timestamp("approvedAt"),
  notes: varchar("notes", { length: 255 }),
}, table => ({ attendanceRegisterApprovalUnique: uniqueIndex("attendance_register_approval_unique").on(table.attendanceDate, table.gradeId) }));

export const feeStructures = mysqlTable("fee_structures", {
  id: int("id").autoincrement().primaryKey(),
  gradeId: int("gradeId").notNull(),
  term: varchar("term", { length: 40 }).notNull(),
  academicYear: int("academicYear").notNull(),
  itemName: varchar("itemName", { length: 120 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
});

export const payments = mysqlTable("payments", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["mpesa", "bank", "cash"]).notNull(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  paidAt: timestamp("paidAt").defaultNow().notNull(),
});

export const storeItems = mysqlTable("store_items", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  unit: varchar("unit", { length: 30 }).notNull(),
  reorderLevel: decimal("reorderLevel", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const storeMovements = mysqlTable("store_movements", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  itemId: int("itemId").notNull(),
  movementType: mysqlEnum("movementType", ["received", "issued", "adjustment"]).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  reference: varchar("reference", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const timetableEntries = mysqlTable("timetable_entries", {
  id: int("id").autoincrement().primaryKey(),
  gradeId: int("gradeId").notNull(),
  subjectId: int("subjectId").notNull(),
  teacherUserId: int("teacherUserId").notNull(),
  dayOfWeek: int("dayOfWeek").notNull(),
  period: int("period").notNull(),
  room: varchar("room", { length: 80 }),
}, table => ({ timetableGradeSlotUnique: uniqueIndex("timetable_grade_slot_unique").on(table.gradeId, table.dayOfWeek, table.period), timetableTeacherSlotUnique: uniqueIndex("timetable_teacher_slot_unique").on(table.teacherUserId, table.dayOfWeek, table.period) }));

export const timetableRequirements = mysqlTable("timetable_requirements", {
  id: int("id").autoincrement().primaryKey(),
  gradeId: int("gradeId").notNull(),
  subjectId: int("subjectId").notNull(),
  academicYear: int("academicYear").notNull(),
  periodsPerWeek: int("periodsPerWeek").notNull(),
}, table => ({ timetableRequirementUnique: uniqueIndex("timetable_requirement_unique").on(table.gradeId, table.subjectId, table.academicYear) }));

export const communications = mysqlTable("communications", {
  id: int("id").autoincrement().primaryKey(),
  audience: mysqlEnum("audience", ["parents", "staff", "learners", "all"]).notNull(),
  channel: mysqlEnum("channel", ["sms", "notice", "email"]).notNull(),
  subject: varchar("subject", { length: 160 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["draft", "queued", "sent", "failed"]).notNull().default("draft"),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const nexusMessages = mysqlTable("nexus_messages", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category", { length: 80 }).notNull().default("announcement"),
  channel: mysqlEnum("channel", ["sms", "email", "in_app", "whatsapp"]).notNull().default("in_app"),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["draft", "queued", "sent", "failed", "cancelled"]).notNull().default("queued"),
  selectionJson: text("selectionJson"),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const nexusMessageRecipients = mysqlTable("nexus_message_recipients", {
  id: int("id").autoincrement().primaryKey(),
  messageId: int("messageId").notNull(),
  recipientType: varchar("recipientType", { length: 30 }).notNull(),
  recipientId: int("recipientId").notNull(),
  label: varchar("label", { length: 180 }).notNull(),
  status: mysqlEnum("status", ["queued", "sent", "failed"]).notNull().default("queued"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ messageRecipientUnique: uniqueIndex("nexus_message_recipient_unique").on(table.messageId, table.recipientType, table.recipientId) }));

export const curriculumOfferings = mysqlTable("curriculum_offerings", {
  id: int("id").autoincrement().primaryKey(),
  level: varchar("level", { length: 40 }).notNull(),
  gradeLabel: varchar("gradeLabel", { length: 40 }).notNull(),
  pathway: varchar("pathway", { length: 100 }),
  learningArea: varchar("learningArea", { length: 160 }).notNull(),
  subjectCode: varchar("subjectCode", { length: 40 }),
  offered: int("offered").notNull().default(1),
  sourceUrl: varchar("sourceUrl", { length: 500 }),
  updatedByUserId: int("updatedByUserId").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({ curriculumOfferingUnique: uniqueIndex("curriculum_offering_unique").on(table.level, table.gradeLabel, table.pathway, table.learningArea) }));

export const alumni = mysqlTable("alumni", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull().unique(),
  completionYear: int("completionYear").notNull(),
  destination: varchar("destination", { length: 160 }),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
  archivedByUserId: int("archivedByUserId").notNull(),
});

export const auditLogs = mysqlTable("smis_audit_logs", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entityType", { length: 80 }),
  entityId: varchar("entityId", { length: 80 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const iamSessions = mysqlTable("iam_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionHash: varchar("sessionHash", { length: 128 }).notNull().unique(),
  loginAt: timestamp("loginAt").defaultNow().notNull(),
  logoutAt: timestamp("logoutAt"),
  ipAddress: varchar("ipAddress", { length: 80 }),
  userAgent: varchar("userAgent", { length: 500 }),
  status: mysqlEnum("status", ["active", "revoked", "expired"]).notNull().default("active"),
});

export const iamPasswordResets = mysqlTable("iam_password_resets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
});

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  permissionKey: varchar("permissionKey", { length: 120 }).notNull().unique(),
  description: varchar("description", { length: 255 }).notNull(),
});

export const userPermissions = mysqlTable("user_permissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  permissionKey: varchar("permissionKey", { length: 120 }).notNull(),
  allowed: int("allowed").notNull().default(1),
});

export const expenditures = mysqlTable("expenditures", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  expenditureDate: date("expenditureDate").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  responsiblePerson: varchar("responsiblePerson", { length: 160 }).notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  audience: mysqlEnum("audience", ["parents", "staff", "learners", "all"]).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["draft", "published", "archived"]).notNull().default("draft"),
  createdByUserId: int("createdByUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const reportCards = mysqlTable("report_cards", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  academicYear: int("academicYear").notNull(),
  term: varchar("term", { length: 40 }).notNull(),
  assessmentType: mysqlEnum("assessmentType", ["mid_term", "end_term"]).notNull().default("end_term"),
  status: mysqlEnum("status", ["draft", "generated", "reviewed", "approved", "published"]).notNull().default("draft"),
  classTeacherComment: text("classTeacherComment"),
  headTeacherComment: text("headTeacherComment"),
  generatedByUserId: int("generatedByUserId"),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ reportCardPeriodUnique: uniqueIndex("report_card_period_unique").on(table.learnerId, table.academicYear, table.term, table.assessmentType) }));

export type Learner = typeof learners.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Mark = typeof marks.$inferSelect;
export type Payment = typeof payments.$inferSelect;

export const rolePermissions = mysqlTable("role_permissions", {
  id: int("id").autoincrement().primaryKey(),
  role: varchar("role", { length: 40 }).notNull(),
  permissionKey: varchar("permissionKey", { length: 120 }).notNull(),
  allowed: int("allowed").notNull().default(1),
}, table => ({ rolePermissionUnique: uniqueIndex("role_permission_unique").on(table.role, table.permissionKey) }));

export const staffClockings = mysqlTable("staff_clockings", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  clockDate: date("clockDate").notNull(),
  clockedAt: timestamp("clockedAt").defaultNow().notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  distanceMeters: decimal("distanceMeters", { precision: 10, scale: 2 }).notNull(),
}, table => ({ staffClockingDailyUnique: uniqueIndex("staff_clocking_daily_unique").on(table.userId, table.clockDate) }));

export const libraryCategories = mysqlTable("library_categories", {
  id: int("id").autoincrement().primaryKey(), name: varchar("name", { length: 120 }).notNull().unique(), active: int("active").notNull().default(1),
});
export const libraryBooks = mysqlTable("library_books", {
  id: int("id").autoincrement().primaryKey(), isbn: varchar("isbn", { length: 40 }), title: varchar("title", { length: 200 }).notNull(), author: varchar("author", { length: 160 }), publisher: varchar("publisher", { length: 160 }), pubYear: int("pubYear"), subject: varchar("subject", { length: 120 }), categoryId: int("categoryId"), deletedAt: timestamp("deletedAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const libraryCopies = mysqlTable("library_copies", {
  id: int("id").autoincrement().primaryKey(), bookId: int("bookId").notNull(), accessionNo: varchar("accessionNo", { length: 80 }).notNull().unique(), barcode: varchar("barcode", { length: 80 }).notNull().unique(), status: mysqlEnum("status", ["available", "borrowed", "lost", "damaged", "withdrawn"]).notNull().default("available"), location: varchar("location", { length: 120 }), condition: varchar("condition", { length: 40 }).notNull().default("good"), acquiredOn: date("acquiredOn"), cost: decimal("cost", { precision: 12, scale: 2 }),
});
export const libraryLoans = mysqlTable("library_loans", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(), copyId: int("copyId").notNull(), learnerId: int("learnerId"), staffUserId: int("staffUserId"), loanedOn: date("loanedOn").notNull(), dueDate: date("dueDate").notNull(), returnedOn: date("returnedOn"), renewedCount: int("renewedCount").notNull().default(0), issuedByUserId: int("issuedByUserId").notNull(),
});
export const libraryReservations = mysqlTable("library_reservations", {
  id: int("id").autoincrement().primaryKey(), bookId: int("bookId").notNull(), learnerId: int("learnerId"), staffUserId: int("staffUserId"), status: mysqlEnum("status", ["waiting", "ready", "fulfilled", "cancelled"]).notNull().default("waiting"), createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const libraryFines = mysqlTable("library_fines", {
  id: int("id").autoincrement().primaryKey(), loanId: bigint("loanId", { mode: "number" }).notNull(), amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), paid: decimal("paid", { precision: 12, scale: 2 }).notNull().default("0"), reason: varchar("reason", { length: 255 }), createdAt: timestamp("createdAt").defaultNow().notNull(),
});
