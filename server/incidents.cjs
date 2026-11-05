// SPDX-License-Identifier: Apache-2.0
// Incident register and report settings.
//
// Incidents carry the timestamps needed for SLA reporting:
//   occurred -> detected      = time to detect      (MTTD)
//   detected -> acknowledged  = time to acknowledge (MTTA)
//   detected -> resolved      = time to resolve     (MTTR)
// Timestamps are stored as local "YYYY-MM-DDTHH:MM" strings, the same
// convention the rest of the cockpit uses for dates.
'use strict';

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const INCIDENT_STATUSES = ['Open', 'Acknowledged', 'Resolved', 'Closed'];

// Minutes. detect = 0 means no detection target.
const DEFAULT_SLA_TARGETS = {
  P1: { detect: 15, ack: 15, resolve: 240 },
  P2: { detect: 30, ack: 30, resolve: 480 },
  P3: { detect: 60, ack: 120, resolve: 1440 },
  P4: { detect: 240, ack: 480, resolve: 4320 },
};

const DEFAULT_COMPLIANCE = { target: 95, amber: 85 };

const DEFAULT_REPORT_SETTINGS = {
  orgName: 'Security Operations Center',
  // JavaScript day numbers: 0 = Sunday ... 6 = Saturday. Saturday + Sunday by default;
  // GCC deployments such as Saudi Arabia set Friday + Saturday in Reports > Report settings.
  weekendDays: [0, 6],
  slaTargets: DEFAULT_SLA_TARGETS,
  // Contracted compliance target and the amber threshold below it (percent).
  compliance: DEFAULT_COMPLIANCE,
  // Per-customer SLA overrides: { "<customer>": { P1: { detect, ack, resolve }, ... } }.
  customerSla: {},
};

const MAX_CUSTOMER_OVERRIDES = 200;

function ensureIncidentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P3',
      category TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Open',
      analyst TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      detected_at TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_detected ON incidents (detected_at);
  `);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('reportSettings', JSON.stringify(DEFAULT_REPORT_SETTINGS));
}

function readIncidents(db) {
  return db.prepare(`
    SELECT id, ref, customer, title, priority, category, source, status, analyst,
      occurred_at AS occurredAt, detected_at AS detectedAt, acknowledged_at AS acknowledgedAt,
      resolved_at AS resolvedAt, notes, created_at AS createdAt
    FROM incidents ORDER BY detected_at DESC, id DESC
  `).all();
}

function readReportSettings(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('reportSettings');
  let stored = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  return normalizeReportSettings(stored);
}

function writeReportSettings(db, payload) {
  const current = readReportSettings(db);
  const next = normalizeReportSettings({ ...current, ...(payload || {}) });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('reportSettings', JSON.stringify(next));
  return next;
}

function normalizeTargets(source, fallbackTargets) {
  const targets = {};
  for (const priority of PRIORITIES) {
    const entry = source?.[priority] || {};
    const fallback = fallbackTargets[priority];
    targets[priority] = {
      detect: minutes(entry.detect, fallback.detect),
      ack: minutes(entry.ack, fallback.ack),
      resolve: minutes(entry.resolve, fallback.resolve),
    };
  }
  return targets;
}

function percentValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed * 10) / 10)) : fallback;
}

function normalizeReportSettings(value) {
  const orgName = clean(value?.orgName).slice(0, 120) || DEFAULT_REPORT_SETTINGS.orgName;
  const weekendDays = Array.isArray(value?.weekendDays)
    ? [...new Set(value.weekendDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : DEFAULT_REPORT_SETTINGS.weekendDays;
  const slaTargets = normalizeTargets(value?.slaTargets, DEFAULT_SLA_TARGETS);

  const target = percentValue(value?.compliance?.target, DEFAULT_COMPLIANCE.target);
  const amber = Math.min(target, percentValue(value?.compliance?.amber, Math.min(target, DEFAULT_COMPLIANCE.amber)));

  // Customer overrides inherit any missing value from the default targets.
  const customerSla = {};
  const entries = value?.customerSla && typeof value.customerSla === 'object' ? Object.entries(value.customerSla) : [];
  for (const [name, targets] of entries.slice(0, MAX_CUSTOMER_OVERRIDES)) {
    const customer = clean(name).slice(0, 120);
    if (customer) customerSla[customer] = normalizeTargets(targets, slaTargets);
  }
  return { orgName, weekendDays, slaTargets, compliance: { target, amber }, customerSla };
}

/** SLA targets that apply to a customer: its override if one exists, otherwise the defaults. */
function targetsForCustomer(settings, customer) {
  return (customer && settings.customerSla?.[customer]) || settings.slaTargets;
}

// ---- KPI health rules ----

// Parses KPI values such as "94%", "3h 40m", "11m", "1d 2h", "142" or "0.5".
function parseMetric(value) {
  const source = clean(value).toLowerCase().replace(/,/g, '');
  if (!source) return null;
  let match = source.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (match) return { kind: 'percent', value: Number(match[1]) };
  if (/^(\d+(?:\.\d+)?\s*(d|h|m|min|mins|s|sec)\s*)+$/.test(source)) {
    const units = { d: 1440, h: 60, m: 1, min: 1, mins: 1, s: 1 / 60, sec: 1 / 60 };
    let total = 0;
    for (const part of source.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|mins|min|m|sec|s)/g)) total += Number(part[1]) * units[part[2]];
    return { kind: 'duration', value: total };
  }
  match = source.match(/^(-?\d+(?:\.\d+)?)$/);
  if (match) return { kind: 'number', value: Number(match[1]) };
  return null;
}

/**
 * Health from a KPI rule. direction: 'higher' or 'lower' is better; tolerance is the
 * amber band as a percentage of the target. Returns null when the rule cannot be applied
 * (manual rule, or actual/target not comparable), so the stored health is kept.
 */
function computeKpiHealth(actual, target, direction, tolerance) {
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

function minutes(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 525600) : fallback;
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizePriority(value) {
  const source = clean(value).toUpperCase();
  if (PRIORITIES.includes(source)) return source;
  if (/^[1-4]$/.test(source)) return `P${source}`;
  if (/^(SEV|S)[1-4]$/.test(source)) return `P${source.slice(-1)}`;
  const named = { CRITICAL: 'P1', URGENT: 'P1', HIGH: 'P2', MEDIUM: 'P3', MODERATE: 'P3', LOW: 'P4', INFO: 'P4', INFORMATIONAL: 'P4' };
  return named[source] || 'P3';
}

function normalizeStatus(value, row) {
  const source = clean(value).toLowerCase();
  const match = INCIDENT_STATUSES.find((status) => status.toLowerCase() === source);
  if (match) return match;
  if (['closed', 'done', 'complete', 'completed'].includes(source)) return 'Closed';
  if (['resolved', 'fixed', 'mitigated', 'contained'].includes(source)) return 'Resolved';
  if (['ack', 'acknowledged', 'in progress', 'investigating', 'assigned'].includes(source)) return 'Acknowledged';
  if (row?.resolvedAt) return 'Resolved';
  if (row?.acknowledgedAt) return 'Acknowledged';
  return 'Open';
}

const pad = (value) => String(value).padStart(2, '0');

// Accepts ISO strings, "YYYY-MM-DD HH:MM[:SS]", "DD/MM/YYYY HH:MM" and Excel-style
// "MM/DD/YYYY" only when the day part is > 12. Returns local "YYYY-MM-DDTHH:MM" or ''.
function normalizeTimestamp(value) {
  const source = clean(value);
  if (!source) return '';
  let match = source.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (match) {
    if (match[6]) {
      const parsed = new Date(source.replace(' ', 'T'));
      if (!Number.isNaN(parsed.getTime())) return toLocalStamp(parsed);
    }
    return `${match[1]}-${match[2]}-${match[3]}T${pad(match[4] ?? '00')}:${match[5] ?? '00'}`;
  }
  match = source.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?$/i);
  if (match) {
    let first = Number(match[1]);
    let second = Number(match[2]);
    // Default day/month order (GCC convention); swap only when it can't be a valid day/month.
    let day = first;
    let month = second;
    if (month > 12 && day <= 12) {
      day = second;
      month = first;
    }
    let hour = Number(match[4] ?? 0);
    const meridiem = (match[6] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${match[3]}-${pad(month)}-${pad(day)}T${pad(hour)}:${match[5] ?? '00'}`;
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? '' : toLocalStamp(parsed);
}

function toLocalStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeIncident(payload) {
  const row = {
    ref: clean(payload.ref).slice(0, 80),
    customer: clean(payload.customer).slice(0, 120),
    title: clean(payload.title).slice(0, 300),
    priority: normalizePriority(payload.priority),
    category: clean(payload.category).slice(0, 120),
    source: clean(payload.source).slice(0, 120),
    analyst: clean(payload.analyst).slice(0, 120),
    occurredAt: normalizeTimestamp(payload.occurredAt),
    detectedAt: normalizeTimestamp(payload.detectedAt),
    acknowledgedAt: normalizeTimestamp(payload.acknowledgedAt),
    resolvedAt: normalizeTimestamp(payload.resolvedAt),
    notes: clean(payload.notes).slice(0, 4000),
  };
  row.status = normalizeStatus(payload.status, row);
  if (!row.title && row.ref) row.title = `Ticket ${row.ref}`;
  if (!row.title) throw httpError(400, 'Incident title (or a ticket number) is required.');
  if (!row.detectedAt) throw httpError(400, 'Incident detected time is required.');
  if (row.occurredAt && row.occurredAt > row.detectedAt) throw httpError(400, 'Occurred time cannot be after detected time.');
  if (row.acknowledgedAt && row.acknowledgedAt < row.detectedAt) throw httpError(400, 'Acknowledged time cannot be before detected time.');
  if (row.resolvedAt && row.resolvedAt < row.detectedAt) throw httpError(400, 'Resolved time cannot be before detected time.');
  return row;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function insertIncident(db, payload) {
  const row = normalizeIncident(payload);
  db.prepare(`INSERT INTO incidents (ref, customer, title, priority, category, source, status, analyst, occurred_at, detected_at, acknowledged_at, resolved_at, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.ref, row.customer, row.title, row.priority, row.category, row.source, row.status, row.analyst, row.occurredAt, row.detectedAt, row.acknowledgedAt, row.resolvedAt, row.notes, new Date().toISOString());
}

function updateIncident(db, id, payload) {
  const row = normalizeIncident(payload);
  db.prepare(`UPDATE incidents SET ref = ?, customer = ?, title = ?, priority = ?, category = ?, source = ?, status = ?, analyst = ?, occurred_at = ?, detected_at = ?, acknowledged_at = ?, resolved_at = ?, notes = ? WHERE id = ?`)
    .run(row.ref, row.customer, row.title, row.priority, row.category, row.source, row.status, row.analyst, row.occurredAt, row.detectedAt, row.acknowledgedAt, row.resolvedAt, row.notes, Number.parseInt(String(id), 10) || 0);
}

// ---- Excel / CSV import ----

// Header aliases so exports from Splunk, ServiceNow, Jira, TheHive and hand-made Excel sheets map without editing.
const HEADER_ALIASES = {
  ref: ['ref', 'reference', 'ticket', 'ticket number', 'ticket no', 'ticket no.', 'ticket #', 'ticket id', 'ticket_id', 'incident', 'incident number', 'incident id', 'incident_id', 'number', 'case', 'case id', 'case_id', 'case number', 'id', 'key'],
  customer: ['customer', 'client', 'tenant', 'company', 'account', 'organization', 'organisation'],
  title: ['title', 'summary', 'short description', 'short_description', 'name', 'subject', 'description', 'rule name', 'rule_name', 'alert', 'alert name'],
  priority: ['priority', 'severity', 'urgency', 'sev', 'impact'],
  category: ['category', 'type', 'incident type', 'classification', 'use case', 'use_case'],
  source: ['source', 'detection source', 'tool', 'product', 'data source'],
  status: ['status', 'state'],
  analyst: ['analyst', 'owner', 'assignee', 'assigned to', 'assigned_to', 'handler'],
  occurredAt: ['occurred', 'occurred at', 'occurred_at', 'event time', 'event_time', 'start time', 'start_time', 'first seen', 'first_seen'],
  detectedAt: ['detected', 'detected at', 'detected_at', 'detected date', 'detection date', 'detection time', 'date', 'incident date', 'ticket date', 'created', 'created at', 'created_at', 'created date', 'opened', 'opened at', 'opened_at', 'reported', 'date/time', '_time'],
  detectedTime: ['time', 'detected time', 'incident time'],
  acknowledgedAt: ['acknowledged', 'acknowledged at', 'acknowledged_at', 'ack', 'ack time', 'ack_time', 'responded', 'responded at', 'first response', 'first_response'],
  resolvedAt: ['resolved', 'resolved at', 'resolved_at', 'closed', 'closed at', 'closed_at', 'end time'],
  // Durations: minutes (45), "1h 30m", "1:30" (h:mm) or an Excel time value.
  mttd: ['mttd', 'ttd', 'time to detect', 'detection duration', 'mttd (min)', 'mttd (minutes)', 'ttd (min)'],
  mtta: ['mtta', 'tta', 'time to acknowledge', 'time to respond', 'response time', 'mtta (min)', 'mtta (minutes)', 'tta (min)'],
  mttr: ['mttr', 'ttr', 'time to resolve', 'resolution time', 'time to resolution', 'mttr (min)', 'mttr (minutes)', 'ttr (min)'],
  notes: ['notes', 'comments', 'work notes', 'work_notes', 'resolution notes', 'remarks'],
};

function parseCsv(textInput) {
  const textValue = String(textInput).replace(/^﻿/, '');
  const delimiter = detectDelimiter(textValue);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < textValue.length; i += 1) {
    const char = textValue[i];
    if (quoted) {
      if (char === '"') {
        if (textValue[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && textValue[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(textValue) {
  const firstLine = textValue.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((candidate) => [candidate, firstLine.split(candidate).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function mapHeaders(headerRow) {
  const normalized = headerRow.map((cell) => clean(cell).toLowerCase().replace(/\s+/g, ' ').replace(/\s*\*$/, ''));
  const mapping = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header, column) => aliases.includes(header) && !Object.values(mapping).includes(column));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

/** Duration cell -> minutes. Accepts 45, "45", "1h 30m", "90 min", "1:30" (h:mm) and "1:30:00". */
function parseDurationMinutes(value) {
  const source = clean(value).toLowerCase();
  if (!source) return null;
  if (/^\d+(\.\d+)?$/.test(source)) return Math.round(Number(source));
  let match = source.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]) + Math.round(Number(match[3] ?? 0) / 60);
  match = source.match(/^(\d+(?:\.\d+)?)\s*(minutes|minute|mins|min)$/);
  if (match) return Math.round(Number(match[1]));
  const parsed = parseMetric(source);
  return parsed && parsed.kind === 'duration' ? Math.round(parsed.value) : null;
}

function shiftStamp(stampValue, minutesDelta) {
  const match = stampValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]) + minutesDelta);
  return toLocalStamp(date);
}

/**
 * Turns one spreadsheet row into an incident payload. Timestamps are used when the
 * file has them; otherwise they are derived from the detected time and the
 * MTTD / MTTA / MTTR durations, so every report can measure the incident.
 */
function rowToPayload(cells, mapping) {
  const get = (field) => (mapping[field] === undefined ? '' : clean(cells[mapping[field]]));
  const payload = {};
  for (const field of ['ref', 'customer', 'title', 'priority', 'category', 'source', 'status', 'analyst', 'occurredAt', 'acknowledgedAt', 'resolvedAt', 'notes']) {
    payload[field] = get(field);
  }
  let detected = get('detectedAt');
  const time = get('detectedTime');
  if (detected && time && /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(detected)) detected = `${detected} ${time}`;
  payload.detectedAt = detected;

  const detectedStamp = normalizeTimestamp(detected);
  const durations = {};
  for (const [field, column] of [['mttd', 'occurredAt'], ['mtta', 'acknowledgedAt'], ['mttr', 'resolvedAt']]) {
    const raw = get(field);
    if (!raw) continue;
    const minutesValue = parseDurationMinutes(raw);
    if (minutesValue === null || minutesValue < 0) throw httpError(400, `${field.toUpperCase()} "${raw}" is not a duration. Use minutes (45), 1h 30m or 1:30.`);
    durations[field] = minutesValue;
    if (!payload[column] && detectedStamp) {
      payload[column] = shiftStamp(detectedStamp, field === 'mttd' ? -minutesValue : minutesValue);
    }
  }
  // Rows from a "durations only" sheet are closed once they have a resolution time.
  if (!payload.status && payload.resolvedAt) payload.status = 'Closed';
  return { payload, durations };
}

function importRows(db, rows, label) {
  if (rows.length < 2) throw httpError(400, `The ${label} has no data rows below the header.`);
  const headerIndex = rows.findIndex((row) => {
    const mapping = mapHeaders(row);
    return mapping.detectedAt !== undefined && (mapping.ref !== undefined || mapping.title !== undefined);
  });
  if (headerIndex < 0) {
    throw httpError(400, `The ${label} needs a header row with at least a ticket number (or title) column and a detected date column. Download the template to see the expected columns.`);
  }
  const mapping = mapHeaders(rows[headerIndex]);
  const findExisting = db.prepare('SELECT id FROM incidents WHERE ref = ? AND customer = ?');
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  db.exec('BEGIN');
  try {
    rows.slice(headerIndex + 1).forEach((cells, index) => {
      if (!cells.some((cell) => clean(cell))) return;
      try {
        const { payload } = rowToPayload(cells, mapping);
        const normalized = normalizeIncident(payload);
        const existing = normalized.ref ? findExisting.get(normalized.ref, normalized.customer) : null;
        if (existing) {
          updateIncident(db, existing.id, payload);
          updated += 1;
        } else {
          insertIncident(db, payload);
          added += 1;
        }
      } catch (error) {
        skipped += 1;
        if (errors.length < 25) errors.push(`Row ${headerIndex + index + 2}: ${error.message}`);
      }
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { added, updated, skipped, errors, mappedColumns: Object.keys(mapping) };
}

function importIncidentsCsv(db, csvText) {
  return importRows(db, parseCsv(csvText), 'CSV file');
}

// ---- Excel (.xlsx) ----

const pad2 = (value) => String(value).padStart(2, '0');

// Excel stores date/times as wall-clock values; exceljs exposes them as UTC Dates.
function excelDateText(date) {
  const hasTime = date.getUTCHours() || date.getUTCMinutes();
  const day = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  return hasTime ? `${day} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}` : day;
}

function excelCellText(cell) {
  let value = cell.value;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) value = value.result; // formula
    else if (Array.isArray(value.richText)) value = value.richText.map((part) => part.text).join('');
    else if ('text' in value) value = value.text; // hyperlink
  }
  if (value instanceof Date) {
    // Durations typed as 1:30 in a time-formatted cell arrive as dates on 1899-12-30.
    if (value.getUTCFullYear() < 1900) return String(Math.round((value.getTime() - Date.UTC(1899, 11, 30)) / 60000));
    return excelDateText(value);
  }
  if (typeof value === 'number') {
    const format = String(cell.numFmt || '').toLowerCase();
    if (/[hs]|mm:|:mm/.test(format) && value < 60) return String(Math.round(value * 1440)); // time-formatted duration
    return String(value);
  }
  return value === null || value === undefined ? '' : String(value);
}

async function readXlsxRows(buffer) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw httpError(400, 'Could not read the Excel file. Save it as .xlsx (Excel Workbook) and try again.');
  }
  const sheet = workbook.getWorksheet('Incidents') || workbook.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) throw httpError(400, 'The Excel file has no data.');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) cells.push(excelCellText(row.getCell(column)));
    rows.push(cells);
  });
  return rows;
}

async function importIncidentsXlsx(db, buffer) {
  return importRows(db, await readXlsxRows(buffer), 'Excel sheet');
}

const TEMPLATE_COLUMNS = [
  { header: 'Ticket number *', key: 'ref', width: 16 },
  { header: 'Customer', key: 'customer', width: 20 },
  { header: 'Title', key: 'title', width: 36 },
  { header: 'Priority *', key: 'priority', width: 10 },
  { header: 'Detected *', key: 'detected', width: 18 },
  { header: 'MTTD', key: 'mttd', width: 9 },
  { header: 'MTTA', key: 'mtta', width: 9 },
  { header: 'MTTR', key: 'mttr', width: 9 },
  { header: 'Category', key: 'category', width: 18 },
  { header: 'Analyst', key: 'analyst', width: 18 },
  { header: 'Status', key: 'status', width: 13 },
  { header: 'Notes', key: 'notes', width: 30 },
];

async function buildIncidentTemplateXlsx() {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SOC Cockpit';
  const sheet = workbook.addWorksheet('Incidents', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS;
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D2138' } };
  header.height = 20;
  const examples = [
    ['INC-1001', 'Customer A', 'Brute force on VPN gateway', 'P2', new Date(Date.UTC(2026, 10, 1, 8, 10)), 8, 15, '3h 30m', 'Credential access', 'Analyst 1', 'Closed', 'Blocked source IPs'],
    ['INC-1002', 'Customer B', 'Malware detected on endpoint', 'P1', new Date(Date.UTC(2026, 10, 2, 21, 15)), 5, 7, '', 'Malware', 'Analyst 2', 'Acknowledged', 'Host isolated, still investigating'],
    ['INC-1003', 'Customer A', '', 'P3', new Date(Date.UTC(2026, 10, 3, 9, 40)), '', 45, '1:20', '', '', '', 'Title is optional'],
  ];
  for (const values of examples) sheet.addRow(values);
  for (let rowNumber = 2; rowNumber <= 500; rowNumber += 1) {
    sheet.getCell(`D${rowNumber}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"P1,P2,P3,P4"'], showErrorMessage: true, errorTitle: 'Priority', error: 'Choose P1, P2, P3 or P4.' };
    sheet.getCell(`K${rowNumber}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Open,Acknowledged,Resolved,Closed"'] };
    sheet.getCell(`E${rowNumber}`).numFmt = 'yyyy-mm-dd hh:mm';
  }

  const help = workbook.addWorksheet('How to fill');
  help.columns = [{ width: 18 }, { width: 90 }];
  const lines = [
    ['SOC Cockpit – incident import', ''],
    ['', ''],
    ['Ticket number *', 'Your ticket / case reference. Re-importing the same ticket number (and customer) updates it instead of creating a duplicate.'],
    ['Customer', 'Customer or tenant name. Must match the name used for any customer-specific SLA in Settings → SLA & KPI policies.'],
    ['Title', 'Optional short description. If empty, "Ticket <number>" is used.'],
    ['Priority *', 'P1, P2, P3 or P4 (Critical / High / Medium / Low and 1–4 are also accepted).'],
    ['Detected *', 'Date and time the incident was detected, e.g. 2026-11-05 14:30 or 05/11/2026 14:30.'],
    ['MTTD', 'Time to detect: from when the activity happened to detection. Optional.'],
    ['MTTA', 'Time to acknowledge: from detection to acknowledgement.'],
    ['MTTR', 'Time to resolve: from detection to resolution. Leave empty while the incident is still open.'],
    ['', 'Durations can be minutes (45), hours and minutes (1h 30m, 2d 4h) or h:mm (1:30).'],
    ['Status', 'Optional. Open, Acknowledged, Resolved or Closed. If empty, it is worked out from MTTA / MTTR.'],
    ['', ''],
    ['', 'Delete the three example rows before importing. Import in SOC Cockpit: Reports → Incident register → Import Excel / CSV.'],
    ['', 'SLA results are calculated against the targets in Settings → SLA & KPI policies.'],
  ];
  for (const line of lines) help.addRow(line);
  help.getRow(1).font = { bold: true, size: 14 };
  help.getColumn(1).font = { bold: true };
  help.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const CSV_TEMPLATE = [
  'Ticket number,Customer,Title,Priority,Detected,MTTD,MTTA,MTTR,Category,Analyst,Status,Notes',
  'INC-1001,Customer A,Brute force on VPN gateway,P2,2026-11-01 08:10,8,15,3h 30m,Credential access,Analyst 1,Closed,Blocked source IPs',
  'INC-1002,Customer B,Malware detected on endpoint,P1,2026-11-02 21:15,5,7,,Malware,Analyst 2,Acknowledged,Host isolated',
].join('\r\n');

module.exports = {
  PRIORITIES,
  INCIDENT_STATUSES,
  CSV_TEMPLATE,
  ensureIncidentSchema,
  readIncidents,
  readReportSettings,
  writeReportSettings,
  targetsForCustomer,
  parseMetric,
  computeKpiHealth,
  insertIncident,
  updateIncident,
  importIncidentsCsv,
  importIncidentsXlsx,
  buildIncidentTemplateXlsx,
  parseDurationMinutes,
  normalizeTimestamp,
  parseCsv,
};
