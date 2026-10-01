import { useMemo, useState } from "react";
import { CalendarDays, Check, Download, FileCheck2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Checkbox } from "@/components/ui/checkbox";
import { attendanceGradeLevel, attendanceGradeLevels, type AttendanceGradeLevel, type AttendanceStatus } from "../../../shared/attendance";

const statusLabel: Record<AttendanceStatus, string> = { present: "Present", absent: "Absent", late: "Late", excused: "Excused" };
const statusStyle: Record<AttendanceStatus, string> = {
  present: "bg-[#e5f1e8] text-[#1d6a57] border-[#bed9c4]",
  absent: "bg-[#f8e8e5] text-[#9c4038] border-[#e8bcb6]",
  late: "bg-[#f9efd8] text-[#966615] border-[#ebd7a9]",
  excused: "bg-[#eaf0f5] text-[#526d83] border-[#d0dce5]",
};
const today = () => new Date().toISOString().slice(0, 10);
const summaryLabels = { weekly: "Weekly", monthly: "Monthly", termly: "Termly", yearly: "Yearly" } as const;

type Session = "morning" | "afternoon";
type SummaryPeriod = keyof typeof summaryLabels;

export function AttendanceWorkspace() {
  const [date, setDate] = useState(today);
  const [gradeLevel, setGradeLevel] = useState<AttendanceGradeLevel>(7);
  const [session, setSession] = useState<Session>("morning");
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("weekly");
  const [draft, setDraft] = useState<Record<number, AttendanceStatus | "">>({});
  const utils = trpc.useUtils();
  const settings = trpc.smis.settings.get.useQuery();
  const roster = trpc.smis.attendance.register.useQuery({ date, session });
  const rows = roster.data ?? [];
  const visibleRows = useMemo(() => rows.filter(row => attendanceGradeLevel(row.grade) === gradeLevel), [rows, gradeLevel]);
  const selectedGradeId = visibleRows[0]?.gradeId ?? 0;
  const approval = trpc.smis.attendance.approval.useQuery({ date, gradeId: selectedGradeId }, { enabled: selectedGradeId > 0 });
  const summary = trpc.smis.attendance.summary.useQuery({ period: summaryPeriod, gradeLevel });
  const save = trpc.smis.attendance.saveBatch.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.smis.attendance.register.invalidate(), utils.smis.attendance.approval.invalidate(), utils.smis.snapshot.invalidate()]);
      setDraft(current => { const next = { ...current }; visibleRows.forEach(row => { delete next[row.id]; }); return next; });
      toast.success(`Saved ${session} attendance for ${result.savedCount} learners`);
    },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const setApproval = trpc.smis.attendance.setApproval.useMutation({
    onSuccess: async result => { await approval.refetch(); toast.success(`Register ${result.status}`); },
    onError: error => toast.error(error.message.replaceAll("_", " ")),
  });
  const getStatus = (row: (typeof rows)[number]): AttendanceStatus | "" => draft[row.id] ?? (row.attendanceStatus as AttendanceStatus | null) ?? "";
  const counts = visibleRows.reduce((acc, row) => { const status = getStatus(row); if (status) acc[status] += 1; return acc; }, { present: 0, absent: 0, late: 0, excused: 0 });
  const pendingRows = visibleRows.filter(row => getStatus(row) !== ((row.attendanceStatus as AttendanceStatus | null) ?? ""));
  const allPresentState: boolean | "indeterminate" = visibleRows.length > 0 && counts.present === visibleRows.length ? true : counts.present > 0 ? "indeterminate" : false;
  const setAllPresent = (checked: boolean | "indeterminate") => setDraft(current => { const next = { ...current }; visibleRows.forEach(row => { next[row.id] = checked === true ? "present" : ((row.attendanceStatus as AttendanceStatus | null) ?? ""); }); return next; });
  const saveRegister = () => {
    const entries = visibleRows.map(row => ({ learnerId: row.id, status: getStatus(row) })).filter((entry): entry is { learnerId: number; status: AttendanceStatus } => entry.status !== "");
    if (!entries.length) { toast.error("Mark at least one learner before saving"); return; }
    save.mutate({ attendanceDate: date, session, entries });
  };
  const downloadRegister = () => {
    const csv = [["Attendance date", "Session", "Admission No.", "Learner", "Class", "Status", "Captured at"], ...visibleRows.map(row => [date, session, row.admissionNumber, row.fullName, row.grade, getStatus(row) || "Not marked", row.capturedAt ? new Date(row.capturedAt).toLocaleString("en-KE") : ""])].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `attendance-${session}-grade-${gradeLevel}-${date}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const printRegister = () => window.print();
  const status = approval.data?.status ?? "draft";
  const canSubmit = status === "draft" || status === "reopened";
  const canApprove = status === "submitted";
  const totalSessions = summary.data?.totals.sessions ?? 0;
  const attendanceRate = totalSessions ? Math.round(((summary.data?.totals.present ?? 0) / totalSessions) * 100) : 0;

  return <div className="attendance-workspace page-enter space-y-6">
    <div className="attendance-print-heading print-heading hidden">
      <div className="flex items-center justify-center gap-4 border-b-2 border-[#1d6a57] pb-3">{settings.data?.logoPath && <img src={settings.data.logoPath} alt="School logo" className="h-16 w-16 object-contain" />}<div><p className="text-[9pt] font-bold uppercase tracking-[.18em] text-[#1d6a57]">{settings.data?.schoolName ?? "Ebunangwe Junior School"}</p><h2 className="text-[18pt] font-black uppercase">Learner Attendance Register</h2><p className="text-[10pt] font-semibold">Grade {gradeLevel} · {date} · {session === "morning" ? "Present Morning" : "Present Afternoon"}</p></div></div>
    </div>
    <header className="print:hidden flex flex-col gap-4 border-b border-[#dfdbd1] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Daily register · persistent school records</p><h1 className="mt-1 font-editorial text-3xl text-[#193d32]">Learner attendance</h1><p className="mt-2 text-sm text-[#69796f]">Capture both daily sessions, submit the register for approval, and review attendance trends by period.</p></div>
      <label className="text-xs font-bold text-[#53675d]">Register date<div className="mt-1 flex items-center gap-2 rounded-lg border border-[#d8ded7] bg-white px-3"><CalendarDays size={15} className="text-[#1d6a57]" /><input type="date" disabled={save.isPending} value={date} onChange={event => { setDate(event.target.value); setDraft({}); }} className="py-2.5 text-sm outline-none disabled:opacity-60" /></div></label>
    </header>
    <section className="print:hidden flex flex-wrap items-center gap-2 rounded-xl border border-[#d8ded7] bg-[#fffefa] p-2"><span className="px-2 text-xs font-bold uppercase tracking-wider text-[#718077]">Session</span>{(["morning", "afternoon"] as const).map(value => <button key={value} type="button" onClick={() => { setSession(value); setDraft({}); }} aria-pressed={session === value} className={`rounded-lg px-4 py-2 text-sm font-bold ${session === value ? "bg-[#1d6a57] text-white" : "text-[#53675d] hover:bg-[#edf2ed]"}`}>{value === "morning" ? "Present Morning" : "Present Afternoon"}</button>)}</section>
    <section className="print:hidden grid grid-cols-3 gap-3" aria-label="Choose grade">{attendanceGradeLevels.map(level => { const count = rows.filter(row => attendanceGradeLevel(row.grade) === level).length; const active = gradeLevel === level; return <button key={level} type="button" disabled={save.isPending} aria-pressed={active} onClick={() => setGradeLevel(level)} className={`rounded-xl border px-3 py-4 text-left transition ${active ? "border-[#1d6a57] bg-[#e8f0e9] shadow-sm" : "border-[#e0ddd3] bg-[#fffefa] hover:border-[#a8c4b2]"}`}><span className="block text-sm font-extrabold text-[#193d32]">Grade {level}</span><span className="mt-1 block text-xs text-[#718077]">{count} learners in register</span></button>; })}</section>
    <section className="print:hidden grid grid-cols-2 gap-3 sm:grid-cols-5">{(["present", "absent", "late", "excused"] as const).map(value => <div key={value} className="soft-card rounded-xl p-4"><p className="text-xs font-bold text-[#718077]">{statusLabel[value]}</p><p className="mt-2 text-2xl font-bold text-[#193d32]">{counts[value]}</p></div>)}<div className="soft-card rounded-xl p-4"><p className="text-xs font-bold text-[#718077]">Not marked</p><p className="mt-2 text-2xl font-bold text-[#193d32]">{Math.max(visibleRows.length - counts.present - counts.absent - counts.late - counts.excused, 0)}</p></div></section>
    <section className="attendance-register-paper overflow-hidden rounded-xl border border-[#e7e2d7] bg-[#fffefa]">
      <div className="print:hidden flex flex-col gap-3 border-b border-[#e7e2d7] bg-[#f8f7f1] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Checkbox id="mark-grade-present" checked={allPresentState} disabled={roster.isLoading || save.isPending || visibleRows.length === 0} onCheckedChange={setAllPresent} className="mt-0.5" /><div><label htmlFor="mark-grade-present" className="cursor-pointer text-sm font-extrabold text-[#28483f]">Mark all Grade {gradeLevel} {session === "morning" ? "morning" : "afternoon"} present</label><p className="mt-1 text-xs text-[#718077]">Adjust individual learners, then save the session.</p></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={printRegister} className="quiet-button"><Printer size={15} />Print / PDF</button><button type="button" onClick={downloadRegister} disabled={visibleRows.length === 0} className="quiet-button disabled:opacity-50"><Download size={15} />Download CSV</button><button type="button" disabled={save.isPending || pendingRows.length === 0} onClick={saveRegister} className="action-button disabled:opacity-50"><Save size={15} />{save.isPending ? "Saving…" : "Save session"}</button></div></div>
      {roster.isLoading ? <p className="p-6 text-sm text-[#718077]">Loading assigned learner roster…</p> : visibleRows.length === 0 ? <div className="p-8 text-center"><h2 className="font-bold text-[#28483f]">No Grade {gradeLevel} learners available</h2><p className="mt-2 text-sm text-[#718077]">Add active learners in People or ask an administrator to create the class-teacher allocation.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[#edf2ed] text-[.67rem] uppercase tracking-wider text-[#53675d]"><tr><th className="p-3">Admission No.</th><th className="p-3">Learner</th><th className="p-3">Class</th><th className="p-3">Saved status</th><th className="p-3">Captured at</th><th className="p-3 text-center">Present</th><th className="p-3">If not present</th></tr></thead><tbody>{visibleRows.map(learner => { const selected = getStatus(learner); const actual = learner.attendanceStatus as AttendanceStatus | null; return <tr key={learner.id} className="border-t border-[#eee9df]"><td className="p-3 font-mono text-xs">{learner.admissionNumber}</td><td className="p-3 font-semibold text-[#28483f]">{learner.fullName}</td><td className="p-3 text-[#718077]">{learner.grade}</td><td className="p-3">{actual ? <span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyle[actual]}`}>{statusLabel[actual]}</span> : <span className="text-xs text-[#966615]">Not marked</span>}</td><td className="p-3 text-xs text-[#718077]">{learner.capturedAt ? new Date(learner.capturedAt).toLocaleString("en-KE") : "—"}</td><td className="p-3 text-center"><Checkbox disabled={save.isPending} aria-label={`Mark ${learner.fullName} present`} checked={selected === "present"} onCheckedChange={checked => setDraft(current => ({ ...current, [learner.id]: checked === true ? "present" : "absent" }))} /></td><td className="p-3"><select disabled={save.isPending || selected === "present"} aria-label={`Status for ${learner.fullName} if not present`} value={selected === "present" ? "" : selected} onChange={event => setDraft(current => ({ ...current, [learner.id]: event.target.value as AttendanceStatus | "" }))} className="rounded-md border border-[#d8ded7] bg-white px-2 py-2 text-xs disabled:opacity-60"><option value="">Choose status</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></td></tr>; })}</tbody></table></div>}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-2 border-t border-[#e7e2d7] px-4 py-3 text-xs text-[#718077]"><span>Each saved status records the capture date and time.</span><span className="inline-flex items-center gap-1"><Check size={13} className="text-[#1d6a57]" /> Session: {session}</span></div>
      <div className="hidden print:flex mt-5 items-end justify-between border-t border-[#d8ded7] pt-4 text-[9pt]"><span>Prepared by the class register desk</span><span className="text-center">{settings.data?.principalSignaturePath && <img src={settings.data.principalSignaturePath} alt="Administrator signature" className="mx-auto h-8 max-w-28 object-contain" />}Administrator approval / signature</span></div>
    </section>
    <section className="print:hidden grid gap-4 lg:grid-cols-[1fr_auto] rounded-xl border border-[#d8ded7] bg-[#fffefa] p-4"><div><div className="flex flex-wrap items-center gap-2"><FileCheck2 size={17} className="text-[#1d6a57]" /><h2 className="font-bold text-[#28483f]">Register approval</h2><span className={`rounded-full px-2 py-1 text-xs font-bold ${status === "approved" ? "bg-[#e5f1e8] text-[#1d6a57]" : "bg-[#f9efd8] text-[#966615]"}`}>{status}</span></div><p className="mt-1 text-xs text-[#718077]">Submit the selected class register after both sessions are captured. An administrator or super administrator approves and can reopen it for corrections.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={!selectedGradeId || !canSubmit || setApproval.isPending} onClick={() => setApproval.mutate({ attendanceDate: date, gradeId: selectedGradeId, action: "submit" })} className="quiet-button disabled:opacity-50">Submit for approval</button><button type="button" disabled={!selectedGradeId || !canApprove || setApproval.isPending} onClick={() => setApproval.mutate({ attendanceDate: date, gradeId: selectedGradeId, action: "approve" })} className="action-button disabled:opacity-50">Approve register</button><button type="button" disabled={!selectedGradeId || status !== "approved" || setApproval.isPending} onClick={() => setApproval.mutate({ attendanceDate: date, gradeId: selectedGradeId, action: "reopen" })} className="quiet-button disabled:opacity-50">Reopen</button></div></section>
    <section className="print:hidden rounded-xl border border-[#d8ded7] bg-[#fffefa] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Learner attendance summary</p><h2 className="font-editorial text-2xl text-[#193d32]">{summaryLabels[summaryPeriod]} view · Grade {gradeLevel}</h2><p className="mt-1 text-xs text-[#718077]">{summary.data?.from ?? ""} to {summary.data?.to ?? ""} · {attendanceRate}% present across captured sessions.</p></div><div className="flex flex-wrap gap-2"><select value={summaryPeriod} onChange={event => setSummaryPeriod(event.target.value as SummaryPeriod)} className="rounded-lg border border-[#d8ded7] bg-white px-3 py-2 text-xs font-bold">{Object.entries(summaryLabels).map(([key, label]) => <option key={key} value={key}>{label} summary</option>)}</select><button type="button" onClick={() => window.print()} className="quiet-button">Print summary</button><button type="button" onClick={() => { const rows = summary.data?.rows ?? []; const csv = [["Period", "Learner", "Admission No.", "Class", "Present", "Absent", "Late", "Excused", "Sessions"], ...rows.map(row => [summaryLabels[summaryPeriod], row.learner, row.admissionNumber, row.grade, row.present, row.absent, row.late, row.excused, row.sessions])].map(row => row.join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `attendance-${summaryPeriod}-summary-grade-${gradeLevel}.csv`; link.click(); URL.revokeObjectURL(link.href); }} className="quiet-button">Download summary</button></div></div><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-[#edf2ed]"><tr><th className="p-2">Learner</th><th className="p-2">Class</th><th className="p-2">Present</th><th className="p-2">Absent</th><th className="p-2">Late</th><th className="p-2">Excused</th><th className="p-2">Sessions</th></tr></thead><tbody>{(summary.data?.rows ?? []).map(row => <tr key={row.learnerId} className="border-t border-[#eee9df]"><td className="p-2 font-semibold">{row.learner}</td><td className="p-2">{row.grade}</td><td className="p-2 text-[#1d6a57]">{row.present}</td><td className="p-2 text-[#9c4038]">{row.absent}</td><td className="p-2 text-[#966615]">{row.late}</td><td className="p-2">{row.excused}</td><td className="p-2">{row.sessions}</td></tr>)}</tbody></table></div></section>
  </div>;
}
