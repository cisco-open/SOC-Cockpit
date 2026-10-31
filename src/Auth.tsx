// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import ciscoLogo from './assets/Cisco_Logo_no_TM_White-RGB.svg';
import { App } from './App';
import { AUTH_EXPIRED_EVENT, api } from './api';
import type { AuthStatus, AuthUser } from './types';

function errorText(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('soc-theme') === 'night' ? 'night' : 'day';
  }, []);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <header className="auth-card-head">
          <img src={ciscoLogo} alt="Cisco" className="brand-logo" />
          <span className="brand-name">SOC COCKPIT</span>
        </header>
        <div className="auth-card-body">
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ ldapEnabled, onSignedIn }: { ldapEnabled: boolean; onSignedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(username, password);
      setPassword('');
      onSignedIn(user);
    } catch (caught) {
      setError(errorText(caught, 'Sign-in failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle={ldapEnabled ? 'Use your SOC Cockpit account or your company (Active Directory) account.' : undefined}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-btn" type="submit" disabled={busy}><LogIn size={14} /> {busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthShell>
  );
}

function SetupScreen({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [form, setForm] = useState({ setupCode: '', username: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.setup({ setupCode: form.setupCode, username: form.username, email: form.email, password: form.password });
      onSignedIn(user);
    } catch (caught) {
      setError(errorText(caught, 'Setup failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="First-time setup" subtitle="Create the first administrator account. The setup code is printed in the server console when the app starts.">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Setup code</span>
          <input value={form.setupCode} onChange={(event) => setForm({ ...form, setupCode: event.target.value })} autoComplete="off" required />
        </label>
        <label className="field">
          <span>Admin username</span>
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
        </label>
        <label className="field">
          <span>Email (optional)</span>
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" />
        </label>
        <label className="field">
          <span>Password (at least 12 characters)</span>
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength={12} required />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} autoComplete="new-password" minLength={12} required />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-btn" type="submit" disabled={busy}><ShieldCheck size={14} /> {busy ? 'Creating…' : 'Create admin account'}</button>
      </form>
    </AuthShell>
  );
}

export function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.authStatus()
      .then(setStatus)
      .catch((caught) => setLoadError(errorText(caught, 'Could not reach the server.')));

    const onExpired = () => setStatus((current) => (current ? { ...current, user: null } : current));
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  if (loadError) {
    return <AuthShell title="Unavailable"><div className="error-banner">{loadError}</div></AuthShell>;
  }
  if (!status) {
    return <AuthShell title="Loading…" />;
  }
  if (status.setupRequired) {
    return <SetupScreen onSignedIn={(user) => setStatus({ ...status, setupRequired: false, user })} />;
  }
  if (!status.user) {
    return <LoginScreen ldapEnabled={status.ldapEnabled} onSignedIn={(user) => setStatus({ ...status, user })} />;
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    setStatus((current) => (current ? { ...current, user: null } : current));
  }

  return <App key={status.user.id} user={status.user} onSignOut={() => void signOut()} />;
}
