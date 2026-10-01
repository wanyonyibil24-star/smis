# NEXUS-SMIS People Master Registry Verification

**Date:** 25 September 2026  
**Scope:** Database-backed People module for learners, guardians, teachers and staff

## Implemented

- Learner create/edit, unique admission-number validation, Grade/Class linking, guardian name/ID/phone, and active/inactive status.
- Staff create/edit, automatic unique staff code generation, title, designation, phone/email, role, linked user account, and active/inactive status.
- Searchable learner and staff registry views with activate/deactivate and edit actions.
- Excel templates for learners and staff with instructions and sample rows.
- Two-stage bulk import: workbook parsing in the browser, server-side validation/preview, duplicate detection, Grade/Class validation, status/email checks, and explicit confirmation.
- People remains the source of truth: existing learner IDs and staff user IDs continue to feed attendance, marks, reports, finance, allocations and timetable workflows.
- Staff creation is cleanup-safe: if profile creation fails after the linked user is created, the orphan user is removed.

## Verification results

- `pnpm check` — passed.
- `pnpm test -- --run` — passed: 3 test files, 7 tests.
- `pnpm build` — passed. Vite emitted the existing chunk-size advisory only.
- Live database smoke test — passed:
  - learner creation succeeded;
  - duplicate admission number was rejected;
  - learner status change to inactive persisted;
  - staff profile creation succeeded;
  - unique staff code was generated;
  - duplicate admission numbers in an import workbook were detected;
  - temporary smoke data was removed.
- Live migration verification — passed: `staff_profiles` contains `title`, `designation`, `email`, `teacherCode`, and the existing school-role enum.

## Safety note

No production learner, guardian, or staff records were used as fixtures. Temporary diagnostic rows were removed after verification.
