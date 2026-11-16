// SPDX-License-Identifier: Apache-2.0
// Keo and the Executive Update can use the Reports module (incidents and SLA results).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../server/db.cjs');
const { buildReportsContext } = require('../server/reportsContext.cjs');
const calc = require('../src/reportCalc.ts');

const pad = (value) => String(value).padStart(2, '0');
const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
const lastMonthKey = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`;

function storeWithIncidents(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-cockpit-keo-'));
  const store = createStore({ dbPath: path.join(dir, 'data', 'test.sqlite'), env });
  // Last month: one P1 within target, one P1 that breached acknowledge and resolve.
  store.createRecord('incident', { ref: 'INC-A', customer: 'Acme', title: 'Phishing', priority: 'P1', status: 'Resolved', detectedAt: `${lastMonthKey}-10 08:00`, acknowledgedAt: `${lastMonthKey}-10 08:10`, resolvedAt: `${lastMonthKey}-10 10:00` });
  store.createRecord('incident', { ref: 'INC-B', customer: 'Acme', title: 'Ransomware', priority: 'P1', status: 'Resolved', detectedAt: `${lastMonthKey}-11 08:00`, acknowledgedAt: `${lastMonthKey}-11 09:00`, resolvedAt: `${lastMonthKey}-11 14:00` });
  // Still open, detected two days ago, so it is already past every P2 target.
  const open = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  store.createRecord('incident', { ref: 'INC-C', customer: 'Beta', title: 'Malware on host', priority: 'P2', status: 'Open', detectedAt: `${calc.dateKey(open)} 09:00` });
  return store;
}

function stubLlm(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'stub answer' } }] }) };
  });
  return calls;
}

test('Reports context quotes the same SLA figures as the Reports module', () => {
  const store = storeWithIncidents();
  const snapshot = store.getSnapshot();
  const context = buildReportsContext(snapshot, now);

  const previous = context.sla.lastMonth;
  assert.equal(previous.label, lastMonthKey);
  assert.equal(previous.incidents, 2);
  assert.equal(previous.overallCompliancePct, 50, '2 of 4 acknowledge/resolve results met');
  assert.equal(previous.meetsComplianceTarget, false);
  assert.equal(previous.byPriority.P1.acknowledge.breached, 1);
  assert.equal(previous.byPriority.P1.mtta.medianMinutes, 35);
  assert.deepEqual(previous.breaches.map((item) => `${item.ref}:${item.measure}`).sort(), ['INC-B:Acknowledge', 'INC-B:Resolve']);
  assert.deepEqual(previous.byCustomer.map((item) => [item.customer, item.incidents, item.breaches]), [['Acme', 2, 2]]);

  const reference = calc.buildSlaReport(snapshot, calc.monthPeriod(`${lastMonthKey}-01`), '', now);
  assert.equal(previous.overallCompliancePct, reference.overallCompliance);
  assert.equal(previous.total.mttr.avgMinutes, Math.round(reference.total.ttr.avg));

  assert.deepEqual(context.openIncidents.map((item) => [item.ref, item.resolveSla]), [['INC-C', 'breached']]);
  assert.equal(context.slaPolicy.standardTargetsMinutes.P1.ack, 15);
  assert.equal(context.totals.incidentsRecorded, 3);
});

test('Keo receives the Reports data and is told to use the precomputed figures', async (t) => {
  const store = storeWithIncidents({ OPENAI_API_KEY: 'test-key' });
  const calls = stubLlm(t);
  const result = await store.answerQuestion([{ role: 'user', content: 'Which customer had SLA breaches last month?' }]);
  assert.equal(result.answer, 'stub answer');

  const system = calls[0].messages[0].content;
  assert.match(system, /use `reports`/);
  const context = JSON.parse(system.slice(system.indexOf('DATA CONTEXT (JSON):') + 'DATA CONTEXT (JSON):'.length));
  assert.equal(context.reports.sla.lastMonth.byCustomer[0].customer, 'Acme');
  assert.equal(context.reports.openIncidents[0].ref, 'INC-C');
  assert.ok(Array.isArray(context.kpis), 'other modules are still included');
});

test('the Executive Update includes SLA results, with or without an LLM', async (t) => {
  const withLlm = storeWithIncidents({ OPENAI_API_KEY: 'test-key' });
  const calls = stubLlm(t);
  await withLlm.generateAdvisorBrief(calc.dateKey(now));
  const prompt = calls[0].messages[1].content;
  const context = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(context.slaAndIncidents.openHighPriority[0].ref, 'INC-C');
  assert.equal(context.slaAndIncidents.complianceTargetPct, 95);

  t.mock.restoreAll();
  const fallback = storeWithIncidents();
  const brief = fallback.generateAdvisorBrief(calc.dateKey(now));
  const content = (await brief).advisorBriefs[0].content;
  assert.match(content, /open P1\/P2 incident\(s\): INC-C/);
});
