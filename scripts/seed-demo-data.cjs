#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Loads a realistic, fictional demo dataset so every module and report has data.
//
// Covers the last three full months and the current month up to today, plus the
// roster for the next 14 days, so the reports work whenever this is run.
// All people, customers and tickets are invented; phone numbers are all zeros.
//
// Usage:
//   npm run seed:demo             add demo data (refuses if it was already loaded)
//   npm run seed:demo -- --force  add it again anyway
//
// The app can stay running; press Reload in the cockpit afterwards.
'use strict';

const path = require('node:path');
const { createStore } = require('../server/db.cjs');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'soc-cockpit.sqlite');
const force = process.argv.includes('--force');

// ---------- deterministic randomness, so every run looks the same ----------
let seed = 20261105;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[0][0];
}

// ---------- dates ----------
const pad = (value) => String(value).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const stamp = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000);

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const MONTHS_OF_HISTORY = 3;
const start = new Date(today.getFullYear(), today.getMonth() - MONTHS_OF_HISTORY, 1); // first day, three months back
const rosterEnd = addDays(today, 14);
const WEEKEND = new Set([5, 6]); // Friday + Saturday (KSA)
const isWeekend = (date) => WEEKEND.has(date.getDay());

function daysBetween(from, to) {
  const out = [];
  for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) out.push(new Date(cursor));
  return out;
}

// ---------- reference data ----------
const ANALYSTS = [
  { name: 'Ahmed Al-Qahtani', role: 'SOC Lead – Tier 3', channel: 'TM', lead: true },
  { name: 'Sara Al-Harbi', role: 'Incident Responder – Tier 2', channel: 'TM', lead: true },
  { name: 'Faisal Al-Otaibi', role: 'SOC Analyst – Tier 2', channel: 'TM' },
  { name: 'Noura Al-Shehri', role: 'SOC Analyst – Tier 1', channel: 'TM' },
  { name: 'Omar Al-Zahrani', role: 'SOC Analyst – Tier 1', channel: 'TM' },
  { name: 'Lina Al-Dossary', role: 'SOC Analyst – Tier 1', channel: 'TM' },
  { name: 'Khalid Al-Mutairi', role: 'Detection Engineer', channel: 'Engineering', lead: true },
  { name: 'Reem Al-Ghamdi', role: 'Threat Intelligence Analyst', channel: 'Engineering' },
];

const LABELS = [
  { code: 'FS', label: 'First shift', hours: '07:00-15:00', status: 'Confirmed', health: 'healthy', fill: '#32b7c6', textColor: '#ffffff' },
  { code: 'SS', label: 'Second shift', hours: '15:00-23:00', status: 'Confirmed', health: 'healthy', fill: '#0a60ff', textColor: '#ffffff' },
  { code: 'NS', label: 'Night shift', hours: '23:00-07:00', status: 'Confirmed', health: 'healthy', fill: '#1e2f86', textColor: '#ffffff' },
  { code: 'GS', label: 'General shift', hours: '08:00-17:00', status: 'Confirmed', health: 'healthy', fill: '#6a39bf', textColor: '#ffffff' },
  { code: 'DO', label: 'Day off', hours: '', status: 'Leave', health: 'watch', fill: '#e3e8ee', textColor: '#17212b' },
  { code: 'PL', label: 'Paid leave', hours: '', status: 'Leave', health: 'watch', fill: '#ffb000', textColor: '#17212b' },
  { code: 'SCK', label: 'Sick leave', hours: '', status: 'Gap', health: 'risk', fill: '#d5323f', textColor: '#ffffff' },
];
const labelByCode = new Map(LABELS.map((label) => [label.code, label]));

const CUSTOMERS = [
  { name: 'Sample Customer 1', weight: 5 },
  { name: 'Sample Customer 2', weight: 4 },
  { name: 'Sample Customer 3', weight: 3 },
];

const INCIDENT_TYPES = [
  { category: 'Phishing', source: 'Email gateway', titles: ['Credential-harvesting email reported by user', 'Mass email with credential lure', 'Business email compromise attempt'] },
  { category: 'Malware', source: 'EDR', titles: ['Malware beacon to known C2', 'Ransomware precursor behaviour on server', 'Malicious macro executed'] },
  { category: 'Credential access', source: 'Splunk', titles: ['Password spraying against Office 365', 'Brute force on VPN gateway', 'Impossible travel sign-in'] },
  { category: 'Reconnaissance', source: 'NDR', titles: ['Port scan against DMZ', 'Internal network sweep from workstation'] },
  { category: 'Data exfiltration', source: 'DLP', titles: ['Large upload to personal cloud storage', 'Sensitive file emailed externally'] },
  { category: 'Policy violation', source: 'Splunk', titles: ['Antivirus disabled on server', 'Unapproved remote access tool installed', 'Privileged account used outside change window'] },
];

const PRIORITY_PROFILE = {
  // detect / ack / resolve targets in minutes (match the default report settings)
  P1: { weight: 1, detect: 15, ack: 15, resolve: 240 },
  P2: { weight: 3, detect: 30, ack: 30, resolve: 480 },
  P3: { weight: 6, detect: 60, ack: 120, resolve: 1440 },
  P4: { weight: 3, detect: 240, ack: 480, resolve: 4320 },
};

// Mostly within target, with a realistic tail of breaches.
function responseMinutes(target) {
  const roll = rand();
  if (roll < 0.9) return Math.max(1, Math.round(target * (0.15 + rand() * 0.8)));
  return Math.round(target * (1.05 + rand() * 0.9));
}

// ---------- run ----------
async function main() {
  const store = createStore({ dbPath, env: {} });
  const existing = store.getSnapshot();
  if (!force && (existing.incidents ?? []).some((item) => item.ref.startsWith('DEMO-'))) {
    console.log('[demo] Demo data is already loaded. Run with --force to add it again.');
    return;
  }

  console.log(`[demo] Loading demo data for ${dayKey(start)} to ${dayKey(today)} into ${dbPath}`);

  store.updateReportSettings({
    orgName: 'Demo Security Operations Center – Riyadh',
    weekendDays: [...WEEKEND],
    compliance: { target: 95, amber: 85 },
    // One customer with a stricter contract than the standard targets.
    customerSla: {
      'Sample Customer 1': {
        P1: { detect: 10, ack: 10, resolve: 180 },
        P2: { detect: 20, ack: 20, resolve: 360 },
      },
    },
  });

  // Directory (also adds staff to the roster planner)
  for (const person of ANALYSTS) {
    const local = person.name.split(' ')[0].toLowerCase();
    store.createRecord('contact', { name: person.name, role: person.role, channel: person.channel, email: `${local}@soc-demo.example`, phone: '+000000000000', scope: 'Staff', isLead: Boolean(person.lead) });
  }
  store.createRecord('contact', { name: 'Vendor Support – EDR (demo)', role: 'Vendor TAM', channel: 'Vendor', email: 'support@edr-vendor.example', phone: '+000000000000', scope: 'Vendor', isLead: false });
  store.createRecord('contact', { name: 'CISO Office (demo)', role: 'Escalation', channel: 'Management', email: 'ciso@soc-demo.example', phone: '+000000000000', scope: 'Key', isLead: false });

  const snapshotAfterContacts = store.getSnapshot();
  const staff = [...new Set([...(snapshotAfterContacts.settings.rosterStaff ?? []), ...ANALYSTS.map((a) => a.name)])];
  store.updateRosterPlannerSettings({ staff, labels: LABELS, channelOrder: ['TM', 'Engineering'] });

  // Roster: 24/7 rotation for TM (2 first, 2 second, 2 night, 2 off), weekdays for engineering
  const rotation = ['FS', 'FS', 'SS', 'SS', 'NS', 'NS', 'DO', 'DO'];
  const changes = [];
  const leaveBlock = { analyst: 'Noura Al-Shehri', from: addDays(start, 9), to: addDays(start, 13) };
  const leaveBlock2 = { analyst: 'Ahmed Al-Qahtani', from: addDays(start, 52), to: addDays(start, 58) };
  const sickDays = [
    { analyst: 'Omar Al-Zahrani', date: addDays(start, 17) },
    { analyst: 'Omar Al-Zahrani', date: addDays(start, 18) },
    { analyst: 'Lina Al-Dossary', date: addDays(start, 44) },
    { analyst: 'Sara Al-Harbi', date: addDays(start, 71) },
    { analyst: 'Faisal Al-Otaibi', date: addDays(today, -3) },
  ];
  const engineerLeave = { analyst: 'Reem Al-Ghamdi', from: addDays(today, -8), to: addDays(today, -6) };
  daysBetween(start, rosterEnd).forEach((date, index) => {
    ANALYSTS.forEach((person, personIndex) => {
      let code;
      if (person.channel === 'TM') code = rotation[(index + personIndex * 2) % rotation.length];
      else code = isWeekend(date) ? 'DO' : 'GS';
      const within = (block) => block.analyst === person.name && date >= block.from && date <= block.to;
      if (within(leaveBlock) || within(leaveBlock2) || within(engineerLeave)) code = isWeekend(date) && person.channel !== 'TM' ? 'DO' : 'PL';
      if (sickDays.some((sick) => sick.analyst === person.name && dayKey(sick.date) === dayKey(date))) code = 'SCK';
      const label = labelByCode.get(code);
      changes.push({ analyst: person.name, rosterDate: dayKey(date), code, label: label.label, hours: label.hours, status: label.status, health: label.health });
    });
  });
  store.upsertRosterPlan(changes);

  // KPIs
  // [code, name, actual, target, manual health, trend, delta, health rule, amber band %]
  const kpis = [
    ['MTTA-P1', 'Mean time to acknowledge – P1', '11m', '15m', 'healthy', 'down', '-2m', 'lower', 20],
    ['MTTR-P1', 'Mean time to resolve – P1', '4h 10m', '4h', 'watch', 'up', '+20m', 'lower', 10],
    ['SLA-ALL', 'Overall SLA compliance', '91%', '95%', 'watch', 'up', '+2%', 'higher', 5],
    ['LOG-COV', 'Critical log source coverage', '94%', '98%', 'watch', 'up', '+3%', 'higher', 3],
    ['UC-DEP', 'Detection use cases in production', '142', '150', 'healthy', 'up', '+6', 'higher', 10],
    ['FP-RATE', 'False positive rate', '31%', '25%', 'risk', 'down', '-4%', 'lower', 20],
    ['EDR-COV', 'EDR agent coverage', '96.8%', '99%', 'watch', 'flat', '0', ''],
  ];
  for (const [code, name, actual, target, health, trend, delta, direction, tolerance] of kpis) {
    store.createRecord('kpi', { code, name, actual, target, health, trend, delta, direction, tolerance });
  }

  // Objectives
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const objectives = [
    { scope: 'M', title: 'Onboard OT / SCADA log sources', owner: 'Khalid Al-Mutairi', assignedTo: 'Reem Al-Ghamdi', due: dayKey(monthEnd), progress: 70, health: 'watch' },
    { scope: 'M', title: 'Quarterly purple-team exercise', owner: 'Sara Al-Harbi', assignedTo: 'Ahmed Al-Qahtani', due: dayKey(addDays(today, -5)), progress: 100, health: 'healthy' },
    { scope: 'M', title: 'Reduce false positives by 20%', owner: 'Khalid Al-Mutairi', assignedTo: 'Faisal Al-Otaibi', due: dayKey(addDays(monthEnd, 15)), progress: 35, health: 'risk' },
    { scope: 'W', title: 'Close all P1 post-incident reviews', owner: 'Ahmed Al-Qahtani', assignedTo: 'Sara Al-Harbi', due: dayKey(addDays(today, 3)), progress: 60, health: 'watch' },
    { scope: 'W', title: 'Publish weekly threat-intel brief', owner: 'Reem Al-Ghamdi', assignedTo: 'Reem Al-Ghamdi', due: dayKey(addDays(today, 2)), progress: 80, health: 'healthy' },
    { scope: 'D', title: 'Clear overnight alert queue before 09:00', owner: 'Ahmed Al-Qahtani', assignedTo: 'Noura Al-Shehri', due: dayKey(today), progress: 100, health: 'healthy' },
  ];
  for (const objective of objectives) store.createRecord('objective', objective);
  const objectiveIds = store.getSnapshot().objectives.slice(-objectives.length).map((item) => item.id);

  // Projects
  const projects = [
    ['PRJ-SOAR', 'SOAR playbook automation', 'Khalid Al-Mutairi', 'Build', dayKey(addDays(monthEnd, 45)), 55, 'watch'],
    ['PRJ-NCA', 'NCA ECC control evidence pack', 'Ahmed Al-Qahtani', 'Execution', dayKey(addDays(monthEnd, 20)), 65, 'healthy'],
    ['PRJ-UEBA', 'UEBA pilot for privileged users', 'Reem Al-Ghamdi', 'Design', dayKey(addDays(monthEnd, 75)), 20, 'risk'],
  ];
  for (const [code, name, owner, phase, due, progress, health] of projects) store.createRecord('project', { code, name, owner, phase, due, progress, health });

  // Processes
  const processes = [
    ['PR-IR', 'Incident response', 'Sara Al-Harbi', 'Continuous', 4, 'healthy'],
    ['PR-TRI', 'Alert triage', 'Ahmed Al-Qahtani', 'Continuous', 3, 'watch'],
    ['PR-UC', 'Use-case lifecycle', 'Khalid Al-Mutairi', 'Monthly', 3, 'watch'],
    ['PR-TI', 'Threat intelligence', 'Reem Al-Ghamdi', 'Weekly', 2, 'risk'],
    ['PR-VM', 'Vulnerability escalation', 'Faisal Al-Otaibi', 'Weekly', 3, 'healthy'],
  ];
  for (const [code, name, owner, cadence, maturity, health] of processes) store.createRecord('process', { code, name, owner, cadence, maturity, health, notes: '' });

  // Issues (some get closed so the monthly report shows opened vs closed)
  const issues = [
    ['EDR agent missing on 37 servers', 'Faisal Al-Otaibi', addDays(today, 4), 'risk', 'Open', 20],
    ['WAF still in monitoring mode – move to blocking', 'Khalid Al-Mutairi', addDays(today, 12), 'watch', 'In Progress', 50],
    ['Splunk licence usage at 92% of daily limit', 'Ahmed Al-Qahtani', addDays(today, -1), 'watch', 'Open', 10],
    ['DMZ firewall logs not reaching SIEM', 'Khalid Al-Mutairi', addDays(today, -6), 'healthy', 'Closed', 100],
    ['Shared admin account on backup appliance', 'Sara Al-Harbi', addDays(today, 7), 'risk', 'In Progress', 40],
    ['Phishing simulation results pending from HR', 'Reem Al-Ghamdi', addDays(today, -9), 'healthy', 'Closed', 100],
  ];
  for (const [title, owner, due, health, status, progress] of issues) {
    store.createRecord('issue', { scope: 'M', title, summary: '', owner, assignedTo: owner, due: dayKey(due), health, status, progress });
  }

  // Follow-ups
  const followUps = [
    ['FU-21', 'Confirm vendor patch date for VPN CVE', 'Omar Al-Zahrani', '3d', 'watch'],
    ['FU-22', 'Collect evidence for ECC 2-12 log retention', 'Ahmed Al-Qahtani', '1d', 'healthy'],
    ['FU-23', 'Customer RCA for P1 ransomware alert', 'Sara Al-Harbi', '5d', 'risk'],
  ];
  for (const [ref, title, owner, age, health] of followUps) store.createRecord('followUp', { ref, title, owner, age, health });

  // Notes
  store.createRecord('note', { noteDate: dayKey(today), text: 'Change freeze on core network from 20:00 tonight – escalate any outage to the duty manager.', pinned: true });
  store.createRecord('note', { noteDate: dayKey(today), text: 'EDR console upgrade scheduled tomorrow 02:00–04:00; expect agent heartbeat alerts.', pinned: false });
  store.createRecord('note', { noteDate: dayKey(addDays(today, -1)), text: 'Night shift handled phishing wave against finance mailboxes; 14 messages purged.', pinned: false });

  // Stand-up tasks on working days
  const taskPool = [
    ['Review overnight P1/P2 queue', 'Do', 30, 0],
    ['Tune noisy brute-force correlation rule', 'Delay', 60, 2],
    ['Update phishing response playbook', 'Delay', 90, 3],
    ['Validate parsing for new OT log source', 'Do', 45, 0],
    ['Prepare threat-intel brief for management', 'Delegate', 45, 4],
    ['Chase EDR agent deployment with IT', 'Delegate', 20, 0],
    ['Review false-positive backlog', 'Delay', 60, 2],
    ['Close post-incident review actions', 'Do', 40, 3],
    ['Archive resolved tickets older than 30 days', 'Discard', 15, 0],
  ];
  const leads = ANALYSTS.filter((person) => person.lead).map((person) => person.name);
  for (const date of daysBetween(start, today)) {
    if (isWeekend(date)) continue;
    const count = between(4, 6);
    const isToday = dayKey(date) === dayKey(today);
    for (let i = 0; i < count; i += 1) {
      const [title, quadrant, minutes, objectiveIndex] = taskPool[(i + date.getDate()) % taskPool.length];
      const urgency = quadrant === 'Do' || quadrant === 'Delegate';
      const importance = quadrant === 'Do' || quadrant === 'Delay';
      const completed = isToday ? rand() < 0.35 : rand() < 0.82;
      store.createRecord('matrixTask', {
        taskDate: dayKey(date), title, lead: leads[i % leads.length], assignee: pick(ANALYSTS).name,
        durationMinutes: minutes, urgency, importance, dueTime: pick(['10:00', '12:00', '14:00', '16:00']),
        status: completed ? 'Completed' : 'Not Completed', notes: '', objectiveId: objectiveIndex ? objectiveIds[objectiveIndex] ?? 0 : 0,
      });
    }
  }

  // Incidents
  let sequence = 1000;
  let incidentCount = 0;
  for (const date of daysBetween(start, today)) {
    const perDay = isWeekend(date) ? between(2, 5) : between(4, 9);
    for (let i = 0; i < perDay; i += 1) {
      const detected = new Date(date.getFullYear(), date.getMonth(), date.getDate(), between(0, 23), between(0, 59));
      if (detected > now) continue;
      const priority = weighted(Object.entries(PRIORITY_PROFILE).map(([key, value]) => [key, value.weight]));
      const profile = PRIORITY_PROFILE[priority];
      const type = pick(INCIDENT_TYPES);
      const customer = weighted(CUSTOMERS.map((item) => [item.name, item.weight]));
      const occurred = rand() < 0.85 ? addMinutes(detected, -responseMinutes(profile.detect)) : null;
      const acknowledged = addMinutes(detected, responseMinutes(profile.ack));
      const resolved = addMinutes(detected, responseMinutes(profile.resolve));
      const ackKnown = acknowledged <= now;
      const resolvedKnown = resolved <= now;
      sequence += 1;
      incidentCount += 1;
      store.createRecord('incident', {
        ref: `DEMO-${sequence}`,
        customer,
        title: pick(type.titles),
        priority,
        category: type.category,
        source: type.source,
        status: resolvedKnown ? (rand() < 0.7 ? 'Closed' : 'Resolved') : ackKnown ? 'Acknowledged' : 'Open',
        analyst: pick(ANALYSTS.filter((person) => person.channel === 'TM')).name,
        occurredAt: occurred ? stamp(occurred) : '',
        detectedAt: stamp(detected),
        acknowledgedAt: ackKnown ? stamp(acknowledged) : '',
        resolvedAt: resolvedKnown ? stamp(resolved) : '',
        notes: '',
      });
    }
  }

  // Executive updates (locally generated briefs, no AI key needed)
  const quietError = console.error;
  console.error = () => {};
  try {
    // One executive update at the end of each past month, plus today.
    const briefDates = [];
    for (let back = MONTHS_OF_HISTORY - 1; back >= 0; back -= 1) briefDates.push(addDays(new Date(today.getFullYear(), today.getMonth() - back, 1), -1));
    briefDates.push(today);
    for (const date of briefDates) {
      await store.generateAdvisorBrief(dayKey(date));
    }
  } finally {
    console.error = quietError;
  }

  const finalSnapshot = store.getSnapshot();
  console.log(`[demo] Done: ${ANALYSTS.length} analysts, ${changes.length} roster entries, ${incidentCount} incidents, `
    + `${finalSnapshot.matrixTasks.length} stand-up tasks, ${objectives.length} objectives, ${issues.length} issues, ${kpis.length} KPIs.`);
  console.log('[demo] Open the cockpit (or press Reload) and go to Reports.');
}

main().catch((error) => {
  console.error(`[demo] Failed: ${error.message}`);
  process.exit(1);
});
