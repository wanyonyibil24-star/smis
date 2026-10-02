# NEXUS Report Cards — production integration

## Integration status

The Report Card module is now wired into the existing NEXUS application:

- `server/routers.ts` mounts `options`, `generate`, and scoped comment-save procedures under the authenticated `smis.reports` router. The read procedures require the existing `reports.view` permission. The administrator-only report status procedure remains available.
- `client/src/pages/Home.tsx` mounts the new `ReportCardsWorkspace` on the Reports view and keeps that navigation permission-gated.
- `client/src/components/ReportCardsWorkspace.tsx` adapts the authenticated NEXUS tRPC client to the report UI and checks the existing comment-edit capability.
- The former `IntegratedReportCardView` and old report-read handlers were removed. `getAssessmentReportCard`, `getIntegratedReportCard`, `getReportCard`, and the old comment-save handler are no longer called or present. Existing `report_cards` rows are retained; status updates remain administrator-only.

No schema migration or database cleanup is required. The report generator is read-only with respect to learner, assessment, attendance, finance, and report-card records; it writes the expected audit event only. Editing comments is a separate, explicit mutation. No report draft is created just by opening or generating a report.

## Data and filtering

The service reads the existing NEXUS records through `server/reportCards/server/nexusAdapter.ts`:

- Learners, active grades/streams, subjects, marks and assessments come from the existing central tables.
- Each request is filtered by learner/class/grade, academic year, term, and assessment type. Only approved or locked assessments supply published marks; draft/unapproved assessments do not reveal marks.
- CBC level is the stored assessment value; the report never recalculates it. Summary rules use the existing NEXUS band/majority rules.
- Fee totals are calculated from existing fee structures for the learner’s grade and that learner’s payments, matching the current finance overview’s all-period calculation. A newly recorded payment or corrected mark appears on the next report generation.
- Attendance is grouped by date within the selected academic year; a day counts as present only when at least one session is present or late. Excused-only days remain absent, matching the attendance record rather than being silently converted to presence.
- School name, contact details, logo and signatures come only from the configured `school_settings` record. If settings are missing, report generation fails with a configuration error; it does not print a fabricated school identity.

There is no second learner/marks database, no hard-coded production mark/fee fixture, and no sample learner data in the production module. The in-memory records used by the audit are confined to `server/reportCards/tests/`.

## Permissions and privacy

- The server independently requires `reports.view` or `report_cards.view`; hiding navigation or the fee checkbox is not the authorization boundary.
- Existing `getAccessProfile` scope is used: school/system users see the school, class teachers see their class, and subject teachers see only allocated learning areas/classes. A partial card does not disclose an overall mark/average computed from a subset.
- Fees are not queried or included when the checkbox is off. When it is on, the server separately requires `finance.view` and the relevant class scope. A client checkbox cannot grant access.
- Comment saves separately require `assessments.edit` and full scope over the learner; subject-teacher partial scope is not enough. The status mutation remains administrator-only.
- Existing default role grants are intentionally unchanged. In the current permission matrix, the `finance`/Bursar role also has `reports.view`, which makes that role school-scoped for marks; `finance.view` still independently gates fee details. Review the live role-permission settings if the Bursar should have fee access without academic-report access.

## Verification completed in the repository checkout

- `pnpm check` — passed for the integrated application code.
- Pure CBC/scope rules — 7/7 passed.
- Real report service against the test-only in-memory NEXUS adapter — 24/24 passed, including filter isolation, role/scope restrictions, both report permission keys, direct finance authorization, payment/mark changes appearing on regeneration, required school settings, comment-write authorization, excused attendance, and the no-data-write/read-audit guarantee.
- Chromium A4/PDF audit — all six scenarios passed with no detected clipping, horizontal overflow, frame overflow, or blank pages. Standard individual and class reports use one A4 page per learner. The 13-learning-area stress card with long per-subject remarks paginates across three A4 pages; all report rows and comments are retained, the final page contains substantive report content, and it does not create a blank trailing page.

The render audit uses Chromium plus the system `pdftotext` tool to assert that pages contain text. It is a browser print/PDF verification, not a physical-printer test.

## Production-environment checks still required

This audit did not connect to the live NEXUS database or physically print a report. Before relying on production output, verify the school’s actual `school_settings`, live permission assignments, real assessment/attendance/payment records, configured signature/logo assets, and a physical printer’s scaling/paper settings. No production NEXUS records were created, modified, or deleted by this audit.

## Administrator bootstrap

`server/smis-seed.ts` no longer inserts sample learners, assessments, marks, attendance, payments, fees, inventory, or fixed school profile values. If it is deliberately run, it creates only the initial administrator and permission catalog using required `NEXUS_SEED_OPEN_ID`, `NEXUS_SEED_USERNAME`, `NEXUS_SEED_NAME`, `NEXUS_SEED_EMAIL`, and `NEXUS_SEED_PASSWORD` environment values. Existing accounts are left unchanged; this audit did not run that script.
