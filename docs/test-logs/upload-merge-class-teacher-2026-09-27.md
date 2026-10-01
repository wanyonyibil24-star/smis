# NEXUS-SMIS Uploaded Project Merge Verification

**Date:** 27 September 2026  
**Scope:** Merge of the uploaded `nexus-smis(1).zip` workflows into the permanent NEXUS-SMIS project.

## Delivered

- Preserved the existing NEXUS visual shell, navigation, colours, People registry, allocations, report cards, timetable generator, IAM, and role permissions.
- Added the uploaded database-backed **Assessments**, **Attendance**, and integrated report-card workspaces.
- Added the uploaded assessment service, marklist validation, attendance validation, tests, and migration history.
- Preserved the single **School Operations** group containing **Timetable Generator** and **Teacher Allocations**.
- Added `class_teacher` master timetable visibility:
  - A staff profile marked **Class Teacher** can switch between their personal timetable and the published Grade 7–9 master timetable from the dashboard.
  - The class teacher can read the master timetable only; generator, code changes, requirements, and timetable edits remain restricted to timetable administrators.
  - The master timetable is read through a protected `masterList` tRPC procedure.
- Retained the authoritative allocation conflict rule: only one active class-teacher allocation may exist per grade, term, and academic year; conflicting learning-area allocations are rejected.
- Reconciled the assessment migration as `0015_good_quasimodo.sql` and `0016_last_gideon.sql`, including a safe backfill for existing assessment and mark records before enforcing required ownership fields.

## Verification

- `pnpm check` — passed.
- `pnpm test -- --run` — passed: **7 test files, 27 tests**.
- `pnpm build` — passed; Vite client and server bundle generated successfully.
- `pnpm drizzle-kit generate` — passed: **No schema changes, nothing to migrate** after migration snapshot reconciliation.
- `git diff --check` — passed.

## Important operating rule

People remains the single source of truth for staff roles. Mark a staff record as **Class Teacher** in People, then create the corresponding **Class Teacher** allocation in Teacher Allocations under School Operations. The allocation is what binds the staff member to a specific class and enforces the one-class-teacher-per-class rule.
