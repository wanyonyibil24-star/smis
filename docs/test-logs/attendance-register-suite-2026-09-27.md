# Attendance Register Suite Verification

**Date:** 27 September 2026

NEXUS-SMIS now captures attendance in two independent daily sessions: **Present Morning** and **Present Afternoon**. The database uniqueness rule is learner + date + session, so the afternoon register cannot overwrite the morning register. Each save retains the latest capture timestamp.

A class teacher can submit a class register for approval. An administrator or super administrator can approve it, and an administrator can reopen an approved register for correction. All approval actions are persisted in `attendance_register_approvals` and written to the audit log. Backend scope checks ensure a class teacher can only submit the class allocated to them.

The Attendance workspace provides Weekly, Monthly, Termly, and Yearly summaries for every active learner in the selected Grade 7–9 class, including learners with zero captured sessions. Each summary shows present, absent, late, excused, and total sessions, with print and CSV download actions. The register print view uses the school name, logo, date, grade, session, and administrator signature from School Settings where available, and the browser Print / PDF action can save a branded PDF.

Verification: `pnpm check`, `pnpm test -- --run`, `pnpm build`, migration generation, live migration application, and conflict-marker checks passed.
