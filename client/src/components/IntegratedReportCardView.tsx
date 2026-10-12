import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type AssessmentType = "mid_term" | "end_term";
type GradeOption = { id: number; name: string; stream?: string | null };
const MAGENTA = "#d000b9";
const gradeLabels = ["Grade 7", "Grade 8", "Grade 9"];

const levelLabel = (level: string | null) => {
  if (!level) return "-";
  if (level.startsWith("EE")) return `Exceeding Expectations ${level.slice(2)}`;
  if (level.startsWith("ME")) return `Meeting Expectations ${level.slice(2)}`;
  if (level.startsWith("AE")) return `Approaching Expectations ${level.slice(2)}`;
  return `Below Expectations ${level.slice(2)}`;
};

const numeric = (value: number | null | undefined) => value == null ? "-" : Math.round(value);

export function IntegratedReportCardView({ canReview = false }: { canReview?: boolean }) {
  const settings = trpc.smis.settings.get.useQuery();
  const commentAccess = trpc.smis.assessments.commentAccess.useQuery();
  const mayComment = canReview || commentAccess.data === true;
  const learners = trpc.smis.learners.list.useQuery({});
  const catalog = trpc.smis.people.catalog.useQuery();
  const [learnerId, setLearnerId] = useState<number | null>(null);
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState("Term 1");
  const [assessmentType, setAssessmentType] = useState<AssessmentType>("mid_term");
  const [classTeacherComment, setClassTeacherComment] = useState("");
  const [headTeacherComment, setHeadTeacherComment] = useState("");
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!settings.data) return;
    setAcademicYear(settings.data.academicYear);
    setTerm(settings.data.currentTerm);
  }, [settings.data?.academicYear, settings.data?.currentTerm]);
  useEffect(() => {
    if (gradeId || !catalog.data?.grades.length) return;
    setGradeId(catalog.data.grades[0].id);
  }, [catalog.data?.grades, gradeId]);
  const gradeLearners = useMemo(() => (learners.data ?? []).filter(row => !gradeId || row.gradeId === gradeId), [learners.data, gradeId]);
  useEffect(() => {
    if (!gradeLearners.length) { setLearnerId(null); return; }
    if (!learnerId || !gradeLearners.some(row => row.id === learnerId)) setLearnerId(gradeLearners[0].id);
  }, [gradeLearners, learnerId]);

  const report = trpc.smis.reports.reportCard.useQuery({ learnerId: learnerId ?? 0, academicYear, term, assessmentType }, { enabled: learnerId !== null });
  const saveComments = trpc.smis.reports.saveReportCardComments.useMutation({
    onSuccess: async () => { toast.success("Report-card comments saved"); await utils.smis.reports.reportCard.invalidate(); },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const result = report.data;
  const status = result?.assessmentStatus ?? "draft";
  const selectedGrade = catalog.data?.grades.find((row: GradeOption) => row.id === gradeId);

  return <div className="page-enter space-y-5">
    <header className="flex flex-col gap-4 border-b border-[#dfdbd1] pb-5"><div><p className="eyebrow">Reports · learner assessment output</p><h1 className="mt-1 font-editorial text-3xl text-[#193d32]">Learner assessment report card</h1><p className="mt-2 text-sm text-[#69796f]">Select a Grade and learner to view the print-ready report-card template.</p></div></header>
    <section className="grid gap-3 rounded-xl border border-[#e7e2d7] bg-[#fffefa] p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-bold text-[#53675d]">Grade<select value={gradeId ?? ""} onChange={event => setGradeId(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-white px-3 py-2.5 text-sm"><option value="" disabled>Select Grade</option>{gradeLabels.map((label, index) => { const grade = catalog.data?.grades.find((row: GradeOption) => row.name.replace(/\s+/g, " ").trim() === label); return <option key={label} value={grade?.id ?? `grade-${index + 7}`} disabled={!grade}>{label}{grade?.stream ? ` ${grade.stream}` : ""}</option>; })}</select></label>
      <label className="text-xs font-bold text-[#53675d]">Learner<select value={learnerId ?? ""} onChange={event => setLearnerId(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-white px-3 py-2.5 text-sm"><option value="" disabled>Select learner</option>{gradeLearners.map(row => <option key={row.id} value={row.id}>{row.admissionNumber} · {row.fullName}</option>)}</select></label>
      <label className="text-xs font-bold text-[#53675d]">Academic year<input type="number" min="2000" max="2100" value={academicYear} onChange={event => setAcademicYear(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-white px-3 py-2.5 text-sm" /></label>
      <label className="text-xs font-bold text-[#53675d]">Term<input value={term} onChange={event => setTerm(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-white px-3 py-2.5 text-sm" /></label>
      <label className="text-xs font-bold text-[#53675d]">Assessment type<select value={assessmentType} onChange={event => setAssessmentType(event.target.value as AssessmentType)} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-white px-3 py-2.5 text-sm"><option value="mid_term">Mid-Term</option><option value="end_term">End-Term</option></select></label>
    </section>
    {report.isLoading && <p className="text-sm text-[#718077]">Loading the report from current assessment records…</p>}
    {!result && !report.isLoading && <VisionSampleCard schoolName={settings.data?.schoolName ?? "VISION PRIMARY AND JUNIOR SCHOOLS"} gradeName={selectedGrade?.name ?? "Grade 7"} />}
    {result && <VisionReportCard result={result} assessmentType={assessmentType} term={term} academicYear={academicYear} status={status} mayComment={mayComment} classTeacherComment={classTeacherComment} headTeacherComment={headTeacherComment} setClassTeacherComment={setClassTeacherComment} setHeadTeacherComment={setHeadTeacherComment} saveComments={saveComments} />}
    {report.error && <p className="rounded-lg bg-[#fbf5e5] p-3 text-sm text-[#76591d]">{report.error.message.replaceAll("_", " ")}</p>}
  </div>;
}

function VisionReportCard({ result, assessmentType, term, academicYear, status, mayComment, classTeacherComment, headTeacherComment, setClassTeacherComment, setHeadTeacherComment, saveComments }: { result: any; assessmentType: AssessmentType; term: string; academicYear: number; status: string; mayComment: boolean; classTeacherComment: string; headTeacherComment: string; setClassTeacherComment: (value: string) => void; setHeadTeacherComment: (value: string) => void; saveComments: { mutate: (input: any) => void }; }) {
  const rows = result.marksheet ?? [];
  const values = rows.map((row: any) => ({ mid: row.midTerm ?? (assessmentType === "mid_term" ? row.score : null), end: row.endTerm ?? (assessmentType === "end_term" ? row.score : null), avg: row.average ?? row.score }));
  const totalMid = values.reduce((sum: number, row: any) => sum + (row.mid ?? 0), 0);
  const totalEnd = values.reduce((sum: number, row: any) => sum + (row.end ?? 0), 0);
  const average = values.filter((row: any) => row.avg != null).length ? Math.round(values.reduce((sum: number, row: any) => sum + (row.avg ?? 0), 0) / values.filter((row: any) => row.avg != null).length) : null;
  return <article className="report-card-print mx-auto max-w-5xl bg-white p-2 text-[#101052] shadow-sm sm:p-4" style={{ border: `4px solid ${MAGENTA}` }}>
    <VisionHeader schoolName={result.settings.schoolName} motto={result.settings.motto} />
    <div className="grid grid-cols-6 border-2 border-[#242477] text-[11px] font-bold sm:text-sm"><div className="col-span-3 border-b border-r border-[#242477] p-1">NAME <span className="ml-2 uppercase">{result.learner.fullName}</span></div><div className="col-span-3 border-b border-[#242477] p-1">GRADE <span className="ml-2">{result.grade?.name ?? "-"}</span></div><div className="col-span-3 border-r border-[#242477] p-1">STREAM <span className="ml-2">{result.grade?.stream ?? "-"}</span></div><div className="col-span-1 border-r border-[#242477] p-1">TERM</div><div className="col-span-2 p-1">{term.toUpperCase()} · {academicYear}</div></div>
    <table className="mt-2 w-full border-collapse text-[9px] font-semibold sm:text-xs"><thead><tr className="bg-[#ef16c6] text-white"><th className="border border-[#242477] p-1 text-left">Learning Area</th><th className="border border-[#242477] p-1">M-Term</th><th className="border border-[#242477] p-1">E-Term</th><th className="border border-[#242477] p-1">AVG</th><th className="border border-[#242477] p-1">Performance Level</th><th className="border border-[#242477] p-1">Facilitator</th></tr></thead><tbody>{rows.map((row: any, index: number) => <tr key={row.subject.id}><td className="border border-[#242477] p-1">{row.subject.name}</td><td className="border border-[#242477] p-1 text-center">{numeric(values[index].mid)}</td><td className="border border-[#242477] p-1 text-center">{numeric(values[index].end)}</td><td className="border border-[#242477] p-1 text-center">{numeric(values[index].avg)}</td><td className="border border-[#242477] p-1 text-center">{levelLabel(row.cbcLevel)}</td><td className="border border-[#242477] p-1 text-center">{row.teacherName ?? "-"}</td></tr>)}</tbody></table>
    <div className="grid grid-cols-4 border-2 border-t-0 border-[#242477] text-[9px] font-bold sm:text-xs"><div className="border-r border-[#242477] p-1">Total Scores</div><div className="border-r border-[#242477] p-1">{totalMid}/{rows.length * 100}</div><div className="border-r border-[#242477] p-1">{totalEnd}/{rows.length * 100}</div><div className="p-1">Termly Average: {average ?? "-"}/100</div></div>
    <PerformanceChart rows={rows} values={values} />
    <div className="mt-2 border-2 border-[#242477] text-[10px] sm:text-xs"><p className="border-b border-[#242477] p-1"><b>Class Teacher’s Comment:</b> {classTeacherComment || result.report?.classTeacherComment || "-"}</p><p className="p-1"><b>Head Teacher’s Comment:</b> {headTeacherComment || result.report?.headTeacherComment || "-"}</p></div>
    <div className="mt-2 border-t-2 border-[#242477] pt-1 text-center text-[9px] font-semibold sm:text-xs">This term closed on 01/08/{academicYear} · Next term opens on 25/08/{academicYear}</div>
    <div className="mt-2 flex items-center justify-between gap-2 print:hidden"><span className={`rounded px-2 py-1 text-xs font-bold ${status === "approved" || status === "locked" ? "bg-[#e7f0e7] text-[#1d6a57]" : "bg-[#f9efd8] text-[#966615]"}`}>{status}</span><div className="flex gap-2"><button type="button" onClick={() => window.print()} className="quiet-button"><Printer size={15} />Print / PDF</button>{mayComment && <button type="button" onClick={() => saveComments.mutate({ learnerId: result.learner.id, academicYear, term, assessmentType, classTeacherComment: classTeacherComment || null, headTeacherComment: headTeacherComment || null })} className="action-button">Save comments</button>}</div></div>
    {mayComment && <div className="mt-3 grid gap-2 print:hidden sm:grid-cols-2"><textarea value={classTeacherComment} onChange={event => setClassTeacherComment(event.target.value)} placeholder="Class teacher comment" className="min-h-16 w-full rounded border p-2 text-sm" /><textarea value={headTeacherComment} onChange={event => setHeadTeacherComment(event.target.value)} placeholder="Head teacher comment" className="min-h-16 w-full rounded border p-2 text-sm" /></div>}
  </article>;
}

function VisionHeader({ schoolName, motto }: { schoolName: string; motto?: string | null }) {
  return <header className="border-b-4 border-[#242477] text-center"><h2 className="text-lg font-black uppercase tracking-wide text-[#d000b9] sm:text-2xl">{schoolName || "VISION PRIMARY AND JUNIOR SCHOOLS"}</h2><div className="grid grid-cols-3 items-center py-1 text-[9px] sm:text-xs"><div className="text-left text-[#242477]">P.O. BOX 54 KENYA<br />school@school.co.ke<br />+254 700 000 000</div><div className="text-3xl">🏫</div><div className="text-right text-[#242477]">{motto || "Education for Excellence"}</div></div><h1 className="bg-[#ef16c6] py-1 text-base font-black text-white sm:text-2xl">LEARNER ASSESSMENT REPORT CARD</h1></header>;
}

function PerformanceChart({ rows, values }: { rows: any[]; values: any[] }) {
  return <section className="mt-2 border-2 border-[#242477] p-2"><h3 className="text-center text-base font-black text-[#242477] sm:text-xl">Performance Trend</h3><div className="flex h-36 items-end gap-2 border-b border-l border-[#242477] px-2 pb-1 sm:h-48 sm:gap-4">{rows.map((row, index) => { const mid = values[index]?.mid ?? 0; const end = values[index]?.end ?? 0; return <div key={row.subject.id} className="flex min-w-0 flex-1 items-end justify-center gap-0.5"><div className="w-2 bg-[#142ea5] sm:w-4" style={{ height: `${Math.max(3, Math.min(100, mid))}%` }} title={`M-Term ${mid}`} /><div className="w-2 bg-[#ed1c24] sm:w-4" style={{ height: `${Math.max(3, Math.min(100, end))}%` }} title={`E-Term ${end}`} /></div>; })}</div><div className="mt-1 flex justify-around text-[7px] font-semibold sm:text-[10px]">{rows.map(row => <span key={row.subject.id} className="max-w-14 rotate-[-35deg] truncate">{row.subject.name}</span>)}</div><div className="mt-4 flex justify-center gap-4 text-[9px] font-bold sm:text-xs"><span><i className="mr-1 inline-block h-2 w-2 bg-[#142ea5]" />M-Term</span><span><i className="mr-1 inline-block h-2 w-2 bg-[#ed1c24]" />E-Term</span></div></section>;
}

function VisionSampleCard({ schoolName, gradeName }: { schoolName: string; gradeName: string }) {
  const rows = ["Agriculture", "Creative Arts", "English", "Integrated Science", "Kiswahili", "Mathematics", "Pretechnical Studies", "Religious Education", "Social Studies"];
  const scores = [54, 58, 68, 70, 64, 50, 80, 78, 76];
  const values = scores.map((avg, index) => ({ mid: Math.max(33, avg - 8 + index), end: Math.max(34, avg - 3), avg }));
  return <article className="report-card-print mx-auto max-w-5xl bg-white p-2 text-[#101052] shadow-sm sm:p-4" style={{ border: `4px solid ${MAGENTA}` }}><VisionHeader schoolName={schoolName} motto="Education for Excellence" /><div className="grid grid-cols-6 border-2 border-[#242477] text-[11px] font-bold sm:text-sm"><div className="col-span-3 border-b border-r border-[#242477] p-1">NAME <span className="ml-2">MARYANN WANGECI</span></div><div className="col-span-3 border-b border-[#242477] p-1">GRADE <span className="ml-2">{gradeName}</span></div><div className="col-span-3 border-r border-[#242477] p-1">STREAM <span className="ml-2">G9A</span></div><div className="col-span-1 border-r border-[#242477] p-1">TERM</div><div className="col-span-2 p-1">TWO · 2025</div></div><table className="mt-2 w-full border-collapse text-[9px] font-semibold sm:text-xs"><thead><tr className="bg-[#ef16c6] text-white"><th className="border border-[#242477] p-1 text-left">Learning Area</th><th className="border border-[#242477] p-1">M-Term</th><th className="border border-[#242477] p-1">E-Term</th><th className="border border-[#242477] p-1">AVG</th><th className="border border-[#242477] p-1">Performance Level</th><th className="border border-[#242477] p-1">Facilitator</th></tr></thead><tbody>{rows.map((name, index) => <tr key={name}><td className="border border-[#242477] p-1">{name}</td><td className="border border-[#242477] p-1 text-center">{values[index].mid}</td><td className="border border-[#242477] p-1 text-center">{values[index].end}</td><td className="border border-[#242477] p-1 text-center">{values[index].avg}</td><td className="border border-[#242477] p-1 text-center">{index < 5 ? "Meeting Expectations 1" : "Exceeding Expectations 1"}</td><td className="border border-[#242477] p-1 text-center">Mr. Matenge</td></tr>)}</tbody></table><div className="grid grid-cols-4 border-2 border-t-0 border-[#242477] text-[9px] font-bold sm:text-xs"><div className="border-r border-[#242477] p-1">Total Scores</div><div className="border-r border-[#242477] p-1">628/900</div><div className="border-r border-[#242477] p-1">571/900</div><div className="p-1">Termly Average: 67/100</div></div><PerformanceChart rows={rows.map((name, id) => ({ subject: { id, name } }))} values={values} /><div className="mt-2 border-2 border-[#242477] text-[10px] sm:text-xs"><p className="border-b border-[#242477] p-1"><b>Class Teacher’s Comment:</b> Very good work. Meeting expectations, well done</p><p className="p-1"><b>Head Teacher’s Comment:</b> This performance has met expectations. Continue working.</p></div><p className="mt-2 bg-[#fbf5e5] p-2 text-center text-[10px] font-bold text-[#76591d]">Sample report-card layout preview. Select a Grade 7, Grade 8, or Grade 9 learner to load live marks.</p></article>;
}
