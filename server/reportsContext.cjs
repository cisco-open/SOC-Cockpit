// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

// Reports data for Keo (the assistant and the Executive Update).
// The figures come from the same calculations the Reports module uses (src/reportCalc.ts),
// so Keo always quotes the numbers shown on screen and in the PDF. Node.js loads the
// TypeScript file directly (type stripping, Node.js >= 22.18).
'use strict';

let calcModule = null;
// Loaded on first use so an older Node.js only loses the Reports part of Keo, not the whole server.
function reportCalc() {
  if (!calcModule) {
    try {
      calcModule = require('../src/reportCalc.ts');
    } catch (error) {
      throw new Error(`Could not load src/reportCalc.ts (Node.js >= 22.18 is required): ${error.message}`);
    }
  }
  return calcModule;
}

const MAX_OPEN_INCIDENTS = 50;
const MAX_RECENT_INCIDENTS = 150;
const MAX_BREACHES = 40;
const MAX_CUSTOMERS = 25;
const MAX_CATEGORIES = 10;

const round = (value) => (value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value));
const clip = (value, max = 160) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function addDays(key, days) {
  const date = reportCalc().parseStamp(key);
  date.setDate(date.getDate() + days);
  return reportCalc().dateKey(date);
}

function stats(value) {
  return { measured: value.count, avgMinutes: round(value.avg), medianMinutes: round(value.median), p90Minutes: round(value.p90) };
}

function priorityRow(row) {
  return {
    incidents: row.count,
    open: row.open,
    mttd: stats(row.ttd),
    mtta: stats(row.tta),
    mttr: stats(row.ttr),
    acknowledge: { met: row.ackMet, breached: row.ackBreached, compliancePct: row.ackCompliance },
    resolve: { met: row.resolveMet, breached: row.resolveBreached, compliancePct: row.resolveCompliance },
  };
}

function breach(item) {
  return {
    ref: item.incident.ref,
    customer: item.incident.customer,
    priority: item.incident.priority,
    detectedAt: item.incident.detectedAt,
    measure: item.measure,
    actualMinutes: round(item.actual),
    targetMinutes: item.target,
    stillOpen: item.open,
  };
}

/** SLA results for one period, shaped like the Reports → SLA report. */
function slaSummary(snapshot, label, period, now, { breaches = true, customers = true } = {}) {
  const report = reportCalc().buildSlaReport(snapshot, period, '', now);
  const summary = {
    label,
    from: period.from,
    to: period.to,
    incidents: report.total.count,
    openIncidents: report.total.open,
    overallCompliancePct: report.overallCompliance,
    meetsComplianceTarget: report.meetsContract,
    total: priorityRow(report.total),
    byPriority: Object.fromEntries(report.rows.map((row) => [row.priority, priorityRow(row)])),
    byCategory: report.byCategory.slice(0, MAX_CATEGORIES),
    breachCount: report.breaches.length,
  };
  if (breaches) summary.breaches = report.breaches.slice(0, MAX_BREACHES).map(breach);
  if (customers) {
    const names = [...new Set(report.incidents.map((item) => item.incident.customer).filter(Boolean))];
    summary.byCustomer = names
      .map((name) => {
        const one = reportCalc().buildSlaReport(snapshot, period, name, now);
        return {
          customer: name,
          incidents: one.total.count,
          open: one.total.open,
          compliancePct: one.overallCompliance,
          meetsComplianceTarget: one.meetsContract,
          breaches: one.breaches.length,
          customerSpecificSla: one.customTargets,
        };
      })
      .sort((a, b) => b.incidents - a.incidents || a.customer.localeCompare(b.customer))
      .slice(0, MAX_CUSTOMERS);
  }
  return summary;
}

function incidentRow(item) {
  return {
    ref: item.incident.ref,
    customer: item.incident.customer,
    title: clip(item.incident.title),
    priority: item.incident.priority,
    category: item.incident.category,
    status: item.incident.status,
    analyst: item.incident.analyst,
    detectedAt: item.incident.detectedAt,
    acknowledgedAt: item.incident.acknowledgedAt,
    resolvedAt: item.incident.resolvedAt,
    mttaMinutes: round(item.tta),
    mttrMinutes: round(item.ttr),
    acknowledgeSla: item.ackState,
    resolveSla: item.resolveState,
  };
}

/**
 * Reports data for the Keo assistant: SLA policy, precomputed SLA results for this month,
 * last month and the last 90 days, and the incident register (open + last 30 days).
 */
function buildReportsContext(snapshot, now = new Date()) {
  const settings = reportCalc().reportSettingsOf(snapshot);
  const today = reportCalc().dateKey(now);
  const thisMonth = reportCalc().monthPeriod(today);
  const lastMonth = reportCalc().monthPeriod(addDays(thisMonth.from, -1));
  const measured = (snapshot.incidents ?? []).map((incident) => reportCalc().measureIncident(incident, settings, now));
  const recentFrom = addDays(today, -29);
  const recent = measured.filter((item) => item.incident.detectedAt.slice(0, 10) >= recentFrom);
  const open = measured.filter((item) => item.isOpen);

  return {
    note: 'Incident register and SLA results from the Reports module. All durations are in minutes. Compliance % = SLA targets met / (met + breached) across acknowledge and resolve; open incidents already past target count as breached.',
    slaPolicy: {
      complianceTargetPct: settings.compliance.target,
      amberFromPct: settings.compliance.amber,
      standardTargetsMinutes: settings.slaTargets,
      customerSpecificTargetsMinutes: Object.fromEntries(Object.entries(settings.customerSla ?? {}).slice(0, MAX_CUSTOMERS)),
    },
    totals: { incidentsRecorded: measured.length, openNow: open.length, customers: reportCalc().customersOf(snapshot).length },
    sla: {
      monthToDate: slaSummary(snapshot, `${thisMonth.from.slice(0, 7)} (month to date)`, thisMonth, now),
      lastMonth: slaSummary(snapshot, lastMonth.from.slice(0, 7), lastMonth, now),
      last90Days: slaSummary(snapshot, 'last 90 days', { from: addDays(today, -89), to: today }, now, { breaches: false }),
    },
    openIncidents: open
      .sort((a, b) => a.incident.priority.localeCompare(b.incident.priority) || a.incident.detectedAt.localeCompare(b.incident.detectedAt))
      .slice(0, MAX_OPEN_INCIDENTS)
      .map(incidentRow),
    recentIncidents: {
      from: recentFrom,
      to: today,
      count: recent.length,
      shown: Math.min(recent.length, MAX_RECENT_INCIDENTS),
      incidents: recent
        .sort((a, b) => b.incident.detectedAt.localeCompare(a.incident.detectedAt))
        .slice(0, MAX_RECENT_INCIDENTS)
        .map(incidentRow),
    },
  };
}

/** Smaller SLA and incident picture for the Executive Update (7-day window plus month to date). */
function buildExecutiveSlaContext(snapshot, windowStart, windowEnd, now = new Date()) {
  const settings = reportCalc().reportSettingsOf(snapshot);
  const open = (snapshot.incidents ?? [])
    .map((incident) => reportCalc().measureIncident(incident, settings, now))
    .filter((item) => item.isOpen);
  const highPriorityOpen = open.filter((item) => item.incident.priority === 'P1' || item.incident.priority === 'P2');
  const week = slaSummary(snapshot, 'past 7 days', { from: windowStart, to: windowEnd }, now, { customers: false });
  week.breaches = week.breaches.slice(0, 10);
  return {
    note: 'SLA results from the Reports module. Durations in minutes. Use for wins (compliance at or above target) and concerns (breaches, compliance below target, open P1/P2 incidents). Do not list individual incidents unless they are P1 or breached.',
    complianceTargetPct: settings.compliance.target,
    pastWeek: week,
    monthToDate: slaSummary(snapshot, 'month to date', reportCalc().monthPeriod(windowEnd), now, { breaches: false, customers: false }),
    openIncidents: open.length,
    openHighPriority: highPriorityOpen.slice(0, 10).map(incidentRow),
  };
}

module.exports = { buildReportsContext, buildExecutiveSlaContext };
