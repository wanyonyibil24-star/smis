import { describe, expect, it } from "vitest";
import { assessmentScopeKey, averageAssessmentScores, canTransitionAssessment, missingAssessmentLearners } from "./assessment";
import { assertScore } from "./smis";
import { rankMarklistRows } from "../shared/marklist";

describe("central assessment workflow", () => {
  it("keeps marks separated by academic year, term, assessment type, class, and subject", () => {
    const base = { academicYear: 2026, term: "Term 2", assessmentType: "mid_term" as const, gradeId: 8, subjectId: 3 };
    expect(assessmentScopeKey(base)).not.toBe(assessmentScopeKey({ ...base, assessmentType: "end_term" }));
    expect(assessmentScopeKey(base)).not.toBe(assessmentScopeKey({ ...base, term: "Term 3" }));
    expect(assessmentScopeKey(base)).not.toBe(assessmentScopeKey({ ...base, subjectId: 4 }));
  });

  it("treats blank scores as missing but a genuine zero as entered", () => {
    expect(missingAssessmentLearners([1, 2, 3], [
      { learnerId: 1, score: 0 },
      { learnerId: 2, score: "76.5" },
      { learnerId: 3, score: null },
    ])).toEqual([3]);
  });

  it("calculates Average marklists from both terms without treating a missing term as zero", () => {
    expect(averageAssessmentScores(60, 80)).toBe(70);
    expect(averageAssessmentScores(0, 100)).toBe(50);
    expect(averageAssessmentScores(null, 80)).toBeNull();
    expect(averageAssessmentScores(60, null)).toBeNull();
  });

  it("keeps roster rows visible before marks and leaves their positions blank", () => {
    const rows = rankMarklistRows([
      { learnerId: 1, fullName: "Amina Njeri", average: null },
      { learnerId: 2, fullName: "Brian Otieno", average: null },
      { learnerId: 3, fullName: "Caro Wekesa", average: 80 },
      { learnerId: 4, fullName: "Diana Ali", average: 80 },
    ]);
    expect(rows.map(row => [row.fullName, row.position])).toEqual([
      ["Caro Wekesa", 1], ["Diana Ali", 1], ["Amina Njeri", null], ["Brian Otieno", null],
    ]);
  });

  it("requires submission before approval and approval before locking", () => {
    expect(canTransitionAssessment("draft", "approved")).toBe(false);
    expect(canTransitionAssessment("submitted", "approved")).toBe(true);
    expect(canTransitionAssessment("approved", "locked")).toBe(true);
    expect(canTransitionAssessment("submitted", "locked")).toBe(false);
  });

  it("validates score boundaries without treating missing as zero", () => {
    expect(assertScore(0)).toBe(0);
    expect(assertScore(100)).toBe(100);
    expect(() => assertScore(-0.01)).toThrow();
    expect(() => assertScore(100.01)).toThrow();
  });
});
