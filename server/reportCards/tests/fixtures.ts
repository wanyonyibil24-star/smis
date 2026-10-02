import { DATA, LOG, MATRIX } from "../server/nexusAdapter.ts";
export const U = { superAdmin: 1, admin: 2, teacherOwner: 3, classTeacher: 4, bursar: 5, nobody: 6, scienceTeacher: 7 };
export function seed(classTeacherHasFinance = true) {
  for (const k of Object.keys(DATA)) delete DATA[k];
  LOG.reads.length = 0; LOG.writes.length = 0; LOG.audits.length = 0;
  Object.assign(MATRIX, {
    super_admin: ["*"], admin: ["reports.view", "finance.view"], teacher: ["reports.view"], finance: ["reports.view", "finance.view"], other: [],
    class_teacher: classTeacherHasFinance ? ["reports.view", "finance.view"] : ["reports.view"],
  });
  const staff = [[1, "super_admin", "Super Admin"], [2, "admin", "Principal Admin"], [3, "teacher", "Teacher Owner"], [4, "class_teacher", "Class Teacher Nine"], [5, "finance", "Bursar"], [6, "other", "Support"], [7, "teacher", "Science Teacher"]];
  DATA.users = staff.map(([id]) => ({ id, role: "user" }));
  DATA.staffProfiles = staff.map(([userId, role, displayName]) => ({ userId, role, displayName, title: null }));
  DATA.schoolSettings = [{ schoolName: "Fixture School Name", motto: "Fixture Motto", academicYear: 2026, currentTerm: "Term 2", includeFeesOnReportCard: 1, address: "Fixture Addr", phone: "0700", email: "a@b.c", logoPath: null, principalSignaturePath: null, classTeacherSignaturePath: null }];
  DATA.grades = [{ id: 1, name: "Grade 7", stream: "A", classTeacherUserId: null }, { id: 2, name: "Grade 8", stream: "A", classTeacherUserId: 3 },
    { id: 3, name: "Grade 9", stream: "A", classTeacherUserId: 4 }, { id: 4, name: "Grade 9", stream: "B", classTeacherUserId: null }];
  DATA.subjects = [{ id: 1, name: "Mathematics" }, { id: 2, name: "English" }, { id: 3, name: "Integrated Science" }];
  DATA.learners = [
    { id: 31, fullName: "Maryann Wangeci", admissionNumber: "A31", gender: "female", gradeId: 3, status: "active" },
    { id: 32, fullName: "Brian Otieno", admissionNumber: "A32", gender: "male", gradeId: 3, status: "active" },
    { id: 33, fullName: "Inactive Learner", admissionNumber: "A33", gender: "male", gradeId: 3, status: "inactive" },
    { id: 21, fullName: "Faith Njeri", admissionNumber: "A21", gender: "female", gradeId: 2, status: "active" },
    { id: 11, fullName: "Peter Kamau", admissionNumber: "A11", gender: "male", gradeId: 1, status: "active" },
    { id: 41, fullName: "Lucy Achieng", admissionNumber: "A41", gender: "female", gradeId: 4, status: "active" }];
  const a = (id: number, year: number, term: string, type: string, gradeId: number, subjectId: number, status: string, teacherUserId: number) => ({ id, academicYear: year, term, assessmentType: type, gradeId, subjectId, status, teacherUserId });
  DATA.assessments = [a(1, 2026, "Term 2", "end_term", 3, 1, "approved", 3), a(2, 2026, "Term 2", "end_term", 3, 2, "locked", 3), a(3, 2026, "Term 2", "end_term", 3, 3, "approved", 7),
    a(4, 2026, "Term 2", "mid_term", 3, 1, "approved", 3), a(5, 2026, "Term 1", "end_term", 3, 1, "approved", 3), a(6, 2025, "Term 2", "end_term", 3, 1, "approved", 3),
    a(7, 2026, "Term 2", "end_term", 2, 1, "approved", 3), a(8, 2026, "Term 2", "end_term", 2, 3, "draft", 7), a(9, 2026, "Term 2", "end_term", 4, 1, "approved", 3)];
  const m = (assessmentId: number, learnerId: number, subjectId: number, midTerm: number | null, endTerm: number | null, average: number, cbcLevel: string) => ({ assessmentId, learnerId, subjectId, midTerm, endTerm, average, cbcLevel, teacherRemark: null });
  DATA.marks = [m(1, 31, 1, 60, 80, 70, "ME1"), m(2, 31, 2, 50, 70, 60, "ME1"), m(3, 31, 3, 90, 94, 92, "EE1"), m(4, 31, 1, 55, null, 55, "ME2"), m(5, 31, 1, 11, 11, 11, "BE1"),
    m(6, 31, 1, 22, 22, 22, "AE2"), m(7, 31, 1, 5, 5, 5, "BE2"),
    m(1, 32, 1, 30, 50, 40, "AE1"), m(2, 32, 2, 85, 91, 88, "EE2"), m(7, 21, 1, 70, 84, 77, "EE2"), m(8, 21, 3, 99, 99, 99, "EE1"), m(9, 41, 1, 66, 66, 66, "ME1")];
  DATA.feeStructures = [{ gradeId: 3, itemName: "Tuition", amount: "30000.00" }, { gradeId: 3, itemName: "Activity", amount: "5000.00" }, { gradeId: 2, itemName: "Tuition", amount: "20000.00" }, { gradeId: 1, itemName: "Tuition", amount: "18000.00" }];
  DATA.payments = [{ learnerId: 31, amount: "12000.00" }, { learnerId: 31, amount: "8000.00" }, { learnerId: 32, amount: "35000.00" }];
  DATA.attendances = [
    { learnerId: 31, attendanceDate: "2026-05-04", session: "morning", status: "present" }, { learnerId: 31, attendanceDate: "2026-05-04", session: "afternoon", status: "absent" },
    { learnerId: 31, attendanceDate: "2026-05-05", session: "morning", status: "absent" }, { learnerId: 31, attendanceDate: "2026-05-05", session: "afternoon", status: "absent" },
    { learnerId: 31, attendanceDate: "2026-05-06", session: "morning", status: "late" }, { learnerId: 31, attendanceDate: "2025-05-06", session: "morning", status: "present" }];
  DATA.reportCards = [{ learnerId: 31, academicYear: 2026, term: "Term 2", assessmentType: "end_term", classTeacherComment: "Steady progress.", headTeacherComment: "Keep it up." }];
  DATA.userPermissions = [];
  DATA.teacherAllocations = [
    { teacherUserId: 3, gradeId: 3, subjectId: 1, status: "active", allocationType: "learning_area" }, { teacherUserId: 3, gradeId: 3, subjectId: 2, status: "active", allocationType: "learning_area" },
    { teacherUserId: 7, gradeId: 3, subjectId: 3, status: "active", allocationType: "learning_area" }, { teacherUserId: 4, gradeId: 3, subjectId: 0, status: "active", allocationType: "class_teacher" }];
}
