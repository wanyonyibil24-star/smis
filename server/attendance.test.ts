import { describe, expect, it } from "vitest";
import { attendanceGradeLevel, validateAttendanceBatch } from "../shared/attendance";

describe("attendance grade and batch helpers", () => {
  it.each([
    ["Grade 7", 7],
    ["Grade 8 Blue", 8],
    ["G9A", 9],
    ["7 East", 7],
    ["Grade 6", null],
    ["Grade 70", null],
  ] as const)("resolves supported grade labels: %s", (name, expected) => {
    expect(attendanceGradeLevel(name)).toBe(expected);
  });

  it("accepts a non-empty unique attendance batch", () => {
    expect(validateAttendanceBatch([{ learnerId: 1, status: "present" }, { learnerId: 2, status: "late" }])).toHaveLength(2);
  });

  it("rejects empty, duplicate, oversized, and invalid learner batches", () => {
    expect(() => validateAttendanceBatch([])).toThrow("ATTENDANCE_BATCH_EMPTY");
    expect(() => validateAttendanceBatch([{ learnerId: 1, status: "present" }, { learnerId: 1, status: "absent" }])).toThrow("DUPLICATE_LEARNER_IN_BATCH");
    expect(() => validateAttendanceBatch(Array.from({ length: 501 }, (_, index) => ({ learnerId: index + 1, status: "present" as const })))).toThrow("ATTENDANCE_BATCH_TOO_LARGE");
    expect(() => validateAttendanceBatch([{ learnerId: 0, status: "present" }])).toThrow("INVALID_LEARNER_ID");
    expect(() => validateAttendanceBatch([{ learnerId: 3, status: "unknown" as any }])).toThrow("INVALID_ATTENDANCE_STATUS");
  });
});
