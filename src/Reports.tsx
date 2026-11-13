// SPDX-License-Identifier: Apache-2.0
// Reports module: monthly service, customer SLA, workforce, stand-up and
// shift-handover reports, shown on screen and printed to PDF (A4 portrait).

import { t, getLocale } from './i18n';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Pencil, Plus, Printer, Save, Trash2, Upload } from 'lucide-react';
import { api } from './api';
import type { AppSnapshot, AuthUser, Health, IncidentAuditEntry, IncidentPriority, IncidentRow, IncidentStatus, ReportSettings } from './types';
import {
  PRIORITIES,
  buildHandoverReport,
  buildServiceReport,
  buildSlaReport,
  buildStandupReport,
  buildWorkforceReport,
  complianceTone,
  computeKpiHealth,
  customersOf,
  dateKey,
  datesIn,
  formatDate as formatReportDate,
  formatDuration,
  formatPercent as formatReportPercent,
  formatPeriod as formatReportPeriod,
  formatStamp as formatReportStamp,
  measureIncident,
  monthPeriod,
  parseDurationInput,
  parseStamp,
  reportSettingsOf,
} from './reportCalc';
import type { IncidentMetrics, Period, SlaReport, SlaState, Stats } from './reportCalc';
import './reports.css';

const formatDate = (value: string) => formatReportDate(value, getLocale());
const formatStamp = (value: string) => formatReportStamp(value, getLocale());
const formatPercent = (value: number | null) => formatReportPercent(value, getLocale());
const formatPeriod = (period: Period) => formatReportPeriod(period, getLocale());

type ReportKey = 'service' | 'sla' | 'workforce' | 'standup' | 'handover' | 'incidents';

const REPORT_TABS: Array<{ key: ReportKey; label: string; printable: boolean }> = [
  { key: 'service', label: 'Monthly service report', printable: true },
  { key: 'sla', label: 'Customer SLA report', printable: true },
  { key: 'workforce', label: 'Workforce & attendance', printable: true },
  { key: 'standup', label: 'Stand-up & tasks', printable: true },
  { key: 'handover', label: 'Shift handover', printable: true },
  { key: 'incidents', label: 'Incident register', printable: false },
];

const PRIORITY_COLORS: Record<IncidentPriority, string> = { P1: '#d5323f', P2: '#f08c00', P3: '#0a60ff', P4: '#8d99a6' };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INCIDENT_STATUSES: IncidentStatus[] = ['Open', 'Acknowledged', 'Resolved', 'Closed'];

type Mutate = (action: string, work: () => Promise<AppSnapshot>) => Promise<void>;

export function ReportsView({ app, user, busy, mutate }: { app: AppSnapshot; user: AuthUser; busy: boolean; mutate: Mutate }) {
  const [tab, setTab] = useState<ReportKey>('service');
  const [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [rangeMode, setRangeMode] = useState<'month' | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState(() => monthPeriod(dateKey(new Date())).from);
  const [customTo, setCustomTo] = useState(() => dateKey(new Date()));
  const [customer, setCustomer] = useState('');
  const [handoverDate, setHandoverDate] = useState(() => dateKey(new Date()));
  const [printing, setPrinting] = useState(false);

  const settings = reportSettingsOf(app);
  const period: Period = rangeMode === 'month'
    ? monthPeriod(`${month}-01`)
    : { from: customFrom <= customTo ? customFrom : customTo, to: customFrom <= customTo ? customTo : customFrom };
  const canEdit = user.role !== 'Viewer';
  const active = REPORT_TABS.find((item) => item.key === tab)!;
  const preparedBy = user.displayName || user.username;

  useEffect(() => {
    if (!printing) return undefined;
    document.body.classList.add('print-report');
    const done = () => {
      document.body.classList.remove('print-report');
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    // Let the portal render before opening the print dialog.
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('print-report');
    };
  }, [printing]);

  const documentNode = active.printable ? (
    <ReportDocument report={tab} app={app} period={period} customer={customer} handoverDate={handoverDate} settings={settings} preparedBy={preparedBy} />
  ) : null;

  return (
    <div className="reports-module">
      <div className="report-tabs" role="tablist" aria-label={t("Reports")}>
        {REPORT_TABS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'report-tab active' : 'report-tab'} onClick={() => setTab(item.key)}>
            {t(item.label)}
          </button>
        ))}
      </div>

      {active.printable ? (
        <div className="report-toolbar">
          {tab === 'handover' ? (
            <label className="report-field">{t("Handover date")} <input type="date" value={handoverDate} onChange={(event) => setHandoverDate(event.target.value)} />
            </label>
          ) : (
            <>
              <label className="report-field">{t("Period")} <select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as 'month' | 'custom')}>
                  <option value="month">{t("Calendar month")}</option>
                  <option value="custom">{t("Custom range")}</option>
                </select>
              </label>
              {rangeMode === 'month' ? (
                <label className="report-field">{t("Month")} <input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
                </label>
              ) : (
                <>
                  <label className="report-field">{t("From")}<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
                  <label className="report-field">{t("To")}<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
                </>
              )}
            </>
          )}
          {tab === 'sla' ? (
            <label className="report-field">{t("Customer")} <select value={customer} onChange={(event) => setCustomer(event.target.value)}>
                <option value="">{t("All customers")}</option>
                {customersOf(app).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ) : null}
          <span className="report-toolbar-spacer" />
          <button type="button" className="primary-btn" onClick={() => setPrinting(true)} disabled={printing}>
            <Printer size={14} /> {t("Print / Save as PDF")} </button>
        </div>
      ) : null}

      {documentNode ? <div className="report-paper-shell">{documentNode}</div> : null}
      {tab === 'incidents' ? <IncidentRegister app={app} canEdit={canEdit} isAdmin={user.role === 'Admin'} busy={busy} mutate={mutate} /> : null}

      {printing && documentNode ? createPortal(<div className="report-print-portal">{documentNode}</div>, document.body) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report document shell
// ---------------------------------------------------------------------------

function ReportDocument(props: { report: ReportKey; app: AppSnapshot; period: Period; customer: string; handoverDate: string; settings: ReportSettings; preparedBy: string }) {
  const { report, app, period, customer, handoverDate, settings, preparedBy } = props;
  const now = new Date();
  const titles: Record<string, string> = {
    service: 'Monthly SOC Service Report',
    sla: 'SLA Performance Report',
    workforce: 'Workforce & Attendance Report',
    standup: 'Stand-up & Task Report',
    handover: 'Shift Handover Report',
  };
  const subtitle = report === 'handover'
    ? formatDate(handoverDate)
    : `${formatPeriod(period)}${report === 'sla' ? ` · ${customer || t('All customers')}` : ''}`;

  let body: ReactNode = null;
  if (report === 'service') body = <ServiceReportBody app={app} period={period} now={now} settings={settings} />;
  if (report === 'sla') body = <SlaReportBody report={buildSlaReport(app, period, customer, now)} settings={settings} customer={customer} />;
  if (report === 'workforce') body = <WorkforceReportBody app={app} period={period} settings={settings} />;
  if (report === 'standup') body = <StandupReportBody app={app} period={period} />;
  if (report === 'handover') body = <HandoverReportBody app={app} date={handoverDate} now={now} />;

  return (
    <article className="report-doc">
      <header className="rpt-header">
        <div>
          <div className="rpt-org">{settings.orgName}</div>
          <h1 className="rpt-title">{t(titles[report])}</h1>
          <div className="rpt-subtitle">{t(subtitle)}</div>
        </div>
        <dl className="rpt-meta">
          <div><dt>{t("Prepared by")}</dt><dd>{preparedBy}</dd></div>
          <div><dt>{t("Generated")}</dt><dd>{now.toLocaleString(getLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div>
          <div><dt>{t("Classification")}</dt><dd>{t("Internal – Confidential")}</dd></div>
        </dl>
      </header>
      {body}
      <footer className="rpt-footer">{settings.orgName} · {t(titles[report])} {t("· Generated by SOC Cockpit")}</footer>
    </article>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rpt-section">
      <h2>{t(title)}{note ? <span className="rpt-section-note">{t(note)}</span> : null}</h2>
      {children}
    </section>
  );
}

function Tiles({ items }: { items: Array<{ label: string; value: string; hint?: string; tone?: Health | 'neutral' }> }) {
  return (
    <div className="rpt-tiles">
      {items.map((item) => (
        <div key={item.label} className={`rpt-tile ${item.tone ?? 'neutral'}`}>
          <div className="rpt-tile-value">{item.value}</div>
          <div className="rpt-tile-label">{t(item.label)}</div>
          {item.hint ? <div className="rpt-tile-hint">{t(item.hint)}</div> : null}
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rpt-empty">{children}</p>;
}

function SignOff({ roles }: { roles: string[] }) {
  return (
    <section className="rpt-section rpt-signoff">
      {roles.map((role) => (
        <div key={role} className="rpt-sign">
          <div className="rpt-sign-line" />
          <div className="rpt-sign-role">{t(role)}</div>
          <div className="rpt-sign-meta">{t("Name / Signature / Date")}</div>
        </div>
      ))}
    </section>
  );
}

function HealthDot({ health }: { health: Health }) {
  return <span className={`rpt-dot ${health}`} aria-label={t(health)} />;
}

/** Stand-up completion colour (not an SLA, so fixed thresholds). */
function taskTone(rate: number | null): Health | 'neutral' {
  if (rate === null) return 'neutral';
  if (rate >= 85) return 'healthy';
  if (rate >= 70) return 'watch';
  return 'risk';
}

function StateBadge({ state }: { state: SlaState }) {
  const label = { met: 'Met', breached: 'Breached', pending: 'In progress', na: '—' }[state];
  return <span className={`rpt-state ${state}`}>{t(label)}</span>;
}

function statCell(value: Stats) {
  return value.count ? formatDuration(value.avg) : '—';
}

// ---------------------------------------------------------------------------
// Simple SVG charts (print friendly)
// ---------------------------------------------------------------------------

function BarChart({ data, height = 120, valueLabel }: { data: Array<{ label: string; segments: Array<{ value: number; color: string }>; marker?: boolean }>; height?: number; valueLabel?: string }) {
  const width = 700;
  const padLeft = 28;
  const padBottom = 18;
  const max = Math.max(1, ...data.map((item) => item.segments.reduce((sum, seg) => sum + seg.value, 0)));
  const step = data.length ? (width - padLeft) / data.length : 0;
  const barWidth = Math.max(2, step * 0.7);
  const plotHeight = height - padBottom - 6;
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <svg className="rpt-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t(valueLabel ?? 'chart')}>
      {ticks.map((tick) => {
        const y = 6 + plotHeight - (tick / max) * plotHeight;
        return (
          <g key={tick}>
            <line x1={padLeft} x2={width} y1={y} y2={y} className="rpt-chart-grid" />
            <text x={padLeft - 4} y={y + 3} className="rpt-chart-axis" textAnchor="end">{tick}</text>
          </g>
        );
      })}
      {data.map((item, index) => {
        let y = 6 + plotHeight;
        const x = padLeft + index * step + (step - barWidth) / 2;
        return (
          <g key={`${item.label}-${index}`}>
            {item.marker ? <rect x={padLeft + index * step} y={6} width={step} height={plotHeight} className="rpt-chart-marker" /> : null}
            {item.segments.map((segment, segIndex) => {
              const h = (segment.value / max) * plotHeight;
              y -= h;
              return segment.value > 0 ? <rect key={segIndex} x={x} y={y} width={barWidth} height={h} fill={segment.color} rx={1} /> : null;
            })}
            {data.length <= 16 || index % Math.ceil(data.length / 16) === 0 ? (
              <text x={x + barWidth / 2} y={height - 5} className="rpt-chart-axis" textAnchor="middle">{t(item.label)}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="rpt-legend">
      {items.map((item) => <span key={item.label}><i style={{ background: item.color }} />{t(item.label)}</span>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLA report
// ---------------------------------------------------------------------------

function SlaPriorityTable({ report, settings }: { report: SlaReport; settings: ReportSettings }) {
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          <th>{t("Priority")}</th><th className="num">{t("Incidents")}</th><th className="num">{t("Open")}</th>
          <th className="num">{t("MTTD")}</th><th className="num">{t("MTTA")}</th><th className="num">{t("MTTA median")}</th>
          <th className="num">{t("MTTR")}</th><th className="num">{t("MTTR median")}</th>
          <th className="num">{t("Ack SLA")}</th><th className="num">{t("Resolve SLA")}</th>
        </tr>
      </thead>
      <tbody>
        {report.rows.map((row) => (
          <tr key={row.priority} className={row.count ? '' : 'rpt-muted-row'}>
            <td><span className="rpt-prio" style={{ background: PRIORITY_COLORS[row.priority] }}>{row.priority}</span></td>
            <td className="num">{row.count}</td>
            <td className="num">{row.open}</td>
            <td className="num">{statCell(row.ttd)}</td>
            <td className="num">{statCell(row.tta)}</td>
            <td className="num">{row.tta.count ? formatDuration(row.tta.median) : '—'}</td>
            <td className="num">{statCell(row.ttr)}</td>
            <td className="num">{row.ttr.count ? formatDuration(row.ttr.median) : '—'}</td>
            <td className={`num tone-${complianceTone(row.ackCompliance, settings)}`}>{formatPercent(row.ackCompliance)}</td>
            <td className={`num tone-${complianceTone(row.resolveCompliance, settings)}`}>{formatPercent(row.resolveCompliance)}</td>
          </tr>
        ))}
        <tr className="rpt-total-row">
          <td>{t("All")}</td>
          <td className="num">{report.total.count}</td>
          <td className="num">{report.total.open}</td>
          <td className="num">{statCell(report.total.ttd)}</td>
          <td className="num">{statCell(report.total.tta)}</td>
          <td className="num">{report.total.tta.count ? formatDuration(report.total.tta.median) : '—'}</td>
          <td className="num">{statCell(report.total.ttr)}</td>
          <td className="num">{report.total.ttr.count ? formatDuration(report.total.ttr.median) : '—'}</td>
          <td className={`num tone-${complianceTone(report.total.ackCompliance, settings)}`}>{formatPercent(report.total.ackCompliance)}</td>
          <td className={`num tone-${complianceTone(report.total.resolveCompliance, settings)}`}>{formatPercent(report.total.resolveCompliance)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function SlaReportBody({ report, settings, customer }: { report: SlaReport; settings: ReportSettings; customer: string }) {
  const total = report.total;
  if (!report.incidents.length) {
    return (
      <Section title={t("Summary")}>
        <Empty>{t("No incidents were detected in this period")}{customer ? ` for ${customer}` : ''}{t(". Import your SLA sheet (Excel or CSV) in the Incident register tab: one row per ticket with priority, detected date and MTTD / MTTA / MTTR.")}</Empty>
      </Section>
    );
  }
  return (
    <>
      <Section title={t("Summary")}>
        <Tiles items={[
          { label: 'Incidents handled', value: String(total.count), hint: t("{{value0}} still open", { value0: total.open }) },
          { label: 'Overall SLA compliance', value: formatPercent(report.overallCompliance), tone: complianceTone(report.overallCompliance, settings), hint: t("target {{value0}}%{{value1}}", { value0: settings.compliance.target, value1: report.meetsContract === null ? '' : report.meetsContract ? t(' · met') : t(' · not met') }) },
          { label: 'Mean time to detect', value: statCell(total.ttd), hint: total.ttd.count ? t('{{count}} measured', { count: total.ttd.count }) : t('no occurred times') },
          { label: 'Mean time to acknowledge', value: statCell(total.tta), hint: t("median {{value0}}", { value0: total.tta.count ? formatDuration(total.tta.median) : '—' }) },
          { label: 'Mean time to resolve', value: statCell(total.ttr), hint: t("median {{value0}}", { value0: total.ttr.count ? formatDuration(total.ttr.median) : '—' }) },
          { label: 'SLA breaches', value: String(report.breaches.length), tone: report.breaches.length ? 'risk' : 'healthy' },
        ]} />
      </Section>

      <Section title={t("Performance by priority")}>
        <SlaPriorityTable report={report} settings={settings} />
      </Section>

      <Section title={t("Agreed SLA targets")} note={report.customTargets ? `${customer} – customer-specific SLA` : 'standard SLA'}>
        <table className="rpt-table compact">
          <thead><tr><th>{t("Priority")}</th><th className="num">{t("Detect within")}</th><th className="num">{t("Acknowledge within")}</th><th className="num">{t("Resolve within")}</th></tr></thead>
          <tbody>
            {PRIORITIES.map((priority) => (
              <tr key={priority}>
                <td><span className="rpt-prio" style={{ background: PRIORITY_COLORS[priority] }}>{priority}</span></td>
                <td className="num">{report.targets[priority].detect ? formatDuration(report.targets[priority].detect) : t("Not measured")}</td>
                <td className="num">{formatDuration(report.targets[priority].ack)}</td>
                <td className="num">{formatDuration(report.targets[priority].resolve)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rpt-footnote"> {t("Contracted compliance target:")} {settings.compliance.target}{t("% (amber from")} {settings.compliance.amber}%).
          {!customer && report.overrideCustomers.length ? ` Incidents for ${report.overrideCustomers.join(', ')} are measured against their customer-specific SLA.` : ''}
        </p>
      </Section>

      <Section title={t("Daily incident volume")}>
        <BarChart
          valueLabel={t("Incidents per day")}
          data={report.daily.map((day) => ({ label: String(Number(day.date.slice(8))), segments: PRIORITIES.map((priority) => ({ value: day.counts[priority], color: PRIORITY_COLORS[priority] })) }))}
        />
        <Legend items={PRIORITIES.map((priority) => ({ label: priority, color: PRIORITY_COLORS[priority] }))} />
      </Section>

      {report.byCategory.length ? (
        <Section title={t("Incidents by category")}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Category")}</th><th className="num">{t("Incidents")}</th><th className="num">{t("Share")}</th></tr></thead>
            <tbody>
              {report.byCategory.map((row) => (
                <tr key={row.name}><td>{row.name}</td><td className="num">{row.count}</td><td className="num">{formatPercent(Math.round((row.count / total.count) * 1000) / 10)}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title={t("SLA breaches")} note={report.breaches.length ? `${report.breaches.length} breach${report.breaches.length === 1 ? '' : 'es'}` : undefined}>
        {report.breaches.length ? (
          <table className="rpt-table">
            <thead><tr><th>{t("Ref")}</th><th>{t("Incident")}</th>{customer ? null : <th>{t("Customer")}</th>}<th>{t("Priority")}</th><th>{t("Measure")}</th><th className="num">{t("Actual")}</th><th className="num">{t("Target")}</th></tr></thead>
            <tbody>
              {report.breaches.map((breach, index) => (
                <tr key={`${breach.incident.id}-${breach.measure}-${index}`}>
                  <td className="mono">{breach.incident.ref || `#${breach.incident.id}`}</td>
                  <td>{breach.incident.title}</td>
                  {customer ? null : <td>{breach.incident.customer || '—'}</td>}
                  <td>{breach.incident.priority}</td>
                  <td>{breach.measure}</td>
                  <td className="num tone-risk">{formatDuration(breach.actual)}{breach.open ? t(" (open)") : ''}</td>
                  <td className="num">{formatDuration(breach.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("All measured incidents were acknowledged and resolved within target.")}</Empty>}
      </Section>

      <Section title={t("Incident log")}>
        <IncidentLogTable incidents={report.incidents} showCustomer={!customer} />
      </Section>

      <p className="rpt-footnote"> {t("MTTD is measured from when the activity occurred to when it was detected (only for incidents with an occurred time). MTTA is measured from detection to acknowledgement and MTTR from detection to resolution. Averages exclude incidents without the relevant timestamp. An open incident that has already exceeded its target is counted as a breach.")} </p>
      <SignOff roles={['SOC Service Delivery Manager', 'Customer representative']} />
    </>
  );
}

function IncidentLogTable({ incidents, showCustomer }: { incidents: IncidentMetrics[]; showCustomer: boolean }) {
  return (
    <table className="rpt-table dense">
      <thead>
        <tr><th>{t("Ref")}</th><th>{t("Title")}</th>{showCustomer ? <th>{t("Customer")}</th> : null}<th>{t("Pri")}</th><th>{t("Detected")}</th><th className="num">{t("TTA")}</th><th>{t("Ack")}</th><th className="num">{t("TTR")}</th><th>{t("Resolve")}</th><th>{t("Status")}</th></tr>
      </thead>
      <tbody>
        {incidents.map((m) => (
          <tr key={m.incident.id}>
            <td className="mono">{m.incident.ref || `#${m.incident.id}`}</td>
            <td>{m.incident.title}</td>
            {showCustomer ? <td>{m.incident.customer || '—'}</td> : null}
            <td>{m.incident.priority}</td>
            <td className="nowrap">{formatStamp(m.incident.detectedAt)}</td>
            <td className="num">{formatDuration(m.tta)}</td>
            <td><StateBadge state={m.ackState} /></td>
            <td className="num">{formatDuration(m.ttr)}</td>
            <td><StateBadge state={m.resolveState} /></td>
            <td>{t(m.incident.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Monthly service report
// ---------------------------------------------------------------------------

function ServiceReportBody({ app, period, now, settings }: { app: AppSnapshot; period: Period; now: Date; settings: ReportSettings }) {
  const report = useMemo(() => buildServiceReport(app, period, now), [app, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sla, workforce, standup } = report;
  const gapDays = workforce.gapDates.length;
  return (
    <>
      <Section title={t("Executive summary")}>
        <Tiles items={[
          { label: 'Incidents handled', value: String(sla.total.count), hint: t("{{value0}} open at report time", { value0: sla.total.open }) },
          { label: 'SLA compliance', value: formatPercent(sla.overallCompliance), tone: complianceTone(sla.overallCompliance, settings), hint: t("target {{value0}}%", { value0: settings.compliance.target }) },
          { label: 'Mean time to acknowledge', value: statCell(sla.total.tta) },
          { label: 'Mean time to resolve', value: statCell(sla.total.ttr) },
          { label: 'Issues opened / closed', value: `${report.issuesOpened.length} / ${report.issuesClosed.length}`, hint: t("{{value0}} open now", { value0: report.issuesOpenNow.length }) },
          { label: 'Objectives completed', value: `${report.objectivesDone} / ${report.objectives.length}`, hint: report.objectivesAtRisk ? `${report.objectivesAtRisk} at risk` : 'none at risk', tone: report.objectivesAtRisk ? 'watch' : 'healthy' },
          { label: 'Task completion', value: formatPercent(standup.rate), hint: t("{{value0}} of {{value1}} tasks", { value0: standup.completed, value1: standup.total }) },
          { label: 'Days with staffing gaps', value: String(gapDays), tone: gapDays ? 'watch' : 'healthy' },
          { label: 'Process maturity', value: report.processMaturity === null ? '—' : `${report.processMaturity} / 5` },
        ]} />
      </Section>

      {report.brief ? (
        <Section title={t("Management commentary")} note={t("Executive update · {{value0}}", { value0: formatDate(report.brief.briefDate) })}>
          <div className="rpt-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.brief.content}</ReactMarkdown></div>
        </Section>
      ) : null}

      <Section title={t("Incident & SLA performance")}>
        {sla.total.count ? <SlaPriorityTable report={sla} settings={settings} /> : <Empty>{t("No incidents recorded for this period.")}</Empty>}
      </Section>

      <Section title={t("Service KPIs")} note={t("current values")}>
        {report.kpis.length ? (
          <table className="rpt-table">
            <thead><tr><th>{t("Code")}</th><th>{t("KPI")}</th><th className="num">{t("Actual")}</th><th className="num">{t("Target")}</th><th>{t("Trend")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>
              {report.kpis.map((kpi) => (
                <tr key={kpi.id}><td className="mono">{kpi.code}</td><td>{kpi.name}</td><td className="num">{kpi.actual}</td><td className="num">{kpi.target}</td><td>{kpi.trend === 'up' ? '▲' : kpi.trend === 'down' ? '▼' : '▬'} {kpi.delta}</td><td><HealthDot health={kpi.health} /> {t(kpi.health)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("No KPIs defined. Add them in the Service module.")}</Empty>}
      </Section>

      <Section title={t("Issues")} note={t("{{value0}} opened · {{value1}} closed · {{value2}} overdue", { value0: report.issuesOpened.length, value1: report.issuesClosed.length, value2: report.issuesOverdue.length })}>
        {report.issuesOpenNow.length ? (
          <table className="rpt-table">
            <thead><tr><th>{t("Issue")}</th><th>{t("Owner")}</th><th>{t("Status")}</th><th className="num">{t("Progress")}</th><th>{t("Due")}</th><th>{t("Health")}</th></tr></thead>
            <tbody>
              {report.issuesOpenNow.slice().sort((a, b) => ({ risk: 0, watch: 1, healthy: 2 }[a.health] - { risk: 0, watch: 1, healthy: 2 }[b.health])).slice(0, 20).map((issue) => (
                <tr key={issue.id}><td>{issue.title}</td><td>{issue.owner}</td><td>{t(issue.status)}</td><td className="num">{issue.progress}%</td><td className={issue.due && issue.due < dateKey(now) ? 'tone-risk nowrap' : 'nowrap'}>{issue.due || '—'}</td><td><HealthDot health={issue.health} /> {t(issue.health)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("No open issues.")}</Empty>}
        {report.issuesUndated ? <p className="rpt-footnote">{report.issuesUndated} {t("issue(s) were created before open/close dates were tracked and are not counted in the opened/closed figures.")}</p> : null}
      </Section>

      <Section title={t("Objectives")}>
        {report.objectives.length ? (
          <table className="rpt-table">
            <thead><tr><th>{t("Objective")}</th><th>{t("Owner")}</th><th>{t("Due")}</th><th className="num">{t("Progress")}</th><th>{t("Health")}</th></tr></thead>
            <tbody>
              {report.objectives.map((item) => (
                <tr key={item.id}><td>{item.title}</td><td>{item.owner}</td><td className="nowrap">{item.due || '—'}</td><td className="num"><ProgressBar value={item.progress} /></td><td><HealthDot health={item.health} /> {t(item.health)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("No objectives recorded.")}</Empty>}
      </Section>

      {report.projects.length ? (
        <Section title={t("Projects")}>
          <table className="rpt-table">
            <thead><tr><th>{t("Code")}</th><th>{t("Project")}</th><th>{t("Owner")}</th><th>{t("Phase")}</th><th>{t("Due")}</th><th className="num">{t("Progress")}</th><th>{t("Health")}</th></tr></thead>
            <tbody>
              {report.projects.map((item) => (
                <tr key={item.id}><td className="mono">{item.code}</td><td>{item.name}</td><td>{item.owner}</td><td>{item.phase}</td><td className="nowrap">{item.due || '—'}</td><td className="num"><ProgressBar value={item.progress} /></td><td><HealthDot health={item.health} /> {t(item.health)}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title={t("Workforce")} note={t("{{value0}} working days · weekend {{value1}}", { value0: workforce.totals.weekdays, value1: settings.weekendDays.map((day) => t(WEEKDAY_NAMES[day]).slice(0, 3)).join('–') || 'none' })}>
        {workforce.analysts.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>{t("Analyst")}</th><th className="num">{t("Worked")}</th><th className="num">{t("Weekend worked")}</th><th className="num">{t("Days off")}</th><th className="num">{t("Leave")}</th><th className="num">{t("Sick / absent")}</th></tr></thead>
            <tbody>
              {workforce.analysts.map((row) => (
                <tr key={row.analyst}><td>{row.analyst}</td><td className="num">{row.worked}</td><td className="num">{row.workedWeekend}</td><td className="num">{row.off}</td><td className="num">{row.leave}</td><td className="num">{row.gap}</td></tr>
              ))}
              <tr className="rpt-total-row"><td>{t("Total")}</td><td className="num">{workforce.totals.worked}</td><td className="num">{workforce.analysts.reduce((sum, row) => sum + row.workedWeekend, 0)}</td><td className="num">{workforce.totals.off}</td><td className="num">{workforce.totals.leave}</td><td className="num">{workforce.totals.gap}</td></tr>
            </tbody>
          </table>
        ) : <Empty>{t("No roster entries in this period.")}</Empty>}
      </Section>

      <Section title={t("Stand-up delivery")}>
        {standup.total ? (
          <table className="rpt-table compact">
            <thead><tr><th>{t("Lead")}</th><th className="num">{t("Tasks")}</th><th className="num">{t("Completed")}</th><th className="num">{t("Completion")}</th><th className="num">{t("Planned time")}</th></tr></thead>
            <tbody>
              {standup.byLead.map((row) => (
                <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className={`num tone-${taskTone(row.rate)}`}>{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("No stand-up tasks in this period.")}</Empty>}
      </Section>

      <SignOff roles={['Prepared by – SOC Manager', 'Reviewed by – Head of Security Operations']} />
    </>
  );
}

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className="rpt-progress"><span className="rpt-progress-track"><span className="rpt-progress-fill" style={{ width: `${clamped}%` }} /></span>{clamped}%</span>
  );
}

// ---------------------------------------------------------------------------
// Workforce report
// ---------------------------------------------------------------------------

function WorkforceReportBody({ app, period, settings }: { app: AppSnapshot; period: Period; settings: ReportSettings }) {
  const report = useMemo(() => buildWorkforceReport(app, period), [app, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = new Map((app.settings.rosterLabels ?? []).map((label) => [label.code, label]));
  const weekend = new Set(settings.weekendDays);
  const days = datesIn(period);
  const gridDays = days.length <= 31 ? days : [];
  if (!report.analysts.length) {
    return <Section title={t("Summary")}><Empty>{t("No roster entries in this period. Plan shifts in the Workforce module first.")}</Empty></Section>;
  }
  return (
    <>
      <Section title={t("Summary")} note={t("weekend: {{value0}}", { value0: settings.weekendDays.map((day) => t(WEEKDAY_NAMES[day])).join(' & ') || 'none' })}>
        <Tiles items={[
          { label: 'Calendar days', value: String(days.length), hint: t("{{value0}} working · {{value1}} weekend", { value0: report.totals.weekdays, value1: report.totals.weekendDays }) },
          { label: 'Shifts worked', value: String(report.totals.worked) },
          { label: 'Days off', value: String(report.totals.off) },
          { label: 'Leave days', value: String(report.totals.leave) },
          { label: 'Sick / absence', value: String(report.totals.gap), tone: report.totals.gap ? 'watch' : 'healthy' },
          { label: 'Lowest coverage', value: report.minCoverage ? String(report.minCoverage.working) : '—', hint: report.minCoverage ? formatDate(report.minCoverage.date) : '', tone: report.minCoverage && report.minCoverage.working === 0 ? 'risk' : 'neutral' },
        ]} />
      </Section>

      <Section title={t("Attendance by analyst")}>
        <table className="rpt-table compact">
          <thead>
            <tr>
              <th>{t("Analyst")}</th>
              {report.codes.map((code) => <th key={code.code} className="num" title={t(code.label)}>{code.code}</th>)}
              <th className="num">{t("Worked")}</th><th className="num">{t("Weekday")}</th><th className="num">{t("Weekend")}</th><th className="num">{t("Off")}</th><th className="num">{t("Leave")}</th><th className="num">{t("Sick/abs.")}</th>
            </tr>
          </thead>
          <tbody>
            {report.analysts.map((row) => (
              <tr key={row.analyst}>
                <td className="nowrap">{row.analyst}</td>
                {report.codes.map((code) => <td key={code.code} className="num">{row.byCode[code.code] ?? ''}</td>)}
                <td className="num strong">{row.worked}</td><td className="num">{row.workedWeekday}</td><td className="num">{row.workedWeekend}</td><td className="num">{row.off}</td><td className="num">{row.leave}</td><td className="num">{row.gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rpt-code-legend">
          {report.codes.map((code) => <span key={code.code}><b>{code.code}</b> {code.label}{code.hours ? ` (${code.hours})` : ''}</span>)}
        </div>
      </Section>

      {gridDays.length ? (
        <Section title={t("Roster calendar")}>
          <div className="rpt-roster-wrap">
            <table className="rpt-roster">
              <thead>
                <tr>
                  <th>{t("Analyst")}</th>
                  {gridDays.map((day) => (
                    <th key={day} className={weekend.has((parseStamp(day) ?? new Date()).getDay()) ? 'weekend' : ''}>
                      <span>{Number(day.slice(8))}</span><small>{t(WEEKDAY_NAMES[(parseStamp(day) ?? new Date()).getDay()]).slice(0, 2)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.analysts.map((row) => (
                  <tr key={row.analyst}>
                    <td className="nowrap">{row.analyst}</td>
                    {gridDays.map((day) => {
                      const entry = app.rosterAssignments.find((item) => item.rosterDate === day && item.analyst === row.analyst);
                      const label = entry ? labels.get(entry.shiftName) : undefined;
                      return (
                        <td key={day} className={weekend.has((parseStamp(day) ?? new Date()).getDay()) ? 'weekend' : ''} style={label ? { background: label.fill, color: label.textColor } : undefined}>
                          {entry?.shiftName ?? ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title={t("Daily coverage")} note={t("analysts on shift per day")}>
        <BarChart
          valueLabel={t("Analysts on shift per day")}
          data={report.coverage.map((day) => ({ label: String(Number(day.date.slice(8))), marker: day.weekend, segments: [{ value: day.working, color: '#1e8a4c' }, { value: day.gaps, color: '#d5323f' }] }))}
        />
        <Legend items={[{ label: 'On shift', color: '#1e8a4c' }, { label: 'Sick / gap', color: '#d5323f' }, { label: 'Weekend', color: '#e3e8ee' }]} />
        {report.gapDates.length ? <p className="rpt-footnote">{t("Staffing gaps recorded on:")} {report.gapDates.map((date) => formatDate(date)).join(', ')}.</p> : null}
      </Section>

      <SignOff roles={['SOC Manager', 'HR / Workforce coordinator']} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Stand-up report
// ---------------------------------------------------------------------------

function StandupReportBody({ app, period }: { app: AppSnapshot; period: Period }) {
  const report = useMemo(() => buildStandupReport(app, period), [app, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!report.total) {
    return <Section title={t("Summary")}><Empty>{t("No stand-up tasks were recorded in this period.")}</Empty></Section>;
  }
  return (
    <>
      <Section title={t("Summary")}>
        <Tiles items={[
          { label: 'Tasks', value: String(report.total), hint: t("over {{value0}} stand-up day(s)", { value0: report.activeDays }) },
          { label: 'Completion rate', value: formatPercent(report.rate), tone: taskTone(report.rate) },
          { label: 'Planned effort', value: formatDuration(report.minutes), hint: t("{{value0}} completed", { value0: formatDuration(report.completedMinutes) }) },
          { label: 'Linked to objectives', value: `${report.linkedToObjectives} / ${report.total}` },
          { label: 'Carried over', value: String(report.carriedOver.length), tone: report.carriedOver.length ? 'watch' : 'healthy', hint: 'tasks seen on 2+ days' },
          { label: 'Still open', value: String(report.open.length), tone: report.open.length ? 'watch' : 'healthy' },
        ]} />
      </Section>

      <Section title={t("Daily completion")}>
        <BarChart
          valueLabel={t("Tasks per day")}
          data={report.byDay.map((day) => ({ label: day.date.slice(5), segments: [{ value: day.completed, color: '#1e8a4c' }, { value: day.total - day.completed, color: '#ffb000' }] }))}
        />
        <Legend items={[{ label: 'Completed', color: '#1e8a4c' }, { label: 'Not completed', color: '#ffb000' }]} />
      </Section>

      <div className="rpt-two-col">
        <Section title={t("By lead")}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Lead")}</th><th className="num">{t("Tasks")}</th><th className="num">{t("Done")}</th><th className="num">{t("Rate")}</th><th className="num">{t("Effort")}</th></tr></thead>
            <tbody>{report.byLead.map((row) => <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className="num">{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>)}</tbody>
          </table>
        </Section>
        <Section title={t("By Eisenhower quadrant")}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Quadrant")}</th><th className="num">{t("Tasks")}</th><th className="num">{t("Done")}</th><th className="num">{t("Rate")}</th><th className="num">{t("Effort")}</th></tr></thead>
            <tbody>{report.byQuadrant.map((row) => <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className="num">{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>)}</tbody>
          </table>
        </Section>
      </div>

      {report.carriedOver.length ? (
        <Section title={t("Carried-over tasks")} note={t("same task and lead on more than one day")}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Task")}</th><th>{t("Lead")}</th><th className="num">{t("Days")}</th><th>{t("Latest status")}</th></tr></thead>
            <tbody>{report.carriedOver.slice(0, 25).map((row) => <tr key={`${row.title}-${row.lead}`}><td>{row.title}</td><td>{row.lead}</td><td className="num">{row.days}</td><td>{row.lastStatus}</td></tr>)}</tbody>
          </table>
        </Section>
      ) : null}

      {report.open.length ? (
        <Section title={t("Open tasks")} note={report.open.length > 30 ? t('Showing 30 of {{count}}', { count: report.open.length }) : undefined}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Date")}</th><th>{t("Task")}</th><th>{t("Lead")}</th><th>{t("Quadrant")}</th><th className="num">{t("Effort")}</th></tr></thead>
            <tbody>{report.open.slice(0, 30).map((task) => <tr key={task.id}><td className="nowrap">{task.taskDate}</td><td>{task.title}</td><td>{task.lead}</td><td>{t(task.quadrant)}</td><td className="num">{formatDuration(task.durationMinutes)}</td></tr>)}</tbody>
          </table>
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shift handover report
// ---------------------------------------------------------------------------

function HandoverReportBody({ app, date, now }: { app: AppSnapshot; date: string; now: Date }) {
  const report = buildHandoverReport(app, date, now);
  const rosterTable = (groups: typeof report.rosterToday) => groups.length ? (
    <table className="rpt-table compact">
      <thead><tr><th>{t("Shift")}</th><th>{t("Hours")}</th><th>{t("On duty")}</th></tr></thead>
      <tbody>{groups.map((group) => <tr key={group.code}><td><b>{group.code}</b> {group.label !== group.code ? group.label : ''}</td><td className="nowrap">{group.hours || '—'}</td><td>{group.analysts.join(', ')}</td></tr>)}</tbody>
    </table>
  ) : <Empty>{t("No shifts planned.")}</Empty>;

  return (
    <>
      <Section title={t("At a glance")}>
        <Tiles items={[
          { label: 'Open incidents', value: String(report.openIncidents.length), tone: report.openIncidents.some((m) => m.incident.priority === 'P1') ? 'risk' : report.openIncidents.length ? 'watch' : 'healthy', hint: `${report.openIncidents.filter((m) => m.incident.priority === 'P1').length} P1` },
          { label: 'New incidents today', value: String(report.newIncidents.length) },
          { label: 'Open issues', value: String(report.openIssues.length), tone: report.openIssues.some((issue) => issue.health === 'risk') ? 'risk' : 'neutral' },
          { label: 'Open tasks today', value: String(report.openTasks.length), hint: t("{{value0}} completed", { value0: report.doneTasks }) },
          { label: 'Absences', value: String(report.absent.length), tone: report.absent.length ? 'watch' : 'healthy' },
        ]} />
      </Section>

      <div className="rpt-two-col">
        <Section title={t("On duty · {{value0}}", { value0: formatDate(report.date) })}>{rosterTable(report.rosterToday)}</Section>
        <Section title={t("Next day · {{value0}}", { value0: formatDate(report.nextDate) })}>{rosterTable(report.rosterNext)}</Section>
      </div>
      {report.absent.length ? (
        <p className="rpt-footnote">{t("Absent today:")} {report.absent.map((item) => `${item.analyst} (${item.label})`).join(', ')}.</p>
      ) : null}

      <Section title={t("Open incidents to hand over")}>
        {report.openIncidents.length ? (
          <table className="rpt-table dense">
            <thead><tr><th>{t("Ref")}</th><th>{t("Incident")}</th><th>{t("Customer")}</th><th>{t("Pri")}</th><th>{t("Detected")}</th><th>{t("Analyst")}</th><th>{t("Ack")}</th><th>{t("Resolve SLA")}</th></tr></thead>
            <tbody>
              {report.openIncidents.map((m) => (
                <tr key={m.incident.id}>
                  <td className="mono">{m.incident.ref || `#${m.incident.id}`}</td><td>{m.incident.title}</td><td>{m.incident.customer || '—'}</td><td>{m.incident.priority}</td>
                  <td className="nowrap">{formatStamp(m.incident.detectedAt)}</td><td>{m.incident.analyst || '—'}</td><td><StateBadge state={m.ackState} /></td><td><StateBadge state={m.resolveState} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t("No open incidents.")}</Empty>}
      </Section>

      {report.newIncidents.length ? (
        <Section title={t("Incidents detected today")}>
          <IncidentLogTable incidents={report.newIncidents} showCustomer />
        </Section>
      ) : null}

      <Section title={t("Open issues")}>
        {report.openIssues.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>{t("Issue")}</th><th>{t("Owner")}</th><th>{t("Status")}</th><th>{t("Due")}</th><th>{t("Health")}</th></tr></thead>
            <tbody>{report.openIssues.slice(0, 15).map((issue) => <tr key={issue.id}><td>{issue.title}</td><td>{issue.owner}</td><td>{t(issue.status)}</td><td className="nowrap">{issue.due || '—'}</td><td><HealthDot health={issue.health} /> {t(issue.health)}</td></tr>)}</tbody>
          </table>
        ) : <Empty>{t("No open issues.")}</Empty>}
      </Section>

      {report.followUps.length ? (
        <Section title={t("Follow-ups")}>
          <table className="rpt-table compact">
            <thead><tr><th>{t("Ref")}</th><th>{t("Follow-up")}</th><th>{t("Owner")}</th><th>{t("Age")}</th><th>{t("Health")}</th></tr></thead>
            <tbody>{report.followUps.map((item) => <tr key={item.id}><td className="mono">{item.ref}</td><td>{item.title}</td><td>{item.owner}</td><td>{item.age}</td><td><HealthDot health={item.health} /> {t(item.health)}</td></tr>)}</tbody>
          </table>
        </Section>
      ) : null}

      <Section title={t("Outstanding tasks for today")}>
        {report.openTasks.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>{t("Task")}</th><th>{t("Lead")}</th><th>{t("Assignee")}</th><th>{t("Quadrant")}</th><th>{t("Due")}</th></tr></thead>
            <tbody>{report.openTasks.map((task) => <tr key={task.id}><td>{task.title}</td><td>{task.lead}</td><td>{task.assignee || '—'}</td><td>{t(task.quadrant)}</td><td>{task.dueTime || '—'}</td></tr>)}</tbody>
          </table>
        ) : <Empty>{t("All of today's stand-up tasks are complete.")}</Empty>}
      </Section>

      {report.notes.length ? (
        <Section title={t("Notes")}>
          <ul className="rpt-notes">{report.notes.map((note) => <li key={note.id}>{note.pinned ? <b>📌 </b> : null}{note.text}</li>)}</ul>
        </Section>
      ) : null}

      <Section title={t("Handover remarks")}>
        <div className="rpt-write-box" />
      </Section>
      <SignOff roles={['Outgoing shift lead', 'Incoming shift lead']} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Incident register (data entry + CSV import)
// ---------------------------------------------------------------------------

interface IncidentForm {
  ref: string; customer: string; title: string; priority: IncidentPriority; category: string; source: string;
  status: IncidentStatus; analyst: string; occurredAt: string; detectedAt: string; acknowledgedAt: string; resolvedAt: string; notes: string;
}

const emptyIncident = (): IncidentForm => ({
  ref: '', customer: '', title: '', priority: 'P3', category: '', source: '', status: 'Open', analyst: '',
  occurredAt: '', detectedAt: `${dateKey(new Date())}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
  acknowledgedAt: '', resolvedAt: '', notes: '',
});

function IncidentRegister({ app, canEdit, isAdmin, busy, mutate }: { app: AppSnapshot; canEdit: boolean; isAdmin: boolean; busy: boolean; mutate: Mutate }) {
  const [form, setForm] = useState<IncidentForm>(emptyIncident);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState({ customer: '', status: '', search: '' });
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const incidents = app.incidents ?? [];
  const customers = customersOf(app);
  const settings = reportSettingsOf(app);
  const now = new Date();

  const visible = incidents.filter((item) => (!filter.customer || item.customer === filter.customer)
    && (!filter.status || item.status === filter.status)
    && (!filter.search || `${item.ref} ${item.title} ${item.analyst} ${item.category}`.toLowerCase().includes(filter.search.toLowerCase())));

  function edit(item: IncidentRow) {
    setEditingId(item.id);
    setForm({
      ref: item.ref, customer: item.customer, title: item.title, priority: item.priority, category: item.category, source: item.source,
      status: item.status, analyst: item.analyst, occurredAt: item.occurredAt, detectedAt: item.detectedAt,
      acknowledgedAt: item.acknowledgedAt, resolvedAt: item.resolvedAt, notes: item.notes,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyIncident());
  }

  async function submit() {
    const payload = { ...form } as unknown as Record<string, unknown>;
    if (editingId) {
      await mutate(`update-incident-${editingId}`, () => api.updateRecord('incident', editingId, payload));
    } else {
      await mutate('create-incident', () => api.createRecord('incident', payload));
    }
    reset();
  }

  async function importFile(file: File) {
    setImportResult(null);
    setImportErrors([]);
    await mutate('import-incidents', async () => {
      const result = await api.importIncidents(file);
      setImportResult(`Imported ${result.added} new and updated ${result.updated} existing incident(s)${result.skipped ? `; ${result.skipped} row(s) skipped` : ''}.`);
      setImportErrors([...result.errors, ...(result.warnings ?? []).map((warning) => `Note – ${warning}`)]);
      return result.snapshot;
    });
  }

  async function downloadTemplate(format: 'xlsx' | 'csv') {
    const blob = await api.downloadIncidentTemplate(format);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `soc-incidents-template.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const now16 = () => `${dateKey(new Date())}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const field = (key: keyof IncidentForm) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }) });

  return (
    <div className="report-register">
      <section className="panel report-register-list">
        <header className="panel-head"><h2>{t("Incident register")}</h2><div className="panel-meta"><span className="muted">{incidents.length} {t("incidents")}</span></div></header>
        <div className="panel-body">
          <div className="report-filters">
            <select value={filter.customer} onChange={(event) => setFilter({ ...filter, customer: event.target.value })}>
              <option value="">{t("All customers")}</option>
              {customers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
              <option value="">{t("All statuses")}</option>
              {INCIDENT_STATUSES.map((status) => <option key={status} value={status}>{t(status)}</option>)}
            </select>
            <input type="search" placeholder={t("Search ref, title, analyst…")} value={filter.search} onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
          </div>
          {visible.length ? (
            <div className="report-table-scroll">
              <table className="grid-table">
                <thead><tr><th>{t("Ref")}</th><th>{t("Title")}</th><th>{t("Customer")}</th><th>{t("Pri")}</th><th>{t("Detected")}</th><th>{t("TTA")}</th><th>{t("TTR")}</th><th>{t("Status")}</th>{canEdit ? <th className="ta-r">{t("Action")}</th> : null}</tr></thead>
                <tbody>
                  {visible.slice(0, 300).map((item) => {
                    const m = measureIncident(item, settings, now);
                    return (
                      <tr key={item.id}>
                        <td className="ref">{item.ref || `#${item.id}`}</td>
                        <td>{item.title}</td>
                        <td className="muted">{item.customer || '—'}</td>
                        <td><span className="rpt-prio" style={{ background: PRIORITY_COLORS[item.priority] }}>{item.priority}</span></td>
                        <td className="muted nowrap">{formatStamp(item.detectedAt)}</td>
                        <td className={`nowrap state-${m.ackState}`}>{formatDuration(m.tta)}</td>
                        <td className={`nowrap state-${m.resolveState}`}>{formatDuration(m.ttr)}</td>
                        <td>{t(item.status)}</td>
                        {canEdit ? (
                          <td className="ta-r">
                            <div className="action-row">
                              <button type="button" className="icon-btn" onClick={() => edit(item)} title={t("Edit incident")} aria-label={t("Edit incident")}><Pencil size={14} /></button>
                              {isAdmin ? <button type="button" className="icon-btn" onClick={() => { if (window.confirm(t('Delete incident {{ref}}? It will no longer count in SLA reports. The deletion is logged.', { ref: item.ref || item.id }))) void mutate(`delete-incident-${item.id}`, () => api.deleteRecord('incident', item.id)); }} title={t("Delete incident (Admin only, logged)")} aria-label={t("Delete incident")}><Trash2 size={14} /></button> : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length > 300 ? <p className="muted">{t("Showing the 300 most recent of")} {visible.length}{t(". Use the filters to narrow down.")}</p> : null}
            </div>
          ) : <p className="muted report-empty-state">{t("No incidents yet. Import your SLA sheet (Excel or CSV) or add an incident with the form.")}</p>}
        </div>
      </section>

      {canEdit ? (
        <aside className="report-register-side">
          <section className="panel">
            <header className="panel-head"><h2>{editingId ? t("Edit incident") : t("Add incident")}</h2></header>
            <div className="panel-body">
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <div className="form-grid two">
                  <label className="field"><span>{t("Ref / ticket")}</span><input {...field('ref')} placeholder={t("INC-1024")} /></label>
                  <label className="field"><span>{t("Customer")}</span><input {...field('customer')} list="incident-customers" placeholder={t("Customer name")} /></label>
                </div>
                <datalist id="incident-customers">{customers.map((name) => <option key={name} value={name} />)}</datalist>
                <label className="field"><span>{t("Title")}</span><input {...field('title')} required /></label>
                <div className="form-grid two">
                  <label className="field"><span>{t("Priority")}</span><select {...field('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                  <label className="field"><span>{t("Status")}</span><select {...field('status')}>{INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                </div>
                <div className="form-grid two">
                  <label className="field"><span>{t("Category")}</span><input {...field('category')} placeholder={t("Malware, Phishing…")} /></label>
                  <label className="field"><span>{t("Analyst")}</span><input {...field('analyst')} list="incident-analysts" /></label>
                </div>
                <datalist id="incident-analysts">{(app.settings.rosterStaff ?? []).map((name) => <option key={name} value={name} />)}</datalist>
                <label className="field"><span>{t("Occurred (optional – for MTTD)")}</span><input type="datetime-local" {...field('occurredAt')} /></label>
                <label className="field"><span>{t("Detected")}</span><input type="datetime-local" {...field('detectedAt')} required /></label>
                <label className="field"><span>{t("Acknowledged")}</span>
                  <span className="report-inline"><input type="datetime-local" {...field('acknowledgedAt')} /><button type="button" className="ghost-btn" onClick={() => setForm({ ...form, acknowledgedAt: now16(), status: form.status === 'Open' ? 'Acknowledged' : form.status })}>{t("Now")}</button></span>
                </label>
                <label className="field"><span>{t("Resolved")}</span>
                  <span className="report-inline"><input type="datetime-local" {...field('resolvedAt')} /><button type="button" className="ghost-btn" onClick={() => setForm({ ...form, resolvedAt: now16(), status: 'Resolved' })}>{t("Now")}</button></span>
                </label>
                <label className="field"><span>{t("Notes")}</span><textarea rows={2} {...field('notes')} /></label>
                <button className="primary-btn" type="submit" disabled={busy}>{editingId ? <><Save size={14} /> {t("Save incident")}</> : <><Plus size={14} /> {t("Add incident")}</>}</button>
                {editingId ? <button className="ghost-btn" type="button" onClick={reset}>{t("Cancel edit")}</button> : null}
              </form>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head"><h2>{t("Import Excel / CSV")}</h2></header>
            <div className="panel-body form-stack">
              <p className="muted small"> {t("Upload a sheet with one row per ticket:")} <b>{t("ticket number, priority, detected date/time")}</b> {t("and the")} <b>{t("MTTD, MTTA and MTTR")}</b> {t("for that ticket (minutes like")} <code>45</code>, <code>{t("1h 30m")}</code> {t("or")} <code>1:30</code>{t("). The SLA reports are built from it automatically. Exports with timestamps from Splunk, ServiceNow or Jira work too. Re-importing a ticket updates it instead of duplicating it.")} </p>
              <label className="primary-btn report-file-btn">
                <Upload size={14} /> {t("Choose Excel or CSV file")} <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} disabled={busy} />
              </label>
              <button type="button" className="ghost-btn" onClick={() => void downloadTemplate('xlsx')}><Download size={14} /> {t("Download Excel template")}</button>
              <button type="button" className="link-btn" onClick={() => void downloadTemplate('csv')}>{t("or CSV template")}</button>
              {importResult ? <p className="report-import-ok">{importResult}</p> : null}
              {importErrors.length ? <ul className="report-import-errors">{importErrors.map((error) => <li key={error}>{t(error)}</li>)}</ul> : null}
            </div>
          </section>
          {isAdmin ? <IncidentHistory refreshKey={incidents.length + (app.settings.reports ? JSON.stringify(app.settings.reports).length : 0)} /> : null}
        </aside>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change history (Admin): who changed incident data or SLA policies, and when
// ---------------------------------------------------------------------------

const AUDIT_LABELS: Record<string, string> = {
  'incident.create': 'Added incident',
  'incident.update': 'Edited incident',
  'incident.delete': 'Deleted incident',
  'incidents.import': 'Imported file',
  'sla-settings.update': 'Changed SLA policies',
};

function describeAudit(entry: IncidentAuditEntry): string {
  const details = entry.details ?? {};
  if (entry.action === 'incidents.import') {
    return `${details.added ?? 0} added, ${details.updated ?? 0} updated, ${details.skipped ?? 0} skipped`;
  }
  const fields = Object.keys(details).filter((key) => key !== 'id' && key !== 'format' && key !== 'sha256');
  if (entry.action === 'incident.update') {
    return fields.length ? fields.map((key) => {
      const pair = details[key] as [string, string];
      return `${key}: ${pair?.[0] || '—'} → ${pair?.[1] || '—'}`;
    }).join('; ') : 'no SLA-relevant change';
  }
  if (entry.action === 'sla-settings.update') return fields.join(', ');
  return '';
}

function IncidentHistory({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<IncidentAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.getIncidentAudit(200)
      .then((result) => { if (active) { setEntries(result.entries); setError(null); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the change history.'); });
    return () => { active = false; };
  }, [refreshKey]);

  return (
    <section className="panel">
      <header className="panel-head"><h2>{t("Change history")}</h2><div className="panel-meta"><span className="muted">{t("Admin only")}</span></div></header>
      <div className="panel-body">
        {error ? <p className="report-import-errors">{t(error)}</p> : null}
        {entries && !entries.length ? <p className="muted small">{t("No changes recorded yet.")}</p> : null}
        {entries && entries.length ? (
          <ul className="audit-list">
            {entries.slice(0, 50).map((entry) => (
              <li key={entry.id}>
                <div className="audit-head">
                  <strong>{t(AUDIT_LABELS[entry.action] ?? entry.action)}</strong>
                  <span className="muted"> · {entry.target}</span>
                </div>
                <div className="muted small">{new Date(entry.at).toLocaleString(getLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {entry.username || 'system'}{entry.role ? ` (${entry.role})` : ''}</div>
                {describeAudit(entry) ? <div className="audit-detail">{describeAudit(entry)}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
