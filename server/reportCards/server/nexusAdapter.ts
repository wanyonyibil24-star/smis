/**
 * The ONLY file that touches the host NEXUS codebase. When the module is dropped into the system
 * (e.g. server/reportCards/), adjust these relative paths if the folder location differs.
 */
export { and, eq, inArray } from "drizzle-orm";
export { getDb } from "../../db";
export { writeAudit } from "../../smis";
export { can, getAccessProfile } from "../../access";
export {
  users, grades, learners, subjects, assessments, marks, attendances, feeStructures, payments, reportCards, staffProfiles, teacherAllocations, schoolSettings,
} from "../../../drizzle/schema";
