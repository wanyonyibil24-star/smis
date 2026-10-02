import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReportCardSheet } from "./ReportCardSheet";
import "./reportCard.css";
import { ASSESSMENT_LABEL, TERMS, type AssessmentType, type ReportBatch, type ReportCardData, type ReportOptions, type ReportRequest } from "../shared/reportCard";

type SaveCommentInput = {
  learnerId: number;
  academicYear: number;
  term: string;
  assessmentType: AssessmentType;
  classTeacherComment: string | null;
  headTeacherComment: string | null;
};

/** The host supplies calls backed by NEXUS's authenticated tRPC client. */
export type ReportCardClient = {
  options(): Promise<ReportOptions>;
  generate(req: ReportRequest): Promise<ReportBatch>;
  saveComments?(input: SaveCommentInput): Promise<unknown>;
};
type Mode = "learner" | "class" | "grade";

function CommentEditor({ card, batch, onSave }: {
  card: ReportCardData;
  batch: ReportBatch;
  onSave(input: SaveCommentInput): Promise<void>;
}) {
  const [classComment, setClassComment] = useState(card.comments.classTeacher ?? "");
  const [headComment, setHeadComment] = useState(card.comments.headTeacher ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setClassComment(card.comments.classTeacher ?? "");
    setHeadComment(card.comments.headTeacher ?? "");
  }, [card.learner.id, card.comments.classTeacher, card.comments.headTeacher]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        learnerId: card.learner.id,
        academicYear: batch.academicYear,
        term: batch.term,
        assessmentType: batch.assessmentType,
        classTeacherComment: classComment.trim() || null,
        headTeacherComment: headComment.trim() || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save report comments.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rcp-comment-editor" aria-label={`Comments for ${card.learner.fullName}`}>
      <h3>Report comments</h3>
      <div className="rcp-comment-fields">
        <label>Class teacher comment
          <textarea maxLength={1000} value={classComment} onChange={event => setClassComment(event.target.value)} />
        </label>
        <label>Head teacher comment
          <textarea maxLength={1000} value={headComment} onChange={event => setHeadComment(event.target.value)} />
        </label>
      </div>
      {error && <p className="rcp-msg rcp-err" role="alert">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save comments"}</button>
    </section>
  );
}

export default function ReportCardPage({ client, canEditComments = false }: { client: ReportCardClient; canEditComments?: boolean }) {
  const [opts, setOpts] = useState<ReportOptions | null>(null);
  const [year, setYear] = useState(0);
  const [term, setTerm] = useState<string>(TERMS[0]);
  const [type, setType] = useState<AssessmentType>("end_term");
  const [mode, setMode] = useState<Mode>("learner");
  const [gradeName, setGradeName] = useState("");
  const [gradeId, setGradeId] = useState(0);
  const [learnerId, setLearnerId] = useState(0);
  const [fees, setFees] = useState(false);
  const [batch, setBatch] = useState<ReportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const api = useRef(client);
  api.current = client;

  useEffect(() => {
    api.current.options().then(options => {
      setOpts(options);
      setYear(options.defaultYear);
      setTerm(options.defaultTerm);
      setFees(options.defaultIncludeFees && options.canViewFinance);
      setGradeName(options.grades[0]?.name ?? "");
      setGradeId(options.grades[0]?.id ?? 0);
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load report options."));
  }, []);

  const gradeNames = useMemo(() => Array.from(new Set((opts?.grades ?? []).map(grade => grade.name))), [opts]);
  const classLearners = useMemo(() => (opts?.learners ?? []).filter(learner => learner.gradeId === gradeId), [opts, gradeId]);
  useEffect(() => {
    if (!classLearners.some(learner => learner.id === learnerId)) setLearnerId(classLearners[0]?.id ?? 0);
  }, [classLearners, learnerId]);

  const request = (): ReportRequest | null => {
    const target = mode === "learner" ? (learnerId ? { kind: "learner" as const, learnerId } : null)
      : mode === "class" ? (gradeId ? { kind: "class" as const, gradeId } : null)
        : (gradeName ? { kind: "grade" as const, gradeName } : null);
    return target ? { academicYear: year, term, assessmentType: type, target, includeFees: fees } : null;
  };

  async function run(then: "preview" | "print") {
    const req = request();
    if (!req) { setError("Select a learner, class or grade first."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await api.current.generate(req);
      setBatch(result);
      if (then === "print") setPrinting(true);
    } catch (cause) {
      setBatch(null);
      setError(cause instanceof Error ? cause.message : "The report could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function saveComments(input: SaveCommentInput) {
    if (!api.current.saveComments) throw new Error("Comment editing is unavailable.");
    await api.current.saveComments(input);
    setBatch(current => current ? {
      ...current,
      cards: current.cards.map(card => card.learner.id === input.learnerId
        ? { ...card, comments: { classTeacher: input.classTeacherComment, headTeacher: input.headTeacherComment } }
        : card),
    } : current);
  }

  useEffect(() => {
    if (!printing || !batch) return;
    const previous = document.title;
    document.title = `Report Cards - ${batch.cards.length === 1 ? batch.cards[0].learner.fullName : batch.cards[0]?.grade.label ?? ""} - ${batch.term} ${batch.academicYear}`;
    const done = () => { document.title = previous; setPrinting(false); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const timer = setTimeout(() => window.print(), 150);
    return () => clearTimeout(timer);
  }, [printing, batch]);

  if (!opts) return <div className="rcp" aria-live="polite">{error ? <div className="rcp-msg rcp-err" role="alert">{error}</div> : "Loading report options…"}</div>;

  return (
    <div className="rcp">
      <h2>Report Cards</h2>
      <p className="rcp-sub">{opts.school.name} &middot; access: {opts.accessLabel}</p>
      <div className="rcp-panel">
        <label>Academic Year<select value={year} onChange={event => setYear(Number(event.target.value))}>{opts.years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Term<select value={term} onChange={event => setTerm(event.target.value)}>{TERMS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Assessment Type<select value={type} onChange={event => setType(event.target.value as AssessmentType)}>
          {(Object.keys(ASSESSMENT_LABEL) as AssessmentType[]).map(key => <option key={key} value={key}>{ASSESSMENT_LABEL[key]}</option>)}</select></label>
        <div className="rcp-seg" role="group" aria-label="Report scope">
          {([ ["learner", "Individual learner"], ["class", "Whole class"], ["grade", "Whole grade"] ] as const).map(([key, text]) =>
            <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>{text}</button>)}
        </div>
        {mode === "grade"
          ? <label>Grade<select value={gradeName} onChange={event => setGradeName(event.target.value)}>{gradeNames.map(name => <option key={name}>{name}</option>)}</select></label>
          : <label>Grade / Class<select value={gradeId} onChange={event => setGradeId(Number(event.target.value))}>{opts.grades.map(grade => <option key={grade.id} value={grade.id}>{grade.label}</option>)}</select></label>}
        {mode === "learner" && <label>Learner<select value={learnerId} onChange={event => setLearnerId(Number(event.target.value))}>
          {classLearners.map(learner => <option key={learner.id} value={learner.id}>{learner.fullName} ({learner.admissionNumber})</option>)}</select></label>}
        <label className="rcp-fees"><input type="checkbox" checked={fees} onChange={event => setFees(event.target.checked)} /> Include Fees Balance on Report Card
          {!opts.canViewFinance && <small>(your account has no fee access; the server will not release fee data)</small>}</label>
        <div className="rcp-actions">
          <button type="button" disabled={busy} onClick={() => void run("preview")}>Preview Report</button>
          <button type="button" className="alt" disabled={busy} onClick={() => void run("print")} title="Choose 'Save as PDF' in the print dialog">Generate PDF</button>
          <button type="button" className="alt" disabled={busy} onClick={() => void run("print")}>Print</button>
        </div>
      </div>

      {error && <div className="rcp-msg rcp-err" role="alert">{error}</div>}
      {batch?.feesStatus === "denied" && <div className="rcp-msg rcp-warn" role="alert">Fee information was not included. {batch.feesMessage}</div>}
      {batch && batch.skippedClasses.length > 0 && <div className="rcp-msg rcp-warn">Not included (outside your scope): {batch.skippedClasses.join(", ")}.</div>}
      {batch && <p className="rcp-sub">{batch.cards.length} report card{batch.cards.length === 1 ? "" : "s"} ready.</p>}
      {batch && <div className="rcp-stage">{batch.cards.map(card => (
        <div className="rcp-card-wrap" key={card.learner.id}>
          <ReportCardSheet card={card} batch={batch} />
          {canEditComments && !card.partial && client.saveComments && <CommentEditor card={card} batch={batch} onSave={saveComments} />}
        </div>
      ))}</div>}
      {printing && batch && createPortal(<div className="rc-print-portal">{batch.cards.map(card => <ReportCardSheet key={card.learner.id} card={card} batch={batch} />)}</div>, document.body)}
    </div>
  );
}
