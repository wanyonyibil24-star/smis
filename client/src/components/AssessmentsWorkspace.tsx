import { useEffect, useMemo, useState } from "react";
import { Download, Printer, Save, Send, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { rankMarklistRows } from "@shared/marklist";
import { toast } from "sonner";

type AssessmentType = "mid_term" | "end_term";
type MarklistType = AssessmentType | "average";
type ViewMode = "entry" | "marklist";
const assessmentLabel = (type: AssessmentType) => type === "mid_term" ? "Mid-Term" : "End-Term";
const marklistLabel = (type: MarklistType) => type === "average" ? "Average" : assessmentLabel(type);
const scopeKey = (scope: { academicYear: number; term: string; gradeId: number; subjectId: number }) => `${scope.academicYear}:${scope.term}:${scope.gradeId}:${scope.subjectId}`;
const LEVEL_POINTS: Record<string, number> = { EE1: 8, EE2: 7, ME1: 6, ME2: 5, AE1: 4, AE2: 3, BE1: 2, BE2: 1 };
const levelPoints = (level: string | null) => level ? LEVEL_POINTS[level] ?? null : null;
const levelForScore = (score: number | null) => score === null ? null : score >= 90 ? "EE1" : score >= 75 ? "EE2" : score >= 58 ? "ME1" : score >= 41 ? "ME2" : score >= 31 ? "AE1" : score >= 21 ? "AE2" : score >= 11 ? "BE1" : "BE2";
const formatNumber = (value: number | null, digits = 2) => value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits);

export function AssessmentsWorkspace({ canReview = false }: { canReview?: boolean }) {
  const [mode, setMode] = useState<ViewMode>("entry");
  const reviewAccess = trpc.smis.assessments.reviewAccess.useQuery();
  const mayReview = canReview || reviewAccess.data === true;
  const catalog = trpc.smis.people.catalog.useQuery(undefined, { enabled: mayReview });
  const [newGrade, setNewGrade] = useState("");
  const [newStream, setNewStream] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newSubjectCode, setNewSubjectCode] = useState("");
  const [assessmentType, setAssessmentType] = useState<AssessmentType>("mid_term");
  const [marklistType, setMarklistType] = useState<MarklistType>("mid_term");
  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [assessmentId, setAssessmentId] = useState<number | null>(null);
  const [draftScores, setDraftScores] = useState<Record<number, string>>({});
  const scopes = trpc.smis.assessments.scopes.useQuery();
  const utils = trpc.useUtils();
  const scope = useMemo(() => scopes.data?.find(row => scopeKey(row) === selectedScopeKey), [scopes.data, selectedScopeKey]);
  const entry = trpc.smis.assessments.entries.useQuery({ assessmentId: assessmentId ?? 0 }, { enabled: assessmentId !== null });
  const marklist = trpc.smis.assessments.classMarklist.useQuery({
    academicYear: scope?.academicYear ?? 2026,
    term: scope?.term ?? "Term 1",
    assessmentType: marklistType,
    gradeId: scope?.gradeId ?? 0,
  }, { enabled: mode === "marklist" && Boolean(scope) });
  const openAssessment = trpc.smis.assessments.open.useMutation({
    onSuccess: async assessment => {
      setAssessmentId(assessment.id);
      await utils.smis.assessments.entries.invalidate();
      toast.success("Assessment roster loaded", { description: `${assessmentLabel(assessmentType)} · ${scope?.term} ${scope?.academicYear}` });
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const saveRows = trpc.smis.assessments.saveRows.useMutation({
    onSuccess: async result => {
      toast.success(`${result.rowsUpdated} learner rows saved`);
      await Promise.all([utils.smis.assessments.entries.invalidate(), utils.smis.assessments.classMarklist.invalidate()]);
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const submit = trpc.smis.assessments.submit.useMutation({
    onSuccess: async () => {
      toast.success("Marks submitted for verification");
      await Promise.all([utils.smis.assessments.entries.invalidate(), utils.smis.assessments.classMarklist.invalidate()]);
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const finalize = trpc.smis.assessments.setFinalState.useMutation({
    onSuccess: async result => {
      toast.success(`Assessment ${result.status}`);
      await Promise.all([utils.smis.assessments.entries.invalidate(), utils.smis.assessments.classMarklist.invalidate()]);
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const correct = trpc.smis.assessments.correctLockedMark.useMutation({
    onSuccess: async () => {
      toast.success("Locked mark corrected and audit recorded");
      await Promise.all([utils.smis.assessments.entries.invalidate(), utils.smis.assessments.classMarklist.invalidate()]);
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const createGrade = trpc.smis.settings.createGrade.useMutation({
    onSuccess: async () => {
      toast.success("Class saved"); setNewGrade(""); setNewStream("");
      await Promise.all([utils.smis.people.catalog.invalidate(), utils.smis.assessments.scopes.invalidate()]);
    }, onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const createSubject = trpc.smis.settings.createSubject.useMutation({
    onSuccess: async () => {
      toast.success("Learning area saved"); setNewSubject(""); setNewSubjectCode("");
      await Promise.all([utils.smis.people.catalog.invalidate(), utils.smis.assessments.scopes.invalidate()]);
    }, onError: error => toast.error(error.message.replaceAll("_", " ")),
  });

  useEffect(() => {
    if (!scopes.data?.length) return;
    if (!selectedScopeKey || !scopes.data.some(row => scopeKey(row) === selectedScopeKey)) {
      setSelectedScopeKey(scopeKey(scopes.data[0]));
      setAssessmentId(null);
    }
  }, [scopes.data, selectedScopeKey]);
  useEffect(() => {
    if (!entry.data) return;
    setDraftScores(Object.fromEntries(entry.data.learners.map(row => [row.learnerId, row.score == null ? "" : String(row.score)])));
  }, [entry.data]);

  const markRows = entry.data?.learners ?? [];
  const missing = markRows.filter(row => (draftScores[row.learnerId] ?? (row.score == null ? "" : String(row.score))).trim() === "").length;
  const isEditable = entry.data?.assessment.status === "draft" || entry.data?.assessment.status === "submitted" && canReview;

  const selectScope = (value: string) => { setSelectedScopeKey(value); setAssessmentId(null); setDraftScores({}); };
  const openSelected = () => {
    if (!scope) return;
    openAssessment.mutate({ academicYear: scope.academicYear, term: scope.term, assessmentType, gradeId: scope.gradeId, subjectId: scope.subjectId });
  };
  const persistRows = () => {
    if (!entry.data) return;
    const rows = entry.data.learners.map(row => {
      const raw = (draftScores[row.learnerId] ?? (row.score == null ? "" : String(row.score))).trim();
      const score = raw === "" ? null : Number(raw);
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error(`Invalid mark for ${row.fullName}; enter 0–100 or leave blank.`);
      return { learnerId: row.learnerId, score, teacherRemark: row.teacherRemark || null };
    });
    saveRows.mutate({ assessmentId: entry.data.assessment.id, rows });
  };
  const exportExcel = async () => {
    if (!marklist.data || !printRows) return;
    const XLSX = await import("xlsx");
    const data = marklist.data;
    const headings = ["S.No.", "ADM No.", "STUDENT NAME", "ASS NO", "STREAM", "STREAM POS", "OVERALL POS", "PRV STR POS", "PRV OVR POS", ...data.subjects.map(subject => subject.code || subject.name), "SUB. ENTRY", "TOTAL MARKS", "AVG MARKS", "TOTAL POINTS", "AVG POINTS", "LEVEL"];
    const rows = printRows.map(({ learner, position, totalPoints, averagePoints, level }, index) => [index + 1, learner.admissionNumber, learner.fullName, "", data.grade.stream || "—", position ?? "", position ?? "", "—", "—", ...learner.marks.map(mark => mark.score === null ? "X" : `${formatNumber(mark.score)} ${levelForScore(mark.score)}`), learner.enteredCount, learner.total ?? "—", learner.average ?? "—", totalPoints, averagePoints ?? "—", level ?? "—"]);
    const summaryMarks = Array(15 + data.subjects.length).fill("");
    const summaryPoints = Array(15 + data.subjects.length).fill("");
    summaryMarks[0] = "SUBJECT AVG. MARKS";
    summaryPoints[0] = "SUBJECT AVG. POINTS";
    subjectSummary.forEach((item, index) => { summaryMarks[9 + index] = item.averageMark ?? "—"; summaryPoints[9 + index] = item.averagePoints ?? "—"; });
    summaryMarks[9 + data.subjects.length] = "CLASS AVG";
    summaryMarks[10 + data.subjects.length] = averageClassMark ?? "—";
    summaryPoints[9 + data.subjects.length] = "CLASS AVG";
    summaryPoints[10 + data.subjects.length] = averageClassPoints ?? "—";
    const sheet = XLSX.utils.aoa_to_sheet([headings, ...rows, [], summaryMarks, summaryPoints]);
    sheet["!cols"] = headings.map((_, index) => ({ wch: index === 2 ? 27 : index < 2 ? 12 : 10 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, `${marklistLabel(marklistType)} Marklist`);
    XLSX.writeFile(book, `NEXUS-${data.grade.name}-${data.academicYear}-${marklistType}.xlsx`);
  };
  const correctLocked = (assessmentId: number, learnerId: number, fullName: string, current: number | null) => {
    const proposed = window.prompt(`Correct mark for ${fullName} (current: ${current ?? "missing"}; 0–100):`, current == null ? "" : String(current));
    if (proposed === null) return;
    const score = Number(proposed);
    if (!Number.isFinite(score) || score < 0 || score > 100) { toast.error("Mark must be between 0 and 100"); return; }
    const reason = window.prompt("Enter the reason for this post-lock correction (minimum 10 characters):");
    if (reason === null) return;
    correct.mutate({ assessmentId, learnerId, score, reason });
  };
  const printRows = useMemo(() => {
    if (!marklist.data) return null;
    return rankMarklistRows(marklist.data.learners).map(({ position, ...learner }) => {
      const totalPoints = learner.marks.reduce((sum, mark) => sum + (levelPoints(mark.score === null ? null : levelForScore(mark.score)) ?? 0), 0);
      return { learner, position, totalPoints, averagePoints: learner.enteredCount ? Math.round((totalPoints / learner.enteredCount) * 100) / 100 : null, level: levelForScore(learner.average) };
    });
  }, [marklist.data]);
  const subjectSummary = useMemo(() => marklist.data?.subjects.map((subject, index) => {
    const scores = marklist.data!.learners.map(learner => learner.marks[index]?.score).filter((score): score is number => score !== undefined && score !== null);
    const points = marklist.data!.learners.map(learner => levelPoints(learner.marks[index]?.score == null ? null : levelForScore(learner.marks[index]!.score))).filter((point): point is number => point !== null);
    return {
      subject,
      averageMark: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100 : null,
      averagePoints: points.length ? Math.round((points.reduce((sum, point) => sum + point, 0) / points.length) * 100) / 100 : null,
    };
  }) ?? [], [marklist.data]);
  const classAverages = printRows?.map(row => row.learner.average).filter((score): score is number => score !== null) ?? [];
  const averageClassMark = classAverages.length ? classAverages.reduce((sum, score) => sum + score, 0) / classAverages.length : null;
  const classPointAverages = printRows?.map(row => row.averagePoints).filter((point): point is number => point !== null) ?? [];
  const averageClassPoints = classPointAverages.length ? classPointAverages.reduce((sum, point) => sum + point, 0) / classPointAverages.length : null;

  return <div className="assessment-workspace page-enter space-y-5">
    <header className="flex flex-col gap-4 border-b border-[#dfdbd1] pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="eyebrow">Assessments · single source of truth</p><h1 className="mt-1 font-editorial text-3xl text-[#193d32]">Mark entry & class marklist</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#69796f]">Marks are linked to year, term, assessment type, class, subject and allocated teacher. Report cards read directly from these records.</p></div>
      <div className="flex gap-2"><button type="button" className={`quiet-button ${mode === "entry" ? "bg-[#e7f0e7] text-[#1d6a57]" : ""}`} onClick={() => setMode("entry")}>Teacher entry</button><button type="button" className={`quiet-button ${mode === "marklist" ? "bg-[#e7f0e7] text-[#1d6a57]" : ""}`} onClick={() => setMode("marklist")}>Class marklist</button></div>
    </header>
    <section className="soft-card grid gap-3 rounded-xl p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <label className="text-xs font-bold text-[#53675d]">Allocated class & subject<select value={selectedScopeKey} onChange={event => selectScope(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-[#fffefa] px-3 py-2.5 text-sm">
        {!scopes.data?.length && <option value="">No active teacher allocations</option>}
        {scopes.data?.map(row => <option key={scopeKey(row)} value={scopeKey(row)}>{row.gradeName}{row.gradeStream ? ` ${row.gradeStream}` : ""} · {row.subjectName} · {row.term} {row.academicYear} · {row.teacherName}</option>)}
      </select></label>
      {mode === "entry" ? <label className="text-xs font-bold text-[#53675d]">Assessment type<select value={assessmentType} onChange={event => { setAssessmentType(event.target.value as AssessmentType); setAssessmentId(null); }} className="mt-2 w-full rounded-lg border border-[#d8ded7] bg-[#fffefa] px-3 py-2.5 text-sm"><option value="mid_term">Mid-Term</option><option value="end_term">End-Term</option></select></label> : <div className="text-xs text-[#718077]">Choose Mid-Term, End-Term, or Average below.</div>}
      {mode === "entry" && <button type="button" onClick={openSelected} disabled={!scope || openAssessment.isPending} className="action-button justify-center disabled:opacity-50">{openAssessment.isPending ? "Loading…" : "Load learner roster"}</button>}
    </section>
    {!scopes.isLoading && !scopes.data?.length && <section className="rounded-xl border border-dashed border-[#ccd8ce] bg-[#f7f8f3] p-5">
      <h2 className="font-bold text-[#28483f]">No active teacher allocations</h2>
      <p className="mt-1 max-w-3xl text-sm text-[#718077]">Assessment scopes come from existing classes, learning areas, staff and teacher allocations. No sample results are generated. Add the missing master data below, then add staff and learners in People and create allocations.</p>
      {mayReview && (!catalog.data?.grades.length || !catalog.data?.subjects.length) && <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {!catalog.data?.grades.length && <form onSubmit={event => { event.preventDefault(); if (newGrade.trim()) createGrade.mutate({ name: newGrade.trim(), stream: newStream.trim() || null }); }} className="rounded-lg border border-[#e1e5de] bg-white p-4">
          <h3 className="text-sm font-bold text-[#28483f]">Add class / grade</h3><label className="mt-3 block text-xs font-semibold text-[#53675d]">Grade or class name<input required maxLength={80} value={newGrade} onChange={event => setNewGrade(event.target.value)} className="mt-1 w-full rounded-md border border-[#d8ded7] px-3 py-2" placeholder="Grade 7" /></label><label className="mt-3 block text-xs font-semibold text-[#53675d]">Stream (optional)<input maxLength={80} value={newStream} onChange={event => setNewStream(event.target.value)} className="mt-1 w-full rounded-md border border-[#d8ded7] px-3 py-2" placeholder="East" /></label><button className="action-button mt-3" disabled={createGrade.isPending}>Save class</button>
        </form>}
        {!catalog.data?.subjects.length && <form onSubmit={event => { event.preventDefault(); if (newSubject.trim() && newSubjectCode.trim()) createSubject.mutate({ name: newSubject.trim(), code: newSubjectCode.trim() }); }} className="rounded-lg border border-[#e1e5de] bg-white p-4">
          <h3 className="text-sm font-bold text-[#28483f]">Add learning area</h3><label className="mt-3 block text-xs font-semibold text-[#53675d]">Subject / learning area<input required maxLength={120} value={newSubject} onChange={event => setNewSubject(event.target.value)} className="mt-1 w-full rounded-md border border-[#d8ded7] px-3 py-2" placeholder="Mathematics" /></label><label className="mt-3 block text-xs font-semibold text-[#53675d]">Short code<input required maxLength={30} value={newSubjectCode} onChange={event => setNewSubjectCode(event.target.value)} className="mt-1 w-full rounded-md border border-[#d8ded7] px-3 py-2 uppercase" placeholder="MATH" /></label><button className="action-button mt-3" disabled={createSubject.isPending}>Save learning area</button>
        </form>}
      </div>}
    </section>}

    {mode === "entry" && <>
      {entry.isFetching && <p className="text-sm text-[#718077]">Loading class roster…</p>}
      {entry.data && <>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#cfe0d3] bg-[#e7f0e7] p-4 text-sm text-[#315c4c]">
          <div><b>{entry.data.assessment.title}</b><span className="ml-2 rounded-full bg-white/75 px-2 py-1 text-xs font-bold capitalize">{entry.data.assessment.status}</span><p className="mt-1 text-xs">{assessmentLabel(assessmentType)} · {entry.data.assessment.term} {entry.data.assessment.academicYear} · {entry.data.learners.length - missing}/{entry.data.learners.length} marks entered · {missing} missing</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!isEditable || saveRows.isPending} onClick={() => { try { persistRows(); } catch (error) { toast.error(error instanceof Error ? error.message : "Check the marks"); } }} className="action-button"><Save size={15} />Save marks</button>
            {entry.data.assessment.status === "draft" && <button type="button" disabled={missing > 0 || submit.isPending} onClick={() => submit.mutate({ assessmentId: entry.data!.assessment.id })} className="action-button disabled:opacity-50"><Send size={15} />Submit for verification</button>}
            {mayReview && entry.data.assessment.status === "submitted" && <button type="button" onClick={() => finalize.mutate({ assessmentId: entry.data!.assessment.id, status: "approved" })} className="action-button"><ShieldCheck size={15} />Approve</button>}
            {mayReview && entry.data.assessment.status === "approved" && <button type="button" onClick={() => finalize.mutate({ assessmentId: entry.data!.assessment.id, status: "locked" })} className="action-button">Lock assessment</button>}
          </div>
        </section>
        <div className="overflow-x-auto rounded-xl border border-[#e7e2d7] bg-[#fffefa]"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#edf2ed] text-[.67rem] uppercase tracking-wider text-[#53675d]"><tr><th className="p-3">Admission No.</th><th className="p-3">Learner</th><th className="p-3">Mark / 100</th><th className="p-3">Status</th><th className="p-3">Performance</th></tr></thead><tbody>{entry.data.learners.map(row => {
          const raw = draftScores[row.learnerId] ?? (row.score == null ? "" : String(row.score));
          const score = raw.trim() === "" ? null : Number(raw);
          const invalid = raw.trim() !== "" && (!Number.isFinite(score) || score! < 0 || score! > 100);
          return <tr key={row.learnerId} className="border-t border-[#eee9df]"><td className="p-3 font-mono text-xs">{row.admissionNumber}</td><td className="p-3 font-semibold text-[#28483f]">{row.fullName}</td><td className="p-3"><input aria-label={`Mark for ${row.fullName}`} disabled={!isEditable} type="number" min="0" max="100" step="0.01" value={raw} onChange={event => setDraftScores(current => ({ ...current, [row.learnerId]: event.target.value }))} className={`w-28 rounded-md border bg-[#fbfaf5] px-2.5 py-2 outline-none focus:border-[#1d6a57] disabled:opacity-60 ${invalid ? "border-red-600" : "border-[#d8ded7]"}`} /></td><td className="p-3">{invalid ? <span className="text-xs font-bold text-red-700">Invalid</span> : score === null ? <span className="rounded-full bg-[#f9efd8] px-2 py-1 text-xs font-bold text-[#966615]">Missing</span> : <span className="rounded-full bg-[#e7f0e7] px-2 py-1 text-xs font-bold text-[#1d6a57]">Entered</span>}</td><td className="p-3 text-xs text-[#718077]">{score === null || invalid ? "—" : `${score}%`}</td></tr>;
        })}</tbody></table></div>
      </>}
    </>}

    {mode === "marklist" && <>
      <div className="print-heading hidden text-center">
        <p className="text-[9pt] font-bold uppercase tracking-[.18em]">NEXUS · School Assessment Record</p>
        <h2 className="mt-1 text-[18pt] font-black uppercase">{marklist.data?.schoolName}</h2>
        <p className="mt-1 text-[10pt] font-semibold">{marklist.data?.grade.name}{marklist.data?.grade.stream ? ` · ${marklist.data.grade.stream}` : ""} · {marklist.data?.academicYear} · {marklist.data?.term} · {marklistLabel(marklistType)} Marklist</p>
      </div>
      <section className="print:hidden flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e7e2d7] bg-[#fffefa] p-4">
        <div><p className="text-sm font-bold text-[#28483f]">{marklist.data?.schoolName ?? "Class Marklist"} · {marklist.data?.grade.name}{marklist.data?.grade.stream ? ` ${marklist.data.grade.stream}` : ""}</p><p className="text-xs text-[#718077]">{marklist.data?.term} {marklist.data?.academicYear} · {marklistLabel(marklistType)} · {marklist.data?.missingCount ?? 0} missing cells</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-[#edf2ed] p-1" role="group" aria-label="Choose marklist type">
            {(["mid_term", "end_term", "average"] as const).map(type => <button key={type} type="button" aria-pressed={marklistType === type} onClick={() => setMarklistType(type)} className={`rounded-md px-3 py-2 text-xs font-bold transition ${marklistType === type ? "bg-[#1d6a57] text-white shadow-sm" : "text-[#53675d] hover:bg-white"}`}>{marklistLabel(type)}</button>)}
          </div>
          <button type="button" onClick={() => window.print()} className="quiet-button"><Printer size={15} />Print / PDF</button>
          <button type="button" onClick={exportExcel} className="action-button"><Download size={15} />Excel</button>
        </div>
      </section>
      {marklist.data && printRows && <div className="marklist-print overflow-x-auto rounded-xl border border-[#e7e2d7] bg-white">
        <table className="w-full min-w-[1380px] border-collapse text-[10px] leading-tight">
          <thead className="bg-[#e9e8e2] text-[#333]">
            <tr>
              <th className="border border-[#a9a89f] px-1 py-1.5">S.No</th><th className="border border-[#a9a89f] px-1 py-1.5">ADM No.</th><th className="min-w-40 border border-[#a9a89f] px-1.5 py-1.5 text-left">STUDENT NAME</th><th className="border border-[#a9a89f] px-1 py-1.5">ASS NO</th><th className="border border-[#a9a89f] px-1 py-1.5">STREAM</th><th className="border border-[#a9a89f] px-1 py-1.5">STREAM POS</th><th className="border border-[#a9a89f] px-1 py-1.5">OVERALL POS</th><th className="border border-[#a9a89f] px-1 py-1.5">PRV STR POS</th><th className="border border-[#a9a89f] px-1 py-1.5">PRV OVR POS</th>
              {marklist.data.subjects.map(subject => <th key={subject.id} title={subject.name} className="min-w-[48px] border border-[#a9a89f] px-1 py-1.5">{subject.code || subject.name}</th>)}
              <th className="border border-[#a9a89f] px-1 py-1.5">SUB.<br/>ENTRY</th><th className="border border-[#a9a89f] px-1 py-1.5">TOTAL<br/>MARKS</th><th className="border border-[#a9a89f] px-1 py-1.5">AVG<br/>MARKS</th><th className="border border-[#a9a89f] px-1 py-1.5">TOTAL<br/>POINTS</th><th className="border border-[#a9a89f] px-1 py-1.5">AVG<br/>POINTS</th><th className="border border-[#a9a89f] px-1 py-1.5">LEVEL</th>
            </tr>
          </thead>
          <tbody>{printRows.map(({ learner, position, totalPoints, averagePoints, level }, index) => <tr key={learner.learnerId} className="even:bg-[#f8f7f3]">
            <td className="border border-[#c9c8bf] px-1 py-1 text-center">{index + 1}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center font-mono">{learner.admissionNumber}</td><td className="border border-[#c9c8bf] px-2 py-1 font-semibold">{learner.fullName}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">—</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{marklist.data!.grade.stream || "—"}</td>
            <td className="border border-[#c9c8bf] px-1 py-1 text-center">{position ?? "—"}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{position ?? "—"}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">—</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">—</td>
            {learner.marks.map(mark => <td key={mark.subjectId} className="border border-[#c9c8bf] px-1 py-1 text-center">{mark.score === null ? "X" : `${formatNumber(mark.score)} ${levelForScore(mark.score)}`}</td>)}
            <td className="border border-[#c9c8bf] px-1 py-1 text-center">{learner.enteredCount}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{formatNumber(learner.total)}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{formatNumber(learner.average)}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{totalPoints}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center">{formatNumber(averagePoints)}</td><td className="border border-[#c9c8bf] px-1 py-1 text-center font-bold">{level ?? "—"}</td>
          </tr>)}</tbody>
        </table>
        <div className="marklist-summary mt-4 flex flex-wrap items-end justify-between gap-4">
          <table className="border-collapse text-[10px]">
            <thead><tr><th className="border border-[#a9a89f] px-2 py-1.5 text-left">SUBJECT</th>{subjectSummary.map(row => <th key={row.subject.id} className="border border-[#a9a89f] px-2 py-1.5">{row.subject.code || row.subject.name}</th>)}</tr></thead>
            <tbody>
              <tr><th className="border border-[#a9a89f] px-2 py-1.5 text-left">AVG. MARKS</th>{subjectSummary.map(row => <td key={row.subject.id} className="border border-[#a9a89f] px-2 py-1.5 text-center">{row.averageMark === null ? "—" : `${formatNumber(row.averageMark)}%`}</td>)}</tr>
              <tr><th className="border border-[#a9a89f] px-2 py-1.5 text-left">AVG. POINTS</th>{subjectSummary.map(row => <td key={row.subject.id} className="border border-[#a9a89f] px-2 py-1.5 text-center">{row.averagePoints === null ? "—" : `${formatNumber(row.averagePoints, 4)} ${levelForScore(row.averageMark) ?? ""}`}</td>)}</tr>
            </tbody>
          </table>
          <p className="generated-on text-right text-[9px] text-[#555]">Report generated on: {new Date().toLocaleString()}</p>
        </div>
      </div>}
      {mayReview && marklistType !== "average" && marklist.data && marklist.data.subjects.map(subject => subject.assessmentId && subject.status === "submitted" ? <div key={subject.id} className="flex items-center justify-between border-t p-2 text-xs print:hidden"><span>{subject.name} · submitted</span><button type="button" onClick={() => finalize.mutate({ assessmentId: subject.assessmentId!, status: "approved" })} className="quiet-button">Approve</button></div> : null)}
      {mayReview && marklistType !== "average" && marklist.data && marklist.data.subjects.map(subject => subject.assessmentId && subject.status === "approved" ? <div key={subject.id} className="flex items-center justify-between border-t p-2 text-xs print:hidden"><span>{subject.name} · approved</span><button type="button" onClick={() => finalize.mutate({ assessmentId: subject.assessmentId!, status: "locked" })} className="quiet-button">Lock</button></div> : null)}
      {mayReview && marklistType !== "average" && marklist.data && marklist.data.subjects.filter(subject => subject.assessmentId && subject.status === "locked").map(subject => <details key={subject.id} className="border-t p-2 text-xs print:hidden"><summary className="cursor-pointer font-bold">Correct a locked {subject.name} mark (reason required)</summary><div className="mt-2 flex flex-wrap gap-2">{marklist.data!.learners.map(learner => <button key={learner.learnerId} type="button" onClick={() => correctLocked(subject.assessmentId!, learner.learnerId, learner.fullName, learner.marks.find(mark => mark.subjectId === subject.id)?.score ?? null)} className="rounded border px-2 py-1">{learner.admissionNumber} · {learner.fullName}</button>)}</div></details>)}
      {marklist.isLoading && <p className="text-sm text-[#718077]">Loading comprehensive marklist…</p>}
      {marklist.error && <p className="rounded-lg bg-[#fbf5e5] p-3 text-sm text-[#76591d]">{marklist.error.message.replaceAll("_", " ")}</p>}
    </>}
    <p className="text-xs leading-5 text-[#718077]">Missing scores remain blank and are never treated as zero. Corrections update the same mark used by the marklist and report card.</p>
  </div>;
}
