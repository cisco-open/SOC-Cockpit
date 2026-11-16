// SPDX-License-Identifier: Apache-2.0
// Audit log: every change made through the app is recorded with the signed-in user (issue #49).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../server/db.cjs');

const admin = { username: 'alice', role: 'Admin' };
const operator = { username: 'bob', role: 'Operator' };

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-cockpit-audit-'));
  return createStore({ dbPath: path.join(dir, 'data', 'test.sqlite'), env: {} });
}

function latest(store, action) {
  return store.readAudit(2000).find((entry) => entry.action === action);
}

test('creating, editing and deleting a record is logged with the user and what changed', () => {
  const store = tempStore();
  const issueId = store.createRecord('issue', { title: 'Firewall upgrade', owner: 'Dana', progress: 10 }, operator).issues.at(-1).id;

  const created = latest(store, 'issue.create');
  assert.equal(created.username, 'bob');
  assert.equal(created.role, 'Operator');
  assert.equal(created.target, 'Firewall upgrade');
  assert.equal(created.details.id, issueId);
  assert.deepEqual(created.details.title, ['', 'Firewall upgrade']);
  assert.ok(!Number.isNaN(Date.parse(created.at)));

  store.updateRecord('issue', issueId, { title: 'Firewall upgrade', owner: 'Eve', progress: 10 }, operator);
  const updated = latest(store, 'issue.update');
  assert.deepEqual(updated.details.owner, ['Dana', 'Eve']);
  assert.equal(updated.details.title, undefined, 'unchanged fields are not listed');

  store.deleteRecord('issue', issueId, admin);
  const deleted = latest(store, 'issue.delete');
  assert.equal(deleted.username, 'alice');
  assert.equal(deleted.target, 'Firewall upgrade');
  assert.deepEqual(deleted.details.owner, ['Eve', ''], 'the deleted record is kept in the log');
});

test('saving a record without changes, or deleting a missing record, adds no entry', () => {
  const store = tempStore();
  const id = store.createRecord('contact', { name: 'Dana', role: 'Analyst' }, operator).contacts.at(-1).id;
  const count = store.readAudit(2000).length;
  store.updateRecord('contact', id, { name: 'Dana', role: 'Analyst' }, operator);
  store.deleteRecord('contact', 9999, operator);
  assert.equal(store.readAudit(2000).length, count);
});

test('calls without a user are not logged, and incidents keep a single entry per change', () => {
  const store = tempStore();
  store.createRecord('kpi', { code: 'K1', name: 'MTTD' });
  assert.equal(store.readAudit(2000).length, 0);

  store.createIncident({ ref: 'INC-1', customer: 'Acme', priority: 'P2', detectedAt: '2026-11-01 08:00' }, operator);
  const id = store.getSnapshot().incidents[0].id;
  store.deleteIncident(id, admin);
  assert.deepEqual(store.readAudit(2000).map((entry) => entry.action), ['incident.delete', 'incident.create']);
});

test('planner, stand-up and settings changes are logged as summaries', () => {
  const store = tempStore();
  store.upsertRosterPlan([
    { rosterDate: '2026-11-02', analyst: 'Dana', code: 'D', label: 'Day' },
    { rosterDate: '2026-11-03', analyst: 'Eve', code: 'N', label: 'Night' },
  ], operator);
  const plan = latest(store, 'roster.plan.update');
  assert.equal(plan.details.assigned, 2);
  assert.equal(plan.target, 'Rotation planner · 2026-11-02 – 2026-11-03');

  store.createRecord('matrixTask', { taskDate: '2026-11-02', title: 'Patch VPN', lead: 'Dana' }, operator);
  store.carryOverMatrixTasks('2026-11-03', '2026-11-02', operator);
  assert.equal(latest(store, 'matrixTask.carryOver').details.copied, 1);

  store.updateClockZones(['UTC', 'Asia/Tokyo'], admin);
  assert.deepEqual(latest(store, 'settings.clocks.update').details.zones, ['UTC, America/New_York', 'UTC, Asia/Tokyo']);

  store.updateRosterPlannerSettings({ staff: ['Dana', 'Eve'], labels: [], channelOrder: [] }, operator);
  assert.deepEqual(latest(store, 'roster.settings.update').details['staff added'], ['', 'Dana, Eve']);
});

test('the Reports change history only lists incident and SLA entries', () => {
  const store = tempStore();
  store.createRecord('note', { text: 'Shift was quiet' }, operator);
  store.createIncident({ ref: 'INC-2', customer: 'Acme', priority: 'P3', detectedAt: '2026-11-01 08:00' }, operator);
  assert.deepEqual(store.readIncidentAudit(100).map((entry) => entry.action), ['incident.create']);
  assert.deepEqual(store.readAudit(100).map((entry) => entry.action), ['incident.create', 'note.create']);
});
