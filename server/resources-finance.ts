import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { grades, learners, resourcesFinanceState, schoolSettings } from "../drizzle/schema";
import { requireDb, userCan, writeAudit } from "./smis";

const requiredKeys = ["seq", "set", "lrn", "fee", "inv", "pay", "adj", "tx", "bud", "sup", "req", "itm", "mv", "ast", "mnt", "log"] as const;
const financeKeys = ["set", "fee", "inv", "pay", "adj", "tx", "bud"] as const;
const storeKeys = ["sup", "req", "itm", "mv", "ast", "mnt"] as const;
const financeSeqKeys = ["fee", "inv", "pay", "adj", "tx"] as const;
const storeSeqKeys = ["sup", "req", "itm", "mv", "ast", "mnt"] as const;
const sequenceSources: Record<string, { array: string; prefix: string }> = {
  inv: { array: "inv", prefix: "INV" }, pay: { array: "pay", prefix: "P" }, adj: { array: "adj", prefix: "A" },
  tx: { array: "tx", prefix: "T" }, sup: { array: "sup", prefix: "S" }, req: { array: "req", prefix: "PR" },
  itm: { array: "itm", prefix: "I" }, mv: { array: "mv", prefix: "M" }, ast: { array: "ast", prefix: "AST" }, mnt: { array: "mnt", prefix: "MR" },
};

type State = Record<string, any>;
export type ResourcesFinanceAccess = {
  canRead: boolean; canWrite: boolean; canFinanceRead: boolean; canFinanceWrite: boolean;
  canStoreRead: boolean; canStoreWrite: boolean; moduleRole: string | null;
};
type SchoolContext = { school: string; year: number; term: string; grades: string[]; learners: Array<{ id: number; adm: string; name: string; grade: string; stream: string; guardian: string; phone: string }> };

function invalid(message = "INVALID_MODULE_STATE"): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function safeContextText(value: unknown, limit = 255): string {
  return String(value ?? "").replace(/[<>"\u0000-\u001f]/g, "").slice(0, limit);
}

function assertSafeJsonTree(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 50_000 || depth > 12) invalid();
  if (typeof value === "string") {
    if (value.length > 4_000 || /[<>"\u0000-\u001f]/.test(value)) invalid("UNSAFE_MODULE_TEXT");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) invalid();
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 10_000) invalid();
    for (const item of value) assertSafeJsonTree(item, depth + 1, budget);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["__proto__", "prototype", "constructor"].includes(key) || key.length > 120) invalid();
      assertSafeJsonTree(child, depth + 1, budget);
    }
    return;
  }
  invalid();
}

export function validateResourcesFinanceState(raw: string): State {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1_500_000) invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
  const state = parsed as State;
  if (Object.keys(state).length !== requiredKeys.length || requiredKeys.some(key => !Object.prototype.hasOwnProperty.call(state, key))) invalid();
  for (const key of requiredKeys) {
    if (["seq", "set", "bud"].includes(key)) {
      if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) invalid();
    } else if (!Array.isArray(state[key])) invalid();
  }
  assertSafeJsonTree(state);
  for (const key of Object.keys(state.seq)) if (!Number.isSafeInteger(state.seq[key]) || state.seq[key] < 0) invalid();
  for (const key of Object.keys(state.bud)) if (typeof state.bud[key] !== "number") invalid();
  for (const key of requiredKeys) if (Array.isArray(state[key]) && state[key].some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row))) invalid();
  const ids = new Set<string>();
  const admissions = new Set<string>();
  for (const row of state.lrn as State[]) {
    if (typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(row.id) || typeof row.adm !== "string" || !row.adm) invalid();
    if (ids.has(row.id) || admissions.has(row.adm)) invalid();
    ids.add(row.id);
    admissions.add(row.adm);
  }
  for (const key of ["inv", "pay", "adj", "tx", "sup", "req", "itm", "mv", "ast", "mnt"] as const) {
    for (const row of state[key] as State[]) {
      if (typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(row.id)) invalid("INVALID_MODULE_ROW_ID");
    }
  }
  for (const key of ["inv", "pay", "adj"] as const) {
    for (const row of state[key] as State[]) if (typeof row.lid !== "string" || !ids.has(row.lid)) invalid("UNKNOWN_MODULE_LEARNER");
  }
  return state;
}

function emptyState(ctx: SchoolContext): State {
  return {
    seq: {},
    set: { school: ctx.school, year: String(ctx.year), term: ctx.term, pstart: `${ctx.year}-01-01`, open: 0, overpay: false, grades: ctx.grades, cin: [], cout: [] },
    lrn: [], fee: [], inv: [], pay: [], adj: [], tx: [], bud: {}, sup: [], req: [], itm: [], mv: [], ast: [], mnt: [], log: [],
  };
}

export function maskResourcesFinanceState(state: State, access: ResourcesFinanceAccess, ctx: SchoolContext): State {
  const visible: State = JSON.parse(JSON.stringify(state));
  if (!access.canFinanceRead) {
    const empty = emptyState(ctx);
    for (const key of financeKeys) visible[key] = empty[key];
    visible.lrn = [];
  }
  if (!access.canStoreRead) for (const key of storeKeys) visible[key] = [];
  if (!(access.canFinanceRead && access.canStoreRead)) visible.log = [];
  return visible;
}

function normalizeLearners(incoming: State[], previous: State[], contextLearners: SchoolContext["learners"]): State[] {
  const previousByAdm = new Map(previous.map(row => [row.adm, row]));
  const incomingByAdm = new Map(incoming.map(row => [row.adm, row]));
  const activeAdmissions = new Set<string>();
  const result: State[] = contextLearners.map(learner => {
    activeAdmissions.add(learner.adm);
    const old = previousByAdm.get(learner.adm);
    const submitted = incomingByAdm.get(learner.adm);
    const id = old?.id ?? `L-${String(learner.id).padStart(4, "0")}`;
    if (submitted && old && submitted.id !== old.id) invalid("INVALID_MODULE_LEARNER");
    if (submitted && !old && submitted.id !== id) invalid("INVALID_MODULE_LEARNER");
    return { id, adm: learner.adm, name: learner.name, grade: learner.grade, stream: learner.stream, guardian: learner.guardian, phone: learner.phone };
  });
  for (const old of previous) {
    if (!activeAdmissions.has(old.adm)) result.push(old);
  }
  return result;
}

export function mergeResourcesFinanceState(incoming: State, previous: State, access: ResourcesFinanceAccess, ctx: SchoolContext, userId: number): State {
  const merged: State = JSON.parse(JSON.stringify(incoming));
  for (const key of financeKeys) if (!access.canFinanceWrite) merged[key] = previous[key];
  for (const key of storeKeys) if (!access.canStoreWrite) merged[key] = previous[key];
  merged.lrn = access.canFinanceRead ? normalizeLearners(incoming.lrn, previous.lrn, ctx.learners) : previous.lrn;
  const seq: State = {};
  for (const [key, source] of Object.entries(sequenceSources)) {
    const mayWrite = financeSeqKeys.includes(key as typeof financeSeqKeys[number]) ? access.canFinanceWrite : access.canStoreWrite;
    if (!mayWrite) { seq[key] = previous.seq[key] ?? 0; continue; }
    const pattern = new RegExp(`^${source.prefix}-(\\d+)$`);
    const max = (merged[source.array] as State[]).reduce((n, row) => {
      const match = typeof row.id === "string" ? row.id.match(pattern) : null;
      return Math.max(n, match ? Number(match[1]) : 0);
    }, 0);
    seq[key] = max;
  }
  merged.seq = seq;
  // The client-supplied activity trail is not trusted as audit evidence. Keep a server-authored
  // event only; the authoritative per-user audit remains in smis_audit_logs.
  merged.log = [{ t: new Date().toLocaleString("en-KE"), u: `User ${userId}`, a: "Resources & Finance saved", d: "Module state updated", p: "", n: "" }, ...(previous.log as State[]).slice(0, 499)];
  return merged;
}

export async function resourcesFinanceAccess(userId: number, role: string): Promise<ResourcesFinanceAccess> {
  const [financeView, financeEdit, storeView, storeEdit, superAdmin] = await Promise.all([
    userCan(userId, role, "finance.view"), userCan(userId, role, "finance.edit"),
    userCan(userId, role, "store.view"), userCan(userId, role, "store.edit"), userCan(userId, role, "*"),
  ]);
  const canFinanceRead = financeView || financeEdit;
  const canStoreRead = storeView || storeEdit;
  const canRead = canFinanceRead || canStoreRead;
  const moduleRole = !canRead ? null : superAdmin ? "Super Admin" : financeEdit && storeEdit ? "Principal"
    : financeEdit ? "Bursar / Finance Officer" : storeEdit ? "Storekeeper" : "Auditor (read-only)";
  return { canRead, canWrite: financeEdit || storeEdit, canFinanceRead, canFinanceWrite: financeEdit, canStoreRead, canStoreWrite: storeEdit, moduleRole };
}

async function schoolContext(access: ResourcesFinanceAccess): Promise<SchoolContext> {
  const db = await requireDb();
  const [settings, learnerRows, gradeRows] = await Promise.all([
    db.select().from(schoolSettings).limit(1),
    access.canFinanceRead ? db.select({ id: learners.id, learner: learners, grade: grades }).from(learners).leftJoin(grades, eq(grades.id, learners.gradeId)).where(eq(learners.status, "active")) : Promise.resolve([]),
    db.select().from(grades),
  ]);
  const s = settings[0];
  const gradeNames = Array.from(new Set(gradeRows.map(g => safeContextText(g.name, 80)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    school: safeContextText(s?.schoolName ?? "Your School", 200),
    year: s?.academicYear ?? new Date().getFullYear(),
    term: safeContextText(s?.currentTerm ?? "Term 1", 40),
    grades: gradeNames,
    learners: learnerRows.map((r: any) => ({
      id: r.id,
      adm: safeContextText(r.learner.admissionNumber, 40),
      name: safeContextText(r.learner.fullName, 160),
      grade: safeContextText(r.grade?.name ?? "", 80),
      stream: safeContextText(r.grade?.stream ?? "", 80),
      guardian: safeContextText(r.learner.guardianName ?? "", 160),
      phone: safeContextText(r.learner.guardianPhone ?? "", 40),
    })),
  };
}

export async function loadResourcesFinance(userId: number, role: string) {
  const access = await resourcesFinanceAccess(userId, role);
  if (!access.canRead) throw new TRPCError({ code: "FORBIDDEN", message: "Missing permission: finance.view or store.view" });
  const db = await requireDb();
  const [rows, ctx] = await Promise.all([
    db.select().from(resourcesFinanceState).where(eq(resourcesFinanceState.id, 1)).limit(1),
    schoolContext(access),
  ]);
  let state: State | null = null;
  if (rows[0]) {
    try { state = validateResourcesFinanceState(rows[0].data); }
    catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "INVALID_STORED_MODULE_STATE" }); }
  }
  return {
    state: state ? maskResourcesFinanceState(state, access, ctx) : null,
    version: rows[0]?.version ?? 0,
    role: access.moduleRole!,
    canWrite: access.canWrite,
    context: ctx,
  };
}

export async function saveResourcesFinance(input: { data: string; version: number }, userId: number, role: string) {
  const access = await resourcesFinanceAccess(userId, role);
  if (!access.canRead) throw new TRPCError({ code: "FORBIDDEN", message: "Missing permission: finance.view or store.view" });
  if (!access.canWrite) throw new TRPCError({ code: "FORBIDDEN", message: "Missing permission: finance.edit or store.edit" });
  if (!Number.isSafeInteger(input.version) || input.version < 0) invalid();
  const incoming = validateResourcesFinanceState(input.data);
  const db = await requireDb();
  const [rows, ctx] = await Promise.all([
    db.select().from(resourcesFinanceState).where(eq(resourcesFinanceState.id, 1)).limit(1),
    schoolContext(access),
  ]);
  const existing = rows[0];
  const currentVersion = existing?.version ?? 0;
  if (input.version !== currentVersion) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
  let previous = emptyState(ctx);
  if (existing) {
    try { previous = validateResourcesFinanceState(existing.data); }
    catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "INVALID_STORED_MODULE_STATE" }); }
  }
  const merged = mergeResourcesFinanceState(incoming, previous, access, ctx, userId);
  const data = JSON.stringify(merged);
  validateResourcesFinanceState(data);
  const nextVersion = currentVersion + 1;
  const changedDomains = [access.canFinanceWrite && "finance", access.canStoreWrite && "stores"].filter(Boolean);
  if (!existing) {
    try {
      await db.insert(resourcesFinanceState).values({ id: 1, data, version: nextVersion, updatedByUserId: userId });
    } catch (error) {
      const dbError = error as { code?: string; errno?: number };
      if (dbError.code === "ER_DUP_ENTRY" || dbError.errno === 1062) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
      throw error;
    }
  } else {
    const [result] = await db.update(resourcesFinanceState).set({ data, version: nextVersion, updatedByUserId: userId })
      .where(and(eq(resourcesFinanceState.id, 1), eq(resourcesFinanceState.version, currentVersion)));
    if (!(result as { affectedRows?: number }).affectedRows) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
  }
  await writeAudit(userId, "resources_finance.save", "resources_finance", 1, { version: nextVersion, domains: changedDomains, bytes: Buffer.byteLength(data, "utf8") });
  return { version: nextVersion };
}
