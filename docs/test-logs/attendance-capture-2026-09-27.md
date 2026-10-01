# Attendance Capture and Register Output Verification

**Date:** 27 September 2026  
**System:** NEXUS-SMIS

Attendance capture is now restricted at the backend to administrators, super administrators, and the staff member whose People profile is marked **Class Teacher** and who has an active **Class Teacher** allocation for the learner's class. Ordinary teachers cannot save attendance merely because they teach a learning area in that grade. The same class-specific rule applies to register loading and batch saves.

Each attendance record now stores `capturedAt`. The timestamp is refreshed whenever a register entry is saved or updated, appears in the register table, and is included in the downloaded CSV. The Attendance workspace also provides a browser print action and a CSV download named for the selected grade and date. The print action is intentionally browser-native so the school can choose a printer or save a PDF.

Verification completed:

- `pnpm check` passed.
- `pnpm test -- --run` passed: **7 test files, 29 tests**.
- `pnpm build` passed.
- Attendance migration `0017_dusty_ulik.sql` was reviewed and applied to the live database.
- Existing attendance records were preserved; the new timestamp column receives a default capture time.
- The unresolved-merge-marker scan was checked with line-anchored markers; no Git conflict markers remain in application source.
