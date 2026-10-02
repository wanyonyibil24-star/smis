/**
 * NEXUS Report Card module - shared types and pure rules.
 * No database or UI imports here, so the same rules run on the server, in the client and in tests.
 */

export type AssessmentType = "mid_term" | "end_term";
export type CbcLevel = "EE1" | "EE2" | "ME1" | "ME2" | "AE1" | "AE2" | "BE1" | "BE2";
export type CbcBand = "EE" | "ME" | "AE" | "BE";

export const BAND_LABEL: Record<CbcBand, string> = {
  EE: "Exceeding Expectation", ME: "Meeting Expectation", AE: "Approaching Expectation", BE: "Below Expectation",
};
export const ASSESSMENT_LABEL: Record<AssessmentType, string> = { mid_term: "Mid-Term", end_term: "End-Term" };
export const TERMS = ["Term 1", "Term 2", "Term 3"] as const;

export const bandOf = (level: CbcLevel | string | null | undefined): CbcBand | null => {
  const b = String(level ?? "").slice(0, 2);
  return b === "EE" || b === "ME" || b === "AE" || b === "BE" ? b : null;
};
/** "ME2" -> "Meeting Expectation 2". The stored level is displayed as-is; it is never recomputed here. */
export const levelLabel = (level: CbcLevel | string | null | undefined) => {
  const band = bandOf(level); if (!band) return "-";
  const sub = String(level).slice(2);
  return `${BAND_LABEL[band]}${sub ? ` ${sub}` : ""}`;
};

/** Same overall-level rule as the existing NEXUS integrated report: majority band, checked EE, ME, BE, else AE. */
export function overallBand(levels: Array<string | null>): CbcBand | null {
  const bands = levels.map(bandOf).filter((b): b is CbcBand => b !== null);
  if (!bands.length) return null;
  const half = Math.ceil(bands.length / 2);
  const count = (b: CbcBand) => bands.filter(x => x === b).length;
  return count("EE") >= half ? "EE" : count("ME") >= half ? "ME" : count("BE") >= half ? "BE" : "AE";
}

export type SubjectRow = {
  subjectId: number; subject: string; midTerm: number | null; endTerm: number | null; average: number | null;
  cbcLevel: CbcLevel | null; teacherRemark: string | null; facilitator: string | null;
  /** "published" = approved/locked marks are on the card; anything else is shown as pending, never as a mark. */
  state: "published" | "pending" | "no_mark";
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarise(rows: SubjectRow[]) {
  const scored = rows.filter(r => r.state === "published" && r.average !== null);
  const total = scored.reduce((s, r) => s + (r.average as number), 0);
  const mid = rows.filter(r => r.state === "published" && r.midTerm !== null);
  const end = rows.filter(r => r.state === "published" && r.endTerm !== null);
  const sum = (xs: SubjectRow[], k: "midTerm" | "endTerm") => xs.reduce((s, r) => s + (r[k] as number), 0);
  return {
    subjectsScored: scored.length, subjectsListed: rows.length,
    totalAverage: scored.length ? round1(total) : null, outOf: scored.length * 100,
    termAverage: scored.length ? round1(total / scored.length) : null,
    midTotal: mid.length ? round1(sum(mid, "midTerm")) : null, midOutOf: mid.length * 100,
    endTotal: end.length ? round1(sum(end, "endTerm")) : null, endOutOf: end.length * 100,
    overall: overallBand(scored.map(r => r.cbcLevel)),
  };
}

export type FeeBlock =
  | { status: "ok"; totalFees: number; amountPaid: number; balance: number; currency: "KES" }
  | { status: "no_record" };
export type FeesBatchStatus = "not_requested" | "ok" | "denied";

export type Attendance = { daysOpen: number; daysPresent: number; daysAbsent: number; percentage: number | null };

export type ReportCardData = {
  learner: { id: number; fullName: string; admissionNumber: string; gender: string | null };
  grade: { id: number; name: string; stream: string | null; label: string };
  classTeacher: string | null;
  rows: SubjectRow[];
  summary: ReturnType<typeof summarise>;
  attendance: Attendance;
  comments: { classTeacher: string | null; headTeacher: string | null };
  /** Present only when fees were requested AND the server authorised them. Otherwise the key is absent. */
  fees?: FeeBlock;
  /** True when a subject teacher is limited to the learning areas they are allocated. */
  partial: boolean;
};

export type ReportSchool = {
  name: string; motto: string | null; address: string | null; phone: string | null; email: string | null;
  logoPath: string | null; principalSignaturePath: string | null; classTeacherSignaturePath: string | null;
};

export type ReportBatch = {
  school: ReportSchool; academicYear: number; term: string; assessmentType: AssessmentType;
  feesStatus: FeesBatchStatus; feesMessage: string | null;
  cards: ReportCardData[]; skippedClasses: string[]; generatedAt: string;
};

export type ReportTarget =
  | { kind: "learner"; learnerId: number }
  | { kind: "class"; gradeId: number }
  | { kind: "grade"; gradeName: string };

export type ReportRequest = { academicYear: number; term: string; assessmentType: AssessmentType; target: ReportTarget; includeFees: boolean };

export type ReportOptions = {
  school: { name: string }; defaultYear: number; defaultTerm: string; years: number[]; defaultIncludeFees: boolean;
  canViewFinance: boolean; accessLabel: string;
  grades: Array<{ id: number; name: string; stream: string | null; label: string }>;
  learners: Array<{ id: number; fullName: string; admissionNumber: string; gradeId: number }>;
};

/* ---------------- authorisation rules (pure, used by the server) ---------------- */

/** classGradeIds: grades the user is class teacher of (grades.classTeacherUserId or an active class_teacher allocation), whatever their staff role. */
export type Profile = { level: "system" | "school" | "class" | "allocated"; gradeIds: number[]; pairs: string[]; classGradeIds: number[] };
export type ScopeDecision = { access: "full" | "partial" | "none"; subjectIds?: Set<number> };

/** Which part of a class's report the actor may see. System/school: all. Class teacher: own class. Subject teacher: own subjects only. */
export function decideScope(p: Profile, gradeId: number): ScopeDecision {
  if (p.level === "system" || p.level === "school") return { access: "full" };
  if (p.classGradeIds.includes(gradeId)) return { access: "full" };
  if (!p.gradeIds.includes(gradeId)) return { access: "none" };
  if (p.level === "class") return { access: "full" };
  const subjectIds = new Set(p.pairs.filter(x => x.startsWith(`${gradeId}:`)).map(x => Number(x.split(":")[1])));
  return subjectIds.size ? { access: "partial", subjectIds } : { access: "none" };
}

/** Fees need the finance permission AND a scope that covers the learner's class. A subject teacher never gets fees. */
export function decideFeeAccess(a: { hasFinanceView: boolean; profile: Profile; gradeId: number }) {
  if (!a.hasFinanceView) return { allowed: false as const, reason: "Your account does not have permission to view learner fee information." };
  if (a.profile.level === "system" || a.profile.level === "school") return { allowed: true as const, reason: null };
  if (a.profile.classGradeIds.includes(a.gradeId) || (a.profile.level === "class" && a.profile.gradeIds.includes(a.gradeId))) return { allowed: true as const, reason: null };
  return { allowed: false as const, reason: "Fee information for this learner is outside your permitted scope." };
}

export const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const REPORT_ERRORS = {
  REPORT_PERMISSION_DENIED: "You do not have permission to generate report cards.",
  REPORT_SCOPE_FORBIDDEN: "You are not allocated to this learner, class or grade, so this report cannot be generated for you.",
  LEARNER_NOT_FOUND: "The selected learner was not found.",
  CLASS_NOT_FOUND: "The selected class or grade was not found.",
  NO_LEARNERS: "No active learners were found for the selected class or grade.",
  SCHOOL_SETTINGS_NOT_CONFIGURED: "School identity is not configured. Ask an administrator to complete School Settings before generating reports.",
  COMMENT_PERMISSION_DENIED: "You do not have permission to edit report-card comments.",
} as const;
export type ReportErrorCode = keyof typeof REPORT_ERRORS;
