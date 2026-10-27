// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client, InvalidCredentialsError } = require('ldapts');

const ROLE_RANK = { Viewer: 1, Operator: 2, Admin: 3 };
const SECURITY_MODES = ['ldaps', 'starttls', 'none'];
const LOGIN_ATTRIBUTES = ['sAMAccountName', 'userPrincipalName', 'custom'];
const NEW_USER_MODES = ['approval', 'auto'];
const HOST_PATTERN = /^[A-Za-z0-9.:-]{1,253}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
const MAX_TEXT = 1024;
const MAX_CERT = 64 * 1024;
const MAX_GROUP_RULES = 50;
const LDAP_NO_SUCH_OBJECT = 32;
const LDAP_SIZE_LIMIT_EXCEEDED = 4;

const DEFAULT_SETTINGS = {
  enabled: false,
  host: '',
  port: 0,
  security: 'ldaps',
  caCert: '',
  timeoutSeconds: 8,
  bindDN: '',
  baseDN: '',
  loginAttribute: 'sAMAccountName',
  customFilter: '',
  requiredGroup: '',
  newUserMode: 'approval',
  defaultRole: 'Viewer',
  groupRoles: [],
};

class DirectoryError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createDirectory({ db, env, dataDir }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS directory_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      bind_password TEXT NOT NULL DEFAULT '',
      updated_at TEXT,
      updated_by TEXT
    );
  `);

  const envConfig = readEnvOverrides(env);
  const encryptionKey = loadEncryptionKey(env, dataDir);
  const allowInsecure = env.LDAP_ALLOW_INSECURE === 'true';
  const INSECURE_BLOCKED = 'Unencrypted LDAP would send passwords in clear text. Use LDAPS or StartTLS, or set LDAP_ALLOW_INSECURE=true on the server (lab only).';

  function loadSaved() {
    const row = db.prepare('SELECT data, bind_password, updated_at, updated_by FROM directory_settings WHERE id = 1').get();
    if (!row) {
      return { settings: { ...DEFAULT_SETTINGS }, bindPassword: '', updatedAt: null, updatedBy: null };
    }
    let parsed = {};
    try {
      parsed = JSON.parse(row.data);
    } catch {
      parsed = {};
    }
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed },
      bindPassword: row.bind_password ? decrypt(row.bind_password, encryptionKey) : '',
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  // Draft values let Admins test settings before saving; .env values always win.
  function effectiveConfig(draft) {
    const saved = loadSaved();
    const base = draft ? { ...saved.settings, ...validateSettings(draft) } : saved.settings;
    const draftPassword = typeof draft?.bindPassword === 'string' && draft.bindPassword ? draft.bindPassword : null;
    return {
      ...base,
      ...envConfig.overrides,
      bindPassword: envConfig.bindPassword ?? draftPassword ?? saved.bindPassword,
    };
  }

  function isEnabled() {
    const config = effectiveConfig();
    return Boolean(config.enabled && config.host && config.baseDN);
  }

  function getForAdmin() {
    const saved = loadSaved();
    return {
      settings: { ...saved.settings, ...envConfig.overrides },
      hasBindPassword: Boolean(envConfig.bindPassword ?? saved.bindPassword),
      locked: envConfig.locked,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
    };
  }

  function save(input, actor) {
    const saved = loadSaved();
    const next = validateSettings(input);
    if (next.security === 'none' && !allowInsecure) {
      throw new DirectoryError(400, INSECURE_BLOCKED);
    }
    if (next.enabled && (!next.host || !next.baseDN) && !(envConfig.overrides.host && envConfig.overrides.baseDN)) {
      throw new DirectoryError(400, 'Server address and search starting point are required to turn company sign-in on.');
    }
    let bindPassword = saved.bindPassword;
    if (input?.clearBindPassword === true) {
      bindPassword = '';
    } else if (typeof input?.bindPassword === 'string' && input.bindPassword) {
      if (input.bindPassword.length > 256) {
        throw new DirectoryError(400, 'Service account password is too long.');
      }
      bindPassword = input.bindPassword;
    }
    db.prepare(`
      INSERT INTO directory_settings (id, data, bind_password, updated_at, updated_by) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, bind_password = excluded.bind_password,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(JSON.stringify(next), bindPassword ? encrypt(bindPassword, encryptionKey) : '', new Date().toISOString(), actor);

    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(saved.settings[key]));
    if (bindPassword !== saved.bindPassword) {
      changed.push('bindPassword');
    }
    console.log(`[auth] Admin "${actor}" updated directory settings: ${changed.length ? changed.join(', ') : 'no changes'}.`);
    return getForAdmin();
  }

  async function withClient(config, work) {
    if (!config.host) {
      throw new DirectoryError(400, 'Server address is not set.');
    }
    if (config.security === 'none' && !allowInsecure) {
      throw new DirectoryError(400, INSECURE_BLOCKED);
    }
    const tlsOptions = { rejectUnauthorized: true };
    if (config.caCert) {
      tlsOptions.ca = [config.caCert];
    }
    const scheme = config.security === 'ldaps' ? 'ldaps' : 'ldap';
    const port = config.port || (scheme === 'ldaps' ? 636 : 389);
    const host = config.host.includes(':') ? `[${config.host}]` : config.host;
    const client = new Client({
      url: `${scheme}://${host}:${port}`,
      timeout: config.timeoutSeconds * 1000,
      connectTimeout: config.timeoutSeconds * 1000,
      tlsOptions,
    });
    try {
      if (config.security === 'starttls') {
        await client.startTLS(tlsOptions);
      }
      return await work(client);
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  async function bindServiceAccount(client, config) {
    if (config.bindDN) {
      await client.bind(config.bindDN, config.bindPassword);
    }
  }

  async function findUser(client, config, username) {
    let entries;
    try {
      ({ searchEntries: entries } = await client.search(config.baseDN, {
        scope: 'sub',
        filter: buildUserFilter(config, username),
        attributes: ['mail', 'displayName', 'memberOf'],
        sizeLimit: 2,
      }));
    } catch (error) {
      if (error?.code === LDAP_SIZE_LIMIT_EXCEEDED) {
        return { entry: null, reason: 'More than one directory account matches that name.' };
      }
      throw error;
    }
    if (entries.length === 0) {
      return { entry: null, reason: 'No directory account matches that name.' };
    }
    if (entries.length > 1) {
      return { entry: null, reason: 'More than one directory account matches that name.' };
    }
    return { entry: entries[0], reason: '' };
  }

  function decideAccess(config, memberOf) {
    const allowed = !config.requiredGroup || memberOf.some((dn) => groupMatches(dn, config.requiredGroup));
    let mappedRole = null;
    for (const rule of config.groupRoles) {
      if (memberOf.some((dn) => groupMatches(dn, rule.group)) && (!mappedRole || ROLE_RANK[rule.role] > ROLE_RANK[mappedRole])) {
        mappedRole = rule.role;
      }
    }
    const newUserActive = Boolean(mappedRole) || config.newUserMode === 'auto';
    return {
      allowed,
      mappedRole,
      newUserRole: mappedRole || config.defaultRole,
      newUserStatus: newUserActive ? 'active' : 'inactive',
    };
  }

  async function authenticate(username, password) {
    const config = effectiveConfig();
    try {
      return await withClient(config, async (client) => {
        await bindServiceAccount(client, config);
        const { entry } = await findUser(client, config, username);
        if (!entry) {
          return null;
        }
        try {
          await client.bind(entry.dn, password);
        } catch (error) {
          if (error instanceof InvalidCredentialsError) {
            return null;
          }
          throw error;
        }
        const memberOf = allValues(entry.memberOf);
        return {
          email: firstValue(entry.mail),
          displayName: firstValue(entry.displayName),
          ...decideAccess(config, memberOf),
        };
      });
    } catch (error) {
      console.error('[auth] LDAP sign-in failed:', describeLdapError(error));
      throw new DirectoryError(503, 'The company directory could not be reached. Please try again later.');
    }
  }

  async function testConnection(draft) {
    const config = effectiveConfig(draft);
    const steps = [];
    try {
      await withClient(config, async (client) => {
        try {
          await bindServiceAccount(client, config);
          if (!config.bindDN) {
            // Anonymous: force a round trip so connection problems surface in this step.
            await client.search('', { scope: 'base', filter: '(objectClass=*)', attributes: ['namingContexts'] });
          }
        } catch (error) {
          if (error instanceof InvalidCredentialsError) {
            steps.push({ label: 'Connect to server', ok: true, detail: 'Connected.' });
            steps.push({ label: 'Service account sign-in', ok: false, detail: describeLdapError(error) });
            return;
          }
          steps.push({ label: 'Connect to server', ok: false, detail: describeLdapError(error) });
          return;
        }
        steps.push({ label: 'Connect to server', ok: true, detail: config.security === 'none' ? 'Connected (unencrypted).' : 'Connected securely.' });
        steps.push({ label: 'Service account sign-in', ok: true, detail: config.bindDN ? 'Accepted.' : 'No service account set; using anonymous access.' });
        try {
          await client.search(config.baseDN, { scope: 'base', filter: '(objectClass=*)', attributes: ['distinguishedName'] });
          steps.push({ label: 'Search starting point', ok: true, detail: 'Found.' });
        } catch (error) {
          steps.push({ label: 'Search starting point', ok: false, detail: describeLdapError(error) });
        }
      });
    } catch (error) {
      steps.push({ label: 'Connect to server', ok: false, detail: describeLdapError(error) });
    }
    return { ok: steps.length > 0 && steps.every((step) => step.ok), steps };
  }

  async function lookupUser(draft, username) {
    const name = typeof username === 'string' ? username.trim() : '';
    if (!USERNAME_PATTERN.test(name)) {
      throw new DirectoryError(400, 'Enter a valid username to look up.');
    }
    const config = effectiveConfig(draft);
    try {
      return await withClient(config, async (client) => {
        await bindServiceAccount(client, config);
        const { entry, reason } = await findUser(client, config, name);
        if (!entry) {
          return { found: false, message: reason };
        }
        const memberOf = allValues(entry.memberOf);
        const access = decideAccess(config, memberOf);
        return {
          found: true,
          dn: entry.dn,
          displayName: firstValue(entry.displayName),
          email: firstValue(entry.mail),
          groups: memberOf.map(groupName),
          allowed: access.allowed,
          roleOnSignIn: access.newUserRole,
          needsApproval: access.newUserStatus !== 'active',
        };
      });
    } catch (error) {
      if (error instanceof DirectoryError) {
        throw error;
      }
      return { found: false, message: describeLdapError(error) };
    }
  }

  return { isEnabled, getForAdmin, save, authenticate, testConnection, lookupUser };
}

function validateSettings(input) {
  const out = {};
  out.enabled = input?.enabled === true;
  out.host = str(input?.host);
  if (out.host && !HOST_PATTERN.test(out.host)) {
    fail('Server address may only contain letters, numbers, dots, dashes and colons.');
  }
  out.port = Number.parseInt(String(input?.port ?? 0), 10) || 0;
  if (out.port < 0 || out.port > 65535) {
    fail('Port must be between 1 and 65535 (or blank for the default).');
  }
  out.security = oneOf(input?.security, SECURITY_MODES, 'Unknown security mode.');
  out.caCert = String(input?.caCert ?? '').trim();
  if (out.caCert) {
    if (out.caCert.length > MAX_CERT || !out.caCert.includes('-----BEGIN CERTIFICATE-----')) {
      fail('Trusted certificate must be a PEM file (starting with -----BEGIN CERTIFICATE-----).');
    }
    try {
      new crypto.X509Certificate(out.caCert);
    } catch {
      fail('Trusted certificate could not be read. Check that it is a valid PEM certificate.');
    }
  }
  out.timeoutSeconds = Number.parseInt(String(input?.timeoutSeconds ?? 8), 10);
  if (!Number.isFinite(out.timeoutSeconds) || out.timeoutSeconds < 2 || out.timeoutSeconds > 60) {
    fail('Timeout must be between 2 and 60 seconds.');
  }
  out.bindDN = str(input?.bindDN);
  out.baseDN = str(input?.baseDN);
  out.loginAttribute = oneOf(input?.loginAttribute, LOGIN_ATTRIBUTES, 'Unknown sign-in name type.');
  out.customFilter = str(input?.customFilter);
  if (out.loginAttribute === 'custom' && (!out.customFilter.startsWith('(') || !out.customFilter.includes('{username}'))) {
    fail('Custom filter must start with "(" and contain {username}.');
  }
  out.requiredGroup = str(input?.requiredGroup);
  out.newUserMode = oneOf(input?.newUserMode, NEW_USER_MODES, 'Unknown new-user handling.');
  out.defaultRole = oneOf(input?.defaultRole, Object.keys(ROLE_RANK), 'Unknown starting role.');
  const rules = Array.isArray(input?.groupRoles) ? input.groupRoles : [];
  if (rules.length > MAX_GROUP_RULES) {
    fail(`At most ${MAX_GROUP_RULES} group rules are allowed.`);
  }
  out.groupRoles = rules
    .map((rule) => ({ group: str(rule?.group), role: rule?.role }))
    .filter((rule) => rule.group)
    .map((rule) => ({ group: rule.group, role: oneOf(rule.role, Object.keys(ROLE_RANK), 'Unknown role in group rules.') }));
  return out;
}

function readEnvOverrides(env) {
  const overrides = {};
  if (env.LDAP_URL) {
    const url = new URL(env.LDAP_URL);
    overrides.enabled = true;
    overrides.host = url.hostname.replace(/^\[|\]$/g, '');
    overrides.port = Number(url.port) || 0;
    if (url.protocol === 'ldaps:') {
      overrides.security = 'ldaps';
    } else if (env.LDAP_STARTTLS === 'true') {
      overrides.security = 'starttls';
    } else if (env.LDAP_ALLOW_INSECURE === 'true') {
      overrides.security = 'none';
    } else {
      throw new Error('LDAP_URL uses plain ldap:// which would send passwords unencrypted. Use ldaps://, set LDAP_STARTTLS=true, or (lab only) LDAP_ALLOW_INSECURE=true.');
    }
  }
  if (env.LDAP_CA_CERT_PATH) {
    overrides.caCert = fs.readFileSync(env.LDAP_CA_CERT_PATH, 'utf8');
  }
  if (env.LDAP_BIND_DN) {
    overrides.bindDN = env.LDAP_BIND_DN;
  }
  if (env.LDAP_BASE_DN) {
    overrides.baseDN = env.LDAP_BASE_DN;
  }
  if (env.LDAP_USER_FILTER) {
    overrides.loginAttribute = 'custom';
    overrides.customFilter = env.LDAP_USER_FILTER;
  }
  const bindPassword = env.LDAP_BIND_PASSWORD || null;
  const locked = Object.keys(overrides);
  if (bindPassword) {
    locked.push('bindPassword');
  }
  return { overrides, bindPassword, locked };
}

function loadEncryptionKey(env, dataDir) {
  if (env.SETTINGS_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(env.SETTINGS_ENCRYPTION_KEY).digest();
  }
  // Keeps secrets unreadable in database copies/backups that do not include this file.
  const keyPath = path.join(dataDir, '.auth-secret.key');
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  }
  return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored, key) {
  try {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1') {
      return '';
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    console.error('[auth] Could not decrypt the saved service account password (encryption key changed?). Re-enter it in Users > Directory settings.');
    return '';
  }
}

function buildUserFilter(config, username) {
  const value = escapeLdapFilter(username);
  if (config.loginAttribute === 'userPrincipalName') {
    return `(&(objectCategory=person)(objectClass=user)(userPrincipalName=${value}))`;
  }
  if (config.loginAttribute === 'custom') {
    return config.customFilter.split('{username}').join(value);
  }
  return `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${value}))`;
}

// Matches a group by full DN or by its common name (e.g. "SOC-Team"); nested groups are not expanded.
function groupMatches(memberDn, spec) {
  const wanted = spec.trim().toLowerCase();
  return memberDn.toLowerCase() === wanted || groupName(memberDn).toLowerCase() === wanted;
}

function groupName(dn) {
  const first = dn.split(/(?<!\\),/)[0] || '';
  const index = first.indexOf('=');
  return index >= 0 ? first.slice(index + 1).trim() : first.trim();
}

function describeLdapError(error) {
  const code = String(error?.code ?? '');
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof InvalidCredentialsError) return 'The service account name or password was rejected.';
  if (error?.code === LDAP_NO_SUCH_OBJECT) return 'The search starting point does not exist in the directory.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The server name could not be found.';
  if (code === 'ECONNREFUSED') return 'The server refused the connection. Check the address, port and security mode.';
  if (code === 'ECONNRESET') return 'The server closed the connection. Check the security mode and port.';
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) return 'The server did not answer in time.';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altnames/i.test(code + message)) return `The server certificate is not trusted (${message}). Upload your company CA certificate or check the server address.`;
  return message;
}

// RFC 4515 escaping so user input cannot alter the LDAP search filter.
function escapeLdapFilter(value) {
  return value.replace(/[\\*()\0]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function allValues(value) {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map((item) => (Buffer.isBuffer(item) ? item.toString('utf8') : String(item)));
}

function firstValue(value) {
  return allValues(value)[0] ?? '';
}

function str(value) {
  const text = String(value ?? '').trim();
  if (text.length > MAX_TEXT) {
    fail('One of the values is too long.');
  }
  return text;
}

function oneOf(value, allowed, message) {
  if (!allowed.includes(value)) {
    fail(message);
  }
  return value;
}

function fail(message) {
  throw new DirectoryError(400, message);
}

module.exports = { createDirectory };
