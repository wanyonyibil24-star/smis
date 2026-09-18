import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const roleValues = ["super_admin", "admin", "teacher", "class_teacher", "finance", "storekeeper", "staff", "user"] as const;
export type Role = (typeof roleValues)[number];

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 80 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", roleValues).default("user").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 80 }).notNull().unique(),
  label: varchar("label", { length: 120 }).notNull(),
});

export const rolePermissions = mysqlTable("role_permissions", {
  id: int("id").autoincrement().primaryKey(),
  role: mysqlEnum("role", roleValues).notNull(),
  permissionId: int("permissionId").notNull(),
});

export const learners = mysqlTable("learners", {
  id: int("id").autoincrement().primaryKey(),
  admissionNo: varchar("admissionNo", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  gender: mysqlEnum("gender", ["Female", "Male", "Other"]).notNull(),
  grade: varchar("grade", { length: 30 }).notNull(),
  guardianPhone: varchar("guardianPhone", { length: 30 }),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const teachers = mysqlTable("teachers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }),
  learningAreas: text("learningAreas"),
  grades: text("grades"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const assessments = mysqlTable("assessments", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  learningArea: varchar("learningArea", { length: 100 }).notNull(),
  period: varchar("period", { length: 40 }).notNull(),
  rating: mysqlEnum("rating", ["EE", "ME", "AE", "BE"]).notNull(),
  comment: text("comment"),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const attendance = mysqlTable("attendance", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId").notNull(),
  attendanceDate: varchar("attendanceDate", { length: 10 }).notNull(),
  status: mysqlEnum("status", ["present", "absent", "late", "excused"]).notNull(),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const financeTransactions = mysqlTable("finance_transactions", {
  id: int("id").autoincrement().primaryKey(),
  learnerId: int("learnerId"),
  transactionType: mysqlEnum("transactionType", ["charge", "payment"]).notNull(),
  amount: int("amount").notNull(),
  description: varchar("description", { length: 180 }).notNull(),
  term: varchar("term", { length: 40 }).notNull(),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const inventoryItems = mysqlTable("inventory_items", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  quantity: int("quantity").default(0).notNull(),
  reorderLevel: int("reorderLevel").default(5).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const timetable = mysqlTable("timetable", {
  id: int("id").autoincrement().primaryKey(),
  day: varchar("day", { length: 15 }).notNull(),
  startTime: varchar("startTime", { length: 10 }).notNull(),
  endTime: varchar("endTime", { length: 10 }).notNull(),
  grade: varchar("grade", { length: 30 }).notNull(),
  learningArea: varchar("learningArea", { length: 100 }).notNull(),
  teacherName: varchar("teacherName", { length: 160 }).notNull(),
});

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 80 }).notNull(),
  module: varchar("module", { length: 80 }).notNull(),
  recordId: varchar("recordId", { length: 80 }),
  details: text("details"),
  confirmed: boolean("confirmed").default(false).notNull(),
  success: boolean("success").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Learner = typeof learners.$inferSelect;
export type Teacher = typeof teachers.$inferSelect;
export type Assessment = typeof assessments.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
