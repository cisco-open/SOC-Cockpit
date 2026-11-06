// SPDX-License-Identifier: Apache-2.0
// Report calculations (src/reportCalc.ts). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandoverReport,
  buildServiceReport,
  buildSlaReport,
  buildStandupReport,
  buildWorkforceReport,
  complianceTone,
  computeKpiHealth,
  formatDuration,
  monthPeriod,
  parseDurationInput,
} from '../src/reportCalc.ts';

const period = { from: '2026-11-01', to: '2026-11-30' };
const now = new Date(2026, 10, 5, 10, 0); // 5 Nov 2026 10:00 local

function snapshot(overrides = {}) {
  return {
    settings: {
      rosterStaff: ['Ali', 'Sara'],
      rosterLabels: [
        { code: 'FS', label: 'First shift', hours: '07-15', status: 'Confirmed' },
        { code: 'DO', label: 'Day off', hours: '', status: 'Leave' },
        { code: 'SCK', label: 'Sick', hours: '', status: 'Gap' },
        { code: 'PL', label: 'Paid leave', hours: '', status: 'Leave' },
      ],
      reports: {
        orgName: 'Test SOC',
        weekendDays: [5, 6],
        slaTargets: {
          P1: { detect: 15, ack: 15, resolve: 240 },
          P2: { detect: 30, ack: 30, resolve: 480 },
          P3: { detect: 60, ack: 120, resolve: 1440 },
          P4: { detect: 240, ack: 480, resolve: 4320 },
        },
      },
    },
    kpis: [], projects: [], processes: [], followUps: [], notes: [], advisorBriefs: [],
    objectives: [{ id: 1, progress: 100, health: 'healthy' }, { id: 2, progress: 40, health: 'risk' }],
    issues: [
      { id: 1, status: 'Closed', createdAt: '2026-11-02T08:00:00.000Z', closedAt: '2026-11-03T08:00:00.000Z', due: '2026-11-05', health: 'watch' },
      { id: 2, status: 'Open', createdAt: '', closedAt: '', due: '2026-11-01', health: 'risk' },
    ],
    rosterAssignments: [
      { rosterDate: '2026-11-06', shiftName: 'FS', analyst: 'Ali', status: 'Confirmed' }, // Friday
      { rosterDate: '2026-11-08', shiftName: 'FS', analyst: 'Ali', status: 'Confirmed' }, // Sunday
      { rosterDate: '2026-11-08', shiftName: 'SCK', analyst: 'Sara', status: 'Gap' },
      { rosterDate: '2026-11-09', shiftName: 'DO', analyst: 'Sara', status: 'Leave' },
      { rosterDate: '2026-11-10', shiftName: 'PL', analyst: 'Sara', status: 'Leave' },
    ],
    matrixTasks: [
      { id: 1, taskDate: '2026-11-08', title: 'Patch WAF', lead: 'Ali', status: 'Not Completed', quadrant: 'Do', durationMinutes: 30, objectiveId: 1 },
      { id: 2, taskDate: '2026-11-09', title: 'Patch WAF', lead: 'Ali', status: 'Completed', quadrant: 'Do', durationMinutes: 30, objectiveId: 1 },
      { id: 3, taskDate: '2026-11-09', title: 'Review rules', lead: 'Sara', status: 'Completed', quadrant: 'Delay', durationMinutes: 60, objectiveId: 0 },
    ],
    incidents: [
      // P1: detect 10m (met), ack 20m (breach 15m), resolve 3h (met 4h)
      { id: 1, ref: 'A', customer: 'Acme', title: 't1', priority: 'P1', status: 'Resolved', category: 'Malware', occurredAt: '2026-11-01T08:00', detectedAt: '2026-11-01T08:10', acknowledgedAt: '2026-11-01T08:30', resolvedAt: '2026-11-01T11:10' },
      // P1: ack 5m (met), resolve 5h (breach)
      { id: 2, ref: 'B', customer: 'Acme', title: 't2', priority: 'P1', status: 'Closed', category: 'Malware', occurredAt: '', detectedAt: '2026-11-02T10:00', acknowledgedAt: '2026-11-02T10:05', resolvedAt: '2026-11-02T15:00' },
      // P3 open for 2+ days with no ack: both targets already breached
      { id: 3, ref: 'C', customer: 'Beta', title: 't3', priority: 'P3', status: 'Open', category: '', occurredAt: '', detectedAt: '2026-11-03T09:00', acknowledgedAt: '', resolvedAt: '' },
      // P2 open 10 minutes: still within target
      { id: 4, ref: 'D', customer: 'Beta', title: 't4', priority: 'P2', status: 'Open', category: 'Phishing', occurredAt: '', detectedAt: '2026-11-05T09:50', acknowledgedAt: '', resolvedAt: '' },
      // outside the period
      { id: 5, ref: 'E', customer: 'Acme', title: 't5', priority: 'P1', status: 'Closed', category: '', occurredAt: '', detectedAt: '2026-10-31T09:00', acknowledgedAt: '2026-10-31T09:01', resolvedAt: '2026-10-31T09:30' },
    ],
    ...overrides,
  };
}

test('SLA report computes MTTD/MTTA/MTTR and compliance per priority', () => {
  const report = buildSlaReport(snapshot(), period, '', now);
  assert.equal(report.incidents.length, 4, 'only incidents detected in the period');
  const p1 = report.rows.find((row) => row.priority === 'P1');
  assert.equal(p1.count, 2);
  assert.equal(p1.ttd.avg, 10);
  assert.equal(p1.tta.avg, 12.5);
  assert.equal(p1.ttr.avg, 240);
  assert.equal(p1.ackCompliance, 50);
  assert.equal(p1.resolveCompliance, 50);
  assert.deepEqual(report.incidents.map((m) => `${m.incident.ref}:${m.ackState}:${m.resolveState}`), [
    'A:breached:met', 'B:met:breached', 'C:breached:breached', 'D:pending:pending',
  ]);
  assert.equal(report.overallCompliance, 33.3);
  assert.equal(report.breaches.length, 4);
  assert.deepEqual(report.customers, ['Acme', 'Beta']);
});

test('SLA report filters by customer', () => {
  const report = buildSlaReport(snapshot(), period, 'Acme', now);
  assert.deepEqual(report.incidents.map((m) => m.incident.ref), ['A', 'B']);
});

test('workforce report honours the configured weekend', () => {
  const report = buildWorkforceReport(snapshot(), period);
  const ali = report.analysts.find((row) => row.analyst === 'Ali');
  const sara = report.analysts.find((row) => row.analyst === 'Sara');
  assert.deepEqual([ali.worked, ali.workedWeekend, ali.workedWeekday], [2, 1, 1], 'Friday counts as weekend');
  assert.deepEqual([sara.off, sara.leave, sara.gap], [1, 1, 1]);
  assert.deepEqual(report.gapDates, ['2026-11-08']);
  assert.equal(report.totals.weekendDays, 8, 'eight Fridays/Saturdays in November 2026');

  const satSun = buildWorkforceReport(snapshot({ settings: { ...snapshot().settings, reports: { ...snapshot().settings.reports, weekendDays: [0, 6] } } }), period);
  assert.equal(satSun.analysts.find((row) => row.analyst === 'Ali').workedWeekend, 1, 'Sunday counts as weekend instead');
});

test('stand-up report counts completion and carried-over tasks', () => {
  const report = buildStandupReport(snapshot(), period);
  assert.equal(report.total, 3);
  assert.equal(report.completed, 2);
  assert.equal(report.rate, 66.7);
  assert.equal(report.linkedToObjectives, 2);
  assert.deepEqual(report.carriedOver, [{ title: 'Patch WAF', lead: 'Ali', days: 2, lastStatus: 'Completed' }]);
});

test('handover report lists who is on duty and open incidents by priority', () => {
  const report = buildHandoverReport(snapshot(), '2026-11-08', now);
  assert.deepEqual(report.rosterToday, [{ code: 'FS', label: 'First shift', hours: '07-15', analysts: ['Ali'] }]);
  assert.deepEqual(report.absent, [{ analyst: 'Sara', code: 'SCK', label: 'Sick' }]);
  assert.deepEqual(report.openIncidents.map((m) => m.incident.ref), ['D', 'C']);
});

test('service report counts issues opened, closed and overdue in the period', () => {
  const report = buildServiceReport(snapshot(), period, now);
  assert.equal(report.issuesOpened.length, 1);
  assert.equal(report.issuesClosed.length, 1);
  assert.equal(report.issuesOverdue.length, 1);
  assert.equal(report.issuesUndated, 1);
  assert.equal(report.objectivesDone, 1);
  assert.equal(report.objectivesAvgProgress, 70);
});

test('helpers', () => {
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(95), '1h 35m');
  assert.equal(formatDuration(120), '2h');
  assert.equal(formatDuration(3000), '2d 2h');
  assert.equal(formatDuration(null), '—');
  assert.deepEqual(monthPeriod('2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
});

test('customer-specific SLA targets are used for that customer only', () => {
  const app = snapshot();
  // Acme gets a stricter acknowledge target: incident B (5m) now breaches a 3m target.
  app.settings.reports.customerSla = { Acme: { ...app.settings.reports.slaTargets, P1: { detect: 15, ack: 3, resolve: 600 } } };
  const all = buildSlaReport(app, period, '', now);
  const byRef = Object.fromEntries(all.incidents.map((m) => [m.incident.ref, m]));
  assert.equal(byRef.B.ackState, 'breached', 'Acme P1 ack 5m > 3m');
  assert.equal(byRef.B.resolveState, 'met', 'Acme P1 resolve 5h < 10h');
  assert.equal(byRef.C.ackState, 'breached', 'Beta still uses the standard targets');
  assert.deepEqual(all.overrideCustomers, ['Acme']);
  assert.equal(all.customTargets, false);

  const acme = buildSlaReport(app, period, 'Acme', now);
  assert.equal(acme.customTargets, true);
  assert.equal(acme.targets.P1.ack, 3);
  assert.equal(buildSlaReport(app, period, 'Beta', now).targets.P1.ack, 15);
});

test('compliance colour follows the configured thresholds', () => {
  const settings = { ...snapshot().settings.reports, compliance: { target: 98, amber: 90 } };
  assert.equal(complianceTone(98, settings), 'healthy');
  assert.equal(complianceTone(95, settings), 'watch');
  assert.equal(complianceTone(89.9, settings), 'risk');
  assert.equal(complianceTone(null, settings), 'neutral');
  const report = buildSlaReport({ ...snapshot(), settings: { ...snapshot().settings, reports: settings } }, period, '', now);
  assert.equal(report.meetsContract, false, '33.3% is below the 98% contract target');
});

test('client KPI rule matches the server rule', async () => {
  const server = await import('../server/incidents.cjs');
  const cases = [['94%', '98%', 'higher', 5], ['92%', '98%', 'higher', 5], ['4h 20m', '4h', 'lower', 10], ['142', '150', 'higher', 10], ['11m', '15%', 'lower', 5], ['31%', '25%', 'lower', 20]];
  for (const [actual, target, direction, tolerance] of cases) {
    assert.equal(computeKpiHealth(actual, target, direction, tolerance), server.default.computeKpiHealth(actual, target, direction, tolerance), `${actual} vs ${target}`);
  }
});

test('duration input parsing', () => {
  assert.equal(parseDurationInput('15'), 15);
  assert.equal(parseDurationInput('15m'), 15);
  assert.equal(parseDurationInput('4h'), 240);
  assert.equal(parseDurationInput('1d 2h'), 1560);
  assert.equal(parseDurationInput('soon'), null);
});
