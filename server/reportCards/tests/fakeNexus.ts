/**
 * TEST-ONLY stand-in for server/nexusAdapter.ts. Implements just enough of the drizzle query surface
 * (select/from/where/limit, eq/and/inArray) over in-memory arrays so the real reportCardService.ts runs unmodified.
 * Never shipped with the module; the fixtures live in service.test.ts.
 */
type Col = { __t: string; __c: string };
const tableProxy = (name: string) => new Proxy({ __name: name } as any, { get: (t, k: string) => (k in t ? t[k] : ({ __t: name, __c: k } as Col)) });
export const users = tableProxy("users"), grades = tableProxy("grades"), learners = tableProxy("learners"), subjects = tableProxy("subjects"),
  assessments = tableProxy("assessments"), marks = tableProxy("marks"), attendances = tableProxy("attendances"), feeStructures = tableProxy("feeStructures"),
  payments = tableProxy("payments"), reportCards = tableProxy("reportCards"), staffProfiles = tableProxy("staffProfiles"), teacherAllocations = tableProxy("teacherAllocations"),
  schoolSettings = tableProxy("schoolSettings");

export const DATA: Record<string, any[]> = {};
export const LOG = { reads: [] as string[], writes: [] as string[], audits: [] as any[] };
export const eq = (c: Col, v: any) => (r: any) => r[c.__c] === v;
export const and = (...fs: Array<(r: any) => boolean>) => (r: any) => fs.every(f => f(r));
export const inArray = (c: Col, vs: any[]) => (r: any) => vs.includes(r[c.__c]);

const db = {
  select(proj?: Record<string, Col>) {
    return {
      from(t: any) {
        LOG.reads.push(t.__name);
        let pred: (r: any) => boolean = () => true; let lim = Infinity;
        const run = () => (DATA[t.__name] ?? []).filter(pred).slice(0, lim).map(r =>
          proj ? Object.fromEntries(Object.entries(proj).map(([k, c]) => [k, r[c.__c]])) : { ...r });
        const b: any = { where: (p: any) => { pred = p; return b; }, limit: (n: number) => { lim = n; return b; }, then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej) };
        return b;
      },
    };
  },
  insert() { LOG.writes.push("insert"); throw new Error("report module must not write"); },
  update() { LOG.writes.push("update"); throw new Error("report module must not write"); },
  delete() { LOG.writes.push("delete"); throw new Error("report module must not write"); },
};
export const getDb = async () => db;
export const getSettings = async () => DATA.schoolSettings[0];
export const writeAudit = async (userId: number, action: string, entity: string, id: any, payload: any) => { LOG.audits.push({ userId, action, entity, id, payload }); };

/** Role matrix mirrors server/smis.ts permissionsByRole; class_teacher is configurable because the real one lives in the role_permissions table. */
export const MATRIX: Record<string, string[]> = {};
const staffRole = (uid: number) => DATA.staffProfiles.find(s => s.userId === uid)?.role ?? "other";
export const can = async (uid: number, _acct: string, perm: string) => {
  const r = staffRole(uid); const m = MATRIX[r] ?? [];
  const o = DATA.userPermissions?.find((p: any) => p.userId === uid && p.permissionKey === perm);
  if (o) return !!o.allowed;
  return m.includes("*") || m.includes(perm) || (perm === "report_cards.view" && m.includes("reports.view"));
};
/** Same level rules as server/access.ts getAccessProfile. */
export const getAccessProfile = async (uid: number) => {
  const role = staffRole(uid); const pr = ({ head_teacher: "admin", deputy_head: "admin", senior_teacher: "teacher" } as any)[role] ?? role;
  const level = role === "super_admin" ? "system" : pr === "admin" || pr === "finance" ? "school" : pr === "teacher" ? "allocated" : pr === "class_teacher" ? "class" : "allocated";
  const label = role;
  if (level === "system" || level === "school") return { userId: uid, role, label, level, gradeIds: [] as number[], pairs: [] as string[] };
  const al = DATA.teacherAllocations.filter(a => a.teacherUserId === uid && a.status === "active");
  const owned = DATA.grades.filter(g => g.classTeacherUserId === uid).map(g => g.id);
  const classGrades = new Set([...al.filter(a => a.allocationType === "class_teacher").map(a => a.gradeId), ...owned]);
  const taught = al.filter(a => a.allocationType !== "class_teacher" && a.subjectId > 0);
  const gradeIds = Array.from(new Set(level === "class" ? Array.from(classGrades) : al.map(a => a.gradeId)));
  return { userId: uid, role, label, level, gradeIds, pairs: taught.map(a => `${a.gradeId}:${a.subjectId}`) };
};
