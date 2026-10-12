import { describe, expect, it } from "vitest";
import { curriculumCatalogue, SCHOOL_LEVELS } from "./curriculum";

describe("CBC curriculum catalogue", () => {
  it("contains entries for every supported school level", () => {
    const catalogue = curriculumCatalogue();
    expect(new Set(catalogue.map(row => row.level))).toEqual(new Set(SCHOOL_LEVELS));
    expect(catalogue.some(row => row.grade === "PP1")).toBe(true);
    expect(catalogue.some(row => row.grade === "Grade 12")).toBe(true);
  });

  it("does not expose duplicate learning-area entries within a grade and pathway", () => {
    const catalogue = curriculumCatalogue();
    const keys = catalogue.map(row => `${row.level}|${row.grade}|${row.pathway ?? ""}|${row.area}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
