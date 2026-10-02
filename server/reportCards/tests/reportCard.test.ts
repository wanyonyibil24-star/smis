// Run: node --test --experimental-strip-types tests/reportCard.test.ts   (also valid under the host's vitest via a one-line import swap)
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFeeAccess, decideScope, levelLabel, overallBand, summarise, type Profile, type SubjectRow } from "../shared/reportCard.ts";

const admin: Profile = { level: "school", gradeIds: [], pairs: [], classGradeIds: [] };
const classT: Profile = { level: "class", gradeIds: [7], pairs: [], classGradeIds: [7] };
const subjectT: Profile = { level: "allocated", gradeIds: [7, 8], pairs: ["7:1", "7:2", "8:5"], classGradeIds: [] };
const teacherWhoOwnsClass: Profile = { ...subjectT, classGradeIds: [8] };

test("administrators and class teachers get the right scope", () => {
  assert.equal(decideScope(admin, 9).access, "full");
  assert.equal(decideScope(classT, 7).access, "full");
  assert.equal(decideScope(classT, 8).access, "none");
});
test("subject teachers see only allocated learning areas, in allocated classes", () => {
  const d = decideScope(subjectT, 7);
  assert.equal(d.access, "partial"); assert.deepEqual([...d.subjectIds!].sort(), [1, 2]);
  assert.equal(decideScope(subjectT, 9).access, "none");
  assert.equal(decideScope({ ...subjectT, pairs: [] }, 7).access, "none");
});
test("a teacher-role user who is class teacher of a grade gets the full card and fee scope for that grade only", () => {
  assert.equal(decideScope(teacherWhoOwnsClass, 8).access, "full");
  assert.equal(decideScope(teacherWhoOwnsClass, 7).access, "partial");
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: teacherWhoOwnsClass, gradeId: 8 }).allowed, true);
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: teacherWhoOwnsClass, gradeId: 7 }).allowed, false);
  assert.equal(decideFeeAccess({ hasFinanceView: false, profile: teacherWhoOwnsClass, gradeId: 8 }).allowed, false);
});
test("fees need finance permission AND scope; checkbox alone grants nothing", () => {
  assert.equal(decideFeeAccess({ hasFinanceView: false, profile: admin, gradeId: 7 }).allowed, false);
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: admin, gradeId: 7 }).allowed, true);
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: classT, gradeId: 7 }).allowed, true);
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: classT, gradeId: 8 }).allowed, false);
  assert.equal(decideFeeAccess({ hasFinanceView: true, profile: subjectT, gradeId: 7 }).allowed, false);
});
test("CBC levels are displayed from the stored value, never recomputed", () => {
  assert.equal(levelLabel("ME2"), "Meeting Expectation 2"); assert.equal(levelLabel("EE1"), "Exceeding Expectation 1");
  assert.equal(levelLabel("AE1"), "Approaching Expectation 1"); assert.equal(levelLabel("BE2"), "Below Expectation 2"); assert.equal(levelLabel(null), "-");
});
test("overall band follows the existing NEXUS majority rule", () => {
  assert.equal(overallBand(["EE1", "EE2", "ME1"]), "EE"); assert.equal(overallBand(["ME1", "ME2", "AE1"]), "ME");
  assert.equal(overallBand(["AE1", "AE2", "BE1"]), "AE"); assert.equal(overallBand([null]), null);
});
test("summary ignores pending and unmarked rows", () => {
  const row = (o: Partial<SubjectRow>): SubjectRow => ({ subjectId: 1, subject: "x", midTerm: null, endTerm: null, average: null, cbcLevel: null, teacherRemark: null, facilitator: null, state: "published", ...o });
  const s = summarise([row({ midTerm: 60, endTerm: 80, average: 70, cbcLevel: "ME1" }), row({ state: "pending" }), row({ state: "no_mark" }), row({ midTerm: 40, endTerm: 60, average: 50, cbcLevel: "ME2" })]);
  assert.equal(s.subjectsScored, 2); assert.equal(s.totalAverage, 120); assert.equal(s.outOf, 200); assert.equal(s.termAverage, 60); assert.equal(s.overall, "ME");
});
