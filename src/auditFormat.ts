// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

// Shared wording for audit log entries (Settings → Audit log and the Reports change history).

import { getLocale, t } from './i18n';
import type { AuditEntry } from './types';

const AREA_LABELS: Record<string, string> = {
  kpi: 'KPI',
  rosterAssignment: 'roster entry',
  matrixTask: 'stand-up task',
  objective: 'objective',
  issue: 'issue',
  followUp: 'follow-up',
  project: 'project',
  process: 'process',
  contact: 'contact',
  note: 'daily note',
  incident: 'incident',
  incidents: 'incidents',
  advisorBrief: 'executive update',
  user: 'user',
  directory: 'directory settings',
  roster: 'rotation planner',
  settings: 'settings',
  'sla-settings': 'SLA policies',
};

const VERB_LABELS: Record<string, string> = {
  create: 'Added {{area}}',
  update: 'Edited {{area}}',
  delete: 'Deleted {{area}}',
};

const ACTION_LABELS: Record<string, string> = {
  'incidents.import': 'Imported incident file',
  'sla-settings.update': 'Changed SLA policies',
  'matrixTask.import': 'Imported stand-up workbook',
  'matrixTask.carryOver': 'Carried over stand-up tasks',
  'roster.plan.update': 'Changed rotation planner',
  'roster.settings.update': 'Changed planner settings',
  'roster.staff.rename': 'Renamed staff member',
  'roster.label.update': 'Edited shift label',
  'settings.clocks.update': 'Changed world clocks',
  'advisorBrief.create': 'Generated executive update',
  'user.update': 'Changed user',
  'directory.update': 'Changed directory settings',
};

/** The module an action belongs to, e.g. "issue" for "issue.delete". */
export function auditArea(action: string): string {
  return action.split('.')[0] ?? action;
}

export function auditAreaLabel(area: string): string {
  const label = Object.hasOwn(AREA_LABELS, area) ? t(AREA_LABELS[area]) : area;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function auditActionLabel(action: string): string {
  if (Object.hasOwn(ACTION_LABELS, action)) return t(ACTION_LABELS[action]);
  const [area, verb] = action.split('.');
  return Object.hasOwn(VERB_LABELS, verb) && Object.hasOwn(AREA_LABELS, area)
    ? t(VERB_LABELS[verb], { area: t(AREA_LABELS[area]) })
    : action;
}

export function isDeleteAction(action: string): boolean {
  return action.endsWith('.delete');
}

const FIELD_LABELS: Record<string, string> = {
  customer: 'Business Unit',
  orgName: 'Organisation name',
  weekendDays: 'Weekend days',
  compliance: 'SLA compliance',
  standardTargets: 'Standard SLA targets',
};

const BUSINESS_UNIT_CHANGES: Record<string, string> = {
  'customer added': 'Business unit added: {{name}}',
  'customer removed': 'Business unit removed: {{name}}',
  'customer changed': 'Business unit changed: {{name}}',
};

function fieldLabel(key: string): string {
  for (const [prefix, message] of Object.entries(BUSINESS_UNIT_CHANGES)) {
    if (key.startsWith(prefix + ': ')) return t(message, { name: key.slice(prefix.length + 2) });
  }
  if (Object.hasOwn(FIELD_LABELS, key)) return t(FIELD_LABELS[key]);

  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const label = words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  return t(label);
}

function list(values: string[]): string {
  return new Intl.ListFormat(getLocale()).format(values);
}

function isPair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length === 2;
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

const META_KEYS = new Set(['id', 'format', 'sha256']);

/** One-line summary of what an audit entry changed. */
export function describeAudit(entry: AuditEntry): string {
  const details = entry.details ?? {};
  if (details.truncated) {
    // Large changes are stored as a summary of what changed rather than the full before/after values.
    if (details.unreadable) return t("Details not available (recorded by an older version)");
    const keys = Array.isArray(details.keys) ? details.keys.filter((key): key is string => typeof key === 'string') : [];
    const count = Number(details.keyCount) || keys.length;
    const shown = keys.slice(0, 5).map(fieldLabel);
    if (!shown.length) return t('auditLargeChange', { count });
    const remaining = count - shown.length;
    const fields = remaining > 0 ? t('auditRemainingFields', { fields: shown.join(', '), count: remaining }) : list(shown);
    return t('auditLargeChangeWithFields', { count, fields });
  }
  switch (entry.action) {
    case 'incidents.import':
    case 'matrixTask.import':
      return t("{{added}} added, {{updated}} updated, {{skipped}} skipped", { added: details.added ?? 0, updated: details.updated ?? 0, skipped: details.skipped ?? 0 });
    case 'matrixTask.carryOver':
      return t('auditTasksCopied', { count: Number(details.copied) || 0 });
    case 'roster.plan.update':
      return t(
        details.analysts ? '{{assigned}} assigned, {{cleared}} cleared · {{analysts}}' : '{{assigned}} assigned, {{cleared}} cleared',
        { assigned: details.assigned ?? 0, cleared: details.cleared ?? 0, analysts: details.analysts },
      );
    case 'advisorBrief.create':
      return details.source === 'llm' ? t("Generated by the LLM") : t("Generated from the built-in template");
    case 'sla-settings.update':
      return list(Object.keys(details).filter((key) => !META_KEYS.has(key)).map(fieldLabel));
    default:
      break;
  }

  const fields = Object.keys(details).filter((key) => !META_KEYS.has(key));
  const pairs = fields.filter((key) => isPair(details[key]));
  const others = fields.filter((key) => !isPair(details[key])).map((key) => `${fieldLabel(key)}: ${show(details[key])}`);
  if (entry.action.endsWith('.create')) {
    return [...pairs.map((key) => `${fieldLabel(key)}: ${show((details[key] as unknown[])[1])}`), ...others].join('; ');
  }
  if (isDeleteAction(entry.action)) {
    return [...pairs.map((key) => `${fieldLabel(key)}: ${show((details[key] as unknown[])[0])}`), ...others].join('; ');
  }
  const changes = pairs.map((key) => {
    const [from, to] = details[key] as [unknown, unknown];
    return `${fieldLabel(key)}: ${show(from)} → ${show(to)}`;
  });
  return [...changes, ...others].join('; ') || (entry.action === 'incident.update' ? t('no SLA-relevant change') : '');
}
