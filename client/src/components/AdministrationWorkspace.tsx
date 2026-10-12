import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, History, KeyRound, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, ShieldOff, UserCheck, UserCog, UserPlus, Users, Trash2, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
type Out = inferRouterOutputs<AppRouter>["smis"]["administration"];
type Row = Out["list"][number];
type Catalog = Out["catalog"];
type Role = "super_admin" | "admin" | "teacher" | "class_teacher" | "finance" | "other";
type Alloc = { gradeId: number; subjectId: number };

const field = "mt-1 w-full rounded-lg border border-[#d8ddd4] bg-[#fffefa] px-3 py-2 text-sm text-[#28483f] outline-none focus:border-[#1d6a57]";
const label = "block text-xs font-bold uppercase tracking-wide text-[#718077]";
const ghost = "inline-flex items-center gap-1.5 rounded-lg border border-[#d8ddd4] bg-[#fffefa] px-3 py-2 text-xs font-bold text-[#28483f] hover:bg-[#f1f4ec]";
const fmt = (d?: Date | string | null, time = true) => !d ? "—" : new Date(d).toLocaleString("en-KE", time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
const errText = (m: string) => m.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
const STATUS: Record<string, string> = { active: "bg-[#e6f0e7] text-[#1d6a57]", suspended: "bg-[#f7ecd5] text-[#9a6c19]", locked: "bg-[#f6dfdb] text-[#a3382c]", pending: "bg-[#e8edf3] text-[#486074]" };

function StatusPill({ status }: { status: string }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-bold capitalize ${STATUS[status]}`}>{status}</span>; }

function AllocationEditor({ value, onChange, catalog }: { value: Alloc[]; onChange: (v: Alloc[]) => void; catalog: Catalog }) {
  return <div className="space-y-2">
    {value.map((row, i) => <div key={i} className="flex gap-2">
      <select className={field} value={row.gradeId} onChange={e => onChange(value.map((r, j) => j === i ? { ...r, gradeId: Number(e.target.value) } : r))}>{catalog.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <select className={field} value={row.subjectId} onChange={e => onChange(value.map((r, j) => j === i ? { ...r, subjectId: Number(e.target.value) } : r))}>{catalog.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <button type="button" aria-label="Remove subject" className={ghost} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
    </div>)}
    <button type="button" className={ghost} disabled={!catalog.grades.length || !catalog.subjects.length} onClick={() => onChange([...value, { gradeId: catalog.grades[0].id, subjectId: catalog.subjects[0].id }])}><Plus size={14} />Add subject and class</button>
  </div>;
}

function SetupLinkDialog({ link, name, onClose }: { link: { setupToken: string; expiresAt: Date | string } | null; name: string; onClose: () => void }) {
  const url = link ? `${window.location.origin}/?reset=${link.setupToken}` : "";
  return <Dialog open={!!link} onOpenChange={o => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Password setup link for {name}</DialogTitle><DialogDescription>Share this single-use link with the user through a trusted channel. They will choose their own password. It expires {fmt(link?.expiresAt)} and cannot be shown again.</DialogDescription></DialogHeader>
    <input readOnly value={url} onFocus={e => e.currentTarget.select()} className={field} />
    <DialogFooter><button className="action-button" onClick={() => { navigator.clipboard.writeText(url).then(() => toast.success("Setup link copied")); }}><ClipboardCopy size={15} />Copy link</button></DialogFooter>
  </DialogContent></Dialog>;
}

function UserDialog({ mode, row, catalog, onClose, onLink }: { mode: "create" | "edit" | null; row?: Row; catalog: Catalog; onClose: () => void; onLink: (l: { setupToken: string; expiresAt: Date | string }, name: string) => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState(() => ({ fullName: row?.fullName ?? "", username: row?.username ?? "", staffId: row?.staffId ?? "", role: (row?.role === "head_teacher" || row?.role === "deputy_head" ? "admin" : row?.role === "senior_teacher" ? "teacher" : row?.role === "storekeeper" ? "other" : row?.role ?? "teacher") as Role, department: row?.department ?? "", email: row?.email ?? "", phone: row?.phone ?? "", classGradeId: 0, subjects: [] as Alloc[], status: "pending_activation" as "active" | "pending_activation" | "disabled" }));
  const done = () => { utils.smis.administration.invalidate(); onClose(); };
  const onError = (e: { message: string }) => toast.error(errText(e.message));
  const create = trpc.smis.administration.create.useMutation({ onSuccess: r => { toast.success("User created"); done(); onLink(r, f.fullName); }, onError });
  const update = trpc.smis.administration.update.useMutation({ onSuccess: () => { toast.success("User updated"); done(); }, onError });
  const set = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));
  const teaching = f.role === "teacher" || f.role === "class_teacher";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = { fullName: f.fullName, username: f.username, staffId: f.staffId, department: f.department || null, email: f.email, phone: f.phone || null };
    if (mode === "edit" && row) update.mutate({ userId: row.userId, ...base });
    else create.mutate({ ...base, role: f.role, classGradeId: teaching && f.classGradeId ? f.classGradeId : null, subjectAllocations: teaching ? f.subjects : [], status: f.status });
  };
  return <Dialog open={!!mode} onOpenChange={o => !o && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{mode === "edit" ? "Edit user" : "Create user"}</DialogTitle><DialogDescription>{mode === "edit" ? "Update identity and contact details. Role and assignments are changed separately." : "A single-use setup link is generated so the user chooses their own password."}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className={label}>Full name</label><Input required value={f.fullName} onChange={e => set("fullName", e.target.value)} className="mt-1" /></div>
      <div><label className={label}>Username</label><Input required value={f.username} onChange={e => set("username", e.target.value.toLowerCase())} className="mt-1" autoComplete="off" /></div>
      <div><label className={label}>Staff / Employee ID</label><Input required value={f.staffId} onChange={e => set("staffId", e.target.value)} className="mt-1" /></div>
      <div><label className={label}>Department</label><Input list="departments" value={f.department} onChange={e => set("department", e.target.value)} className="mt-1" /><datalist id="departments">{catalog.departments.map(d => <option key={d} value={d} />)}</datalist></div>
      <div><label className={label}>Email</label><Input type="email" value={f.email} onChange={e => set("email", e.target.value)} className="mt-1" /></div>
      <div><label className={label}>Phone</label><Input value={f.phone} onChange={e => set("phone", e.target.value)} className="mt-1" /></div>
      {mode === "create" && <>
        <div><label className={label}>Role</label><select className={field} value={f.role} onChange={e => set("role", e.target.value)}>{catalog.roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
        <div><label className={label}>Account status</label><select className={field} value={f.status} onChange={e => set("status", e.target.value)}><option value="pending_activation">Pending (until password is set)</option><option value="active">Active</option><option value="disabled">Suspended</option></select></div>
        {teaching && <div className="sm:col-span-2"><label className={label}>{f.role === "class_teacher" ? "Class (required)" : "Class teacher of (optional)"}</label><select className={field} value={f.classGradeId} onChange={e => set("classGradeId", Number(e.target.value))}><option value={0}>— None —</option>{catalog.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        {teaching && <div className="sm:col-span-2"><label className={label}>Subjects taught · {catalog.academicYear} {catalog.term}</label><div className="mt-1"><AllocationEditor value={f.subjects} onChange={v => set("subjects", v)} catalog={catalog} /></div></div>}
      </>}
      <DialogFooter className="sm:col-span-2"><button type="button" className={ghost} onClick={onClose}>Cancel</button><button className="action-button" disabled={create.isPending || update.isPending}>{mode === "edit" ? "Save changes" : "Create user"}</button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function RoleDialog({ row, catalog, onClose }: { row: Row | null; catalog: Catalog; onClose: () => void }) {
  const utils = trpc.useUtils(); const [role, setRole] = useState<Role>("teacher");
  const m = trpc.smis.administration.changeRole.useMutation({ onSuccess: () => { toast.success("Role updated"); utils.smis.administration.invalidate(); onClose(); }, onError: e => toast.error(errText(e.message)) });
  return <Dialog open={!!row} onOpenChange={o => !o && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Change role · {row?.fullName}</DialogTitle><DialogDescription>Currently {row?.roleLabel}. Access changes take effect on the user's next request.</DialogDescription></DialogHeader>
    <select className={field} value={role} onChange={e => setRole(e.target.value as Role)}>{catalog.roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
    <DialogFooter><button className={ghost} onClick={onClose}>Cancel</button><button className="action-button" disabled={m.isPending} onClick={() => row && m.mutate({ userId: row.userId, role })}>Change role</button></DialogFooter>
  </DialogContent></Dialog>;
}

function AssignmentDialog({ row, catalog, onClose }: { row: Row | null; catalog: Catalog; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [cls, setCls] = useState(row?.classes[0]?.gradeId ?? 0);
  const [subs, setSubs] = useState<Alloc[]>(() => row?.subjects.map(s => ({ gradeId: s.gradeId, subjectId: catalog.subjects.find(x => s.name.startsWith(x.name))?.id ?? catalog.subjects[0]?.id ?? 0 })) ?? []);
  const m = trpc.smis.administration.changeAssignment.useMutation({ onSuccess: () => { toast.success("Assignment updated"); utils.smis.administration.invalidate(); onClose(); }, onError: e => toast.error(errText(e.message)) });
  return <Dialog open={!!row} onOpenChange={o => !o && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Change assignment · {row?.fullName}</DialogTitle><DialogDescription>Replaces this user's allocations for {catalog.academicYear} {catalog.term}. Marks and attendance access follow these allocations.</DialogDescription></DialogHeader>
    <label className={label}>Class teacher of</label><select className={field} value={cls} onChange={e => setCls(Number(e.target.value))}><option value={0}>— None —</option>{catalog.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
    <label className={label}>Subjects taught</label><AllocationEditor value={subs} onChange={setSubs} catalog={catalog} />
    <DialogFooter><button className={ghost} onClick={onClose}>Cancel</button><button className="action-button" disabled={m.isPending} onClick={() => row && m.mutate({ userId: row.userId, classGradeId: cls || null, subjectAllocations: subs })}>Save assignment</button></DialogFooter>
  </DialogContent></Dialog>;
}

function AuditTable({ filters, page, onPage }: { filters: Record<string, unknown>; page: number; onPage: (n: number) => void }) {
  const q = trpc.smis.administration.audit.useQuery({ ...(filters as object), limit: 25, offset: page * 25 });
  if (q.error) return <p className="p-6 text-sm text-[#a3382c]">{errText(q.error.message)}</p>;
  const total = q.data?.total ?? 0;
  return <div>
    <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b border-[#e2e6dc] text-[0.68rem] uppercase tracking-wide text-[#718077]"><th className="px-4 py-3">Date / time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
      <tbody>{q.data?.rows.map(r => <tr key={r.id} className="border-b border-[#eef0e8] align-top"><td className="whitespace-nowrap px-4 py-3 text-[#718077]">{fmt(r.at)}</td><td className="font-semibold text-[#28483f]">{r.actor}</td><td><span className="rounded-md bg-[#e6f0e7] px-2 py-1 font-mono text-xs text-[#1d6a57]">{r.action}</span></td><td className="text-[#718077]">{r.target ?? "—"}</td><td className="max-w-[320px] break-words pr-4 text-xs text-[#718077]">{Object.entries(r.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || "—"}</td></tr>)}
        {!q.isLoading && !q.data?.rows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-[#718077]">No audit events match these filters.</td></tr>}</tbody></table></div>
    <div className="flex items-center justify-between px-4 py-3 text-xs text-[#718077]"><span>{total} event{total === 1 ? "" : "s"}</span><div className="flex gap-2"><button className={ghost} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><button className={ghost} disabled={(page + 1) * 25 >= total} onClick={() => onPage(page + 1)}>Next</button></div></div>
  </div>;
}

function AuditFilters({ value, onChange, withUser }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; withUser?: boolean }) {
  const users = trpc.smis.administration.list.useQuery(undefined, { enabled: !!withUser }); const modules = trpc.smis.administration.auditModules.useQuery();
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  return <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
    {withUser && <div><label className={label}>User</label><select className={field} value={value.userId ?? ""} onChange={e => set("userId", e.target.value)}><option value="">All users</option>{users.data?.map(u => <option key={u.userId} value={u.userId}>{u.fullName}</option>)}</select></div>}
    <div><label className={label}>Module</label><select className={field} value={value.module ?? ""} onChange={e => set("module", e.target.value)}><option value="">All modules</option>{modules.data?.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
    <div><label className={label}>Action</label><Input value={value.action ?? ""} onChange={e => set("action", e.target.value)} placeholder="e.g. role.change" className="mt-1" /></div>
    <div><label className={label}>From</label><Input type="date" value={value.from ?? ""} onChange={e => set("from", e.target.value)} className="mt-1" /></div>
    <div><label className={label}>To</label><Input type="date" value={value.to ?? ""} onChange={e => set("to", e.target.value)} className="mt-1" /></div>
  </div>;
}
const toQuery = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x).map(([k, x]) => [k, k === "userId" ? Number(x) : x]));

function ActivitySheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(0);
  return <Sheet open={!!row} onOpenChange={o => !o && onClose()}><SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
    <SheetHeader><SheetTitle>Activity · {row?.fullName}</SheetTitle><SheetDescription>Actions performed by this user and administrative actions taken on their account.</SheetDescription></SheetHeader>
    {row && <><AuditFilters value={f} onChange={v => { setF(v); setPage(0); }} /><AuditTable filters={{ userId: row.userId, ...toQuery(f) }} page={page} onPage={setPage} /></>}
  </SheetContent></Sheet>;
}

function MatrixTab({ users, isSuper }: { users: Row[]; isSuper: boolean }) {
  const utils = trpc.useUtils(); const [subject, setSubject] = useState("role:teacher");
  const arg = subject.startsWith("user:") ? { userId: Number(subject.slice(5)) } : { role: subject.slice(5) };
  const q = trpc.smis.administration.matrix.useQuery(arg);
  const refresh = () => utils.smis.administration.matrix.invalidate();
  const onError = (e: { message: string }) => toast.error(errText(e.message));
  const roleSet = trpc.smis.administration.setRolePermission.useMutation({ onSuccess: refresh, onError });
  const userSet = trpc.smis.administration.setUserPermission.useMutation({ onSuccess: refresh, onError });
  const d = q.data; const granted = new Set(d?.granted); const inherited = new Set(d?.inherited);
  const toggle = (key: string) => {
    if (!d || d.subject.locked || !isSuper) return;
    const next = !granted.has(key);
    if (d.subject.type === "role") roleSet.mutate({ role: d.subject.role, permissionKey: key, allowed: next });
    else userSet.mutate({ userId: d.subject.userId, permissionKey: key, allowed: next === inherited.has(key) ? null : next });
  };
  const roleLabel = Object.fromEntries((d?.roles ?? []).map(r => [r.value, r.label]));
  return <div>
    <div className="flex flex-wrap items-end gap-4 p-4">
      <div className="min-w-[260px]"><label className={label}>Configure permissions for</label><select className={field} value={subject} onChange={e => setSubject(e.target.value)}>
        <optgroup label="Roles">{(d?.roles ?? [{ value: "teacher", label: "Teacher" }]).map(r => <option key={r.value} value={`role:${r.value}`}>{r.label}</option>)}</optgroup>
        <optgroup label="Individual users">{users.map(u => <option key={u.userId} value={`user:${u.userId}`}>{u.fullName} · {u.roleLabel}</option>)}</optgroup></select></div>
      <p className="max-w-xl text-xs leading-5 text-[#718077]">{!isSuper ? "Only a Super Administrator can change permissions. This matrix shows what is currently granted." : d?.subject.locked ? "Super Administrator access is fixed and always complete." : d?.subject.type === "role" ? `Changes apply to every ${roleLabel[d.subject.role] ?? "user"}. Scope (allocated classes and subjects) still limits what each person can reach.` : "Overrides apply to this user only, on top of their role. Click a cell to override; click again to return to the role default."}</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full table-fixed text-xs sm:text-sm"><thead><tr className="border-y border-[#e2e6dc] text-[0.68rem] uppercase tracking-wide text-[#718077]"><th className="px-4 py-3 text-left">Module</th>{d?.actions.map(a => <th key={a} className="px-2 text-center">{a}</th>)}</tr></thead>
      <tbody>{d?.modules.map(m => <tr key={m.key} className="border-b border-[#eef0e8]"><td className="px-4 py-3 font-semibold text-[#28483f]">{m.label}</td>{d.actions.map(a => {
        const key = `${m.key}.${a}`; const on = granted.has(key); const overridden = d.subject.type === "user" && !d.subject.locked && on !== inherited.has(key);
        return <td key={a} className="px-2 text-center"><button role="switch" aria-checked={on} aria-label={`${m.label} ${a}`} disabled={!isSuper || d.subject.locked} onClick={() => toggle(key)} className={`h-6 w-11 rounded-full p-0.5 transition ${on ? "bg-[#1d6a57]" : "bg-[#cfd6cb]"} ${overridden ? "ring-2 ring-[#e7bd6d]" : ""} disabled:opacity-60`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-5" : ""}`} /></button></td>;
      })}</tr>)}</tbody></table></div>
  </div>;
}

type Confirm = { row: Row; action: "activate" | "suspend" | "lock" | "unlock" } | null;
const CONFIRM_TEXT = { activate: ["Activate account", "The user will be able to sign in again."], suspend: ["Suspend account", "The user is signed out immediately and cannot sign in until reactivated."], lock: ["Lock account", "The user is signed out immediately and cannot sign in until unlocked."], unlock: ["Unlock account", "Failed-login counters are cleared and the user can sign in."] } as const;

export function AdministrationWorkspace() {
  const utils = trpc.useUtils();
  const perms = trpc.smis.users.effectivePermissions.useQuery(); const catalogQ = trpc.smis.administration.catalog.useQuery();
  const [tab, setTab] = useState<"users" | "matrix" | "audit">("users");
  const [f, setF] = useState({ search: "", role: "", status: "" });
  const list = trpc.smis.administration.list.useQuery({ search: f.search || undefined, role: f.role || undefined, status: (f.status || undefined) as any });
  const overview = trpc.smis.administration.overview.useQuery();
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; row?: Row } | null>(null);
  const [roleRow, setRoleRow] = useState<Row | null>(null); const [assignRow, setAssignRow] = useState<Row | null>(null); const [activityRow, setActivityRow] = useState<Row | null>(null);
  const [viewRow, setViewRow] = useState<Row | null>(null); const [confirm, setConfirm] = useState<Confirm>(null); const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ link: { setupToken: string; expiresAt: Date | string }; name: string } | null>(null);
  const [auditF, setAuditF] = useState<Record<string, string>>({}); const [auditPage, setAuditPage] = useState(0);
  const setState = trpc.smis.administration.setState.useMutation({ onSuccess: () => { toast.success("Account updated"); utils.smis.administration.invalidate(); setConfirm(null); setReason(""); }, onError: e => toast.error(errText(e.message)) });
  const reset = trpc.smis.administration.resetPassword.useMutation({ onSuccess: (r, v) => setLink({ link: r, name: list.data?.find(u => u.userId === v.userId)?.fullName ?? "user" }), onError: e => toast.error(errText(e.message)) });
  const has = (k: string) => !!perms.data && (perms.data.includes("*") || perms.data.includes(k));
  const isSuper = !!perms.data?.includes("administration.manage_permissions");
  const forbidden = list.error?.data?.code === "FORBIDDEN";
  const catalog = catalogQ.data;
  const stats = overview.data;
  const rows = list.data ?? [];

  if (forbidden) return <div className="page-enter soft-card rounded-[1.1rem] p-10 text-center"><ShieldOff className="mx-auto text-[#a3382c]" size={30} /><h1 className="mt-4 font-editorial text-2xl text-[#28483f]">You do not have access to Administration</h1><p className="mx-auto mt-2 max-w-md text-sm text-[#718077]">Your role does not include user and credential management. Contact a Super Administrator if you believe this is a mistake.</p></div>;

  return <div className="page-enter space-y-6">
    <section className="relative overflow-hidden rounded-[1.2rem] bg-[#1c5547] px-5 py-7 text-[#fffefa] sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl"><p className="eyebrow !text-[#e7bd6d]">Access control</p><h1 className="mt-2 font-editorial text-[2.1rem] leading-[1.05]">Administration</h1><p className="mt-3 text-sm leading-6 text-[#d2e2d9]">Manage staff accounts, roles, permissions and class or subject scope. Every sensitive action is written to the audit trail.</p></div>
        {has("administration.create") && <button className="action-button bg-[#fffefa] text-[#1d6a57] shadow-none" onClick={() => setDialog({ mode: "create" })}><UserPlus size={15} />Create user</button>}</div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">{[["Accounts", stats?.total], ["Active", stats?.active], ["Pending setup", stats?.pending], ["Suspended", stats?.suspended], ["Locked", stats?.locked]].map(([k, v]) => <div key={String(k)} className="rounded-xl bg-white/10 px-4 py-3"><p className="text-[0.66rem] font-bold uppercase tracking-wider text-[#d2e2d9]">{k}</p><p className="mt-1 text-2xl font-bold">{v ?? "—"}</p></div>)}</div>
    </section>

    <div className="flex gap-2 border-b border-[#d8ddd4]" role="tablist">{([["users", "Users & Credentials", Users], ["matrix", "Permission Matrix", ShieldCheck], ["audit", "Audit Trail", History]] as const).map(([k, t, Icon]) =>
      <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold ${tab === k ? "border-[#1d6a57] text-[#1d6a57]" : "border-transparent text-[#718077] hover:text-[#28483f]"}`}><Icon size={15} />{t}</button>)}</div>

    <section className="soft-card paper-noise rounded-[1.1rem]">
      {tab === "users" && <>
        <div className="flex flex-wrap gap-3 p-4"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#718077]" /><Input aria-label="Search users" value={f.search} onChange={e => setF({ ...f, search: e.target.value })} placeholder="Search name, username, staff ID, department" className="pl-9" /></div>
          <select aria-label="Filter by role" className={`${field.replace("w-full", "")} !mt-0 w-auto`} value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="">All roles</option>{catalog?.roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <select aria-label="Filter by status" className={`${field.replace("w-full", "")} !mt-0 w-auto`} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending setup</option><option value="suspended">Suspended</option><option value="locked">Locked</option></select></div>
        <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-xs sm:text-sm"><thead><tr className="border-y border-[#e2e6dc] text-[0.66rem] uppercase tracking-wide text-[#718077]">{["User ID", "Full name", "Username", "Staff ID", "Role", "Department", "Class", "Subjects", "Status", "Last login", "Password changed", "Created", ""].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
          <tbody>{rows.map(u => <tr key={u.userId} className="border-b border-[#eef0e8] align-top hover:bg-[#f7f9f3]">
            <td className="px-3 py-3 font-mono text-xs text-[#718077]">#{u.userId}</td><td className="px-3 py-3 font-bold text-[#28483f]">{u.fullName}</td><td className="px-3 py-3 text-[#718077]">{u.username ?? "—"}</td><td className="px-3 py-3 text-[#718077]">{u.staffId ?? "—"}</td>
            <td className="px-3 py-3"><span className="rounded-md bg-[#f1f4ec] px-2 py-1 text-xs font-bold text-[#28483f]">{u.roleLabel}</span></td><td className="px-3 py-3 text-[#718077]">{u.department ?? "—"}</td>
            <td className="px-3 py-3 text-[#718077]">{u.classes.map(c => c.name).join(", ") || "—"}</td><td className="max-w-[220px] px-3 py-3 text-xs text-[#718077]">{u.subjects.map(s => s.name).join(", ") || "—"}</td>
            <td className="px-3 py-3"><StatusPill status={u.status} /></td><td className="whitespace-nowrap px-3 py-3 text-xs text-[#718077]">{u.lastLogin ? fmt(u.lastLogin) : "Never"}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-[#718077]">{u.passwordChangedAt ? fmt(u.passwordChangedAt) : "Not set"}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-[#718077]">{fmt(u.createdAt, false)}</td>
            <td className="px-3 py-3"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label={`Actions for ${u.fullName}`} className={ghost}><MoreHorizontal size={15} /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel>{u.fullName}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setViewRow(u)}><Eye size={14} />View</DropdownMenuItem>
                {has("administration.edit") && <><DropdownMenuItem onClick={() => setDialog({ mode: "edit", row: u })}><Pencil size={14} />Edit</DropdownMenuItem><DropdownMenuItem onClick={() => setRoleRow(u)}><UserCog size={14} />Change role</DropdownMenuItem><DropdownMenuItem onClick={() => setAssignRow(u)}><Users size={14} />Change assignment</DropdownMenuItem><DropdownMenuItem onClick={() => reset.mutate({ userId: u.userId })}><KeyRound size={14} />Reset password</DropdownMenuItem><DropdownMenuSeparator />
                  {(u.status === "suspended") && <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "activate" })}><UserCheck size={14} />Activate account</DropdownMenuItem>}
                  {(u.status === "active") && <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "suspend" })}><ShieldOff size={14} />Suspend account</DropdownMenuItem>}
                  {(u.status === "active" || u.status === "suspended") && <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "lock" })}><Lock size={14} />Lock account</DropdownMenuItem>}
                  {u.status === "locked" && <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "unlock" })}><LockOpen size={14} />Unlock account</DropdownMenuItem>}<DropdownMenuSeparator /></>}
                <DropdownMenuItem onClick={() => setActivityRow(u)}><History size={14} />View user activity</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr>)}
            {!list.isLoading && !rows.length && <tr><td colSpan={13} className="px-4 py-12 text-center text-[#718077]">No users match your search.</td></tr>}</tbody></table></div></>}
      {tab === "matrix" && <MatrixTab users={rows} isSuper={isSuper} />}
      {tab === "audit" && <><AuditFilters withUser value={auditF} onChange={v => { setAuditF(v); setAuditPage(0); }} /><AuditTable filters={toQuery(auditF)} page={auditPage} onPage={setAuditPage} /></>}
    </section>

    {catalog && dialog && <UserDialog key={dialog.row?.userId ?? "new"} mode={dialog.mode} row={dialog.row} catalog={catalog} onClose={() => setDialog(null)} onLink={(l, name) => setLink({ link: l, name })} />}
    {catalog && roleRow && <RoleDialog key={roleRow.userId} row={roleRow} catalog={catalog} onClose={() => setRoleRow(null)} />}
    {catalog && assignRow && <AssignmentDialog key={assignRow.userId} row={assignRow} catalog={catalog} onClose={() => setAssignRow(null)} />}
    <ActivitySheet row={activityRow} onClose={() => setActivityRow(null)} />
    <SetupLinkDialog link={link?.link ?? null} name={link?.name ?? ""} onClose={() => setLink(null)} />
    <Dialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}><DialogContent>{confirm && <><DialogHeader><DialogTitle>{CONFIRM_TEXT[confirm.action][0]} · {confirm.row.fullName}</DialogTitle><DialogDescription>{CONFIRM_TEXT[confirm.action][1]}</DialogDescription></DialogHeader>
      {(confirm.action === "suspend" || confirm.action === "lock") && <div><label className={label}>Reason (recorded in the audit trail)</label><Input value={reason} onChange={e => setReason(e.target.value)} className="mt-1" /></div>}
      <DialogFooter><button className={ghost} onClick={() => setConfirm(null)}>Cancel</button><button className="action-button" disabled={setState.isPending} onClick={() => setState.mutate({ userId: confirm.row.userId, action: confirm.action, reason: reason || undefined })}>{CONFIRM_TEXT[confirm.action][0]}</button></DialogFooter></>}</DialogContent></Dialog>
    <Dialog open={!!viewRow} onOpenChange={o => !o && setViewRow(null)}><DialogContent>{viewRow && <><DialogHeader><DialogTitle>{viewRow.fullName}</DialogTitle><DialogDescription>{viewRow.roleLabel} · <StatusPill status={viewRow.status} /></DialogDescription></DialogHeader>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{([["User ID", `#${viewRow.userId}`], ["Username", viewRow.username], ["Staff ID", viewRow.staffId], ["Department", viewRow.department], ["Email", viewRow.email], ["Phone", viewRow.phone], ["Class", viewRow.classes.map(c => c.name).join(", ")], ["Subjects", viewRow.subjects.map(s => s.name).join(", ")], ["Last login", viewRow.lastLogin ? fmt(viewRow.lastLogin) : "Never"], ["Password changed", viewRow.passwordChangedAt ? fmt(viewRow.passwordChangedAt) : "Not set"], ["Created", fmt(viewRow.createdAt)]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className={label}>{k}</dt><dd className="mt-0.5 text-[#28483f]">{v || "—"}</dd></div>)}</dl>
      <p className="text-xs text-[#718077]">Passwords are stored as one-way hashes and are never displayed.</p></>}</DialogContent></Dialog>
  </div>;
}
