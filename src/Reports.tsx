// SPDX-License-Identifier: Apache-2.0
// Reports module: monthly service, customer SLA, workforce, stand-up and
// shift-handover reports, shown on screen and printed to PDF (A4 portrait).

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
  formatDate,
  formatDuration,
  formatPercent,
  formatPeriod,
  formatStamp,
  measureIncident,
  monthPeriod,
  parseDurationInput,
  parseStamp,
  reportSettingsOf,
} from './reportCalc';
import type { IncidentMetrics, Period, SlaReport, SlaState, Stats } from './reportCalc';
import './reports.css';

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
      <div className="report-tabs" role="tablist" aria-label="Reports">
        {REPORT_TABS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'report-tab active' : 'report-tab'} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {active.printable ? (
        <div className="report-toolbar">
          {tab === 'handover' ? (
            <label className="report-field">Handover date
              <input type="date" value={handoverDate} onChange={(event) => setHandoverDate(event.target.value)} />
            </label>
          ) : (
            <>
              <label className="report-field">Period
                <select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as 'month' | 'custom')}>
                  <option value="month">Calendar month</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              {rangeMode === 'month' ? (
                <label className="report-field">Month
                  <input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
                </label>
              ) : (
                <>
                  <label className="report-field">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
                  <label className="report-field">To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
                </>
              )}
            </>
          )}
          {tab === 'sla' ? (
            <label className="report-field">Customer
              <select value={customer} onChange={(event) => setCustomer(event.target.value)}>
                <option value="">All customers</option>
                {customersOf(app).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ) : null}
          <span className="report-toolbar-spacer" />
          <button type="button" className="primary-btn" onClick={() => setPrinting(true)} disabled={printing}>
            <Printer size={14} /> Print / Save as PDF
          </button>
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
    : `${formatPeriod(period)}${report === 'sla' ? ` · ${customer || 'All customers'}` : ''}`;

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
          <h1 className="rpt-title">{titles[report]}</h1>
          <div className="rpt-subtitle">{subtitle}</div>
        </div>
        <dl className="rpt-meta">
          <div><dt>Prepared by</dt><dd>{preparedBy}</dd></div>
          <div><dt>Generated</dt><dd>{now.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></div>
          <div><dt>Classification</dt><dd>Internal – Confidential</dd></div>
        </dl>
      </header>
      {body}
      <footer className="rpt-footer">{settings.orgName} · {titles[report]} · Generated by SOC Cockpit</footer>
    </article>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rpt-section">
      <h2>{title}{note ? <span className="rpt-section-note">{note}</span> : null}</h2>
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
          <div className="rpt-tile-label">{item.label}</div>
          {item.hint ? <div className="rpt-tile-hint">{item.hint}</div> : null}
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
          <div className="rpt-sign-role">{role}</div>
          <div className="rpt-sign-meta">Name / Signature / Date</div>
        </div>
      ))}
    </section>
  );
}

function HealthDot({ health }: { health: Health }) {
  return <span className={`rpt-dot ${health}`} aria-label={health} />;
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
  return <span className={`rpt-state ${state}`}>{label}</span>;
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
    <svg className="rpt-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={valueLabel ?? 'chart'}>
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
              <text x={x + barWidth / 2} y={height - 5} className="rpt-chart-axis" textAnchor="middle">{item.label}</text>
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
      {items.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}
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
          <th>Priority</th><th className="num">Incidents</th><th className="num">Open</th>
          <th className="num">MTTD</th><th className="num">MTTA</th><th className="num">MTTA median</th>
          <th className="num">MTTR</th><th className="num">MTTR median</th>
          <th className="num">Ack SLA</th><th className="num">Resolve SLA</th>
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
          <td>All</td>
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
  const t = report.total;
  if (!report.incidents.length) {
    return (
      <Section title="Summary">
        <Empty>No incidents were detected in this period{customer ? ` for ${customer}` : ''}. Import your SLA sheet (Excel or CSV) in the Incident register tab: one row per ticket with priority, detected date and MTTD / MTTA / MTTR.</Empty>
      </Section>
    );
  }
  return (
    <>
      <Section title="Summary">
        <Tiles items={[
          { label: 'Incidents handled', value: String(t.count), hint: `${t.open} still open` },
          { label: 'Overall SLA compliance', value: formatPercent(report.overallCompliance), tone: complianceTone(report.overallCompliance, settings), hint: `target ${settings.compliance.target}%${report.meetsContract === null ? '' : report.meetsContract ? ' · met' : ' · not met'}` },
          { label: 'Mean time to detect', value: statCell(t.ttd), hint: t.ttd.count ? `${t.ttd.count} measured` : 'no occurred times' },
          { label: 'Mean time to acknowledge', value: statCell(t.tta), hint: `median ${t.tta.count ? formatDuration(t.tta.median) : '—'}` },
          { label: 'Mean time to resolve', value: statCell(t.ttr), hint: `median ${t.ttr.count ? formatDuration(t.ttr.median) : '—'}` },
          { label: 'SLA breaches', value: String(report.breaches.length), tone: report.breaches.length ? 'risk' : 'healthy' },
        ]} />
      </Section>

      <Section title="Performance by priority">
        <SlaPriorityTable report={report} settings={settings} />
      </Section>

      <Section title="Agreed SLA targets" note={report.customTargets ? `${customer} – customer-specific SLA` : 'standard SLA'}>
        <table className="rpt-table compact">
          <thead><tr><th>Priority</th><th className="num">Detect within</th><th className="num">Acknowledge within</th><th className="num">Resolve within</th></tr></thead>
          <tbody>
            {PRIORITIES.map((priority) => (
              <tr key={priority}>
                <td><span className="rpt-prio" style={{ background: PRIORITY_COLORS[priority] }}>{priority}</span></td>
                <td className="num">{report.targets[priority].detect ? formatDuration(report.targets[priority].detect) : 'Not measured'}</td>
                <td className="num">{formatDuration(report.targets[priority].ack)}</td>
                <td className="num">{formatDuration(report.targets[priority].resolve)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rpt-footnote">
          Contracted compliance target: {settings.compliance.target}% (amber from {settings.compliance.amber}%).
          {!customer && report.overrideCustomers.length ? ` Incidents for ${report.overrideCustomers.join(', ')} are measured against their customer-specific SLA.` : ''}
        </p>
      </Section>

      <Section title="Daily incident volume">
        <BarChart
          valueLabel="Incidents per day"
          data={report.daily.map((day) => ({ label: String(Number(day.date.slice(8))), segments: PRIORITIES.map((priority) => ({ value: day.counts[priority], color: PRIORITY_COLORS[priority] })) }))}
        />
        <Legend items={PRIORITIES.map((priority) => ({ label: priority, color: PRIORITY_COLORS[priority] }))} />
      </Section>

      {report.byCategory.length ? (
        <Section title="Incidents by category">
          <table className="rpt-table compact">
            <thead><tr><th>Category</th><th className="num">Incidents</th><th className="num">Share</th></tr></thead>
            <tbody>
              {report.byCategory.map((row) => (
                <tr key={row.name}><td>{row.name}</td><td className="num">{row.count}</td><td className="num">{formatPercent(Math.round((row.count / t.count) * 1000) / 10)}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title="SLA breaches" note={report.breaches.length ? `${report.breaches.length} breach${report.breaches.length === 1 ? '' : 'es'}` : undefined}>
        {report.breaches.length ? (
          <table className="rpt-table">
            <thead><tr><th>Ref</th><th>Incident</th>{customer ? null : <th>Customer</th>}<th>Priority</th><th>Measure</th><th className="num">Actual</th><th className="num">Target</th></tr></thead>
            <tbody>
              {report.breaches.map((breach, index) => (
                <tr key={`${breach.incident.id}-${breach.measure}-${index}`}>
                  <td className="mono">{breach.incident.ref || `#${breach.incident.id}`}</td>
                  <td>{breach.incident.title}</td>
                  {customer ? null : <td>{breach.incident.customer || '—'}</td>}
                  <td>{breach.incident.priority}</td>
                  <td>{breach.measure}</td>
                  <td className="num tone-risk">{formatDuration(breach.actual)}{breach.open ? ' (open)' : ''}</td>
                  <td className="num">{formatDuration(breach.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>All measured incidents were acknowledged and resolved within target.</Empty>}
      </Section>

      <Section title="Incident log">
        <IncidentLogTable incidents={report.incidents} showCustomer={!customer} />
      </Section>

      <p className="rpt-footnote">
        MTTD is measured from when the activity occurred to when it was detected (only for incidents with an occurred time).
        MTTA is measured from detection to acknowledgement and MTTR from detection to resolution. Averages exclude incidents
        without the relevant timestamp. An open incident that has already exceeded its target is counted as a breach.
      </p>
      <SignOff roles={['SOC Service Delivery Manager', 'Customer representative']} />
    </>
  );
}

function IncidentLogTable({ incidents, showCustomer }: { incidents: IncidentMetrics[]; showCustomer: boolean }) {
  return (
    <table className="rpt-table dense">
      <thead>
        <tr><th>Ref</th><th>Title</th>{showCustomer ? <th>Customer</th> : null}<th>Pri</th><th>Detected</th><th className="num">TTA</th><th>Ack</th><th className="num">TTR</th><th>Resolve</th><th>Status</th></tr>
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
            <td>{m.incident.status}</td>
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
      <Section title="Executive summary">
        <Tiles items={[
          { label: 'Incidents handled', value: String(sla.total.count), hint: `${sla.total.open} open at report time` },
          { label: 'SLA compliance', value: formatPercent(sla.overallCompliance), tone: complianceTone(sla.overallCompliance, settings), hint: `target ${settings.compliance.target}%` },
          { label: 'Mean time to acknowledge', value: statCell(sla.total.tta) },
          { label: 'Mean time to resolve', value: statCell(sla.total.ttr) },
          { label: 'Issues opened / closed', value: `${report.issuesOpened.length} / ${report.issuesClosed.length}`, hint: `${report.issuesOpenNow.length} open now` },
          { label: 'Objectives completed', value: `${report.objectivesDone} / ${report.objectives.length}`, hint: report.objectivesAtRisk ? `${report.objectivesAtRisk} at risk` : 'none at risk', tone: report.objectivesAtRisk ? 'watch' : 'healthy' },
          { label: 'Task completion', value: formatPercent(standup.rate), hint: `${standup.completed} of ${standup.total} tasks` },
          { label: 'Days with staffing gaps', value: String(gapDays), tone: gapDays ? 'watch' : 'healthy' },
          { label: 'Process maturity', value: report.processMaturity === null ? '—' : `${report.processMaturity} / 5` },
        ]} />
      </Section>

      {report.brief ? (
        <Section title="Management commentary" note={`Executive update · ${formatDate(report.brief.briefDate)}`}>
          <div className="rpt-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.brief.content}</ReactMarkdown></div>
        </Section>
      ) : null}

      <Section title="Incident & SLA performance">
        {sla.total.count ? <SlaPriorityTable report={sla} settings={settings} /> : <Empty>No incidents recorded for this period.</Empty>}
      </Section>

      <Section title="Service KPIs" note="current values">
        {report.kpis.length ? (
          <table className="rpt-table">
            <thead><tr><th>Code</th><th>KPI</th><th className="num">Actual</th><th className="num">Target</th><th>Trend</th><th>Status</th></tr></thead>
            <tbody>
              {report.kpis.map((kpi) => (
                <tr key={kpi.id}><td className="mono">{kpi.code}</td><td>{kpi.name}</td><td className="num">{kpi.actual}</td><td className="num">{kpi.target}</td><td>{kpi.trend === 'up' ? '▲' : kpi.trend === 'down' ? '▼' : '▬'} {kpi.delta}</td><td><HealthDot health={kpi.health} /> {kpi.health}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No KPIs defined. Add them in the Service module.</Empty>}
      </Section>

      <Section title="Issues" note={`${report.issuesOpened.length} opened · ${report.issuesClosed.length} closed · ${report.issuesOverdue.length} overdue`}>
        {report.issuesOpenNow.length ? (
          <table className="rpt-table">
            <thead><tr><th>Issue</th><th>Owner</th><th>Status</th><th className="num">Progress</th><th>Due</th><th>Health</th></tr></thead>
            <tbody>
              {report.issuesOpenNow.slice().sort((a, b) => ({ risk: 0, watch: 1, healthy: 2 }[a.health] - { risk: 0, watch: 1, healthy: 2 }[b.health])).slice(0, 20).map((issue) => (
                <tr key={issue.id}><td>{issue.title}</td><td>{issue.owner}</td><td>{issue.status}</td><td className="num">{issue.progress}%</td><td className={issue.due && issue.due < dateKey(now) ? 'tone-risk nowrap' : 'nowrap'}>{issue.due || '—'}</td><td><HealthDot health={issue.health} /> {issue.health}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No open issues.</Empty>}
        {report.issuesUndated ? <p className="rpt-footnote">{report.issuesUndated} issue(s) were created before open/close dates were tracked and are not counted in the opened/closed figures.</p> : null}
      </Section>

      <Section title="Objectives">
        {report.objectives.length ? (
          <table className="rpt-table">
            <thead><tr><th>Objective</th><th>Owner</th><th>Due</th><th className="num">Progress</th><th>Health</th></tr></thead>
            <tbody>
              {report.objectives.map((item) => (
                <tr key={item.id}><td>{item.title}</td><td>{item.owner}</td><td className="nowrap">{item.due || '—'}</td><td className="num"><ProgressBar value={item.progress} /></td><td><HealthDot health={item.health} /> {item.health}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No objectives recorded.</Empty>}
      </Section>

      {report.projects.length ? (
        <Section title="Projects">
          <table className="rpt-table">
            <thead><tr><th>Code</th><th>Project</th><th>Owner</th><th>Phase</th><th>Due</th><th className="num">Progress</th><th>Health</th></tr></thead>
            <tbody>
              {report.projects.map((item) => (
                <tr key={item.id}><td className="mono">{item.code}</td><td>{item.name}</td><td>{item.owner}</td><td>{item.phase}</td><td className="nowrap">{item.due || '—'}</td><td className="num"><ProgressBar value={item.progress} /></td><td><HealthDot health={item.health} /> {item.health}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title="Workforce" note={`${workforce.totals.weekdays} working days · weekend ${settings.weekendDays.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join('–') || 'none'}`}>
        {workforce.analysts.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>Analyst</th><th className="num">Worked</th><th className="num">Weekend worked</th><th className="num">Days off</th><th className="num">Leave</th><th className="num">Sick / absent</th></tr></thead>
            <tbody>
              {workforce.analysts.map((row) => (
                <tr key={row.analyst}><td>{row.analyst}</td><td className="num">{row.worked}</td><td className="num">{row.workedWeekend}</td><td className="num">{row.off}</td><td className="num">{row.leave}</td><td className="num">{row.gap}</td></tr>
              ))}
              <tr className="rpt-total-row"><td>Total</td><td className="num">{workforce.totals.worked}</td><td className="num">{workforce.analysts.reduce((sum, row) => sum + row.workedWeekend, 0)}</td><td className="num">{workforce.totals.off}</td><td className="num">{workforce.totals.leave}</td><td className="num">{workforce.totals.gap}</td></tr>
            </tbody>
          </table>
        ) : <Empty>No roster entries in this period.</Empty>}
      </Section>

      <Section title="Stand-up delivery">
        {standup.total ? (
          <table className="rpt-table compact">
            <thead><tr><th>Lead</th><th className="num">Tasks</th><th className="num">Completed</th><th className="num">Completion</th><th className="num">Planned time</th></tr></thead>
            <tbody>
              {standup.byLead.map((row) => (
                <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className={`num tone-${taskTone(row.rate)}`}>{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No stand-up tasks in this period.</Empty>}
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
    return <Section title="Summary"><Empty>No roster entries in this period. Plan shifts in the Workforce module first.</Empty></Section>;
  }
  return (
    <>
      <Section title="Summary" note={`weekend: ${settings.weekendDays.map((day) => WEEKDAY_NAMES[day]).join(' & ') || 'none'}`}>
        <Tiles items={[
          { label: 'Calendar days', value: String(days.length), hint: `${report.totals.weekdays} working · ${report.totals.weekendDays} weekend` },
          { label: 'Shifts worked', value: String(report.totals.worked) },
          { label: 'Days off', value: String(report.totals.off) },
          { label: 'Leave days', value: String(report.totals.leave) },
          { label: 'Sick / absence', value: String(report.totals.gap), tone: report.totals.gap ? 'watch' : 'healthy' },
          { label: 'Lowest coverage', value: report.minCoverage ? String(report.minCoverage.working) : '—', hint: report.minCoverage ? formatDate(report.minCoverage.date) : '', tone: report.minCoverage && report.minCoverage.working === 0 ? 'risk' : 'neutral' },
        ]} />
      </Section>

      <Section title="Attendance by analyst">
        <table className="rpt-table compact">
          <thead>
            <tr>
              <th>Analyst</th>
              {report.codes.map((code) => <th key={code.code} className="num" title={code.label}>{code.code}</th>)}
              <th className="num">Worked</th><th className="num">Weekday</th><th className="num">Weekend</th><th className="num">Off</th><th className="num">Leave</th><th className="num">Sick/abs.</th>
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
        <Section title="Roster calendar">
          <div className="rpt-roster-wrap">
            <table className="rpt-roster">
              <thead>
                <tr>
                  <th>Analyst</th>
                  {gridDays.map((day) => (
                    <th key={day} className={weekend.has((parseStamp(day) ?? new Date()).getDay()) ? 'weekend' : ''}>
                      <span>{Number(day.slice(8))}</span><small>{WEEKDAY_NAMES[(parseStamp(day) ?? new Date()).getDay()].slice(0, 2)}</small>
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

      <Section title="Daily coverage" note="analysts on shift per day">
        <BarChart
          valueLabel="Analysts on shift per day"
          data={report.coverage.map((day) => ({ label: String(Number(day.date.slice(8))), marker: day.weekend, segments: [{ value: day.working, color: '#1e8a4c' }, { value: day.gaps, color: '#d5323f' }] }))}
        />
        <Legend items={[{ label: 'On shift', color: '#1e8a4c' }, { label: 'Sick / gap', color: '#d5323f' }, { label: 'Weekend', color: '#e3e8ee' }]} />
        {report.gapDates.length ? <p className="rpt-footnote">Staffing gaps recorded on: {report.gapDates.map((date) => formatDate(date)).join(', ')}.</p> : null}
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
    return <Section title="Summary"><Empty>No stand-up tasks were recorded in this period.</Empty></Section>;
  }
  return (
    <>
      <Section title="Summary">
        <Tiles items={[
          { label: 'Tasks', value: String(report.total), hint: `over ${report.activeDays} stand-up day(s)` },
          { label: 'Completion rate', value: formatPercent(report.rate), tone: taskTone(report.rate) },
          { label: 'Planned effort', value: formatDuration(report.minutes), hint: `${formatDuration(report.completedMinutes)} completed` },
          { label: 'Linked to objectives', value: `${report.linkedToObjectives} / ${report.total}` },
          { label: 'Carried over', value: String(report.carriedOver.length), tone: report.carriedOver.length ? 'watch' : 'healthy', hint: 'tasks seen on 2+ days' },
          { label: 'Still open', value: String(report.open.length), tone: report.open.length ? 'watch' : 'healthy' },
        ]} />
      </Section>

      <Section title="Daily completion">
        <BarChart
          valueLabel="Tasks per day"
          data={report.byDay.map((day) => ({ label: day.date.slice(5), segments: [{ value: day.completed, color: '#1e8a4c' }, { value: day.total - day.completed, color: '#ffb000' }] }))}
        />
        <Legend items={[{ label: 'Completed', color: '#1e8a4c' }, { label: 'Not completed', color: '#ffb000' }]} />
      </Section>

      <div className="rpt-two-col">
        <Section title="By lead">
          <table className="rpt-table compact">
            <thead><tr><th>Lead</th><th className="num">Tasks</th><th className="num">Done</th><th className="num">Rate</th><th className="num">Effort</th></tr></thead>
            <tbody>{report.byLead.map((row) => <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className="num">{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>)}</tbody>
          </table>
        </Section>
        <Section title="By Eisenhower quadrant">
          <table className="rpt-table compact">
            <thead><tr><th>Quadrant</th><th className="num">Tasks</th><th className="num">Done</th><th className="num">Rate</th><th className="num">Effort</th></tr></thead>
            <tbody>{report.byQuadrant.map((row) => <tr key={row.name}><td>{row.name}</td><td className="num">{row.tasks}</td><td className="num">{row.completed}</td><td className="num">{formatPercent(row.rate)}</td><td className="num">{formatDuration(row.minutes)}</td></tr>)}</tbody>
          </table>
        </Section>
      </div>

      {report.carriedOver.length ? (
        <Section title="Carried-over tasks" note="same task and lead on more than one day">
          <table className="rpt-table compact">
            <thead><tr><th>Task</th><th>Lead</th><th className="num">Days</th><th>Latest status</th></tr></thead>
            <tbody>{report.carriedOver.slice(0, 25).map((row) => <tr key={`${row.title}-${row.lead}`}><td>{row.title}</td><td>{row.lead}</td><td className="num">{row.days}</td><td>{row.lastStatus}</td></tr>)}</tbody>
          </table>
        </Section>
      ) : null}

      {report.open.length ? (
        <Section title="Open tasks" note={report.open.length > 30 ? `showing 30 of ${report.open.length}` : undefined}>
          <table className="rpt-table compact">
            <thead><tr><th>Date</th><th>Task</th><th>Lead</th><th>Quadrant</th><th className="num">Effort</th></tr></thead>
            <tbody>{report.open.slice(0, 30).map((task) => <tr key={task.id}><td className="nowrap">{task.taskDate}</td><td>{task.title}</td><td>{task.lead}</td><td>{task.quadrant}</td><td className="num">{formatDuration(task.durationMinutes)}</td></tr>)}</tbody>
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
      <thead><tr><th>Shift</th><th>Hours</th><th>On duty</th></tr></thead>
      <tbody>{groups.map((group) => <tr key={group.code}><td><b>{group.code}</b> {group.label !== group.code ? group.label : ''}</td><td className="nowrap">{group.hours || '—'}</td><td>{group.analysts.join(', ')}</td></tr>)}</tbody>
    </table>
  ) : <Empty>No shifts planned.</Empty>;

  return (
    <>
      <Section title="At a glance">
        <Tiles items={[
          { label: 'Open incidents', value: String(report.openIncidents.length), tone: report.openIncidents.some((m) => m.incident.priority === 'P1') ? 'risk' : report.openIncidents.length ? 'watch' : 'healthy', hint: `${report.openIncidents.filter((m) => m.incident.priority === 'P1').length} P1` },
          { label: 'New incidents today', value: String(report.newIncidents.length) },
          { label: 'Open issues', value: String(report.openIssues.length), tone: report.openIssues.some((issue) => issue.health === 'risk') ? 'risk' : 'neutral' },
          { label: 'Open tasks today', value: String(report.openTasks.length), hint: `${report.doneTasks} completed` },
          { label: 'Absences', value: String(report.absent.length), tone: report.absent.length ? 'watch' : 'healthy' },
        ]} />
      </Section>

      <div className="rpt-two-col">
        <Section title={`On duty · ${formatDate(report.date)}`}>{rosterTable(report.rosterToday)}</Section>
        <Section title={`Next day · ${formatDate(report.nextDate)}`}>{rosterTable(report.rosterNext)}</Section>
      </div>
      {report.absent.length ? (
        <p className="rpt-footnote">Absent today: {report.absent.map((item) => `${item.analyst} (${item.label})`).join(', ')}.</p>
      ) : null}

      <Section title="Open incidents to hand over">
        {report.openIncidents.length ? (
          <table className="rpt-table dense">
            <thead><tr><th>Ref</th><th>Incident</th><th>Customer</th><th>Pri</th><th>Detected</th><th>Analyst</th><th>Ack</th><th>Resolve SLA</th></tr></thead>
            <tbody>
              {report.openIncidents.map((m) => (
                <tr key={m.incident.id}>
                  <td className="mono">{m.incident.ref || `#${m.incident.id}`}</td><td>{m.incident.title}</td><td>{m.incident.customer || '—'}</td><td>{m.incident.priority}</td>
                  <td className="nowrap">{formatStamp(m.incident.detectedAt)}</td><td>{m.incident.analyst || '—'}</td><td><StateBadge state={m.ackState} /></td><td><StateBadge state={m.resolveState} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No open incidents.</Empty>}
      </Section>

      {report.newIncidents.length ? (
        <Section title="Incidents detected today">
          <IncidentLogTable incidents={report.newIncidents} showCustomer />
        </Section>
      ) : null}

      <Section title="Open issues">
        {report.openIssues.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>Issue</th><th>Owner</th><th>Status</th><th>Due</th><th>Health</th></tr></thead>
            <tbody>{report.openIssues.slice(0, 15).map((issue) => <tr key={issue.id}><td>{issue.title}</td><td>{issue.owner}</td><td>{issue.status}</td><td className="nowrap">{issue.due || '—'}</td><td><HealthDot health={issue.health} /> {issue.health}</td></tr>)}</tbody>
          </table>
        ) : <Empty>No open issues.</Empty>}
      </Section>

      {report.followUps.length ? (
        <Section title="Follow-ups">
          <table className="rpt-table compact">
            <thead><tr><th>Ref</th><th>Follow-up</th><th>Owner</th><th>Age</th><th>Health</th></tr></thead>
            <tbody>{report.followUps.map((item) => <tr key={item.id}><td className="mono">{item.ref}</td><td>{item.title}</td><td>{item.owner}</td><td>{item.age}</td><td><HealthDot health={item.health} /> {item.health}</td></tr>)}</tbody>
          </table>
        </Section>
      ) : null}

      <Section title="Outstanding tasks for today">
        {report.openTasks.length ? (
          <table className="rpt-table compact">
            <thead><tr><th>Task</th><th>Lead</th><th>Assignee</th><th>Quadrant</th><th>Due</th></tr></thead>
            <tbody>{report.openTasks.map((task) => <tr key={task.id}><td>{task.title}</td><td>{task.lead}</td><td>{task.assignee || '—'}</td><td>{task.quadrant}</td><td>{task.dueTime || '—'}</td></tr>)}</tbody>
          </table>
        ) : <Empty>All of today's stand-up tasks are complete.</Empty>}
      </Section>

      {report.notes.length ? (
        <Section title="Notes">
          <ul className="rpt-notes">{report.notes.map((note) => <li key={note.id}>{note.pinned ? <b>📌 </b> : null}{note.text}</li>)}</ul>
        </Section>
      ) : null}

      <Section title="Handover remarks">
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
        <header className="panel-head"><h2>Incident register</h2><div className="panel-meta"><span className="muted">{incidents.length} incidents</span></div></header>
        <div className="panel-body">
          <div className="report-filters">
            <select value={filter.customer} onChange={(event) => setFilter({ ...filter, customer: event.target.value })}>
              <option value="">All customers</option>
              {customers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
              <option value="">All statuses</option>
              {INCIDENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <input type="search" placeholder="Search ref, title, analyst…" value={filter.search} onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
          </div>
          {visible.length ? (
            <div className="report-table-scroll">
              <table className="grid-table">
                <thead><tr><th>Ref</th><th>Title</th><th>Customer</th><th>Pri</th><th>Detected</th><th>TTA</th><th>TTR</th><th>Status</th>{canEdit ? <th className="ta-r">Action</th> : null}</tr></thead>
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
                        <td>{item.status}</td>
                        {canEdit ? (
                          <td className="ta-r">
                            <div className="action-row">
                              <button type="button" className="icon-btn" onClick={() => edit(item)} title="Edit incident" aria-label="Edit incident"><Pencil size={14} /></button>
                              {isAdmin ? <button type="button" className="icon-btn" onClick={() => { if (window.confirm(`Delete incident ${item.ref || item.id}? It will no longer count in SLA reports. The deletion is logged.`)) void mutate(`delete-incident-${item.id}`, () => api.deleteRecord('incident', item.id)); }} title="Delete incident (Admin only, logged)" aria-label="Delete incident"><Trash2 size={14} /></button> : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length > 300 ? <p className="muted">Showing the 300 most recent of {visible.length}. Use the filters to narrow down.</p> : null}
            </div>
          ) : <p className="muted report-empty-state">No incidents yet. Import your SLA sheet (Excel or CSV) or add an incident with the form.</p>}
        </div>
      </section>

      {canEdit ? (
        <aside className="report-register-side">
          <section className="panel">
            <header className="panel-head"><h2>{editingId ? 'Edit incident' : 'Add incident'}</h2></header>
            <div className="panel-body">
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <div className="form-grid two">
                  <label className="field"><span>Ref / ticket</span><input {...field('ref')} placeholder="INC-1024" /></label>
                  <label className="field"><span>Customer</span><input {...field('customer')} list="incident-customers" placeholder="Customer name" /></label>
                </div>
                <datalist id="incident-customers">{customers.map((name) => <option key={name} value={name} />)}</datalist>
                <label className="field"><span>Title</span><input {...field('title')} required /></label>
                <div className="form-grid two">
                  <label className="field"><span>Priority</span><select {...field('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                  <label className="field"><span>Status</span><select {...field('status')}>{INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                </div>
                <div className="form-grid two">
                  <label className="field"><span>Category</span><input {...field('category')} placeholder="Malware, Phishing…" /></label>
                  <label className="field"><span>Analyst</span><input {...field('analyst')} list="incident-analysts" /></label>
                </div>
                <datalist id="incident-analysts">{(app.settings.rosterStaff ?? []).map((name) => <option key={name} value={name} />)}</datalist>
                <label className="field"><span>Occurred (optional – for MTTD)</span><input type="datetime-local" {...field('occurredAt')} /></label>
                <label className="field"><span>Detected</span><input type="datetime-local" {...field('detectedAt')} required /></label>
                <label className="field"><span>Acknowledged</span>
                  <span className="report-inline"><input type="datetime-local" {...field('acknowledgedAt')} /><button type="button" className="ghost-btn" onClick={() => setForm({ ...form, acknowledgedAt: now16(), status: form.status === 'Open' ? 'Acknowledged' : form.status })}>Now</button></span>
                </label>
                <label className="field"><span>Resolved</span>
                  <span className="report-inline"><input type="datetime-local" {...field('resolvedAt')} /><button type="button" className="ghost-btn" onClick={() => setForm({ ...form, resolvedAt: now16(), status: 'Resolved' })}>Now</button></span>
                </label>
                <label className="field"><span>Notes</span><textarea rows={2} {...field('notes')} /></label>
                <button className="primary-btn" type="submit" disabled={busy}>{editingId ? <><Save size={14} /> Save incident</> : <><Plus size={14} /> Add incident</>}</button>
                {editingId ? <button className="ghost-btn" type="button" onClick={reset}>Cancel edit</button> : null}
              </form>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head"><h2>Import Excel / CSV</h2></header>
            <div className="panel-body form-stack">
              <p className="muted small">
                Upload a sheet with one row per ticket: <b>ticket number, priority, detected date/time</b> and the <b>MTTD, MTTA and MTTR</b> for that ticket
                (minutes like <code>45</code>, <code>1h 30m</code> or <code>1:30</code>). The SLA reports are built from it automatically.
                Exports with timestamps from Splunk, ServiceNow or Jira work too. Re-importing a ticket updates it instead of duplicating it.
              </p>
              <label className="primary-btn report-file-btn">
                <Upload size={14} /> Choose Excel or CSV file
                <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} disabled={busy} />
              </label>
              <button type="button" className="ghost-btn" onClick={() => void downloadTemplate('xlsx')}><Download size={14} /> Download Excel template</button>
              <button type="button" className="link-btn" onClick={() => void downloadTemplate('csv')}>or CSV template</button>
              {importResult ? <p className="report-import-ok">{importResult}</p> : null}
              {importErrors.length ? <ul className="report-import-errors">{importErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
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
      <header className="panel-head"><h2>Change history</h2><div className="panel-meta"><span className="muted">Admin only</span></div></header>
      <div className="panel-body">
        {error ? <p className="report-import-errors">{error}</p> : null}
        {entries && !entries.length ? <p className="muted small">No changes recorded yet.</p> : null}
        {entries && entries.length ? (
          <ul className="audit-list">
            {entries.slice(0, 50).map((entry) => (
              <li key={entry.id}>
                <div className="audit-head">
                  <strong>{AUDIT_LABELS[entry.action] ?? entry.action}</strong>
                  <span className="muted"> · {entry.target}</span>
                </div>
                <div className="muted small">{new Date(entry.at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {entry.username || 'system'}{entry.role ? ` (${entry.role})` : ''}</div>
                {describeAudit(entry) ? <div className="audit-detail">{describeAudit(entry)}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

