import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb, logAudit } from "./db";
import { attendance, assessments, auditLogs, financeTransactions, inventoryItems, learners, permissions, teachers, timetable, users } from "../drizzle/schema";

const adminRoles = ["super_admin", "admin"];
const financeRoles = [...adminRoles, "finance"];
const storeRoles = [...adminRoles, "storekeeper"];
const assertRole = (role: string, roles: string[]) => {
  if (!roles.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission for this module." });
};
const dbOrThrow = async () => {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is not available." });
  return db;
};

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  dashboard: router({
    summary: protectedProcedure.query(async () => {
      const db = await dbOrThrow();
      const [learnerRows, attendanceRows, financeRows, assessmentRows, inventoryRows] = await Promise.all([
        db.select().from(learners), db.select().from(attendance), db.select().from(financeTransactions), db.select().from(assessments), db.select().from(inventoryItems),
      ]);
      const present = attendanceRows.filter(row => row.status === "present" || row.status === "late").length;
      const collected = financeRows.filter(row => row.transactionType === "payment").reduce((sum, row) => sum + row.amount, 0);
      const charged = financeRows.filter(row => row.transactionType === "charge").reduce((sum, row) => sum + row.amount, 0);
      const ratings = { EE: 0, ME: 0, AE: 0, BE: 0 };
      assessmentRows.forEach(row => { ratings[row.rating] += 1; });
      return {
        learners: learnerRows.filter(row => row.status === "active").length,
        teachers: (await db.select().from(teachers)).filter(row => row.active).length,
        attendanceRate: attendanceRows.length ? Math.round((present / attendanceRows.length) * 100) : 0,
        collected, outstanding: Math.max(charged - collected, 0),
        lowStock: inventoryRows.filter(row => row.quantity <= row.reorderLevel).length,
        ratings,
        recentAttendance: attendanceRows.slice(-7),
      };
    }),
  }),

  learners: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional(), grade: z.string().optional() }).optional()).query(async ({ input }) => {
      const db = await dbOrThrow();
      const rows = await db.select().from(learners).orderBy(desc(learners.createdAt));
      return rows.filter(row => (!input?.search || `${row.name} ${row.admissionNo}`.toLowerCase().includes(input.search.toLowerCase())) && (!input?.grade || row.grade === input.grade));
    }),
    create: adminProcedure.input(z.object({ admissionNo: z.string().min(2), name: z.string().min(2), gender: z.enum(["Female", "Male", "Other"]), grade: z.string().min(1), guardianPhone: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const result = await db.insert(learners).values(input);
      await logAudit({ userId: ctx.user.id, action: "create", module: "learners", recordId: String(result[0].insertId), details: input.name, confirmed: true });
      return { id: result[0].insertId };
    }),
    setStatus: adminProcedure.input(z.object({ id: z.number(), status: z.enum(["active", "inactive"]) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      await db.update(learners).set({ status: input.status }).where(eq(learners.id, input.id));
      await logAudit({ userId: ctx.user.id, action: "update_status", module: "learners", recordId: String(input.id), details: input.status, confirmed: true });
      return { success: true };
    }),
  }),

  teachers: router({
    list: protectedProcedure.query(async () => (await dbOrThrow()).select().from(teachers).orderBy(desc(teachers.createdAt))),
    create: adminProcedure.input(z.object({ name: z.string().min(2), email: z.string().email().optional(), phone: z.string().optional(), learningAreas: z.string().optional(), grades: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const result = await db.insert(teachers).values(input);
      await logAudit({ userId: ctx.user.id, action: "create", module: "teachers", recordId: String(result[0].insertId), details: input.name, confirmed: true });
      return { id: result[0].insertId };
    }),
  }),

  assessments: router({
    list: protectedProcedure.query(async () => {
      const db = await dbOrThrow();
      const [rows, learnerRows] = await Promise.all([db.select().from(assessments).orderBy(desc(assessments.createdAt)), db.select().from(learners)]);
      const names = new Map(learnerRows.map(row => [row.id, row]));
      return rows.slice(0, 100).map(row => ({ ...row, learnerName: names.get(row.learnerId)?.name ?? "Unknown learner", grade: names.get(row.learnerId)?.grade ?? "—" }));
    }),
    record: protectedProcedure.input(z.object({ learnerId: z.number(), learningArea: z.string().min(2), period: z.string().min(2), rating: z.enum(["EE", "ME", "AE", "BE"]), comment: z.string().optional(), confirmed: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (!input.confirmed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Assessment writes require confirmation." });
      const db = await dbOrThrow();
      const { confirmed: _confirmed, ...assessmentInput } = input;
      const result = await db.insert(assessments).values({ ...assessmentInput, recordedBy: ctx.user.id });
      await logAudit({ userId: ctx.user.id, action: "record", module: "assessments", recordId: String(result[0].insertId), details: JSON.stringify(input), confirmed: true });
      return { id: result[0].insertId };
    }),
  }),

  attendance: router({
    list: protectedProcedure.query(async () => {
      const db = await dbOrThrow();
      const [rows, learnerRows] = await Promise.all([db.select().from(attendance).orderBy(desc(attendance.createdAt)), db.select().from(learners)]);
      const names = new Map(learnerRows.map(row => [row.id, row]));
      return rows.slice(0, 100).map(row => ({ ...row, learnerName: names.get(row.learnerId)?.name ?? "Unknown learner", grade: names.get(row.learnerId)?.grade ?? "—" }));
    }),
    record: protectedProcedure.input(z.object({ learnerId: z.number(), attendanceDate: z.string().length(10), status: z.enum(["present", "absent", "late", "excused"]) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const result = await db.insert(attendance).values({ ...input, recordedBy: ctx.user.id });
      await logAudit({ userId: ctx.user.id, action: "record", module: "attendance", recordId: String(result[0].insertId), details: JSON.stringify(input), confirmed: true });
      return { id: result[0].insertId };
    }),
  }),

  finance: router({
    list: protectedProcedure.query(async ({ ctx }) => { assertRole(ctx.user.role, financeRoles); return (await dbOrThrow()).select().from(financeTransactions).orderBy(desc(financeTransactions.createdAt)); }),
    create: protectedProcedure.input(z.object({ learnerId: z.number().optional(), transactionType: z.enum(["charge", "payment"]), amount: z.number().int().positive(), description: z.string().min(2), term: z.string().min(2), confirmed: z.boolean() })).mutation(async ({ ctx, input }) => {
      assertRole(ctx.user.role, financeRoles);
      if (!input.confirmed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Finance writes require confirmation." });
      const db = await dbOrThrow();
      const { confirmed: _confirmed, ...financeInput } = input;
      const result = await db.insert(financeTransactions).values({ ...financeInput, recordedBy: ctx.user.id });
      await logAudit({ userId: ctx.user.id, action: "create", module: "finance", recordId: String(result[0].insertId), details: JSON.stringify(input), confirmed: true });
      return { id: result[0].insertId };
    }),
  }),

  inventory: router({
    list: protectedProcedure.query(async ({ ctx }) => { assertRole(ctx.user.role, storeRoles); return (await dbOrThrow()).select().from(inventoryItems).orderBy(inventoryItems.name); }),
    create: protectedProcedure.input(z.object({ name: z.string().min(2), category: z.string().min(2), quantity: z.number().int().nonnegative(), reorderLevel: z.number().int().nonnegative() })).mutation(async ({ ctx, input }) => {
      assertRole(ctx.user.role, storeRoles);
      const db = await dbOrThrow();
      const result = await db.insert(inventoryItems).values(input);
      await logAudit({ userId: ctx.user.id, action: "create", module: "inventory", recordId: String(result[0].insertId), details: input.name, confirmed: true });
      return { id: result[0].insertId };
    }),
  }),

  timetable: router({ list: protectedProcedure.query(async () => (await dbOrThrow()).select().from(timetable).orderBy(timetable.day, timetable.startTime)) }),

  users: router({
    list: adminProcedure.query(async () => (await dbOrThrow()).select({ id: users.id, username: users.username, name: users.name, email: users.email, role: users.role, active: users.active, lastSignedIn: users.lastSignedIn }).from(users).orderBy(desc(users.createdAt))),
    setRole: adminProcedure.input(z.object({ id: z.number(), role: z.enum(["super_admin", "admin", "teacher", "class_teacher", "finance", "storekeeper", "staff", "user"]) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.id));
      await logAudit({ userId: ctx.user.id, action: "set_role", module: "users", recordId: String(input.id), details: input.role, confirmed: true });
      return { success: true };
    }),
  }),

  permissions: router({ list: adminProcedure.query(async () => (await dbOrThrow()).select().from(permissions).orderBy(permissions.label)) }),
  audit: router({ list: adminProcedure.query(async () => (await dbOrThrow()).select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100)) }),

  ai: router({
    ask: protectedProcedure.input(z.object({ question: z.string().min(3) })).mutation(async ({ ctx, input }) => {
      const db = await dbOrThrow();
      const [learnerRows, assessmentRows, attendanceRows, financeRows] = await Promise.all([db.select().from(learners), db.select().from(assessments), db.select().from(attendance), db.select().from(financeTransactions)]);
      const facts = {
        learners: learnerRows.map(row => ({ name: row.name, admissionNo: row.admissionNo, grade: row.grade, status: row.status })),
        assessments: assessmentRows.map(row => ({ learnerId: row.learnerId, area: row.learningArea, period: row.period, rating: row.rating })),
        attendance: attendanceRows.map(row => ({ learnerId: row.learnerId, date: row.attendanceDate, status: row.status })),
        finance: financeRows.map(row => ({ learnerId: row.learnerId, type: row.transactionType, amount: row.amount, term: row.term })),
      };
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are NEXUS Level 3 School AI. Answer only from the supplied database facts. Clearly label database facts versus analysis or recommendations. Never invent missing learners, marks, attendance, fees, or balances. Respect that the requesting user is authorized only for their current role." },
            { role: "user", content: `Role: ${ctx.user.role}\nQuestion: ${input.question}\nDatabase facts JSON: ${JSON.stringify(facts)}` },
          ],
        });
        const content = response.choices?.[0]?.message?.content;
        const answer = typeof content === "string" ? content : Array.isArray(content) ? content.map(part => "text" in part ? part.text : "").join(" ") : "The AI could not produce a response.";
        await logAudit({ userId: ctx.user.id, action: "ask", module: "level3_ai", details: input.question, confirmed: false });
        return { answer };
      } catch {
        const activeLearners = learnerRows.filter(row => row.status === "active").length;
        return { answer: `Database facts: ${activeLearners} active learners, ${assessmentRows.length} assessments, ${attendanceRows.length} attendance records, and ${financeRows.length} finance transactions are available. AI analysis is temporarily unavailable; please try again.` };
      }
    }),
    generateDocument: protectedProcedure.input(z.object({
      documentType: z.string().min(2), subject: z.string().min(2), grade: z.string().min(2), term: z.string().min(2), topic: z.string().min(2), strand: z.string().optional(), subStrand: z.string().optional(), outcomes: z.string().optional(), competencies: z.string().optional(), values: z.string().optional(), pci: z.string().optional(), assessment: z.string().optional(), resources: z.string().optional(), differentiation: z.string().optional(), reflection: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const response = await invokeLLM({ messages: [
        { role: "system", content: "You are a Kenyan CBC teacher-document specialist. Follow the current KICD curriculum-design structure for the selected grade and learning area. Produce a professional teacher document, not an official KICD publication. Never invent a quoted KICD page or claim approval. Use these headings where relevant: Administrative Details; Strand; Sub-strand; Specific Learning Outcomes; Core Competencies; Values; Pertinent and Contemporary Issues; Learning Experiences; Learning Resources; Assessment Methods/Evidence; Differentiation and Inclusion; Reflection. Align outcomes to observable learner actions, make activities learner-centred, include formative assessment, and use Kenyan CBC terminology. If an input is blank, make a clearly labelled professional recommendation rather than pretending it came from the official design." },
        { role: "user", content: JSON.stringify({ ...input, source: "KICD Regular Curriculum Designs index (https://kicd.ac.ke/cbc-materials/curriculum-designs/regular-curriculum-designs/)", preparedFor: ctx.user.name || ctx.user.username || "NEXUS teacher" }) },
      ] });
      const content = response.choices?.[0]?.message?.content;
      const document = typeof content === "string" ? content : Array.isArray(content) ? content.map(part => "text" in part ? part.text : "").join(" ") : "The document could not be generated.";
      await logAudit({ userId: ctx.user.id, action: "generate", module: "level3_ai", details: `KICD-CBC ${input.documentType}: ${input.topic}`, confirmed: false });
      return { document };
    }),
  }),
});

export type AppRouter = typeof appRouter;
