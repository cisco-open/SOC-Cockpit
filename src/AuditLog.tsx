// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api';
import { auditActionLabel, auditArea, auditAreaLabel, describeAudit, isDeleteAction } from './auditFormat';
import type { AuditEntry } from './types';

const PAGE_SIZE = 500;
const MAX_ENTRIES = 2000;

type ChangeFilter = '' | 'create' | 'update' | 'delete';

function changeType(action: string): ChangeFilter {
  if (action.endsWith('.create')) return 'create';
  if (isDeleteAction(action)) return 'delete';
  return 'update';
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Settings → Audit log (Admin): who added, changed or deleted what, and when, across all modules. */
export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState({ area: '', change: '' as ChangeFilter, user: '', search: '' });

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getAuditLog(limit)
      .then((result) => { if (active) { setEntries(result.entries); setError(null); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the audit log.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [limit, reloadKey]);

  const all = entries ?? [];
  const areas = useMemo(() => [...new Set(all.map((entry) => auditArea(entry.action)))].sort((a, b) => auditAreaLabel(a).localeCompare(auditAreaLabel(b))), [all]);
  const users = useMemo(() => [...new Set(all.map((entry) => entry.username).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);

  const shown = useMemo(() => {
    const search = filter.search.trim().toLowerCase();
    return all.filter((entry) => {
      if (filter.area && auditArea(entry.action) !== filter.area) return false;
      if (filter.change && changeType(entry.action) !== filter.change) return false;
      if (filter.user && entry.username !== filter.user) return false;
      if (search) {
        const haystack = `${entry.target} ${auditActionLabel(entry.action)} ${describeAudit(entry)} ${entry.username}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [all, filter]);

  const canLoadMore = all.length >= limit && limit < MAX_ENTRIES;

  return (
    <section className="ac-card">
      <header className="ac-card-head">
        <div>
          <h2>Audit log</h2>
          <p>Every addition, change and deletion, with who made it and when. Entries cannot be edited or removed.</p>
        </div>
        <button type="button" className="ac-btn" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}><RefreshCw size={16} /> Refresh</button>
      </header>
      <div className="audit-filters">
        <select value={filter.area} onChange={(event) => setFilter({ ...filter, area: event.target.value })} aria-label="Filter by module">
          <option value="">All modules</option>
          {areas.map((area) => <option key={area} value={area}>{auditAreaLabel(area)}</option>)}
        </select>
        <select value={filter.change} onChange={(event) => setFilter({ ...filter, change: event.target.value as ChangeFilter })} aria-label="Filter by type of change">
          <option value="">All changes</option>
          <option value="create">Added</option>
          <option value="update">Edited / other</option>
          <option value="delete">Deleted</option>
        </select>
        <select value={filter.user} onChange={(event) => setFilter({ ...filter, user: event.target.value })} aria-label="Filter by user">
          <option value="">All users</option>
          {users.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <input type="search" placeholder="Search item or details…" value={filter.search} onChange={(event) => setFilter({ ...filter, search: event.target.value })} aria-label="Search the audit log" />
      </div>
      {error ? <div className="error-banner ac-inset">{error}</div> : null}
      <div className="ac-table-wrap">
        <table className="ac-table audit-table">
          <thead>
            <tr><th>When</th><th>User</th><th>Action</th><th>Item</th><th>Details</th></tr>
          </thead>
          <tbody>
            {shown.map((entry) => (
              <tr key={entry.id} className={isDeleteAction(entry.action) ? 'is-delete' : undefined}>
                <td className="audit-when"><time dateTime={entry.at}>{formatWhen(entry.at)}</time></td>
                <td><strong>{entry.username || 'system'}</strong>{entry.role ? <div className="ac-sub">{entry.role}</div> : null}</td>
                <td className="audit-action">{auditActionLabel(entry.action)}</td>
                <td>{entry.target || '—'}</td>
                <td className="audit-what">{describeAudit(entry) || '—'}</td>
              </tr>
            ))}
            {entries && shown.length === 0 ? <tr><td colSpan={5} className="ac-empty">{all.length ? 'No entries match these filters.' : 'No changes recorded yet.'}</td></tr> : null}
            {!entries && !error ? <tr><td colSpan={5} className="ac-empty">Loading…</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="ac-foot-note">
        Showing {shown.length} of the latest {all.length} entries.
        {canLoadMore ? <> <button type="button" className="ac-btn" onClick={() => setLimit((current) => Math.min(MAX_ENTRIES, current + PAGE_SIZE))} disabled={loading}>Load older entries</button></> : null}
      </p>
    </section>
  );
}
