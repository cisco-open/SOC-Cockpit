// SPDX-License-Identifier: Apache-2.0
// Incident register: validation, timestamp parsing, CSV import and issue dates.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../server/db.cjs');
const { normalizeTimestamp, parseCsv, parseDurationMinutes, buildIncidentTemplateXlsx } = require('../server/incidents.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-cockpit-test-'));
  const store = createStore({ dbPath: path.join(dir, 'data', 'test.sqlite'), env: {} });
  return { store, dir };
}

test('normalizeTimestamp accepts common export formats', () => {
  assert.equal(normalizeTimestamp('2026-11-05 14:30'), '2026-11-05T14:30');
  assert.equal(normalizeTimestamp('2026-11-05T14:30:59'), '2026-11-05T14:30');
  assert.equal(normalizeTimestamp('2026-11-05'), '2026-11-05T00:00');
  assert.equal(normalizeTimestamp('05/11/2026 09:05'), '2026-11-05T09:05', 'day-first by default');
  assert.equal(normalizeTimestamp('11/25/2026 09:05'), '2026-11-25T09:05', 'month-first when day > 12');
  assert.equal(normalizeTimestamp('05/11/2026 02:15 PM'), '2026-11-05T14:15');
  assert.equal(normalizeTimestamp(''), '');
  assert.equal(normalizeTimestamp('not a date'), '');
});

test('parseCsv handles quotes, embedded delimiters and semicolons', () => {
  const rows = parseCsv('a;b;c\r\n"x; y";"say ""hi""";3\n\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x; y', 'say "hi"', '3']]);
});

test('incidents are validated and normalised on create', () => {
  const { store } = tempStore();
  const snapshot = store.createRecord('incident', {
    ref: 'INC-1', customer: 'Acme', title: 'Phishing', priority: 'high',
    detectedAt: '2026-11-01 08:10', acknowledgedAt: '2026-11-01 08:20', resolvedAt: '2026-11-01 10:00',
  });
  const [incident] = snapshot.incidents;
  assert.equal(incident.priority, 'P2');
  assert.equal(incident.status, 'Resolved', 'status inferred from resolved time');
  assert.equal(incident.detectedAt, '2026-11-01T08:10');

  assert.throws(() => store.createRecord('incident', { title: 'x', detectedAt: '2026-11-01 08:10', resolvedAt: '2026-11-01 07:00' }), /Resolved time cannot be before detected time/);
  assert.throws(() => store.createRecord('incident', { title: 'x' }), /detected time is required/);
  assert.throws(() => store.createRecord('incident', { detectedAt: '2026-11-01 08:10' }), /title \(or a ticket number\) is required/);
});

test('CSV import maps ticketing-tool headers and updates instead of duplicating', () => {
  const { store } = tempStore();
  const csv = [
    'Number;Company;Short description;Severity;State;Assigned to;Opened;Responded;Closed',
    'SN-9;Acme;"Suspicious login; geo anomaly";Critical;Closed;Ali;05/11/2026 09:00;05/11/2026 09:05;05/11/2026 12:30',
    'SN-10;Beta;Row without a detected time;Low;Open;Sara;;;',
  ].join('\n');

  const first = store.importIncidentsCsv(csv);
  assert.equal(first.added, 1);
  assert.equal(first.skipped, 1);
  assert.match(first.errors[0], /Row 3: .*detected time is required/);
  const [incident] = first.snapshot.incidents;
  assert.equal(incident.ref, 'SN-9');
  assert.equal(incident.title, 'Suspicious login; geo anomaly');
  assert.equal(incident.priority, 'P1');
  assert.equal(incident.analyst, 'Ali');
  assert.equal(incident.resolvedAt, '2026-11-05T12:30');

  const second = store.importIncidentsCsv(csv);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.snapshot.incidents.length, 1);
});

test('CSV import rejects files without title and detected columns', () => {
  const { store } = tempStore();
  assert.throws(() => store.importIncidentsCsv('foo,bar\n1,2\n'), /needs a header row with at least a ticket number/);
});

test('report settings are normalised and persisted', () => {
  const { store } = tempStore();
  const snapshot = store.updateReportSettings({ orgName: '  Test SOC  ', weekendDays: [6, 5, 5, 9], slaTargets: { P1: { ack: 10 } } });
  const settings = snapshot.settings.reports;
  assert.equal(settings.orgName, 'Test SOC');
  assert.deepEqual(settings.weekendDays, [5, 6]);
  assert.equal(settings.slaTargets.P1.ack, 10);
  assert.equal(settings.slaTargets.P1.resolve, 240, 'unspecified targets keep their defaults');
});

test('issues record when they were opened and closed', () => {
  const { store } = tempStore();
  let snapshot = store.createRecord('issue', { title: 'Gap', owner: 'Ali', due: '2026-11-30', status: 'Open' });
  const issue = snapshot.issues[0];
  assert.ok(issue.createdAt, 'createdAt set on create');
  assert.equal(issue.closedAt, '');

  snapshot = store.updateRecord('issue', issue.id, { title: 'Gap', owner: 'Ali', due: '2026-11-30', status: 'Closed' });
  const closedAt = snapshot.issues[0].closedAt;
  assert.ok(closedAt, 'closedAt set when closed');

  snapshot = store.updateRecord('issue', issue.id, { title: 'Gap (edited)', owner: 'Ali', due: '2026-11-30', status: 'Closed' });
  assert.equal(snapshot.issues[0].closedAt, closedAt, 'editing a closed issue keeps its close date');

  snapshot = store.updateRecord('issue', issue.id, { title: 'Gap', owner: 'Ali', due: '2026-11-30', status: 'Open' });
  assert.equal(snapshot.issues[0].closedAt, '', 'reopening clears the close date');
});

test('compliance thresholds and customer SLA overrides are normalised', () => {
  const { store } = tempStore();
  const settings = store.updateReportSettings({
    compliance: { target: 98, amber: 99 },
    customerSla: { '  Acme  ': { P1: { ack: 10 } }, '': { P1: { ack: 1 } } },
  }).settings.reports;
  assert.deepEqual(settings.compliance, { target: 98, amber: 98 }, 'amber never exceeds the target');
  assert.deepEqual(Object.keys(settings.customerSla), ['Acme'], 'names trimmed, blanks dropped');
  assert.equal(settings.customerSla.Acme.P1.ack, 10);
  assert.equal(settings.customerSla.Acme.P1.resolve, 240, 'missing values inherit the standard targets');
  assert.equal(settings.customerSla.Acme.P3.ack, 120);

  const cleared = store.updateReportSettings({ customerSla: {} }).settings.reports;
  assert.deepEqual(cleared.customerSla, {}, 'overrides can be removed');
  assert.equal(cleared.compliance.target, 98, 'other settings are kept');
});

test('KPI health is calculated from a rule and kept manual otherwise', () => {
  const { computeKpiHealth, parseMetric } = require('../server/incidents.cjs');
  assert.deepEqual(parseMetric('3h 40m'), { kind: 'duration', value: 220 });
  assert.deepEqual(parseMetric('94%'), { kind: 'percent', value: 94 });
  assert.equal(parseMetric('n/a'), null);
  assert.equal(computeKpiHealth('99%', '98%', 'higher', 5), 'healthy');
  assert.equal(computeKpiHealth('94%', '98%', 'higher', 5), 'watch');
  assert.equal(computeKpiHealth('92%', '98%', 'higher', 5), 'risk');
  assert.equal(computeKpiHealth('3h 40m', '4h', 'lower', 10), 'healthy');
  assert.equal(computeKpiHealth('4h 20m', '4h', 'lower', 10), 'watch');
  assert.equal(computeKpiHealth('5h', '4h', 'lower', 10), 'risk');
  assert.equal(computeKpiHealth('11m', '15%', 'lower', 10), null, 'different units are not compared');
  assert.equal(computeKpiHealth('94%', '98%', '', 5), null, 'manual rule');

  const { store } = tempStore();
  let snapshot = store.createRecord('kpi', { code: 'COV', name: 'Coverage', actual: '92%', target: '98%', health: 'healthy', trend: 'up', delta: '', direction: 'higher', tolerance: 5 });
  assert.equal(snapshot.kpis[0].health, 'risk', 'rule overrides the submitted health');
  assert.equal(snapshot.kpis[0].direction, 'higher');
  snapshot = store.updateRecord('kpi', snapshot.kpis[0].id, { ...snapshot.kpis[0], actual: '97%' });
  assert.equal(snapshot.kpis[0].health, 'watch', 'recalculated on update');
  snapshot = store.updateRecord('kpi', snapshot.kpis[0].id, { ...snapshot.kpis[0], direction: '', health: 'healthy' });
  assert.equal(snapshot.kpis[0].health, 'healthy', 'manual health used when the rule is removed');
});

test('duration cells accept minutes, h/m text and h:mm', () => {
  assert.equal(parseDurationMinutes('45'), 45);
  assert.equal(parseDurationMinutes('45 min'), 45);
  assert.equal(parseDurationMinutes('1h 30m'), 90);
  assert.equal(parseDurationMinutes('1:30'), 90);
  assert.equal(parseDurationMinutes('2:00:30'), 121);
  assert.equal(parseDurationMinutes('1d 2h'), 1560);
  assert.equal(parseDurationMinutes(''), null);
  assert.equal(parseDurationMinutes('soon'), null);
});

test('CSV with MTTD / MTTA / MTTR durations derives the timestamps', () => {
  const { store } = tempStore();
  const csv = [
    'Ticket No,Customer,Priority,Date,Time,MTTD,MTTA,MTTR',
    'T-1,Acme,High,2026-11-04,13:05,10,25,5h',
    'T-2,Acme,P1,2026-11-04 09:00,,,12,',
    'T-3,Acme,P3,2026-11-04 10:00,,,abc,',
  ].join('\n');
  const result = store.importIncidentsCsv(csv);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.match(result.errors[0], /Row 4: MTTA "abc" is not a duration/);
  const byRef = Object.fromEntries(result.snapshot.incidents.map((item) => [item.ref, item]));
  assert.deepEqual(
    [byRef['T-1'].detectedAt, byRef['T-1'].occurredAt, byRef['T-1'].acknowledgedAt, byRef['T-1'].resolvedAt, byRef['T-1'].status],
    ['2026-11-04T13:05', '2026-11-04T12:55', '2026-11-04T13:30', '2026-11-04T18:05', 'Closed'],
  );
  assert.equal(byRef['T-1'].title, 'Ticket T-1', 'title defaults to the ticket number');
  assert.equal(byRef['T-2'].status, 'Acknowledged', 'no MTTR yet: still open');
  assert.equal(byRef['T-2'].resolvedAt, '');
});

test('Excel template imports, including time-formatted durations', async () => {
  const ExcelJS = require('exceljs');
  const { store } = tempStore();
  const template = await buildIncidentTemplateXlsx();
  const first = await store.importIncidentsXlsx(template);
  assert.equal(first.added, 3, 'the three example rows');
  assert.deepEqual(first.errors, []);
  const example = first.snapshot.incidents.find((item) => item.ref === 'INC-1003');
  assert.equal(example.resolvedAt, '2026-08-19T11:00', 'MTTR 1:20 from 09:40');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SLA');
  sheet.addRow(['November SLA export']); // a title row above the header is skipped
  sheet.addRow(['Ticket number', 'Detected', 'Severity', 'MTTA', 'MTTR']);
  const row = sheet.addRow(['X-1', new Date(Date.UTC(2026, 10, 4, 9, 0)), 'Critical', 12 / 1440, 95 / 1440]);
  row.getCell(4).numFmt = '[h]:mm';
  row.getCell(5).numFmt = '[h]:mm';
  const result = await store.importIncidentsXlsx(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(result.added, 1);
  const imported = result.snapshot.incidents.find((item) => item.ref === 'X-1');
  assert.deepEqual([imported.priority, imported.detectedAt, imported.acknowledgedAt, imported.resolvedAt], ['P1', '2026-11-04T09:00', '2026-11-04T09:12', '2026-11-04T10:35']);

  await assert.rejects(() => store.importIncidentsXlsx(Buffer.from('PK\x03\x04not really')), /Could not read the Excel file/);
});

test('review: unknown statuses are rejected, synonyms are mapped', () => {
  const { store } = tempStore();
  const base = { ref: 'S-1', title: 'x', detectedAt: '2026-11-01 08:00' };
  assert.equal(store.createRecord('incident', { ...base, status: 'In Progress' }).incidents[0].status, 'Acknowledged');
  assert.equal(store.createRecord('incident', { ...base, ref: 'S-2', status: 'done' }).incidents.find((i) => i.ref === 'S-2').status, 'Closed');
  assert.throws(() => store.createRecord('incident', { ...base, ref: 'S-3', status: 'Escalated' }), /Status "Escalated" is not recognised/);
  const result = store.importIncidentsCsv('Ticket number,Detected,Status\nS-4,2026-11-01 08:00,banana\n');
  assert.equal(result.added, 0);
  assert.match(result.errors[0], /Row 2: Status "banana" is not recognised/);
});

test('review: re-import matches ticket and customer case-insensitively and keeps one spelling', () => {
  const { store } = tempStore();
  store.importIncidentsCsv('Ticket number,Customer,Priority,Detected,MTTA\nINC-9,Sample Customer 1,P1,2026-11-01 08:00,10\n');
  const again = store.importIncidentsCsv('Ticket number,Customer,Priority,Detected,MTTA\ninc-9,  sample CUSTOMER 1 ,P1,2026-11-01 08:00,12\nINC-10,SAMPLE CUSTOMER 1,P2,2026-11-02 09:00,5\n');
  assert.equal(again.added, 1);
  assert.equal(again.updated, 1, 'same ticket, different case -> updated');
  assert.equal(again.snapshot.incidents.length, 2);
  assert.deepEqual([...new Set(again.snapshot.incidents.map((i) => i.customer))], ['Sample Customer 1'], 'first spelling is kept');
  assert.equal(again.snapshot.incidents.find((i) => i.ref === 'INC-9').acknowledgedAt, '2026-11-01T08:12');

  const { store: other } = tempStore();
  other.updateReportSettings({ customerSla: { 'Sample Customer 2': { P1: { ack: 5 } } } });
  const created = other.createRecord('incident', { ref: 'G-1', customer: 'sample customer 2', title: 'x', detectedAt: '2026-11-01 08:00' });
  assert.equal(created.incidents[0].customer, 'Sample Customer 2', 'matches the customer SLA spelling');
});

test('review: free-form dates are rejected instead of guessed', () => {
  const { store } = tempStore();
  assert.equal(normalizeTimestamp('Nov 5 2026 14:30'), '');
  assert.equal(normalizeTimestamp('2026-11-05T14:30:00.000+03:00').length, 16, 'ISO with offset still accepted');
  assert.throws(() => store.createRecord('incident', { ref: 'D-1', detectedAt: 'Nov 5 2026 14:30' }), /Detected time "Nov 5 2026 14:30" is not a recognised date/);
  assert.throws(() => store.createRecord('incident', { ref: 'D-2', detectedAt: '2026-11-05 14:30', resolvedAt: 'tomorrow' }), /Resolved time "tomorrow" is not a recognised date/);
});

test('review: long identifiers are rejected, long text is shortened with a warning', () => {
  const { store } = tempStore();
  assert.throws(() => store.createRecord('incident', { ref: 'X'.repeat(121), detectedAt: '2026-11-05 14:30' }), /Ticket number is longer than 120 characters/);
  const result = store.importIncidentsCsv(`Ticket number,Title,Detected\nL-1,${'t'.repeat(600)},2026-11-05 14:30\n`);
  assert.equal(result.added, 1);
  assert.equal(result.snapshot.incidents[0].title.length, 500);
  assert.match(result.warnings[0], /Row 2: Title shortened to 500 characters/);
});

test('review: validation errors carry HTTP 400', () => {
  const { HttpError } = require('../server/errors.cjs');
  const { store } = tempStore();
  try {
    store.createRecord('incident', { title: 'x' });
    assert.fail('expected an error');
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 400);
  }
});

// ---- security hardening ----

test('security: customer SLA keys like __proto__ are ignored', () => {
  const { store } = tempStore();
  const settings = store.updateReportSettings(JSON.parse('{"customerSla":{"__proto__":{"P1":{"ack":1}},"Constructor":{"P1":{"ack":2}},"Sample Customer 1":{"P1":{"ack":3}}}}')).settings.reports;
  assert.deepEqual(Object.keys(settings.customerSla), ['Sample Customer 1']);
  assert.equal(Object.getPrototypeOf(settings.customerSla), Object.prototype, 'prototype untouched');
});

test('security: Excel decompression bombs are rejected before unpacking', () => {
  const { inspectXlsxArchive } = require('../server/incidents.cjs');
  // Central directory entry claiming 1 KB compressed -> 600 MB uncompressed.
  const entry = Buffer.alloc(46 + 8);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt32LE(1024, 20);
  entry.writeUInt32LE(600 * 1024 * 1024, 24);
  entry.writeUInt16LE(8, 28);
  entry.write('bomb.xml', 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(entry.length, 12);
  end.writeUInt32LE(0, 16);
  assert.throws(() => inspectXlsxArchive(Buffer.concat([entry, end])), /unpacks to an unsafe size/);
});

test('security: the real Excel template passes the archive check', async () => {
  const { inspectXlsxArchive } = require('../server/incidents.cjs');
  const template = await buildIncidentTemplateXlsx();
  assert.doesNotThrow(() => inspectXlsxArchive(template));
});

test('security: error messages never echo long or control-character input', () => {
  const { store } = tempStore();
  const payload = { ref: 'E-1', detectedAt: '2026-11-05 10:00', status: `x\u0000\u001b[31m${'A'.repeat(500)}` };
  assert.throws(() => store.createRecord('incident', payload), (error) => {
    assert.ok(error.message.length < 160, 'message stays short');
    assert.ok(!/[\u0000-\u001f]/.test(error.message), 'no control characters');
    return true;
  });
});

test('security: incident changes and SLA policy changes are written to the audit log', () => {
  const { store } = tempStore();
  const admin = { username: 'admin', role: 'Admin' };
  const operator = { username: 'op1', role: 'Operator' };
  let snapshot = store.createIncident({ ref: 'A-1', customer: 'Sample Customer 1', priority: 'P1', detectedAt: '2026-11-05 10:00', acknowledgedAt: '2026-11-05 10:30' }, operator);
  const id = snapshot.incidents[0].id;
  store.updateIncident(id, { ...snapshot.incidents[0], acknowledgedAt: '2026-11-05 10:05' }, operator);
  store.importIncidentsCsv('Ticket number,Detected,MTTA\nA-2,2026-11-05 11:00,5\n', operator, { name: 'nov.csv', sha256: 'abc' });
  store.updateReportSettings({ compliance: { target: 97, amber: 90 } }, admin);
  store.updateReportSettings({ compliance: { target: 97, amber: 90 } }, admin); // no change: not logged
  store.deleteIncident(id, admin);

  const log = store.readIncidentAudit();
  assert.deepEqual(log.map((entry) => entry.action), ['incident.delete', 'sla-settings.update', 'incidents.import', 'incident.update', 'incident.create']);
  const edit = log.find((entry) => entry.action === 'incident.update');
  assert.equal(edit.username, 'op1');
  assert.deepEqual(edit.details.acknowledgedAt, ['2026-11-05T10:30', '2026-11-05T10:05'], 'before and after are kept');
  assert.equal(log.find((entry) => entry.action === 'incidents.import').details.added, 1);
  assert.ok(log.find((entry) => entry.action === 'sla-settings.update').details.compliance);
  assert.equal(log[0].details.acknowledgedAt[0], '2026-11-05T10:05', 'deleted values are kept in the log');
  assert.throws(() => store.updateIncident(9999, {}, operator), /Incident not found/);
});
