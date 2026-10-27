// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, UserPlus, X } from 'lucide-react';
import { api } from './api';
import type { ManagedUser, ManagedUserList, UserRole, UserStatus } from './types';

const defaultForm = { username: '', email: '', password: '', role: 'Viewer' as UserRole };

function statusOf(user: ManagedUser): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (user.status === 'active') return { label: 'Active', tone: 'ok' };
  return user.accountType === 'ldap' && !user.lastLoginAt ? { label: 'Awaiting approval', tone: 'warn' } : { label: 'Blocked', tone: 'bad' };
}

function AddUserModal({ roles, onClose, onCreate }: { roles: UserRole[]; onClose: () => void; onCreate: (form: typeof defaultForm) => Promise<string | null> }) {
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(await onCreate(form));
    setBusy(false);
  }

  return (
    <div className="ac-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ac-modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <header className="ac-modal-head">
          <h2 id="add-user-title"><UserPlus size={18} /> Add local user</h2>
          <button type="button" className="ac-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <form className="ac-modal-body" onSubmit={(event) => void submit(event)}>
          <label className="ac-field">
            <span>Username</span>
            <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" autoFocus required />
          </label>
          <label className="ac-field">
            <span>Email <em>(optional)</em></span>
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="off" />
          </label>
          <label className="ac-field">
            <span>Temporary password</span>
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength={12} required />
            <small>At least 12 characters. Share it with the user securely.</small>
          </label>
          <label className="ac-field">
            <span>Role</span>
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>
              {roles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <footer className="ac-modal-foot">
            <button type="button" className="ac-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="ac-btn primary" disabled={busy}><Plus size={16} /> {busy ? 'Adding…' : 'Add user'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function UserManagementTab({ currentUserId }: { currentUserId: number }) {
  const [data, setData] = useState<ManagedUserList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.listUsers().then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load users.'));
  }, []);

  function updateUser(id: number, payload: { role?: UserRole; status?: UserStatus }) {
    setBusy(true);
    setError(null);
    api.updateUser(id, payload)
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Request failed.'))
      .finally(() => setBusy(false));
  }

  async function createUser(form: typeof defaultForm) {
    try {
      setData(await api.createUser(form));
      setAdding(false);
      return null;
    } catch (caught) {
      return caught instanceof Error ? caught.message : 'Could not add the user.';
    }
  }

  const roles = data?.roles ?? ['Admin', 'Operator', 'Viewer'];
  const users = data?.users ?? [];
  const pending = users.filter((user) => statusOf(user).tone === 'warn').length;

  return (
    <section className="ac-card">
      <header className="ac-card-head">
        <div>
          <h2>Users</h2>
          <p>{users.length} accounts{pending ? ` · ${pending} awaiting approval` : ''}</p>
        </div>
        <button type="button" className="ac-btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add Local User</button>
      </header>
      {error ? <div className="error-banner ac-inset">{error}</div> : null}
      <div className="ac-table-wrap">
        <table className="ac-table">
          <thead>
            <tr><th>Username</th><th>Name / email</th><th>Type</th><th>Role</th><th>Status</th><th className="ta-r">Actions</th></tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const status = statusOf(user);
              return (
                <tr key={user.id}>
                  <td><strong>{user.username}</strong>{isSelf ? <span className="ac-you">You</span> : null}</td>
                  <td>
                    <div>{user.displayName || '—'}</div>
                    {user.email ? <div className="ac-sub">{user.email}</div> : null}
                  </td>
                  <td><span className="ac-chip">{user.accountType === 'ldap' ? 'Company (AD)' : 'Local'}</span></td>
                  <td>
                    <select className="ac-inline-select" value={user.role} disabled={busy || isSelf} onChange={(event) => updateUser(user.id, { role: event.target.value as UserRole })} aria-label={`Role for ${user.username}`}>
                      {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </td>
                  <td><span className={`ac-status ${status.tone}`}>{status.label}</span></td>
                  <td className="ta-r">
                    {isSelf ? <span className="ac-sub">—</span> : user.status === 'active'
                      ? <button type="button" className="ac-btn danger" disabled={busy} onClick={() => updateUser(user.id, { status: 'inactive' })}>Block</button>
                      : <button type="button" className="ac-btn" disabled={busy} onClick={() => updateUser(user.id, { status: 'active' })}>{status.tone === 'warn' ? 'Approve' : 'Unblock'}</button>}
                  </td>
                </tr>
              );
            })}
            {data && users.length === 0 ? <tr><td colSpan={6} className="ac-empty">No users yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="ac-foot-note">Company (Active Directory) users appear here after their first sign-in attempt.</p>
      {adding ? <AddUserModal roles={roles} onClose={() => setAdding(false)} onCreate={createUser} /> : null}
    </section>
  );
}
