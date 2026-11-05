// SPDX-License-Identifier: Apache-2.0
// Settings → SLA & KPI policies: report header and calendar, compliance thresholds,
// default and per-customer SLA targets, and KPI health rules.

import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api } from './api';
import type { AppSnapshot, Health, IncidentPriority, Kpi, KpiDirection, ReportSettings, SlaTargets } from './types';
import { PRIORITIES, computeKpiHealth, customersOf, formatDuration, parseDurationInput, reportSettingsOf } from './reportCalc';

type Mutate = (action: string, work: () => Promise<AppSnapshot>) => Promise<void>;
type Measure = 'detect' | 'ack' | 'resolve';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PRIORITY_COLORS: Record<IncidentPriority, string> = { P1: '#d5323f', P2: '#f08c00', P3: '#0a60ff', P4: '#8d99a6' };
const MEASURES: Array<{ key: Measure; label: string }> = [
  { key: 'detect', label: 'Detect' },
  { key: 'ack', label: 'Acknowledge' },
  { key: 'resolve', label: 'Resolve' },
];

function cloneTargets(targets: SlaTargets): SlaTargets {
  return JSON.parse(JSON.stringify(targets)) as SlaTargets;
}

/** Text box that accepts "15", "15m", "4h" or "1d 2h" and stores minutes. */
function DurationInput({ minutes, onChange, disabled, allowOff }: { minutes: number; onChange: (value: number) => void; disabled?: boolean; allowOff?: boolean }) {
  const shown = minutes === 0 && allowOff ? 'off' : formatDuration(minutes);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(shown), [shown]);

  function commit() {
    const raw = text.trim().toLowerCase();
    if (allowOff && (raw === 'off' || raw === '0' || raw === '')) {
      setInvalid(false);
      onChange(0);
      return;
    }
    const value = parseDurationInput(raw);
    if (value === null || value <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(value);
  }

  return (
    <input
      className={invalid ? 'sla-duration invalid' : 'sla-duration'}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
      disabled={disabled}
      aria-invalid={invalid}
      title="Examples: 15m, 4h, 1d 2h"
    />
  );
}

function TargetsTable({ targets, base, onChange, disabled }: { targets: SlaTargets; base?: SlaTargets; onChange: (next: SlaTargets) => void; disabled?: boolean }) {
  function set(priority: IncidentPriority, measure: Measure, value: number) {
    onChange({ ...targets, [priority]: { ...targets[priority], [measure]: value } });
  }
  return (
    <table className="grid-table sla-targets">
      <thead>
        <tr><th>Priority</th>{MEASURES.map((measure) => <th key={measure.key}>{measure.label} within</th>)}</tr>
      </thead>
      <tbody>
        {PRIORITIES.map((priority) => (
          <tr key={priority}>
            <td><span className="rpt-prio" style={{ background: PRIORITY_COLORS[priority] }}>{priority}</span></td>
            {MEASURES.map((measure) => {
              const changed = base && base[priority][measure.key] !== targets[priority][measure.key];
              return (
                <td key={measure.key} className={changed ? 'sla-changed' : ''}>
                  <DurationInput minutes={targets[priority][measure.key]} onChange={(value) => set(priority, measure.key, value)} disabled={disabled} allowOff={measure.key === 'detect'} />
                  {changed ? <small className="muted"> standard {formatDuration(base[priority][measure.key]) || 'off'}</small> : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SlaPolicySettings({ app, busy, mutate }: { app: AppSnapshot; busy: boolean; mutate: Mutate }) {
  const settings = reportSettingsOf(app);
  const [draft, setDraft] = useState<ReportSettings>(settings);
  const [newCustomer, setNewCustomer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const settingsKey = JSON.stringify(settings);
  useEffect(() => setDraft(reportSettingsOf(app)), [settingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== settingsKey;
  const knownCustomers = customersOf(app).filter((name) => !draft.customerSla[name]);
  const overrideNames = Object.keys(draft.customerSla).sort((a, b) => a.localeCompare(b));

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3000);
  }

  function toggleWeekend(day: number) {
    const next = draft.weekendDays.includes(day) ? draft.weekendDays.filter((value) => value !== day) : [...draft.weekendDays, day].sort();
    setDraft({ ...draft, weekendDays: next });
  }

  function setCompliance(key: 'target' | 'amber', value: string) {
    const number = Math.max(0, Math.min(100, Number(value) || 0));
    const next = { ...draft.compliance, [key]: number };
    if (next.amber > next.target) next.amber = next.target;
    setDraft({ ...draft, compliance: next });
  }

  function addOverride() {
    const name = newCustomer.trim();
    if (!name || draft.customerSla[name]) return;
    setDraft({ ...draft, customerSla: { ...draft.customerSla, [name]: cloneTargets(draft.slaTargets) } });
    setNewCustomer('');
  }

  function removeOverride(name: string) {
    const next = { ...draft.customerSla };
    delete next[name];
    setDraft({ ...draft, customerSla: next });
  }

  async function save() {
    await mutate('save-sla-policies', () => api.updateReportSettings(draft));
    flash('SLA policies saved. Reports use them straight away.');
  }

  return (
    <div className="sla-policies">
      <section className="panel">
        <header className="panel-head"><h2>Compliance thresholds</h2><div className="panel-meta"><span className="muted">colour of SLA percentages in every report</span></div></header>
        <div className="panel-body form-stack">
          <div className="form-grid two">
            <label className="field"><span>Contracted compliance target (%)</span>
              <input type="number" min={0} max={100} step={0.5} value={draft.compliance.target} onChange={(event) => setCompliance('target', event.target.value)} />
            </label>
            <label className="field"><span>Amber from (%)</span>
              <input type="number" min={0} max={draft.compliance.target} step={0.5} value={draft.compliance.amber} onChange={(event) => setCompliance('amber', event.target.value)} />
            </label>
          </div>
          <div className="sla-bands" aria-label="Threshold preview">
            <span className="sla-band risk">Red · below {draft.compliance.amber}%</span>
            <span className="sla-band watch">Amber · {draft.compliance.amber}% – {draft.compliance.target}%</span>
            <span className="sla-band healthy">Green · {draft.compliance.target}% or more</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Standard SLA targets</h2><div className="panel-meta"><span className="muted">used for every customer without its own SLA</span></div></header>
        <div className="panel-body form-stack">
          <TargetsTable targets={draft.slaTargets} onChange={(next) => setDraft({ ...draft, slaTargets: next })} />
          <small className="muted">Type durations such as <code>15m</code>, <code>4h</code> or <code>1d 2h</code>. Set Detect to <code>off</code> if detection time is not measured for that priority.</small>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Customer-specific SLAs</h2><div className="panel-meta"><span className="muted">{overrideNames.length} customer{overrideNames.length === 1 ? '' : 's'} with their own contract</span></div></header>
        <div className="panel-body form-stack">
          <div className="report-inline">
            <input list="sla-customers" placeholder="Customer name" value={newCustomer} onChange={(event) => setNewCustomer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addOverride(); } }} />
            <datalist id="sla-customers">{knownCustomers.map((name) => <option key={name} value={name} />)}</datalist>
            <button type="button" className="ghost-btn" onClick={addOverride} disabled={!newCustomer.trim() || Boolean(draft.customerSla[newCustomer.trim()])}><Plus size={14} /> Add customer SLA</button>
          </div>
          <small className="muted">A new customer SLA starts as a copy of the standard targets. Customer names must match the incident register exactly.</small>
          {overrideNames.length ? overrideNames.map((name) => (
            <div key={name} className="sla-customer">
              <div className="sla-customer-head">
                <strong>{name}</strong>
                {!customersOf(app).includes(name) ? <span className="sla-warning">no incidents with this customer name yet</span> : null}
                <span className="report-toolbar-spacer" />
                <button type="button" className="ghost-btn" onClick={() => setDraft({ ...draft, customerSla: { ...draft.customerSla, [name]: cloneTargets(draft.slaTargets) } })} title="Reset to the standard targets"><RotateCcw size={14} /> Reset</button>
                <button type="button" className="ghost-btn" onClick={() => removeOverride(name)} title="Remove this customer SLA"><Trash2 size={14} /> Remove</button>
              </div>
              <TargetsTable targets={draft.customerSla[name]} base={draft.slaTargets} onChange={(next) => setDraft({ ...draft, customerSla: { ...draft.customerSla, [name]: next } })} />
            </div>
          )) : <p className="muted">No customer-specific SLAs. Every customer is measured against the standard targets.</p>}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Report header & calendar</h2></header>
        <div className="panel-body form-stack">
          <label className="field"><span>Organisation name (shown on every report)</span>
            <input value={draft.orgName} onChange={(event) => setDraft({ ...draft, orgName: event.target.value })} maxLength={120} />
          </label>
          <div className="field"><span>Weekend days</span>
            <div className="report-weekdays">
              {WEEKDAY_NAMES.map((name, day) => (
                <label key={name} className={draft.weekendDays.includes(day) ? 'report-chip on' : 'report-chip'}>
                  <input type="checkbox" checked={draft.weekendDays.includes(day)} onChange={() => toggleWeekend(day)} />{name.slice(0, 3)}
                </label>
              ))}
            </div>
            <small className="muted">Saudi Arabia and most GCC countries use Friday + Saturday.</small>
          </div>
        </div>
      </section>

      <div className="sla-savebar">
        <button type="button" className="primary-btn" onClick={() => void save()} disabled={busy || !dirty}><Save size={14} /> Save SLA policies</button>
        {dirty ? <button type="button" className="ghost-btn" onClick={() => setDraft(settings)}>Discard changes</button> : null}
        {message ? <span className="report-import-ok">{message}</span> : dirty ? <span className="muted">Unsaved changes</span> : null}
      </div>

      <KpiRules app={app} busy={busy} mutate={mutate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI health rules
// ---------------------------------------------------------------------------

interface KpiRuleDraft {
  direction: KpiDirection;
  tolerance: number;
}

function KpiRules({ app, busy, mutate }: { app: AppSnapshot; busy: boolean; mutate: Mutate }) {
  const initial = () => Object.fromEntries(app.kpis.map((kpi) => [kpi.id, { direction: kpi.direction ?? '', tolerance: kpi.tolerance ?? 5 }])) as Record<number, KpiRuleDraft>;
  const [rules, setRules] = useState<Record<number, KpiRuleDraft>>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const kpiKey = JSON.stringify(app.kpis);
  useEffect(() => setRules(initial()), [kpiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = app.kpis.filter((kpi) => {
    const rule = rules[kpi.id];
    return rule && (rule.direction !== (kpi.direction ?? '') || Number(rule.tolerance) !== Number(kpi.tolerance ?? 5));
  });

  function preview(kpi: Kpi): { health: Health; automatic: boolean; note?: string } {
    const rule = rules[kpi.id] ?? { direction: '', tolerance: 5 };
    if (!rule.direction) return { health: kpi.health, automatic: false };
    const health = computeKpiHealth(kpi.actual, kpi.target, rule.direction, rule.tolerance);
    return health ? { health, automatic: true } : { health: kpi.health, automatic: false, note: 'actual and target are not comparable – kept manual' };
  }

  async function save() {
    for (const kpi of changed) {
      const rule = rules[kpi.id];
      await mutate(`kpi-rule-${kpi.id}`, () => api.updateRecord('kpi', kpi.id, { ...kpi, direction: rule.direction, tolerance: rule.tolerance }));
    }
    setMessage(`Updated ${changed.length} KPI rule${changed.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setMessage(null), 3000);
  }

  return (
    <section className="panel">
      <header className="panel-head"><h2>KPI health rules</h2><div className="panel-meta"><span className="muted">calculate KPI health from actual vs target</span></div></header>
      <div className="panel-body form-stack">
        {app.kpis.length ? (
          <table className="grid-table kpi-rules">
            <thead><tr><th>Code</th><th>KPI</th><th>Actual</th><th>Target</th><th>Rule</th><th>Amber band</th><th>Health</th></tr></thead>
            <tbody>
              {app.kpis.map((kpi) => {
                const rule = rules[kpi.id] ?? { direction: '', tolerance: 5 };
                const result = preview(kpi);
                return (
                  <tr key={kpi.id}>
                    <td className="ref">{kpi.code}</td>
                    <td>{kpi.name}</td>
                    <td>{kpi.actual}</td>
                    <td className="muted">{kpi.target}</td>
                    <td>
                      <select value={rule.direction} onChange={(event) => setRules({ ...rules, [kpi.id]: { ...rule, direction: event.target.value as KpiDirection } })}>
                        <option value="">Set by hand</option>
                        <option value="higher">Higher is better</option>
                        <option value="lower">Lower is better</option>
                      </select>
                    </td>
                    <td>
                      <span className="report-inline">
                        <input type="number" min={0} max={100} step={1} className="kpi-tolerance" value={rule.tolerance} onChange={(event) => setRules({ ...rules, [kpi.id]: { ...rule, tolerance: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } })} disabled={!rule.direction} />
                        <small className="muted">% of target</small>
                      </span>
                    </td>
                    <td>
                      <span className={`sla-band ${result.health}`}>{result.health.charAt(0).toUpperCase() + result.health.slice(1)}</span>
                      <small className="muted"> {result.automatic ? 'auto' : result.note ?? 'manual'}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="muted">No KPIs yet. Add them in the Service module.</p>}
        <small className="muted">
          Higher is better: green at or above target, amber within the band below it, red beyond. Lower is better works the other way.
          Actual and target must use the same unit (both %, both durations like <code>3h 40m</code>, or both plain numbers).
        </small>
        <div className="report-inline">
          <button type="button" className="primary-btn" onClick={() => void save()} disabled={busy || !changed.length}><Save size={14} /> Save KPI rules</button>
          {message ? <span className="report-import-ok">{message}</span> : changed.length ? <span className="muted">{changed.length} unsaved</span> : null}
        </div>
      </div>
    </section>
  );
}
