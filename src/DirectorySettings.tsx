// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { CheckCircle2, Plus, Save, Search, Trash2, Upload, Wifi, XCircle } from 'lucide-react';
import { api } from './api';
import type { DirectoryLookupResult, DirectorySettings, DirectorySettingsDraft, DirectorySettingsResponse, DirectoryTestResult, UserRole } from './types';

const ROLES: UserRole[] = ['Viewer', 'Operator', 'Admin'];

function Card({ step, title, description, aside, children }: { step: number; title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ac-card">
      <header className="ac-card-head">
        <div className="ac-step-title">
          <span className="ac-step-num" aria-hidden="true">{step}</span>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {aside}
      </header>
      <div className="ac-card-body">{children}</div>
    </section>
  );
}

function Field({ label, hint, locked, children }: { label: ReactNode; hint?: ReactNode; locked?: boolean; children: ReactNode }) {
  return (
    <label className="ac-field">
      <span>{label}{locked ? <b className="ac-lock">Set in .env</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function DirectorySettingsPanel() {
  const [loaded, setLoaded] = useState<DirectorySettingsResponse | null>(null);
  const [draft, setDraft] = useState<DirectorySettings | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DirectoryTestResult | null>(null);
  const [lookupName, setLookupName] = useState('');
  const [lookupResult, setLookupResult] = useState<DirectoryLookupResult | null>(null);

  useEffect(() => {
    api.getDirectorySettings()
      .then((response) => { setLoaded(response); setDraft(response.settings); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load directory settings.'));
  }, []);

  if (!draft || !loaded) {
    return error ? <div className="error-banner">{error}</div> : null;
  }

  const isLocked = (key: string) => loaded.locked.includes(key);
  const update = <K extends keyof DirectorySettings>(key: K, value: DirectorySettings[K]) => setDraft({ ...draft, [key]: value });

  function buildDraft(): DirectorySettingsDraft {
    return { ...draft!, bindPassword: newPassword || undefined, clearBindPassword: clearPassword || undefined };
  }

  async function run<T>(label: string, action: () => Promise<T>, onDone: (value: T) => void) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      onDone(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  function save() {
    void run('save', () => api.saveDirectorySettings(buildDraft()), (response) => {
      setLoaded(response);
      setDraft(response.settings);
      setNewPassword('');
      setClearPassword(false);
      setNotice('Directory settings saved. They apply to the next sign-in; no restart needed.');
    });
  }

  function loadCertFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError('Certificate file is too large (max 64 KB).');
      return;
    }
    void file.text().then((text) => update('caCert', text.trim()));
  }

  const passwordState = clearPassword ? 'Will be removed on save' : newPassword ? 'Will be replaced on save' : loaded.hasBindPassword ? 'Saved' : 'Not set';
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.settings) || Boolean(newPassword) || clearPassword;
  const discard = () => { setDraft(loaded.settings); setNewPassword(''); setClearPassword(false); };
  const updateRule = (index: number, patch: Partial<DirectorySettings['groupRoles'][number]>) =>
    update('groupRoles', draft.groupRoles.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="ac-dir">
      <div className="ac-dir-intro">
        <p>Let people sign in with their Active Directory account. Changes apply at the next sign-in; no restart needed.</p>
        <span className="ac-sub">{loaded.updatedAt ? `Last changed ${new Date(loaded.updatedAt).toLocaleString('en-GB')} by ${loaded.updatedBy}` : 'Not configured yet'}</span>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="ac-notice">{notice}</div> : null}

      <Card
        step={1}
        title="Connection"
        description="Where the directory server is and how to reach it securely."
        aside={(
          <div className="ac-toggle">
            <span>{draft.enabled ? 'Company sign-in on' : 'Company sign-in off'}{isLocked('enabled') ? <b className="ac-lock">Set in .env</b> : null}</span>
            <button type="button" role="switch" aria-checked={draft.enabled} aria-label="Allow company users to sign in" className={draft.enabled ? 'switch on' : 'switch'} disabled={isLocked('enabled')} onClick={() => update('enabled', !draft.enabled)}>
              <span className="switch-knob" />
            </button>
          </div>
        )}
      >
        <div className="ac-grid ac-grid-host">
          <Field label="Server address" locked={isLocked('host')}>
            <input value={draft.host} disabled={isLocked('host')} placeholder="dc01.corp.local" onChange={(event) => update('host', event.target.value)} />
          </Field>
          <Field label="Port" locked={isLocked('port')} hint="Blank = default">
            <input type="number" min={0} max={65535} value={draft.port || ''} disabled={isLocked('port')} placeholder={draft.security === 'ldaps' ? '636' : '389'} onChange={(event) => update('port', Number(event.target.value) || 0)} />
          </Field>
        </div>
        <div className="ac-grid ac-grid-2">
          <Field label="Security mode" locked={isLocked('security')}>
            <select value={draft.security} disabled={isLocked('security')} onChange={(event) => update('security', event.target.value as DirectorySettings['security'])}>
              <option value="ldaps">Encrypted (LDAPS)</option>
              <option value="starttls">Encrypted (StartTLS)</option>
              <option value="none">Unencrypted - lab only</option>
            </select>
          </Field>
          <Field label="Timeout (seconds)">
            <input type="number" min={2} max={60} value={draft.timeoutSeconds} onChange={(event) => update('timeoutSeconds', Number(event.target.value) || 8)} />
          </Field>
        </div>
        {draft.security === 'none' ? <div className="error-banner">Unencrypted mode sends passwords across the network in plain text. Use it only in a test lab.</div> : null}
        <Field label="Trusted certificate (PEM)" locked={isLocked('caCert')} hint="Only needed if your directory uses an internal certificate authority.">
          <textarea rows={4} value={draft.caCert} disabled={isLocked('caCert')} placeholder="-----BEGIN CERTIFICATE-----" onChange={(event) => update('caCert', event.target.value)} />
        </Field>
        {isLocked('caCert') ? null : (
          <div className="ac-actions">
            <label className="ac-btn ac-file-btn"><Upload size={16} /> Upload certificate<input type="file" accept=".pem,.crt,.cer" onChange={loadCertFile} hidden /></label>
            {draft.caCert ? <button type="button" className="ac-btn danger" onClick={() => update('caCert', '')}>Remove certificate</button> : null}
          </div>
        )}
      </Card>

      <Card step={2} title="Service account" description="A read-only account the app uses to look people up." aside={<span className={`ac-status ${loaded.hasBindPassword || newPassword ? 'ok' : 'muted'}`}>Password: {passwordState}</span>}>
        <div className="ac-grid ac-grid-2">
          <Field label="Account name" locked={isLocked('bindDN')} hint="Full DN or user@domain.">
            <input value={draft.bindDN} disabled={isLocked('bindDN')} placeholder="CN=svc-soc,OU=Service,DC=corp,DC=local" autoComplete="off" onChange={(event) => update('bindDN', event.target.value)} />
          </Field>
          <Field label="Password" locked={isLocked('bindPassword')} hint={loaded.hasBindPassword ? 'Leave blank to keep the saved password. It is never shown.' : undefined}>
            <input type="password" value={newPassword} disabled={isLocked('bindPassword') || clearPassword} placeholder={loaded.hasBindPassword ? '••••••••' : ''} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} />
          </Field>
        </div>
        {loaded.hasBindPassword && !isLocked('bindPassword') ? (
          <label className="ac-check"><input type="checkbox" checked={clearPassword} onChange={(event) => { setClearPassword(event.target.checked); setNewPassword(''); }} /> Remove saved password</label>
        ) : null}
      </Card>

      <Card step={3} title="User search & filter" description="Where to look for people and how they type their name.">
        <Field label="Search starting point (Base DN)" locked={isLocked('baseDN')}>
          <input value={draft.baseDN} disabled={isLocked('baseDN')} placeholder="OU=Staff,DC=corp,DC=local" onChange={(event) => update('baseDN', event.target.value)} />
        </Field>
        <div className="ac-grid ac-grid-2">
          <Field label="Sign-in format" locked={isLocked('loginAttribute')}>
            <select value={draft.loginAttribute} disabled={isLocked('loginAttribute')} onChange={(event) => update('loginAttribute', event.target.value as DirectorySettings['loginAttribute'])}>
              <option value="sAMAccountName">Short name (jsmith)</option>
              <option value="userPrincipalName">Email-style (jsmith@corp.com)</option>
              <option value="custom">Custom filter (advanced)</option>
            </select>
          </Field>
          <Field label="Only allow members of group" hint="Optional. Group name or full DN; direct membership only.">
            <input value={draft.requiredGroup} placeholder="SOC-Team" onChange={(event) => update('requiredGroup', event.target.value)} />
          </Field>
        </div>
        {draft.loginAttribute === 'custom' ? (
          <Field label="Custom search filter" locked={isLocked('customFilter')} hint={<>Must contain <code>{'{username}'}</code>.</>}>
            <input value={draft.customFilter} disabled={isLocked('customFilter')} placeholder="(&(objectClass=user)(sAMAccountName={username}))" onChange={(event) => update('customFilter', event.target.value)} />
          </Field>
        ) : null}
      </Card>

      <Card step={4} title="Default roles & group mappings" description="What access people get when they sign in.">
        <div className="ac-grid ac-grid-2">
          <Field label="New company users">
            <select value={draft.newUserMode} onChange={(event) => update('newUserMode', event.target.value as DirectorySettings['newUserMode'])}>
              <option value="approval">Wait for Admin approval</option>
              <option value="auto">Let in straight away</option>
            </select>
          </Field>
          <Field label="Starting role">
            <select value={draft.defaultRole} onChange={(event) => update('defaultRole', event.target.value as UserRole)}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </Field>
        </div>
        <div className="ac-subsection">
          <div className="ac-subsection-head">
            <div>
              <h3>Group → role mapping</h3>
              <p className="ac-sub">Checked at every sign-in. Mapped people skip approval; highest matching role wins; blocked accounts stay blocked.</p>
            </div>
            <button type="button" className="ac-btn" onClick={() => update('groupRoles', [...draft.groupRoles, { group: '', role: 'Operator' }])}><Plus size={16} /> Add mapping</button>
          </div>
          {draft.groupRoles.length === 0 ? <div className="ac-empty">No group mappings yet.</div> : (
            <div className="ac-rules">
              {draft.groupRoles.map((rule, index) => (
                <div className="ac-rule" key={index}>
                  <input value={rule.group} placeholder="Group name, e.g. SOC-Leads" aria-label={`Group for mapping ${index + 1}`} onChange={(event) => updateRule(index, { group: event.target.value })} />
                  <span className="ac-arrow" aria-hidden="true">→</span>
                  <select value={rule.role} aria-label={`Role for mapping ${index + 1}`} onChange={(event) => updateRule(index, { role: event.target.value as UserRole })}>
                    {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                  <button type="button" className="ac-icon-btn danger" aria-label="Remove mapping" title="Remove mapping" onClick={() => update('groupRoles', draft.groupRoles.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card step={5} title="Connection testing" description="Uses the values on screen, even before you save.">
        <div className="ac-test-row">
          <button type="button" className="ac-btn" disabled={Boolean(busy)} onClick={() => void run('test', () => api.testDirectory(buildDraft()), setTestResult)}><Wifi size={16} /> {busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        </div>
        {testResult ? (
          <ul className="ac-steps">
            {testResult.steps.map((step) => (
              <li key={step.label} className={step.ok ? 'ok' : 'fail'}>
                {step.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                <div><strong>{step.label}</strong><span>{step.detail}</span></div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="ac-subsection">
          <h3>Look up a user</h3>
          <form className="ac-lookup" onSubmit={(event) => { event.preventDefault(); void run('lookup', () => api.lookupDirectoryUser(buildDraft(), lookupName), setLookupResult); }}>
            <input value={lookupName} placeholder="Username, e.g. jsmith" aria-label="Username to look up" onChange={(event) => setLookupName(event.target.value)} />
            <button type="submit" className="ac-btn" disabled={Boolean(busy) || !lookupName.trim()}><Search size={16} /> {busy === 'lookup' ? 'Looking up…' : 'Look up'}</button>
          </form>
          {lookupResult ? (
            lookupResult.found ? (
              <dl className="ac-lookup-result">
                <dt>Name</dt><dd>{lookupResult.displayName || '—'}</dd>
                <dt>Email</dt><dd>{lookupResult.email || '—'}</dd>
                <dt>Directory entry</dt><dd className="ac-dn">{lookupResult.dn}</dd>
                <dt>Groups</dt><dd>{lookupResult.groups?.length ? lookupResult.groups.map((group) => <span key={group} className="ac-chip">{group}</span>) : 'None'}</dd>
                <dt>Allowed in?</dt><dd><span className={`ac-status ${lookupResult.allowed ? 'ok' : 'bad'}`}>{lookupResult.allowed ? 'Yes' : 'No - not in the required group'}</span></dd>
                <dt>On first sign-in</dt><dd>{lookupResult.roleOnSignIn}{lookupResult.needsApproval ? ', waiting for Admin approval' : ', active straight away'}</dd>
              </dl>
            ) : <div className="error-banner">{lookupResult.message}</div>
          ) : null}
        </div>
      </Card>

      <div className={dirty ? 'ac-savebar dirty' : 'ac-savebar'}>
        <span>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <div className="ac-actions">
          <button type="button" className="ac-btn" disabled={Boolean(busy) || !dirty} onClick={discard}>Discard</button>
          <button type="button" className="ac-btn primary" disabled={Boolean(busy) || !dirty} onClick={save}><Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save Directory Settings'}</button>
        </div>
      </div>
    </div>
  );
}
