export const attendanceGradeLevels = [7, 8, 9] as const;
export type AttendanceGradeLevel = (typeof attendanceGradeLevels)[number];
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type AttendanceBatchEntry = { learnerId: number; status: AttendanceStatus };

/** Accept common class labels such as "Grade 7", "Grade 7 Blue", "G8A", or "9 East". */
export function attendanceGradeLevel(name: string): AttendanceGradeLevel | null {
  const labeled = name.match(/\b(?:grade|year|class|form|g)\s*([789])(?:\D|$)/i);
  const bare = name.match(/^\s*([789])(?:\D|$)/);
  const value = Number((labeled ?? bare)?.[1]);
  return attendanceGradeLevels.includes(value as AttendanceGradeLevel) ? value as AttendanceGradeLevel : null;
}

export function validateAttendanceBatch(entries: AttendanceBatchEntry[]): AttendanceBatchEntry[] {
  if (entries.length === 0) throw new Error("ATTENDANCE_BATCH_EMPTY");
  if (entries.length > 500) throw new Error("ATTENDANCE_BATCH_TOO_LARGE");
  const learnerIds = new Set<number>();
  const allowedStatuses = new Set<string>(["present", "absent", "late", "excused"]);
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.learnerId) || entry.learnerId <= 0) throw new Error("INVALID_LEARNER_ID");
    if (!allowedStatuses.has(entry.status)) throw new Error("INVALID_ATTENDANCE_STATUS");
    if (learnerIds.has(entry.learnerId)) throw new Error("DUPLICATE_LEARNER_IN_BATCH");
    learnerIds.add(entry.learnerId);
  }
  return entries;
}
