// SPDX-License-Identifier: Apache-2.0
// Report calculations. Pure functions over the cockpit snapshot, so the same
// numbers appear on screen and in the printed PDF.

import type {
  AppSnapshot,
  Health,
  IncidentPriority,
  IncidentRow,
  IssueRow,
  MatrixQuadrant,
  MatrixTask,
  ReportSettings,
  RosterAssignment,
  SlaTargets,
} from './types';

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export const PRIORITIES: IncidentPriority[] = ['P1', 'P2', 'P3', 'P4'];
const QUADRANTS: MatrixQuadrant[] = ['Do', 'Delegate', 'Delay', 'Discard'];

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  orgName: 'Security Operations Center',
  weekendDays: [0, 6],
  slaTargets: {
    P1: { detect: 15, ack: 15, resolve: 240 },
    P2: { detect: 30, ack: 30, resolve: 480 },
    P3: { detect: 60, ack: 120, resolve: 1440 },
    P4: { detect: 240, ack: 480, resolve: 4320 },
  },
  compliance: { target: 95, amber: 85 },
  customerSla: {},
};

export function reportSettingsOf(app: AppSnapshot): ReportSettings {
  const stored = app.settings.reports;
  return stored ? { ...DEFAULT_REPORT_SETTINGS, ...stored, customerSla: stored.customerSla ?? {}, compliance: stored.compliance ?? DEFAULT_REPORT_SETTINGS.compliance } : DEFAULT_REPORT_SETTINGS;
}

/** SLA targets for a customer: its override when one exists, otherwise the defaults. */
export function targetsFor(settings: ReportSettings, customer: string): SlaTargets {
  const key = customerSlaKey(settings, customer);
  return key ? settings.customerSla[key] : settings.slaTargets;
}

/** The customer-specific SLA key matching a customer name (case-insensitive), or ''. */
export function customerSlaKey(settings: ReportSettings, customer: string): string {
  const wanted = (customer || '').trim().toLowerCase();
  if (!wanted) return '';
  return Object.keys(settings.customerSla ?? {}).find((key) => key.toLowerCase() === wanted) ?? '';
}

export type Tone = Health | 'neutral';

/** Colour for a compliance percentage using the configured target and amber thresholds. */
export function complianceTone(value: number | null, settings: ReportSettings): Tone {
  if (value === null) return 'neutral';
  if (value >= settings.compliance.target) return 'healthy';
  if (value >= settings.compliance.amber) return 'watch';
  return 'risk';
}

// ---------- date helpers ----------

const pad = (value: number) => String(value).padStart(2, '0');

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function stampOf(date: Date): string {
  return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local "YYYY-MM-DDTHH:MM" (or date-only) -> Date. */
export function parseStamp(value: string): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
}

/** Server ISO timestamps (UTC) -> local date key. */
function isoToDateKey(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : dateKey(parsed);
}

export function inPeriod(key: string, period: Period): boolean {
  return Boolean(key) && key >= period.from && key <= period.to;
}

export function datesIn(period: Period): string[] {
  const out: string[] = [];
  const cursor = parseStamp(period.from);
  const end = parseStamp(period.to);
  if (!cursor || !end) return out;
  while (cursor <= end && out.length < 400) {
    out.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function monthPeriod(anchor: string): Period {
  const date = parseStamp(anchor) ?? new Date();
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: dateKey(first), to: dateKey(last) };
}

export function formatPeriod(period: Period, locale?: string): string {
  const from = parseStamp(period.from);
  const to = parseStamp(period.to);
  if (!from || !to) return '';
  const fullMonth = from.getDate() === 1 && to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate()
    && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (fullMonth) return from.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${from.toLocaleDateString(locale, options)} – ${to.toLocaleDateString(locale, options)}`;
}

export function formatDate(key: string, locale?: string): string {
  const date = parseStamp(key);
  return date ? date.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : key;
}

export function formatStamp(value: string, locale?: string): string {
  const date = parseStamp(value);
  return date ? `${date.toLocaleDateString(locale, { day: '2-digit', month: 'short' })} ${pad(date.getHours())}:${pad(date.getMinutes())}` : '—';
}

function minutesBetween(start: string, end: string): number | null {
  const a = parseStamp(start);
  const b = parseStamp(end);
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/** 95 -> "1h 35m", 3000 -> "2d 2h" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const value = Math.round(minutes);
  if (value < 60) return `${value}m`;
  if (value < 1440) {
    const m = value % 60;
    return m ? `${Math.floor(value / 60)}h ${m}m` : `${Math.floor(value / 60)}h`;
  }
  const h = Math.floor((value % 1440) / 60);
  return h ? `${Math.floor(value / 1440)}d ${h}h` : `${Math.floor(value / 1440)}d`;
}

export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function formatPercent(value: number | null, locale?: string): string {
  return value === null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
}

export interface Stats {
  count: number;
  avg: number | null;
  median: number | null;
  p90: number | null;
}

function stats(values: Array<number | null>): Stats {
  const list = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!list.length) return { count: 0, avg: null, median: null, p90: null };
  const at = (q: number) => list[Math.min(list.length - 1, Math.ceil(q * list.length) - 1)];
  const mid = Math.floor(list.length / 2);
  return {
    count: list.length,
    avg: list.reduce((sum, value) => sum + value, 0) / list.length,
    median: list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2,
    p90: at(0.9),
  };
}

// ---------- SLA (MTTD / MTTA / MTTR) ----------

export type SlaState = 'met' | 'breached' | 'pending' | 'na';

export interface IncidentMetrics {
  incident: IncidentRow;
  ttd: number | null;
  tta: number | null;
  ttr: number | null;
  detectState: SlaState;
  ackState: SlaState;
  resolveState: SlaState;
  isOpen: boolean;
}

export function isIncidentOpen(incident: IncidentRow): boolean {
  return incident.status === 'Open' || incident.status === 'Acknowledged';
}

function slaState(actual: number | null, target: number, elapsedIfMissing: number | null): SlaState {
  if (!target) return 'na';
  if (actual !== null) return actual <= target ? 'met' : 'breached';
  if (elapsedIfMissing === null) return 'na';
  return elapsedIfMissing > target ? 'breached' : 'pending';
}

export function measureIncident(incident: IncidentRow, settings: ReportSettings, now: Date): IncidentMetrics {
  const targets = targetsFor(settings, incident.customer);
  const target = targets[incident.priority] ?? targets.P3;
  const ttd = minutesBetween(incident.occurredAt, incident.detectedAt);
  const tta = minutesBetween(incident.detectedAt, incident.acknowledgedAt);
  const ttr = minutesBetween(incident.detectedAt, incident.resolvedAt);
  const elapsed = minutesBetween(incident.detectedAt, stampOf(now));
  const isOpen = isIncidentOpen(incident);
  return {
    incident,
    ttd,
    tta,
    ttr,
    detectState: incident.occurredAt ? slaState(ttd, target.detect, null) : 'na',
    // A closed ticket with no acknowledgement time is not measurable rather than breached.
    ackState: slaState(tta, target.ack, isOpen ? elapsed : null),
    resolveState: slaState(ttr, target.resolve, isOpen ? elapsed : null),
    isOpen,
  };
}

export interface SlaPriorityRow {
  priority: IncidentPriority;
  count: number;
  open: number;
  ttd: Stats;
  tta: Stats;
  ttr: Stats;
  ackMet: number;
  ackBreached: number;
  resolveMet: number;
  resolveBreached: number;
  ackCompliance: number | null;
  resolveCompliance: number | null;
}

export interface SlaBreach {
  incident: IncidentRow;
  measure: 'Detect' | 'Acknowledge' | 'Resolve';
  actual: number | null;
  target: number;
  open: boolean;
}

export interface SlaReport {
  customer: string;
  incidents: IncidentMetrics[];
  rows: SlaPriorityRow[];
  total: SlaPriorityRow;
  overallCompliance: number | null;
  breaches: SlaBreach[];
  daily: Array<{ date: string; counts: Record<IncidentPriority, number> }>;
  byCategory: Array<{ name: string; count: number }>;
  customers: string[];
  /** Targets shown in the report: the selected customer's, or the defaults for "All customers". */
  targets: SlaTargets;
  /** True when the selected customer has its own SLA. */
  customTargets: boolean;
  /** Customers in this report that are measured against their own SLA. */
  overrideCustomers: string[];
  meetsContract: boolean | null;
}

function summarize(priority: IncidentPriority, list: IncidentMetrics[]): SlaPriorityRow {
  const ackMet = list.filter((m) => m.ackState === 'met').length;
  const ackBreached = list.filter((m) => m.ackState === 'breached').length;
  const resolveMet = list.filter((m) => m.resolveState === 'met').length;
  const resolveBreached = list.filter((m) => m.resolveState === 'breached').length;
  return {
    priority,
    count: list.length,
    open: list.filter((m) => m.isOpen).length,
    ttd: stats(list.map((m) => m.ttd)),
    tta: stats(list.map((m) => m.tta)),
    ttr: stats(list.map((m) => m.ttr)),
    ackMet,
    ackBreached,
    resolveMet,
    resolveBreached,
    ackCompliance: percent(ackMet, ackMet + ackBreached),
    resolveCompliance: percent(resolveMet, resolveMet + resolveBreached),
  };
}

export function customersOf(app: AppSnapshot): string[] {
  return [...new Set((app.incidents ?? []).map((item) => item.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildSlaReport(app: AppSnapshot, period: Period, customer: string, now = new Date()): SlaReport {
  const settings = reportSettingsOf(app);
  const all = app.incidents ?? [];
  const selected = all
    .filter((item) => inPeriod(item.detectedAt.slice(0, 10), period))
    .filter((item) => !customer || item.customer === customer)
    .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  const measured = selected.map((item) => measureIncident(item, settings, now));
  const rows = PRIORITIES.map((priority) => summarize(priority, measured.filter((m) => m.incident.priority === priority)));
  const total = summarize('P1', measured);

  const breaches: SlaBreach[] = [];
  for (const m of measured) {
    const target = targetsFor(settings, m.incident.customer)[m.incident.priority];
    const elapsed = minutesBetween(m.incident.detectedAt, stampOf(now));
    if (m.detectState === 'breached') breaches.push({ incident: m.incident, measure: 'Detect', actual: m.ttd, target: target.detect, open: false });
    if (m.ackState === 'breached') breaches.push({ incident: m.incident, measure: 'Acknowledge', actual: m.tta ?? elapsed, target: target.ack, open: m.tta === null });
    if (m.resolveState === 'breached') breaches.push({ incident: m.incident, measure: 'Resolve', actual: m.ttr ?? elapsed, target: target.resolve, open: m.ttr === null });
  }

  const daily = datesIn(period).map((date) => {
    const counts = { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<IncidentPriority, number>;
    for (const m of measured) if (m.incident.detectedAt.startsWith(date)) counts[m.incident.priority] += 1;
    return { date, counts };
  });

  const categoryCounts = new Map<string, number>();
  for (const m of measured) {
    const name = m.incident.category || 'Uncategorised';
    categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
  }

  const met = total.ackMet + total.resolveMet;
  const breached = total.ackBreached + total.resolveBreached;
  const overallCompliance = percent(met, met + breached);
  return {
    customer,
    incidents: measured,
    rows,
    total,
    overallCompliance,
    breaches,
    daily,
    byCategory: [...categoryCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    customers: customersOf(app),
    targets: targetsFor(settings, customer),
    customTargets: Boolean(customerSlaKey(settings, customer)),
    overrideCustomers: [...new Set(measured.map((m) => m.incident.customer))].filter((name) => Boolean(customerSlaKey(settings, name))).sort(),
    meetsContract: overallCompliance === null ? null : overallCompliance >= settings.compliance.target,
  };
}

// ---------- Workforce & attendance ----------

export type AttendanceKind = 'worked' | 'off' | 'leave' | 'gap';

export function attendanceKind(assignment: RosterAssignment, labelText = ''): AttendanceKind {
  const code = assignment.shiftName.toUpperCase();
  if (code === 'DO' || /\boff\b/i.test(labelText)) return 'off';
  if (assignment.status === 'Leave') return 'leave';
  if (assignment.status === 'Gap') return 'gap';
  return 'worked';
}

export interface AnalystAttendance {
  analyst: string;
  byCode: Record<string, number>;
  worked: number;
  workedWeekday: number;
  workedWeekend: number;
  off: number;
  leave: number;
  gap: number;
  unassigned: number;
}

export interface WorkforceReport {
  dates: string[];
  codes: Array<{ code: string; label: string; hours: string }>;
  analysts: AnalystAttendance[];
  coverage: Array<{ date: string; working: number; gaps: number; weekend: boolean }>;
  totals: { worked: number; off: number; leave: number; gap: number; weekdays: number; weekendDays: number };
  minCoverage: { date: string; working: number } | null;
  gapDates: string[];
}

export function buildWorkforceReport(app: AppSnapshot, period: Period): WorkforceReport {
  const settings = reportSettingsOf(app);
  const weekend = new Set(settings.weekendDays);
  const dates = datesIn(period);
  const isWeekend = (key: string) => weekend.has((parseStamp(key) ?? new Date()).getDay());
  const labels = new Map((app.settings.rosterLabels ?? []).map((label) => [label.code, label]));
  const inRange = app.rosterAssignments.filter((item) => inPeriod(item.rosterDate, period));

  const names = [...(app.settings.rosterStaff ?? [])];
  for (const item of inRange) if (item.analyst && !names.includes(item.analyst)) names.push(item.analyst);

  const codeSet = new Set<string>();
  const analysts = names.map((analyst) => {
    const row: AnalystAttendance = { analyst, byCode: {}, worked: 0, workedWeekday: 0, workedWeekend: 0, off: 0, leave: 0, gap: 0, unassigned: 0 };
    const mine = inRange.filter((item) => item.analyst === analyst);
    const assignedDates = new Set(mine.map((item) => item.rosterDate));
    for (const item of mine) {
      codeSet.add(item.shiftName);
      row.byCode[item.shiftName] = (row.byCode[item.shiftName] ?? 0) + 1;
      const kind = attendanceKind(item, labels.get(item.shiftName)?.label);
      row[kind] += 1;
      if (kind === 'worked') {
        if (isWeekend(item.rosterDate)) row.workedWeekend += 1;
        else row.workedWeekday += 1;
      }
    }
    row.unassigned = dates.filter((date) => !assignedDates.has(date)).length;
    return row;
  }).filter((row) => Object.keys(row.byCode).length > 0 || (app.settings.rosterStaff ?? []).includes(row.analyst));

  const coverage = dates.map((date) => {
    const day = inRange.filter((item) => item.rosterDate === date);
    return {
      date,
      working: day.filter((item) => attendanceKind(item, labels.get(item.shiftName)?.label) === 'worked').length,
      gaps: day.filter((item) => item.status === 'Gap').length,
      weekend: isWeekend(date),
    };
  });
  const scheduledDays = coverage.filter((day) => inRange.some((item) => item.rosterDate === day.date));
  const minDay = scheduledDays.reduce<{ date: string; working: number } | null>((lowest, day) => (!lowest || day.working < lowest.working ? { date: day.date, working: day.working } : lowest), null);

  return {
    dates,
    codes: [...codeSet].sort().map((code) => ({ code, label: labels.get(code)?.label ?? code, hours: labels.get(code)?.hours ?? '' })),
    analysts,
    coverage,
    totals: {
      worked: analysts.reduce((sum, row) => sum + row.worked, 0),
      off: analysts.reduce((sum, row) => sum + row.off, 0),
      leave: analysts.reduce((sum, row) => sum + row.leave, 0),
      gap: analysts.reduce((sum, row) => sum + row.gap, 0),
      weekdays: dates.filter((date) => !isWeekend(date)).length,
      weekendDays: dates.filter(isWeekend).length,
    },
    minCoverage: minDay,
    gapDates: coverage.filter((day) => day.gaps > 0).map((day) => day.date),
  };
}

// ---------- Stand-up & tasks ----------

interface TaskGroup {
  name: string;
  tasks: number;
  completed: number;
  minutes: number;
  rate: number | null;
}

export interface StandupReport {
  tasks: MatrixTask[];
  total: number;
  completed: number;
  rate: number | null;
  minutes: number;
  completedMinutes: number;
  linkedToObjectives: number;
  byLead: TaskGroup[];
  byQuadrant: TaskGroup[];
  byDay: Array<{ date: string; total: number; completed: number }>;
  carriedOver: Array<{ title: string; lead: string; days: number; lastStatus: string }>;
  open: MatrixTask[];
  activeDays: number;
}

function group(name: string, list: MatrixTask[]): TaskGroup {
  const completed = list.filter((task) => task.status === 'Completed').length;
  return { name, tasks: list.length, completed, minutes: list.reduce((sum, task) => sum + (task.durationMinutes || 0), 0), rate: percent(completed, list.length) };
}

export function buildStandupReport(app: AppSnapshot, period: Period): StandupReport {
  const tasks = app.matrixTasks.filter((task) => inPeriod(task.taskDate, period));
  const leads = [...new Set(tasks.map((task) => task.lead || 'Unassigned'))].sort();
  const completed = tasks.filter((task) => task.status === 'Completed');

  // A task that appears on more than one day with the same title and lead was carried over.
  const keyed = new Map<string, MatrixTask[]>();
  for (const task of tasks) {
    const key = `${task.title.trim().toLowerCase()}__${task.lead.trim().toLowerCase()}`;
    keyed.set(key, [...(keyed.get(key) ?? []), task]);
  }
  const carriedOver = [...keyed.values()]
    .filter((list) => new Set(list.map((task) => task.taskDate)).size > 1)
    .map((list) => {
      const sorted = [...list].sort((a, b) => a.taskDate.localeCompare(b.taskDate));
      const last = sorted[sorted.length - 1];
      return { title: last.title, lead: last.lead, days: new Set(list.map((task) => task.taskDate)).size, lastStatus: last.status };
    })
    .sort((a, b) => b.days - a.days);

  const byDayMap = new Map<string, { total: number; completed: number }>();
  for (const task of tasks) {
    const entry = byDayMap.get(task.taskDate) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (task.status === 'Completed') entry.completed += 1;
    byDayMap.set(task.taskDate, entry);
  }

  return {
    tasks,
    total: tasks.length,
    completed: completed.length,
    rate: percent(completed.length, tasks.length),
    minutes: tasks.reduce((sum, task) => sum + (task.durationMinutes || 0), 0),
    completedMinutes: completed.reduce((sum, task) => sum + (task.durationMinutes || 0), 0),
    linkedToObjectives: tasks.filter((task) => task.objectiveId > 0).length,
    byLead: leads.map((lead) => group(lead, tasks.filter((task) => (task.lead || 'Unassigned') === lead))),
    byQuadrant: QUADRANTS.map((quadrant) => group(quadrant, tasks.filter((task) => task.quadrant === quadrant))),
    byDay: [...byDayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, ...value })),
    carriedOver,
    open: tasks.filter((task) => task.status !== 'Completed').sort((a, b) => b.taskDate.localeCompare(a.taskDate) || QUADRANTS.indexOf(a.quadrant) - QUADRANTS.indexOf(b.quadrant)),
    activeDays: byDayMap.size,
  };
}

// ---------- Shift handover ----------

const HEALTH_ORDER: Record<Health, number> = { risk: 0, watch: 1, healthy: 2 };

export interface HandoverReport {
  date: string;
  nextDate: string;
  rosterToday: Array<{ code: string; label: string; hours: string; analysts: string[] }>;
  rosterNext: Array<{ code: string; label: string; hours: string; analysts: string[] }>;
  absent: Array<{ analyst: string; code: string; label: string }>;
  openIncidents: IncidentMetrics[];
  newIncidents: IncidentMetrics[];
  openIssues: IssueRow[];
  followUps: AppSnapshot['followUps'];
  openTasks: MatrixTask[];
  doneTasks: number;
  notes: AppSnapshot['notes'];
  brief: AppSnapshot['advisorBriefs'][number] | null;
}

function rosterGroups(app: AppSnapshot, date: string) {
  const labels = new Map((app.settings.rosterLabels ?? []).map((label) => [label.code, label]));
  const day = app.rosterAssignments.filter((item) => item.rosterDate === date && attendanceKind(item, labels.get(item.shiftName)?.label) === 'worked');
  const codes = [...new Set(day.map((item) => item.shiftName))].sort();
  return codes.map((code) => ({
    code,
    label: labels.get(code)?.label ?? code,
    hours: labels.get(code)?.hours ?? '',
    analysts: day.filter((item) => item.shiftName === code).map((item) => item.analyst).sort(),
  }));
}

export function buildHandoverReport(app: AppSnapshot, date: string, now = new Date()): HandoverReport {
  const settings = reportSettingsOf(app);
  const labels = new Map((app.settings.rosterLabels ?? []).map((label) => [label.code, label]));
  const next = parseStamp(date) ?? new Date();
  next.setDate(next.getDate() + 1);
  const incidents = (app.incidents ?? []).map((item) => measureIncident(item, settings, now));
  const priorityRank = (m: IncidentMetrics) => PRIORITIES.indexOf(m.incident.priority);
  const dayTasks = app.matrixTasks.filter((task) => task.taskDate === date);
  return {
    date,
    nextDate: dateKey(next),
    rosterToday: rosterGroups(app, date),
    rosterNext: rosterGroups(app, dateKey(next)),
    absent: app.rosterAssignments
      .filter((item) => item.rosterDate === date && ['leave', 'gap'].includes(attendanceKind(item, labels.get(item.shiftName)?.label)))
      .map((item) => ({ analyst: item.analyst, code: item.shiftName, label: labels.get(item.shiftName)?.label ?? item.status })),
    openIncidents: incidents.filter((m) => m.isOpen).sort((a, b) => priorityRank(a) - priorityRank(b) || a.incident.detectedAt.localeCompare(b.incident.detectedAt)),
    newIncidents: incidents.filter((m) => m.incident.detectedAt.startsWith(date)).sort((a, b) => priorityRank(a) - priorityRank(b)),
    openIssues: (app.issues ?? []).filter((issue) => issue.status !== 'Closed').sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.due.localeCompare(b.due)),
    followUps: [...app.followUps].sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]),
    openTasks: dayTasks.filter((task) => task.status !== 'Completed').sort((a, b) => QUADRANTS.indexOf(a.quadrant) - QUADRANTS.indexOf(b.quadrant)),
    doneTasks: dayTasks.filter((task) => task.status === 'Completed').length,
    notes: app.notes.filter((note) => note.pinned || note.noteDate === date),
    brief: app.advisorBriefs.find((brief) => brief.briefDate === date) ?? null,
  };
}

// ---------- Monthly SOC service report ----------

export interface ServiceReport {
  sla: SlaReport;
  workforce: WorkforceReport;
  standup: StandupReport;
  issuesOpened: IssueRow[];
  issuesClosed: IssueRow[];
  issuesOpenNow: IssueRow[];
  issuesOverdue: IssueRow[];
  issuesUndated: number;
  objectives: AppSnapshot['objectives'];
  objectivesDone: number;
  objectivesAtRisk: number;
  objectivesAvgProgress: number | null;
  projects: AppSnapshot['projects'];
  kpis: AppSnapshot['kpis'];
  processMaturity: number | null;
  brief: AppSnapshot['advisorBriefs'][number] | null;
}

export function buildServiceReport(app: AppSnapshot, period: Period, now = new Date()): ServiceReport {
  const issues = app.issues ?? [];
  const openNow = issues.filter((issue) => issue.status !== 'Closed');
  const objectives = app.objectives;
  return {
    sla: buildSlaReport(app, period, '', now),
    workforce: buildWorkforceReport(app, period),
    standup: buildStandupReport(app, period),
    issuesOpened: issues.filter((issue) => inPeriod(isoToDateKey(issue.createdAt), period)),
    issuesClosed: issues.filter((issue) => inPeriod(isoToDateKey(issue.closedAt), period)),
    issuesOpenNow: openNow,
    issuesOverdue: openNow.filter((issue) => issue.due && issue.due < dateKey(now)),
    issuesUndated: issues.filter((issue) => !issue.createdAt).length,
    objectives,
    objectivesDone: objectives.filter((item) => item.progress >= 100).length,
    objectivesAtRisk: objectives.filter((item) => item.health === 'risk').length,
    objectivesAvgProgress: objectives.length ? Math.round(objectives.reduce((sum, item) => sum + item.progress, 0) / objectives.length) : null,
    projects: app.projects,
    kpis: app.kpis,
    processMaturity: app.processes.length ? Math.round((app.processes.reduce((sum, item) => sum + item.maturity, 0) / app.processes.length) * 10) / 10 : null,
    brief: app.advisorBriefs.find((brief) => inPeriod(brief.briefDate, period)) ?? null,
  };
}

// ---------- KPI health rules (mirrors server/incidents.cjs) ----------

export interface ParsedMetric {
  kind: 'percent' | 'duration' | 'number';
  value: number;
}

/** Parses KPI values such as "94%", "3h 40m", "11m", "1d 2h", "142". */
export function parseMetric(input: string): ParsedMetric | null {
  const source = String(input ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!source) return null;
  let match = source.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (match) return { kind: 'percent', value: Number(match[1]) };
  if (/^(\d+(?:\.\d+)?\s*(d|h|m|min|mins|s|sec)\s*)+$/.test(source)) {
    const units: Record<string, number> = { d: 1440, h: 60, m: 1, min: 1, mins: 1, s: 1 / 60, sec: 1 / 60 };
    let total = 0;
    for (const part of source.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|mins|min|m|sec|s)/g)) total += Number(part[1]) * units[part[2]];
    return { kind: 'duration', value: total };
  }
  match = source.match(/^(-?\d+(?:\.\d+)?)$/);
  if (match) return { kind: 'number', value: Number(match[1]) };
  return null;
}

/** Health from a KPI rule, or null when the rule is manual or the values are not comparable. */
export function computeKpiHealth(actual: string, target: string, direction: string | undefined, tolerance: number | undefined): Health | null {
  if (direction !== 'higher' && direction !== 'lower') return null;
  const a = parseMetric(actual);
  const t = parseMetric(target);
  if (!a || !t || a.kind !== t.kind) return null;
  const band = Math.abs(t.value) * (Math.max(0, Number(tolerance) || 0) / 100);
  if (direction === 'higher') {
    if (a.value >= t.value) return 'healthy';
    return a.value >= t.value - band ? 'watch' : 'risk';
  }
  if (a.value <= t.value) return 'healthy';
  return a.value <= t.value + band ? 'watch' : 'risk';
}

/** "15", "15m", "4h", "1d 2h" -> minutes; null when not a duration. */
export function parseDurationInput(input: string): number | null {
  const source = String(input ?? '').trim();
  if (/^\d+$/.test(source)) return Number(source);
  const parsed = parseMetric(source);
  return parsed && parsed.kind === 'duration' ? Math.round(parsed.value) : null;
}
