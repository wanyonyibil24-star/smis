// Renders REAL service output (from the in-memory NEXUS fixtures) through the real ReportCardSheet + CSS, prints with Chromium to A4 PDF, and measures layout.
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { DATA } from "../server/nexusAdapter.ts";
import { buildReportBatch } from "../server/reportCardService.ts";
import { ReportCardSheet } from "../client/ReportCardSheet.tsx";
import { U, seed } from "./fixtures.ts";

const css = fs.readFileSync(new URL("../client/reportCard.css", import.meta.url), "utf8");
const out = process.env.OUT ?? "/tmp/rc-audit"; fs.mkdirSync(out, { recursive: true });
const base = { academicYear: 2026, term: "Term 2", assessmentType: "end_term" as const };

function stress() {   // 13 learning areas, long names/comments, to test the worst realistic case
  const names = ["Pre-Technical and Pre-Career Education", "Religious Education (CRE)", "Creative Arts and Sports", "Social Studies", "Agriculture and Nutrition", "Kiswahili", "Indigenous Language", "Computer Science", "Life Skills", "Visual Arts"];
  names.forEach((n, i) => {
    const sid = 10 + i; DATA.subjects.push({ id: sid, name: n });
    DATA.assessments.push({ id: 100 + i, academicYear: 2026, term: "Term 2", assessmentType: "end_term", gradeId: 3, subjectId: sid, status: "approved", teacherUserId: 3 });
    DATA.marks.push({ assessmentId: 100 + i, learnerId: 31, subjectId: sid, midTerm: 30 + i * 6, endTerm: 40 + i * 5, average: 35 + i * 5.5, cbcLevel: ["BE2", "AE2", "AE1", "ME2", "ME1", "EE2", "EE1"][i % 7], teacherRemark: "Demonstrates thoughtful progress and applies feedback with increasing independence across class tasks; continue practising and reviewing each topic with care. ".repeat(2).slice(0, 255) });
  });
  DATA.learners.find(l => l.id === 31)!.fullName = "Maryann Wangechi Njoroge Wanjiru Kamau-Mwangi";
  DATA.reportCards[0].classTeacherComment = "Maryann has shown commendable effort across most learning areas this term and should continue practising numeracy and extended writing daily. She is polite, cooperative and a positive influence on her peers in class.";
  DATA.reportCards[0].headTeacherComment = "A good performance overall. Keep working hard and maintain the discipline displayed this term; the school is proud of your progress and wishes you well in the coming term.";
}
const cases: Array<[string, () => Promise<any>]> = [
  ["01-learner-no-fees", () => buildReportBatch({ ...base, includeFees: false, target: { kind: "learner", learnerId: 31 } }, U.admin)],
  ["02-learner-with-fees", () => buildReportBatch({ ...base, includeFees: true, target: { kind: "learner", learnerId: 31 } }, U.admin)],
  ["03-class-with-fees-3pages", async () => { const b = await buildReportBatch({ ...base, includeFees: true, target: { kind: "grade", gradeName: "Grade 9" } }, U.admin); return b; }],
  ["04-teacher-partial-fees-denied", () => buildReportBatch({ ...base, includeFees: true, target: { kind: "learner", learnerId: 31 } }, U.scienceTeacher)],
  ["05-stress-13-areas-long-text-fees", async () => { stress(); return buildReportBatch({ ...base, includeFees: true, target: { kind: "learner", learnerId: 31 } }, U.admin); }],
  ["06-empty-period", () => buildReportBatch({ ...base, term: "Term 3", includeFees: false, target: { kind: "learner", learnerId: 32 } }, U.admin)],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: process.env.CHROMIUM_PATH ? ["--no-sandbox"] : [] }); const results: any[] = [];
for (const [name, make] of cases) {
  seed();
  const batch = await make();
  const body = renderToStaticMarkup(<>{batch.cards.map((c: any) => <ReportCardSheet key={c.learner.id} card={c} batch={batch} />)}</>);
  if (name.startsWith("05") && (batch.cards[0].rows.length !== 13 || (body.match(/Demonstrates thoughtful progress/g) ?? []).length !== 20)) throw new Error("The 13-area stress card or its stored subject remarks are incomplete.");
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="rc-print-portal">${body}</div>`;
  fs.writeFileSync(`${out}/${name}.html`, html);
  const page = await browser.newPage(); await page.setContent(html); await page.emulateMedia({ media: "print" });
  const m = await page.evaluate(() => {
    const mm = 96 / 25.4; const issues: string[] = [];
    document.querySelectorAll<HTMLElement>(".rc-sheet").forEach((s, i) => {
      if (s.scrollWidth > s.clientWidth + 1) issues.push(`sheet ${i + 1} horizontal overflow`);
      const fr = s.querySelector<HTMLElement>(".rc-frame")!.getBoundingClientRect();
      s.querySelectorAll<HTMLElement>("th,td,h1,p,svg,img,.rc-sign > div").forEach(el => { const r = el.getBoundingClientRect(); if (r.right > fr.right + 1 || r.left < fr.left - 1) issues.push(`sheet ${i + 1}: <${el.tagName.toLowerCase()}> outside frame "${(el.textContent || "").slice(0, 30)}"`); });
      s.querySelectorAll<HTMLElement>("td,th").forEach(el => { if (el.scrollWidth > el.clientWidth + 1) issues.push(`sheet ${i + 1}: cell text clipped "${(el.textContent || "").slice(0, 30)}"`); });
    });
    return { sheets: document.querySelectorAll(".rc-sheet").length, issues, contentHeightsMm: [...document.querySelectorAll<HTMLElement>(".rc-sheet")].map(s => +(s.offsetHeight / mm).toFixed(1)) };
  });
  await page.pdf({ path: `${out}/${name}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  const pages = (await PDFDocument.load(fs.readFileSync(`${out}/${name}.pdf`))).getPageCount();
  if (name.startsWith("05") && (pages < 2 || pages > 3)) throw new Error(`Unexpected page count for the 13-area stress card: ${pages}`);
  if (!name.startsWith("05") && pages !== batch.cards.length) throw new Error(`Unexpected extra/overflow PDF page in ${name}: ${pages} pages for ${batch.cards.length} card(s)`);
  try {
    const text = execFileSync(process.env.PDFTOTEXT ?? "pdftotext", ["-layout", `${out}/${name}.pdf`, "-"], { encoding: "utf8" });
    const contentPages = text.split("\f").filter(p => p.trim().length > 0);
    if (contentPages.length !== pages) throw new Error(`Blank PDF page detected in ${name}.`);
    if (name.startsWith("05") && !contentPages.at(-1)?.includes("Class Teacher's Comment:")) throw new Error("The final stress-card page is missing the report comments.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  results.push({ name, cards: batch.cards.length, pdfPages: pages, ...m }); await page.close();
}
await browser.close(); console.log(JSON.stringify(results, null, 1));
