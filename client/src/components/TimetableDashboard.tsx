import { useMemo, useState } from "react";
import { CalendarDays, Printer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { attendanceGradeLevel } from "../../../shared/attendance";

type ScheduleRow = {
  entry: { dayOfWeek: number; period: number; gradeId: number; subjectId: number; teacherUserId: number; room: string | null };
  grade: { name: string; stream: string | null } | null;
  subject: { code: string; name: string } | null;
  staff?: { teacherCode: number | null; displayName: string } | null;
  teacher?: { name: string | null } | null;
};

type Slot = { period: number } | { label: "BREAK" | "LUNCH" | "GAMES"; time: string };
const weekDays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const scheduleSlots: Slot[] = [
  { period: 1 }, { period: 2 }, { label: "BREAK", time: "9:40–10:00" },
  { period: 3 }, { period: 4 }, { label: "BREAK", time: "11:10–11:30" },
  { period: 5 }, { period: 6 }, { label: "LUNCH", time: "12:50–14:00" },
  { period: 7 }, { period: 8 }, { label: "GAMES", time: "15:20–16:00" }, { period: 9 },
];
const periodTimes: Record<number, string> = {
  1: "8:20–9:00", 2: "9:00–9:40", 3: "10:00–10:30", 4: "10:30–11:10",
  5: "11:30–12:10", 6: "12:10–12:50", 7: "14:00–14:40", 8: "14:40–15:20", 9: "16:00–16:40",
};
const breakAfter: Record<number, { label: "BREAK" | "LUNCH" | "GAMES"; time: string }> = {
  2: { label: "BREAK", time: "9:40–10:00" },
  4: { label: "BREAK", time: "11:10–11:30" },
  6: { label: "LUNCH", time: "12:50–14:00" },
  8: { label: "GAMES", time: "15:20–16:00" },
};
const sameLesson = (left?: ScheduleRow, right?: ScheduleRow) => !!left && !!right
  && left.entry.gradeId === right.entry.gradeId
  && left.entry.subjectId === right.entry.subjectId
  && left.entry.teacherUserId === right.entry.teacherUserId
  && left.entry.room === right.entry.room;
const subjectCode = (row?: ScheduleRow) => row?.subject?.code || row?.subject?.name?.slice(0, 4).toUpperCase() || "";
const gradeLabel = (row?: ScheduleRow) => row?.grade ? `${row.grade.name}${row.grade.stream ? ` ${row.grade.stream}` : ""}` : "";

function ScheduleHeader({ showGrade = false }: { showGrade?: boolean }) {
  return <thead><tr>
    <th className="personal-time-day-head">DAY</th>
    {showGrade && <th className="personal-time-day-head">GRADE</th>}
    {scheduleSlots.map((slot, index) => "period" in slot
      ? <th key={`p${slot.period}`} className="personal-time-period-head"><b>{slot.period}</b><small>{periodTimes[slot.period]}</small></th>
      : <th key={`${slot.label}-${index}`} className="personal-time-break-head"><b>{slot.label}</b><small>{slot.time}</small></th>)}
  </tr></thead>;
}

function PeriodCells({ entries, day, gradeId, multiGrade = false, firstRow = false, breakRowSpan = 5 }: { entries: ScheduleRow[]; day: number; gradeId?: number; multiGrade?: boolean; firstRow?: boolean; breakRowSpan?: number }) {
  const cellFor = (period: number, gradeId?: number) => entries.find(row => row.entry.dayOfWeek === day && row.entry.period === period && (gradeId === undefined || row.entry.gradeId === gradeId));
  const cells: React.ReactNode[] = [];
  for (let period = 1; period <= 9;) {
    const current = cellFor(period, gradeId);
    let span = 1;
    if (current) {
      while (period + span <= 9 && !breakAfter[period + span - 1] && sameLesson(current, cellFor(period + span, gradeId))) span += 1;
    }
    cells.push(<td key={`p${period}`} colSpan={span} className={`personal-time-subject-cell ${current ? "has-lesson" : "is-empty"}`}>
      {current ? <><b>{subjectCode(current)}</b><span>{gradeLabel(current)}</span>{current.entry.room && <small>{current.entry.room}</small>}{multiGrade && current.staff?.teacherCode != null && <small className="personal-time-code">{String(current.staff.teacherCode).padStart(2, "0")}</small>}</> : <span className="personal-time-empty">—</span>}
    </td>);
    period += span;
    const breakInfo = breakAfter[period - 1];
    if (breakInfo && firstRow) cells.push(<td key={`break-${period}`} rowSpan={breakRowSpan} className="personal-time-break-cell"><span>{breakInfo.label}</span></td>);
  }
  return <>{cells}</>;
}

function PersonalSchedule({ schoolName }: { schoolName: string }) {
  const personal = trpc.smis.timetable.personal.useQuery();
  const info = personal.data;
  const entries = useMemo(() => (info?.entries ?? []) as ScheduleRow[], [info?.entries]);
  return <div className="personal-timetable-paper">
    <div className="personal-timetable-title"><div className="personal-timetable-teacher">{info?.teacherName ?? "Your timetable"}{info?.teacherCode != null && <small>Teacher code {info.teacherCode}</small>}</div><div><p>{schoolName}</p><h2>PERSONAL TIMETABLE</h2></div><div className="personal-timetable-print-button"><button type="button" onClick={() => window.print()}><Printer size={14} />Print</button></div></div>
    {personal.isLoading ? <p className="py-8 text-center text-sm text-[#718077]">Loading your personal schedule…</p> : <div className="personal-timetable-scroll"><table className="personal-timetable-grid"><ScheduleHeader /><tbody>{weekDays.map((dayName, dayIndex) => <tr key={dayName}>
      <th className="personal-time-day">{dayName.slice(0, 3)}</th>
      <PeriodCells entries={entries} day={dayIndex + 1} firstRow={dayIndex === 0} />
    </tr>)}</tbody></table></div>}
    {!personal.isLoading && entries.length === 0 && <p className="mt-2 text-center text-xs text-[#718077]">No lessons are assigned to your timetable yet. Once a master schedule is published for you, it will appear here.</p>}
    <div className="personal-timetable-date">Weekly timetable · Printed {new Date().toLocaleDateString("en-KE")}</div>
  </div>;
}

function MasterSchedule({ schoolName, onOpenMaster }: { schoolName: string; onOpenMaster: () => void }) {
  const master = trpc.smis.timetable.masterList.useQuery();
  const entries = useMemo(() => (master.data ?? []) as ScheduleRow[], [master.data]);
  const gradeRows: Array<{ level: number; gradeId: number | null; label: string }> = [];
  for (const level of [7, 8, 9]) {
    const matches = new Map<number, { level: number; gradeId: number; label: string }>();
    entries.filter(row => attendanceGradeLevel(row.grade?.name ?? "") === level && row.grade).forEach(row => matches.set(row.entry.gradeId, { level, gradeId: row.entry.gradeId, label: gradeLabel(row) }));
    gradeRows.push(...(matches.size ? Array.from(matches.values()) : [{ level, gradeId: null, label: `Grade ${level}` }]));
  }
  return <div className="personal-timetable-paper">
    <div className="personal-timetable-title"><div className="personal-timetable-teacher">School-wide view</div><div><p>{schoolName}</p><h2>MASTER TIMETABLE · GRADES 7–9</h2></div><div className="personal-timetable-print-button"><button type="button" onClick={() => window.print()}><Printer size={14} />Print</button></div></div>
    {master.isLoading ? <p className="py-8 text-center text-sm text-[#718077]">Loading master timetable…</p> : <div className="personal-timetable-scroll"><table className="personal-timetable-grid master-time-grid"><ScheduleHeader showGrade /><tbody>{weekDays.map((dayName, dayIndex) => gradeRows.map((grade, gradeIndex) => <tr key={`${dayName}-${grade.gradeId ?? grade.level}`}>
      {gradeIndex === 0 && <th rowSpan={gradeRows.length} className="personal-time-day">{dayName.slice(0, 3)}</th>}
      <th className="personal-time-day">{grade.label}</th>
      <PeriodCells entries={entries} day={dayIndex + 1} gradeId={grade.gradeId ?? undefined} multiGrade breakRowSpan={gradeRows.length} firstRow={gradeIndex === 0} />
    </tr>))}</tbody></table></div>}
    {!master.isLoading && entries.length === 0 && <p className="mt-2 text-center text-xs text-[#718077]">No master timetable entries are available yet.</p>}
    <div className="mt-2 flex justify-end print:hidden"><button type="button" onClick={onOpenMaster} className="text-xs font-bold text-[#1d6a57] underline underline-offset-4">Open timetable generator</button></div>
  </div>;
}

export function TimetableDashboard({ schoolName, isMasterAdmin, canViewMaster, onOpenMaster }: { schoolName: string; isMasterAdmin: boolean; canViewMaster: boolean; onOpenMaster: () => void }) {
  const [view, setView] = useState<"personal" | "master">("personal");
  return <section className="page-enter space-y-4">
    {canViewMaster && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">School day · weekly schedule</p><h2 className="font-editorial text-2xl text-[#193d32]">Your timetables</h2><p className="mt-1 text-xs text-[#718077]">Class teachers can review the published master timetable; only timetable administrators can edit it.</p></div><div className="flex gap-2 rounded-lg border border-[#dedbd1] bg-[#fffefa] p-1 print:hidden"><button type="button" onClick={() => setView("personal")} aria-pressed={view === "personal"} className={`rounded-md px-3 py-2 text-xs font-bold ${view === "personal" ? "bg-[#1d6a57] text-white" : "text-[#53675d]"}`}>Personal timetable</button><button type="button" onClick={() => setView("master")} aria-pressed={view === "master"} className={`rounded-md px-3 py-2 text-xs font-bold ${view === "master" ? "bg-[#1d6a57] text-white" : "text-[#53675d]"}`}>Master timetable</button></div></div>}
    {view === "personal" || !canViewMaster ? <PersonalSchedule schoolName={schoolName} /> : <MasterSchedule schoolName={schoolName} onOpenMaster={onOpenMaster} />}
  </section>;
}
