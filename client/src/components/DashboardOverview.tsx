import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BookOpen, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, GraduationCap,
  Layers3, MapPin, PackageCheck, RefreshCw, ShieldCheck, Users, WalletCards, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { TimetableDashboard } from "@/components/TimetableDashboard";

type View = "Attendance" | "Academics" | "Finance & Resources" | "Store" | "Administration" | "Reports" | "Library" | "Messages" | "Curriculum Setup" | "Timetable Generator" | "People" | "NEXUS AI";
type Props = {
  displayName: string;
  grants: string[];
  onNavigate: (view: View) => void;
  canViewPersonal: boolean;
  canViewMaster: boolean;
  isMasterAdmin: boolean;
};

const money = (value: number) => `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.round(value))}`;
const dateLabel = (value: string, days: number) => new Date(`${value}T12:00:00`).toLocaleDateString("en-KE", days === 7 ? { weekday: "short" } : { day: "numeric", month: "short" });
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

function useCountUp(value: number | null, reduced: boolean | null) {
  const [shown, setShown] = useState(value ?? 0);
  useEffect(() => {
    if (value == null) { setShown(0); return; }
    if (reduced) { setShown(value); return; }
    const startValue = shown;
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 520);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(startValue + (value - startValue) * eased);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return shown;
}

function MetricCard({ label, value, formatted, detail, icon: Icon, tone = "green", index = 0, onClick }: {
  label: string; value: number | null; formatted?: (value: number) => string; detail: string; icon: LucideIcon;
  tone?: "green" | "mint" | "amber" | "ink"; index?: number; onClick?: () => void;
}) {
  const reduced = useReducedMotion();
  const count = useCountUp(value, reduced);
  const toneClass = { green: "metric-icon-green", mint: "metric-icon-mint", amber: "metric-icon-amber", ink: "metric-icon-ink" }[tone];
  return <motion.article
    className={`metric-card ${onClick ? "is-clickable" : ""}`}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={event => { if (onClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}
    initial={reduced ? false : { opacity: 0, y: 10 }}
    whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ duration: reduced ? 0 : 0.34, delay: reduced ? 0 : index * 0.045, ease: "easeOut" }}
  >
    <div className="metric-card-top"><span>{label}</span><span className={`metric-icon ${toneClass}`}><Icon size={18} strokeWidth={1.8} /></span></div>
    <p className="metric-value" aria-live="polite">{value == null ? "—" : formatted ? formatted(count) : new Intl.NumberFormat("en-KE", { maximumFractionDigits: 1 }).format(count)}</p>
    <p className="metric-detail">{detail}</p>
  </motion.article>;
}

function Panel({ title, eyebrow, action, onAction, children, className = "" }: {
  title: string; eyebrow?: string; action?: string; onAction?: () => void; children: React.ReactNode; className?: string;
}) {
  return <section className={`dashboard-panel ${className}`}>
    <div className="dashboard-panel-head">
      <div>{eyebrow && <p className="dashboard-eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
      {action && onAction && <button className="dashboard-text-action" onClick={onAction}>{action}<ChevronRight size={15} /></button>}
    </div>
    {children}
  </section>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="dashboard-empty"><span><Activity size={17} /></span><div><p>{title}</p><small>{detail}</small></div></div>;
}

export function NotificationCenter({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const notifications = trpc.smis.notifications.list.useQuery(undefined, { enabled, staleTime: 60_000 });
  if (!enabled) return null;
  return <div className="relative">
    <button onClick={() => setOpen(value => !value)} aria-label={`Open published notices${notifications.data?.length ? ` (${notifications.data.length})` : ""}`} aria-expanded={open} className="dashboard-icon-button">
      <Bell size={17} />{(notifications.data?.length ?? 0) > 0 && <span className="notification-badge">{notifications.data!.length > 9 ? "9+" : notifications.data!.length}</span>}
    </button>
    {open && <div className="notification-popover">
      <div className="flex items-center justify-between border-b border-[#e6ebe6] px-4 py-3"><div><p className="text-sm font-bold text-[#182119]">Notifications</p><p className="mt-0.5 text-[.68rem] text-[#758078]">Published school notices</p></div><button onClick={() => setOpen(false)} aria-label="Close notifications" className="dashboard-icon-button !h-8 !w-8"><X size={14} /></button></div>
      <div className="max-h-80 overflow-y-auto">
        {notifications.isLoading ? <p className="p-4 text-xs text-[#758078]">Loading notices…</p> : notifications.data?.length ? notifications.data.slice(0, 6).map(item => <article key={item.id} className="border-b border-[#eef1ed] px-4 py-3 last:border-0"><p className="text-xs font-bold text-[#202b21]">{item.title}</p><p className="mt-1 line-clamp-2 text-[.7rem] leading-5 text-[#657166]">{item.body}</p><p className="mt-2 text-[.62rem] text-[#8a948a]">{new Date(item.createdAt).toLocaleDateString("en-KE")}</p></article>) : <p className="p-4 text-xs text-[#758078]">No published notices yet.</p>}
      </div>
    </div>}
  </div>;
}

function ClockInPanel() {
  const status = trpc.smis.clocking.status.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const clockIn = trpc.smis.clocking.clockIn.useMutation({
    onSuccess: result => { toast.success(result.alreadyClockedIn ? "You are already clocked in today" : `Clock-in recorded · ${result.distanceMeters}m from school`); void utils.smis.clocking.status.invalidate(); },
    onError: error => { const [code, meters, radius] = error.message.split(":"); toast.error(code === "OUTSIDE_SCHOOL_GEOFENCE" ? `You are ${meters}m away. Clock-in is allowed within ${radius}m of school.` : error.message.replaceAll("_", " ")); },
  });
  const submit = () => {
    if (status.data?.clockedIn) return;
    if (!navigator.geolocation) { toast.error("This browser does not provide location services"); return; }
    navigator.geolocation.getCurrentPosition(
      position => clockIn.mutate({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => toast.error("Location permission is required to clock in at school"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };
  return <div className="clock-panel">
    <div className="flex items-start gap-3"><span className="clock-panel-icon"><MapPin size={18} /></span><div className="min-w-0"><p className="text-sm font-bold text-[#172019]">Staff clock-in</p><p className="mt-1 text-xs leading-5 text-[#657166]">Location is checked against the school’s configured geofence.</p></div></div>
    <button onClick={submit} disabled={clockIn.isPending || status.data?.clockedIn || !status.data?.configured} className={`clock-panel-button ${status.data?.clockedIn ? "is-done" : ""}`}>
      {status.data?.clockedIn ? <><Check size={16} />Clocked in · {new Date(status.data.clocking?.clockedAt ?? Date.now()).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</> : !status.data?.configured ? "School location not configured" : clockIn.isPending ? "Checking location…" : <>Clock in for today<ChevronRight size={16} /></>}
    </button>
  </div>;
}

type AttendancePoint = { date: string; present: number; absent: number; total: number; rate: number | null };

function AttendanceChart({ rows, days, onNavigate }: { rows: AttendancePoint[]; days: number; onNavigate: () => void }) {
  const hasData = rows.some(row => row.total > 0);
  if (!hasData) return <EmptyState title="No attendance records in this window" detail="The chart will populate when register entries are saved." />;
  return <div className="dashboard-chart h-[230px]">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} onClick={onNavigate} margin={{ top: 12, right: 8, left: -20, bottom: 2 }}>
        <defs><linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#628962" stopOpacity={0.22} /><stop offset="96%" stopColor="#628962" stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="#e9ede8" strokeDasharray="4 5" />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} tickFormatter={(value: string) => dateLabel(value, days)} interval={days === 30 ? 4 : 0} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} width={42} />
        <Tooltip contentStyle={{ border: "1px solid #e3e9e2", borderRadius: 12, fontSize: 12, boxShadow: "0 10px 30px rgba(15,30,18,.08)" }} labelFormatter={(value) => new Date(`${String(value)}T12:00:00`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "short" })} formatter={(value) => [value == null ? "No register" : `${value}%`, "Present / late"]} />
        <Area type="monotone" dataKey="rate" connectNulls={false} stroke="#456d48" strokeWidth={2.5} fill="url(#attendanceFill)" activeDot={{ r: 4, fill: "#9eec9b", stroke: "#456d48", strokeWidth: 2 }} isAnimationActive />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

function DashboardOverview({ displayName, grants, onNavigate, canViewPersonal, canViewMaster, isMasterAdmin }: Props) {
  const reduced = useReducedMotion();
  const [days, setDays] = useState<7 | 30>(7);
  const [gradeId, setGradeId] = useState<number | undefined>();
  const [academicYear, setAcademicYear] = useState<number | undefined>();
  const [term, setTerm] = useState<string | undefined>();
  const can = (key: string) => grants.includes("*") || grants.includes(key);
  const input = useMemo(() => ({ days, ...(gradeId ? { gradeId } : {}), ...(academicYear ? { academicYear } : {}), ...(term ? { term } : {}) }), [days, gradeId, academicYear, term]);
  const query = trpc.smis.snapshot.useQuery(input, { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const data = query.data;
  const periods = data?.filters.periods ?? [];
  const years = Array.from(new Set(periods.map(period => period.academicYear))).sort((a, b) => b - a);
  const terms = periods.filter(period => academicYear == null || period.academicYear === academicYear).map(period => period.term);
  const attendanceTrend = data?.attendanceTrend ?? [];

  useEffect(() => {
    if (!data) return;
    const periodExists = academicYear != null && term != null && periods.some(period => period.academicYear === academicYear && period.term === term);
    if (!periodExists && data.filters.academicYear != null && data.filters.term != null) {
      setAcademicYear(data.filters.academicYear);
      setTerm(data.filters.term);
    }
  }, [data?.filters.academicYear, data?.filters.term, periods, academicYear, term]);

  const finance = data?.finance;
  const metrics: Array<{ label: string; value: number | null; formatted?: (n: number) => string; detail: string; icon: LucideIcon; tone: "green" | "mint" | "amber" | "ink"; view?: View }> = [];
  const role = data?.user.role;
  if (data?.user.leader) {
    metrics.push({ label: "Active learners", value: data.metrics.learners, detail: "Current active roll", icon: GraduationCap, tone: "green", view: "People" });
    metrics.push({ label: "Attendance today", value: data.metrics.attendance?.rate ?? null, formatted: n => `${n.toFixed(1)}%`, detail: data.metrics.attendance?.recorded ? `${data.metrics.attendance.present} present / late · ${data.metrics.attendance.recorded} recorded` : "Register has not started", icon: Users, tone: "mint", view: "Attendance" });
    metrics.push({ label: "Marklists to review", value: data.metrics.pendingMarklists, detail: "Submitted this academic period", icon: ClipboardCheck, tone: "amber", view: "Academics" });
    if (data.metrics.averageMarks != null) metrics.push({ label: "CBC average", value: data.metrics.averageMarks, formatted: n => `${n.toFixed(1)}%`, detail: "Saved marks · selected class and period", icon: Activity, tone: "ink", view: "Academics" });
    if (data.metrics.staff != null) metrics.push({ label: "Active staff", value: data.metrics.staff, detail: "Active staff profiles", icon: Users, tone: "ink", view: "Administration" });
    if (data.permissions.finance && finance) metrics.push({ label: "Collections", value: finance.collected, formatted: money, detail: "All recorded payments", icon: CircleDollarSign, tone: "green", view: "Finance & Resources" });
  } else if (data?.user.teaching) {
    metrics.push({ label: "Learners in scope", value: data.metrics.learners, detail: `${data.assignedClasses.length} assigned class${data.assignedClasses.length === 1 ? "" : "es"}`, icon: GraduationCap, tone: "green", view: "People" });
    metrics.push({ label: "Attendance today", value: data.metrics.attendance?.rate ?? null, formatted: n => `${n.toFixed(1)}%`, detail: data.metrics.attendance?.recorded ? `${data.metrics.attendance.present} present / late recorded` : "No register entries yet", icon: Users, tone: "mint", view: "Attendance" });
    metrics.push({ label: "Incomplete marklists", value: data.metrics.pendingMarklists, detail: `${data.metrics.openAssessments ?? 0} open for this period`, icon: ClipboardCheck, tone: "amber", view: "Academics" });
    metrics.push({ label: "Learning-area average", value: data.metrics.averageMarks, formatted: n => `${n.toFixed(1)}%`, detail: "Based on saved marks in your scope", icon: Activity, tone: "ink", view: "Academics" });
  } else if (role === "finance" || (data?.permissions.finance && !data?.user.teaching && !data?.user.leader)) {
    metrics.push({ label: "Collected to date", value: finance?.collected ?? null, formatted: money, detail: "All recorded payments", icon: CircleDollarSign, tone: "green", view: "Finance & Resources" });
    metrics.push({ label: "Configured fee balance", value: finance?.balance ?? null, formatted: money, detail: "Configured charges less recorded payments", icon: WalletCards, tone: "amber", view: "Finance & Resources" });
    metrics.push({ label: "Expenditure", value: finance?.expenditure ?? null, formatted: money, detail: "All recorded expenditure", icon: ArrowDownRight, tone: "ink", view: "Finance & Resources" });
    metrics.push({ label: "Net recorded", value: finance?.expenditure == null ? null : finance.collected - finance.expenditure, formatted: money, detail: "Collections less expenditure", icon: Activity, tone: "mint", view: "Finance & Resources" });
  } else if (role === "storekeeper" || (data?.permissions.store && !data?.user.leader && !data?.user.teaching)) {
    metrics.push({ label: "Stock items", value: data?.inventory?.total ?? null, detail: "Items with stored stock movements", icon: PackageCheck, tone: "green", view: "Store" });
    metrics.push({ label: "At or below reorder", value: data?.inventory?.lowStock ?? null, detail: "Requires store review", icon: Layers3, tone: "amber", view: "Store" });
  } else {
    if (data?.metrics.attendance) metrics.push({ label: "Attendance today", value: data.metrics.attendance.rate, formatted: n => `${n.toFixed(1)}%`, detail: `${data.metrics.attendance.recorded} attendance records`, icon: Users, tone: "mint", view: "Attendance" });
    if (data?.metrics.learners != null) metrics.push({ label: "Learners in scope", value: data.metrics.learners, detail: "Accessible active roll", icon: GraduationCap, tone: "green", view: "People" });
  }

  const adminOverview = trpc.smis.administration.overview.useQuery(undefined, { enabled: can("administration.view"), staleTime: 60_000 });
  const audit = trpc.smis.administration.audit.useQuery({ limit: 5 }, { enabled: can("administration.view"), staleTime: 30_000 });
  const title = data?.user.leader ? "School overview" : data?.user.teaching ? "Teaching overview" : role === "finance" ? "Finance overview" : role === "storekeeper" ? "Store overview" : "Your workspace";
  const greetingText = `${greeting()}, ${displayName.split(/[\s@]/)[0] || "there"}.`;
  const visibleTerm = data?.filters.term ?? data?.school?.term;
  const visibleYear = data?.filters.academicYear ?? data?.school?.academicYear;
  const periodLabel = visibleTerm && visibleYear ? `${visibleTerm} · ${visibleYear}` : "Academic period not set";
  const noSettings = !data?.school;

  if (query.isLoading && !data) return <div className="dashboard-loading" aria-label="Loading dashboard"><div className="dashboard-loading-hero" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="dashboard-loading-card" />)}</div><div className="dashboard-loading-card !h-64" /></div>;
  if (query.isError) return <div className="dashboard-error"><div><p className="text-base font-bold text-[#1b241c]">Dashboard data could not be loaded</p><p className="mt-1 text-sm text-[#68746a]">{query.error.message.includes("FORBIDDEN") ? "Your account does not have dashboard access." : "Check the database connection and try again."}</p><button className="quiet-button mt-4" onClick={() => void query.refetch()}><RefreshCw size={14} />Try again</button></div></div>;

  return <div className="dashboard-page">
    <motion.section className="dashboard-welcome" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="dashboard-welcome-copy"><div className="dashboard-welcome-meta"><span className="dashboard-role-chip"><span />{data?.user.roleLabel ?? "School staff"}</span><span className="dashboard-period-label"><CalendarDays size={14} />{periodLabel}</span></div>
        <p className="dashboard-greeting">{greetingText}</p><h1>{title}<span>.</span></h1>
        <p className="dashboard-welcome-subtitle">{data?.school?.name ? `${data.school.name} · ` : "NEXUS school workspace · "}{data?.school?.motto || "A clear view of the work that matters today."}</p>
        {noSettings && <p className="dashboard-config-note"><ShieldCheck size={14} />School name and current academic period have not been configured.</p>}
        <div className="dashboard-quick-actions">
          {data?.permissions.attendance && <button className="action-button" onClick={() => onNavigate("Attendance")}><ClipboardCheck size={15} />Open register</button>}
          {data?.permissions.assessments && <button className="quiet-button" onClick={() => onNavigate("Academics")}><BookOpen size={15} />Marklists</button>}
          {data?.permissions.finance && !data.user.leader && <button className="quiet-button" onClick={() => onNavigate("Finance & Resources")}><WalletCards size={15} />Finance desk</button>}
          {data?.permissions.store && !data.user.leader && <button className="quiet-button" onClick={() => onNavigate("Store")}><PackageCheck size={15} />Stock desk</button>}
          {data?.user.superAdmin && <button className="quiet-button" onClick={() => onNavigate("Administration")}><ShieldCheck size={15} />System administration</button>}
        </div>
      </div>
      <div className="dashboard-welcome-art" aria-hidden="true"><span className="welcome-ring welcome-ring-one" /><span className="welcome-ring welcome-ring-two" /><span className="welcome-plant"><i /><i /><i /><b /></span><div className="welcome-stamp"><span>NEXUS</span><small>ACCOUNTABLE<br />SCHOOL DATA</small></div></div>
    </motion.section>

    <AnnouncementRail enabled={can("communication.edit")} />

    <div className="dashboard-filter-row" aria-label="Dashboard filters">
      <div className="dashboard-filter-title"><span>View</span><b>{data?.filters.grades.length ? "Scoped to your access" : "Current workspace"}</b><small className="dashboard-filter-scope">Dates filter attendance and cash trends; year and term filter saved CBC results.</small></div>
      <div className="dashboard-filter-controls">
        <div className="dashboard-segment" role="group" aria-label="Attendance time range"><button onClick={() => setDays(7)} aria-pressed={days === 7}>7 days</button><button onClick={() => setDays(30)} aria-pressed={days === 30}>30 days</button></div>
        {years.length > 0 && <label className="dashboard-select-wrap"><span>Year</span><select value={academicYear ?? data?.filters.academicYear ?? ""} onChange={event => { const nextYear = Number(event.target.value); const nextPeriod = periods.find(period => period.academicYear === nextYear); setAcademicYear(nextYear || undefined); setTerm(nextPeriod?.term); }} aria-label="Filter by academic year"><option value="" disabled>Select year</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select><ChevronDown size={14} /></label>}
        {terms.length > 0 && <label className="dashboard-select-wrap"><span>Term</span><select value={term ?? data?.filters.term ?? ""} onChange={event => setTerm(event.target.value || undefined)} aria-label="Filter by term"><option value="" disabled>Select term</option>{Array.from(new Set(terms)).map(value => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></label>}
        {(data?.filters.grades.length ?? 0) > 0 && <label className="dashboard-select-wrap"><span>Class</span><select value={gradeId ?? "all"} onChange={event => setGradeId(event.target.value === "all" ? undefined : Number(event.target.value))} aria-label="Filter by class"><option value="all">All assigned</option>{data?.filters.grades.map(grade => <option key={grade.id} value={grade.id}>{grade.label}</option>)}</select><ChevronDown size={14} /></label>}
        <button className="dashboard-refresh" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh dashboard data"><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} /></button>
      </div>
    </div>

    <section className="dashboard-metrics" aria-label="Current metrics">
      {metrics.map(({ view, ...metric }, index) => <MetricCard key={metric.label} {...metric} index={index} onClick={view ? () => onNavigate(view) : undefined} />)}
      {metrics.length === 0 && <div className="dashboard-no-metrics"><p>No dashboard metrics are available for this role yet.</p><span>Your module access remains available in the navigation.</span></div>}
    </section>

    {(data?.user.leader || data?.user.teaching) && <section className="dashboard-main-grid">
      {data?.permissions.attendance && <Panel title="Attendance pulse" eyebrow="Live register activity" action="Open register" onAction={() => onNavigate("Attendance")}>
        <div className="dashboard-chart-summary"><div><span>Today</span><b>{data.metrics.attendance?.rate == null ? "Not started" : `${data.metrics.attendance.rate}%`}</b></div><div><span>Recorded</span><b>{data.metrics.attendance?.recorded ?? 0}{data.metrics.attendance?.expected != null ? <small> / {data.metrics.attendance.expected}</small> : null}</b></div><div><span>Absent</span><b className="text-[#9f534b]">{data.metrics.attendance?.absent ?? 0}</b></div></div>
        <AttendanceChart rows={attendanceTrend} days={days} onNavigate={() => onNavigate("Attendance")} />
      </Panel>}
      {data?.permissions.assessments && <Panel title={data.user.leader ? "Marklists awaiting review" : "Your marklist progress"} eyebrow="CBC · selected academic period" action="Open academics" onAction={() => onNavigate("Academics")}>
        {data.assessmentTasks.length ? <div className="dashboard-task-list">{data.assessmentTasks.slice(0, 5).map(task => <button key={task.id} className="dashboard-task-row" onClick={() => onNavigate("Academics")}><span className={`task-status ${task.status === "submitted" ? "task-status-review" : "task-status-draft"}`}><ClipboardCheck size={15} /></span><span className="min-w-0 flex-1"><b>{task.subject}</b><small>{task.grade} · {task.action}</small><span className="task-progress"><i style={{ width: `${task.percent ?? 0}%` }} /></span></span><span className="task-count">{task.marked}<small> / {task.expected}</small></span><ChevronRight size={15} className="text-[#88938a]" /></button>)}</div> : <EmptyState title={data.user.leader ? "No marklists are awaiting review" : "No incomplete marklists"} detail="Assessment tasks appear here after they are saved in NEXUS." />}
        {data.user.teaching && data.assignedClasses.length > 0 && <div className="assigned-class-strip"><span>Assigned classes</span>{data.assignedClasses.map(item => <span key={item.id} className="assigned-class-chip"><b>{item.label}</b><small>{item.learners} learners</small></span>)}</div>}
      </Panel>}
    </section>}

    {data?.user.teaching && data?.permissions.attendance && data.recentAttendance.length > 0 && <Panel title="Today’s register" eyebrow="Your accessible classes" action="Open attendance" onAction={() => onNavigate("Attendance")}>
      <div className="dashboard-record-list">{data.recentAttendance.map(row => <div key={row.id} className="dashboard-record-row"><span className={`attendance-status-dot attendance-${row.status}`} /><span className="min-w-0 flex-1"><b>{row.learner}</b><small>{row.grade} · {row.admissionNumber}</small></span><span className={`attendance-status-label attendance-label-${row.status}`}>{row.status}</span></div>)}</div>
    </Panel>}

    {data?.user.leader && <section className="dashboard-main-grid dashboard-secondary-grid">
      {data.permissions.finance && finance && <Panel title="Collections & expenditure" eyebrow="Finance · all recorded periods" action="Open finance desk" onAction={() => onNavigate("Finance & Resources")}>
        <div className="finance-summary-row"><div><span>Received</span><b>{money(finance.collected)}</b></div><div><span>Recorded spend</span><b>{finance.expenditure == null ? "Restricted" : money(finance.expenditure)}</b></div><div><span>Balance</span><b className={finance.balance < 0 ? "text-[#a34f45]" : "text-[#456d48]"}>{money(finance.balance)}</b></div></div>
        <div className="finance-trend-chart h-[190px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={finance.trend} margin={{ top: 8, right: 4, left: -15, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede8" strokeDasharray="4 5" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} tickFormatter={(value: string) => dateLabel(value, days)} interval={days === 30 ? 4 : 0} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} width={48} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} /><Tooltip contentStyle={{ border: "1px solid #e3e9e2", borderRadius: 12, fontSize: 12 }} formatter={(value) => [money(Number(value)), ""]} labelFormatter={(value) => new Date(`${String(value)}T12:00:00`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })} /><Bar dataKey="collected" name="Collected" fill="#628962" radius={[5, 5, 0, 0]} maxBarSize={18} isAnimationActive onClick={() => onNavigate("Finance & Resources")} /><Bar dataKey="expenditure" name="Expenditure" fill="#9eec9b" radius={[5, 5, 0, 0]} maxBarSize={18} isAnimationActive onClick={() => onNavigate("Finance & Resources")} /></BarChart></ResponsiveContainer></div>
        {finance.recentPayments.length > 0 && <div className="recent-payments">{finance.recentPayments.slice(0, 3).map(payment => <div key={payment.id}><span><b>{payment.learner}</b><small>{payment.method.toUpperCase()} · {payment.reference}</small></span><strong>{money(payment.amount)}</strong></div>)}</div>}
      </Panel>}
      {data.user.superAdmin ? <Panel title="System oversight" eyebrow="Administrator controls">
        <div className="admin-status-grid"><div><span className="admin-status-dot" /><b>Database connected</b><small>Current dashboard request completed successfully</small></div><div><ShieldCheck size={18} /><b>{data.administration?.configuration?.rolePolicies ?? 0}</b><small>Role permission rules</small></div><div><Users size={18} /><b>{adminOverview.data?.total ?? "—"}</b><small>Registered accounts</small></div><div><Clock3 size={18} /><b>{adminOverview.data?.pending ?? "—"}</b><small>Pending accounts</small></div></div>
        {data.administration?.configuration && <p className="admin-config-note">{data.administration.configuration.userOverrides} user-specific permission overrides are configured.</p>}
        {audit.data?.rows?.length ? <div className="audit-activity">{audit.data.rows.slice(0, 4).map(row => <div key={row.id}><span className="audit-dot" /><p><b>{row.action.replaceAll(".", " ")}</b><small>{row.actor} · {new Date(row.at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</small></p></div>)}</div> : <EmptyState title="No recent audit activity" detail="Recorded actions will appear here." />}
      </Panel> : <Panel title="Today at a glance" eyebrow="School operations">
        {data.recentAttendance.length ? <div className="dashboard-record-list">{data.recentAttendance.slice(0, 4).map(row => <div key={row.id} className="dashboard-record-row"><span className={`attendance-status-dot attendance-${row.status}`} /><span className="min-w-0 flex-1"><b>{row.learner}</b><small>{row.grade} · {row.admissionNumber}</small></span><span className={`attendance-status-label attendance-label-${row.status}`}>{row.status}</span></div>)}</div> : <EmptyState title="The register is ready" detail="Attendance activity will appear after class registers are saved." />}
      </Panel>}
    </section>}

    {data?.permissions.finance && !data.user.leader && finance && <section className="dashboard-main-grid"><Panel title="Cash reconciliation" eyebrow="Recorded totals"><div className="finance-summary-row"><div><span>Collected</span><b>{money(finance.collected)}</b></div><div><span>Expenditure</span><b>{finance.expenditure == null ? "Restricted" : money(finance.expenditure)}</b></div><div><span>Net recorded</span><b>{finance.expenditure == null ? "—" : money(finance.collected - finance.expenditure)}</b></div></div><div className="finance-trend-chart h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={finance.trend} margin={{ top: 10, right: 4, left: -15, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9ede8" strokeDasharray="4 5" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} tickFormatter={(value: string) => dateLabel(value, days)} interval={days === 30 ? 4 : 0} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#89948a", fontSize: 10 }} width={48} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} /><Tooltip formatter={(value) => [money(Number(value)), ""]} /><Bar dataKey="collected" name="Collected" fill="#628962" radius={[5, 5, 0, 0]} maxBarSize={18} onClick={() => onNavigate("Finance & Resources")} /><Bar dataKey="expenditure" name="Expenditure" fill="#9eec9b" radius={[5, 5, 0, 0]} maxBarSize={18} onClick={() => onNavigate("Finance & Resources")} /></BarChart></ResponsiveContainer></div></Panel><Panel title="Recent payments" eyebrow="Latest recorded receipts" action="Open finance desk" onAction={() => onNavigate("Finance & Resources")}>{finance.recentPayments.length ? <div className="recent-payments">{finance.recentPayments.map(payment => <div key={payment.id}><span><b>{payment.learner}</b><small>{payment.method.toUpperCase()} · {payment.reference} · {new Date(payment.paidAt).toLocaleDateString("en-KE")}</small></span><strong>{money(payment.amount)}</strong></div>)}</div> : <EmptyState title="No payments recorded" detail="Receipts will appear after they are saved." />}</Panel></section>}

    {data?.permissions.store && data.inventory && <section className="dashboard-main-grid">
      <Panel title="Inventory requiring attention" eyebrow="Store operations" action="Open store desk" onAction={() => onNavigate("Store")}>
        {data.inventory.alerts.length ? <div className="dashboard-record-list">{data.inventory.alerts.map((item, index) => <div key={`${item.name}-${index}`} role="button" tabIndex={0} onClick={() => onNavigate("Store")} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onNavigate("Store"); } }} className="dashboard-record-row inventory-action-row"><span className="inventory-alert-icon"><PackageCheck size={16} /></span><span className="min-w-0 flex-1"><b>{item.name}</b><small>Reorder point: {item.reorderLevel} {item.unit}</small></span><span className="inventory-count">{item.quantity} <small>{item.unit}</small></span></div>)}</div> : <EmptyState title="No low-stock items" detail="Stock levels are above their recorded reorder thresholds." />}
      </Panel>
      <Panel title="Recent stock movements" eyebrow="Latest receipts, issues and adjustments" action="View store desk" onAction={() => onNavigate("Store")}>
        {data.inventory.movements.length ? <div className="dashboard-record-list">{data.inventory.movements.map(movement => <button key={movement.id} type="button" className="dashboard-record-row inventory-action-row" onClick={() => onNavigate("Store")}><span className={`movement-kind movement-${movement.movementType}`}>{movement.movementType}</span><span className="min-w-0 flex-1"><b>{movement.item}</b><small>{movement.reference || "No reference"} · {new Date(movement.createdAt).toLocaleDateString("en-KE")}</small></span><strong className="movement-quantity">{movement.movementType === "issued" ? "−" : "+"}{movement.quantity.toLocaleString("en-KE")}</strong></button>)}</div> : <EmptyState title="No stock movements recorded" detail="Receipts and issues will appear after they are saved." />}
      </Panel>
    </section>}
    {data?.permissions.clockIn && <ClockInPanel />}
    {(canViewPersonal || canViewMaster) && <TimetableDashboard schoolName={data?.school?.name ?? "NEXUS"} isMasterAdmin={isMasterAdmin} canViewPersonal={canViewPersonal} canViewMaster={canViewMaster} onOpenMaster={() => onNavigate("Timetable Generator")} />}
  </div>;
}

export default DashboardOverview;


export function AnnouncementRail({ enabled }: { enabled: boolean }) {
  const notices = trpc.smis.notifications.list.useQuery(undefined, { enabled, staleTime: 60_000 });
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const rows = notices.data ?? [];
  useEffect(() => {
    if (!enabled || rows.length < 2 || paused || reduced) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % rows.length), 10_000);
    return () => window.clearInterval(timer);
  }, [enabled, rows.length, paused, reduced]);
  if (!enabled || !rows.length) return null;
  const visibleIndex = index % rows.length;
  const current = rows[visibleIndex];
  const move = (delta: number) => setIndex(position => (position + delta + rows.length) % rows.length);
  return <section className="announcement-rail" aria-label="School announcements" onMouseEnter={() => setPaused(true)} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setPaused(false); }} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}>
    <span className="announcement-icon"><Bell size={16} /></span>
    <div className="announcement-copy" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}><motion.div key={current.id} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.2 }}><b>{current.title}</b><p>{current.body}</p></motion.div></AnimatePresence>
    </div>
    <div className="announcement-controls"><span>{visibleIndex + 1} / {rows.length}</span><button type="button" onClick={() => move(-1)} aria-label="Previous announcement"><ChevronLeft size={15} /></button><button type="button" onClick={() => move(1)} aria-label="Next announcement"><ChevronRight size={15} /></button></div>
  </section>;
}
