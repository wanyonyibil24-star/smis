import type { ReportCardData, ReportBatch } from "../shared/reportCard";
import { ASSESSMENT_LABEL, BAND_LABEL, kes, levelLabel } from "../shared/reportCard";

const fmt = (n: number | null) => (n === null ? "-" : Number.isInteger(n) ? String(n) : n.toFixed(1));

function TrendChart({ rows }: { rows: ReportCardData["rows"] }) {
  const data = rows.filter(r => r.state === "published" && (r.midTerm !== null || r.endTerm !== null));
  if (!data.length) return null;
  const W = 700, H = 150, L = 28, B = 46, T = 8, plotH = H - B - T, slot = (W - L) / data.length;
  const y = (v: number) => T + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}.` : s);
  return (
    <svg className="rc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mid-term and end-term marks by learning area">
      {[0, 50, 100].map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="rc-grid" /><text x={L - 4} y={y(v) + 3} textAnchor="end" className="rc-axis">{v}</text></g>)}
      {data.map((r, i) => {
        const bw = Math.min(slot * 0.28, 22), x0 = L + i * slot + (slot - 2 * bw - 2) / 2;
        return (
          <g key={r.subjectId}>
            {r.midTerm !== null && <rect x={x0} y={y(r.midTerm)} width={bw} height={T + plotH - y(r.midTerm)} className="rc-bar-mid" />}
            {r.endTerm !== null && <rect x={x0 + bw + 2} y={y(r.endTerm)} width={bw} height={T + plotH - y(r.endTerm)} className="rc-bar-end" />}
            <text transform={`translate(${x0 + bw},${T + plotH + 8}) rotate(35)`} className="rc-axis">{short(r.subject)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function ReportCardSheet({ card, batch }: { card: ReportCardData; batch: ReportBatch }) {
  const { school: s } = batch; const sum = card.summary; const a = card.attendance;
  const contact = [s.address, s.phone, s.email].filter(Boolean).join("  |  ");
  const dense = card.rows.length > 11 ? " rc-dense" : "";
  return (
    <section className={`rc-sheet${dense}`}>
      <div className="rc-frame">
        <header className="rc-head">
          <div className="rc-logo">{s.logoPath ? <img src={s.logoPath} alt="" /> : null}</div>
          <div className="rc-head-text">
            <h1>{s.name}</h1>
            {contact && <p>{contact}</p>}
            {s.motto && <p className="rc-motto">{s.motto}</p>}
          </div>
          <div className="rc-logo" />
        </header>
        <div className="rc-title">Learner Assessment Report Card</div>

        <table className="rc-info"><tbody>
          <tr><th>Name</th><td colSpan={3}>{card.learner.fullName}</td><th>Adm. No.</th><td>{card.learner.admissionNumber}</td></tr>
          <tr><th>Grade / Class</th><td>{card.grade.label}</td><th>Term</th><td>{batch.term}</td><th>Year</th><td>{batch.academicYear}</td></tr>
          <tr><th>Assessment</th><td colSpan={3}>{ASSESSMENT_LABEL[batch.assessmentType]}</td><th>Class Teacher</th><td>{card.classTeacher ?? "-"}</td></tr>
        </tbody></table>

        <table className="rc-marks">
          <thead><tr><th className="l rc-area">Learning Area</th><th>Mid-Term</th><th>End-Term</th><th>Average</th><th className="l rc-remark">Teacher Remark</th><th>Performance Level</th><th className="l rc-facilitator">Facilitator</th></tr></thead>
          <tbody>
            {card.rows.map(r => (
              <tr key={r.subjectId}>
                <td className="l">{r.subject}</td>
                {r.state === "published"
                  ? <><td>{fmt(r.midTerm)}</td><td>{fmt(r.endTerm)}</td><td><b>{fmt(r.average)}</b></td><td className="l rc-remark">{r.teacherRemark?.trim() || "-"}</td><td>{levelLabel(r.cbcLevel)}</td></>
                  : <td colSpan={5} className="rc-pending">{r.state === "pending" ? "Assessment not yet approved" : "No mark recorded"}</td>}
                <td className="l">{r.facilitator ?? "-"}</td>
              </tr>
            ))}
            {!card.rows.length && <tr><td colSpan={7} className="rc-pending">No assessments exist for this class in the selected period.</td></tr>}
          </tbody>
        </table>

        {!card.partial && <table className="rc-totals"><tbody>
          <tr><th>Total Marks</th><td>{sum.midTotal === null ? "-" : `${fmt(sum.midTotal)}/${sum.midOutOf}`} (Mid) &nbsp; {sum.endTotal === null ? "-" : `${fmt(sum.endTotal)}/${sum.endOutOf}`} (End)</td>
              <th>Termly Average</th><td>{sum.termAverage === null ? "-" : `${fmt(sum.termAverage)}/100`}</td></tr>
          <tr><th>Total of Averages</th><td>{sum.totalAverage === null ? "-" : `${fmt(sum.totalAverage)}/${sum.outOf}`}</td>
              <th>Overall Level</th><td>{sum.overall ? `${sum.overall} - ${BAND_LABEL[sum.overall]}` : "-"}</td></tr>
        </tbody></table>}

        <div className="rc-mid">
          <div className="rc-chart-box"><h2>Performance Trend</h2><TrendChart rows={card.rows} />
            <p className="rc-legend"><i className="m" /> Mid-Term <i className="e" /> End-Term</p></div>
          <div className="rc-side">
            <table className="rc-small"><caption>Attendance</caption><tbody>
              <tr><th>Days open</th><td>{a.daysOpen || "-"}</td></tr>
              <tr><th>Days present</th><td>{a.daysOpen ? a.daysPresent : "-"}</td></tr>
              <tr><th>Days absent</th><td>{a.daysOpen ? a.daysAbsent : "-"}</td></tr>
              <tr><th>Attendance</th><td>{a.percentage === null ? "-" : `${a.percentage}%`}</td></tr>
            </tbody></table>
            {card.fees && (
              <table className="rc-small"><caption>Fee Statement</caption><tbody>
                {card.fees.status === "ok"
                  ? <><tr><th>Total fees</th><td>{kes(card.fees.totalFees)}</td></tr><tr><th>Amount paid</th><td>{kes(card.fees.amountPaid)}</td></tr>
                      <tr><th>{card.fees.balance > 0 ? "Arrears" : "Balance"}</th><td><b>{kes(card.fees.balance)}</b></td></tr></>
                  : <tr><td colSpan={2}>No fee record on file.</td></tr>}
              </tbody></table>
            )}
          </div>
        </div>

        <div className="rc-comments">
          <div><b>Class Teacher's Comment:</b> {card.comments.classTeacher ?? <span className="rc-lines" />}</div>
          <div><b>Head Teacher's Comment:</b> {card.comments.headTeacher ?? <span className="rc-lines" />}</div>
        </div>
        {card.partial && <p className="rc-note">Partial report: only the learning areas allocated to the issuing teacher are shown, so no overall total, average or level is given.</p>}

        <div className="rc-sign">
          <div>{s.classTeacherSignaturePath ? <img src={s.classTeacherSignaturePath} alt="" /> : <span className="rc-gap" />}<p>Class Teacher's Signature</p></div>
          <div>{s.principalSignaturePath ? <img src={s.principalSignaturePath} alt="" /> : <span className="rc-gap" />}<p>Head Teacher's Signature &amp; Stamp</p></div>
          <div><span className="rc-gap" /><p>Parent / Guardian's Signature</p></div>
        </div>
        <footer className="rc-foot">This report card is issued without alterations. Any alteration invalidates its authenticity.</footer>
      </div>
    </section>
  );
}
