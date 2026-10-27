// SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { createDirectory } = require('./directory.cjs');

const scrypt = promisify(crypto.scrypt);

const ROLE_NAMES = ['Admin', 'Operator', 'Viewer'];
const ROLE_DESCRIPTIONS = {
  Admin: 'Full access, including user management',
  Operator: 'View and edit cockpit data',
  Viewer: 'Read-only access',
};
const ACCOUNT_STATUSES = ['active', 'inactive'];
// OWASP-recommended scrypt cost (N=2^17, r=8, p=1); ~128 MB per hash.
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const CSRF_HEADER_VALUE = 'soc-cockpit';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const INVALID_LOGIN_MESSAGE = 'Invalid username or password.';

class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createAuth({ dbPath, env, isProduction }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  initAuthSchema(db);

  const directory = createDirectory({ db, env, dataDir: path.dirname(dbPath) });
  const cookieSecure = env.SESSION_COOKIE_SECURE ? env.SESSION_COOKIE_SECURE === 'true' : isProduction;
  const cookieName = cookieSecure ? '__Host-soc_session' : 'soc_session';
  const sessionTtlMs = Math.max(1, Number(env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000;
  const failures = new Map();
  let setupCode = null;
  let dummyHashPromise = null;

  refreshSetupCode();

  function refreshSetupCode() {
    if (countUsers() > 0) {
      setupCode = null;
      return;
    }
    setupCode = crypto.randomBytes(8).toString('hex');
    console.log(`[auth] No users exist yet. Open the app and complete first-time setup using this code: ${setupCode}`);
  }

  function countUsers() {
    return db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  }

  function roleId(name) {
    const row = db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
    if (!row) {
      throw new AuthError(400, 'Unknown role.');
    }
    return row.id;
  }

  function findUserByUsername(username) {
    return db.prepare(`
      SELECT u.id, u.username, u.email, u.display_name, u.account_type, u.status, u.password_hash, r.name AS role
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = ?
    `).get(username);
  }

  function listUsers() {
    return db.prepare(`
      SELECT u.id, u.username, u.email, u.display_name AS displayName, u.account_type AS accountType,
             u.status, r.name AS role, u.created_at AS createdAt, u.last_login_at AS lastLoginAt
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.username COLLATE NOCASE
    `).all();
  }

  function countOtherActiveAdmins(excludeUserId) {
    return db.prepare(`
      SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'Admin' AND u.status = 'active' AND u.id <> ?
    `).get(excludeUserId).total;
  }

  function insertUser({ username, email, displayName = '', accountType, status, role, passwordHash = null }) {
    const result = db.prepare(`
      INSERT INTO users (username, email, display_name, account_type, status, role_id, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, email, displayName, accountType, status, roleId(role), passwordHash, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  // ---- Throttling (per IP + username) ----

  function checkThrottle(key) {
    const entry = failures.get(key);
    if (entry && entry.count >= MAX_FAILED_ATTEMPTS && entry.resetAt > Date.now()) {
      throw new AuthError(429, 'Too many failed attempts. Please wait 15 minutes and try again.');
    }
  }

  function recordFailure(key) {
    const now = Date.now();
    const entry = failures.get(key);
    if (!entry || entry.resetAt <= now) {
      failures.set(key, { count: 1, resetAt: now + LOCKOUT_MS });
    } else {
      entry.count += 1;
    }
    if (failures.size > 10000) {
      for (const [entryKey, value] of failures) {
        if (value.resetAt <= now) {
          failures.delete(entryKey);
        }
      }
    }
  }

  // ---- Sessions ----

  function cookieOptions() {
    return { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/' };
  }

  function createSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, now, now + sessionTtlMs);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date(now).toISOString(), userId);
    res.cookie(cookieName, token, { ...cookieOptions(), maxAge: sessionTtlMs });
  }

  function loadSessionUser(req) {
    const token = readCookie(req, cookieName);
    if (!token) {
      return null;
    }
    const row = db.prepare(`
      SELECT u.id, u.username, u.email, u.display_name, u.account_type, u.status, r.name AS role, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?
    `).get(sha256(token));
    if (!row || row.expires_at <= Date.now() || row.status !== 'active') {
      return null;
    }
    return publicUser(row);
  }

  // ---- Passwords ----

  async function verifyUnknownUser(password) {
    // Spend the same time as a real check so response timing does not reveal which usernames exist.
    dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex'));
    await verifyPassword(password, await dummyHashPromise);
  }

  // A directory group rule may change a role, but never remove the last active Admin.
  function applyMappedRole(user, mappedRole) {
    if (!mappedRole || mappedRole === user.role) {
      return;
    }
    if (user.role === 'Admin' && user.status === 'active' && countOtherActiveAdmins(user.id) === 0) {
      return;
    }
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(roleId(mappedRole), user.id);
    console.log(`[auth] Directory group rule changed role of "${user.username}" from ${user.role} to ${mappedRole}.`);
  }

  // ---- Middleware ----

  function requireCsrfHeader(req, _res, next) {
    // Browsers cannot attach custom headers to cross-site form posts, so this blocks CSRF.
    if (SAFE_METHODS.has(req.method) || req.get('x-requested-with') === CSRF_HEADER_VALUE) {
      next();
      return;
    }
    next(new AuthError(403, 'Request rejected: missing security header.'));
  }

  function requireAuth(req, _res, next) {
    const user = loadSessionUser(req);
    if (!user) {
      next(new AuthError(401, 'Please sign in.'));
      return;
    }
    req.user = user;
    next();
  }

  function requireRole(...allowedRoles) {
    return (req, _res, next) => {
      if (!req.user) {
        next(new AuthError(401, 'Please sign in.'));
        return;
      }
      if (!allowedRoles.includes(req.user.role)) {
        next(new AuthError(403, 'Your role does not allow this action.'));
        return;
      }
      next();
    };
  }

  // ---- Public auth routes (/api/auth) ----

  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      setupRequired: countUsers() === 0,
      ldapEnabled: directory.isEnabled(),
      user: loadSessionUser(req),
    });
  });

  router.post('/setup', async (req, res) => {
    if (countUsers() > 0) {
      throw new AuthError(403, 'Setup has already been completed.');
    }
    const throttleKey = `setup|${req.ip}`;
    checkThrottle(throttleKey);
    if (!setupCode || !safeEqual(String(req.body?.setupCode ?? '').trim(), setupCode)) {
      recordFailure(throttleKey);
      throw new AuthError(401, 'Invalid setup code. Check the server console output.');
    }
    const input = validateNewLocalUser(req.body);
    const passwordHash = await hashPassword(input.password);
    // Re-check after the async hash so two concurrent requests cannot both create an admin.
    if (countUsers() > 0) {
      throw new AuthError(403, 'Setup has already been completed.');
    }
    const userId = insertUser({ ...input, accountType: 'local', status: 'active', role: 'Admin', passwordHash });
    setupCode = null;
    failures.delete(throttleKey);
    console.log(`[auth] First admin account "${input.username}" created. Public setup is now disabled.`);
    createSession(res, userId);
    res.json({ user: publicUser(findUserByUsername(input.username)) });
  });

  router.post('/login', async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!USERNAME_PATTERN.test(username) || !password || password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthError(401, INVALID_LOGIN_MESSAGE);
    }
    const throttleKey = `login|${req.ip}|${username.toLowerCase()}`;
    checkThrottle(throttleKey);

    let user = findUserByUsername(username);
    let authenticated = false;
    let newlyRegistered = false;

    if (user?.account_type === 'local') {
      authenticated = await verifyPassword(password, user.password_hash);
    } else if (directory.isEnabled() && (!user || user.account_type === 'ldap')) {
      const profile = await directory.authenticate(username, password);
      if (profile) {
        authenticated = true;
        if (!profile.allowed) {
          failures.delete(throttleKey);
          throw new AuthError(403, 'Your company account is not in the group allowed to use this app.');
        }
        if (user) {
          db.prepare('UPDATE users SET email = ?, display_name = ? WHERE id = ?').run(profile.email, profile.displayName, user.id);
          applyMappedRole(user, profile.mappedRole);
        } else {
          insertUser({ username, email: profile.email, displayName: profile.displayName, accountType: 'ldap', status: profile.newUserStatus, role: profile.newUserRole });
          newlyRegistered = profile.newUserStatus !== 'active';
          console.log(`[auth] Company user "${username}" registered with role ${profile.newUserRole}${newlyRegistered ? ', awaiting admin approval' : ''}.`);
        }
        user = findUserByUsername(username);
      }
    } else {
      await verifyUnknownUser(password);
    }

    if (!authenticated) {
      recordFailure(throttleKey);
      throw new AuthError(401, INVALID_LOGIN_MESSAGE);
    }
    failures.delete(throttleKey);

    if (user.status !== 'active') {
      throw new AuthError(403, newlyRegistered
        ? 'Your company account has been registered. An administrator must approve it before you can sign in.'
        : 'Your account is not active. Please contact an administrator.');
    }

    createSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const token = readCookie(req, cookieName);
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    }
    res.clearCookie(cookieName, cookieOptions());
    res.json({ ok: true });
  });

  // ---- Admin routes (/api/admin), mounted behind requireAuth + requireRole('Admin') ----

  const adminRouter = express.Router();

  adminRouter.get('/users', (_req, res) => {
    res.json({ users: listUsers(), roles: ROLE_NAMES });
  });

  adminRouter.post('/users', async (req, res) => {
    const input = validateNewLocalUser(req.body);
    const role = validateRole(req.body?.role);
    if (findUserByUsername(input.username)) {
      throw new AuthError(409, 'That username is already taken.');
    }
    const passwordHash = await hashPassword(input.password);
    try {
      insertUser({ ...input, accountType: 'local', status: 'active', role, passwordHash });
    } catch (error) {
      if (String(error?.message).includes('UNIQUE')) {
        throw new AuthError(409, 'That username is already taken.');
      }
      throw error;
    }
    console.log(`[auth] Admin "${req.user.username}" created local user "${input.username}" with role ${role}.`);
    res.json({ users: listUsers(), roles: ROLE_NAMES });
  });

  adminRouter.patch('/users/:id', (req, res) => {
    const targetId = Number.parseInt(req.params.id, 10);
    const target = db.prepare(`
      SELECT u.id, u.username, u.status, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
    `).get(targetId);
    if (!target) {
      throw new AuthError(404, 'User not found.');
    }
    const nextRole = req.body?.role === undefined ? target.role : validateRole(req.body.role);
    const nextStatus = req.body?.status === undefined ? target.status : validateStatus(req.body.status);

    const losesAdmin = target.role === 'Admin' && target.status === 'active' && (nextRole !== 'Admin' || nextStatus !== 'active');
    if (losesAdmin && target.id === req.user.id) {
      throw new AuthError(400, 'You cannot block or demote your own account.');
    }
    if (losesAdmin && countOtherActiveAdmins(target.id) === 0) {
      throw new AuthError(400, 'At least one active Admin must remain.');
    }

    db.prepare('UPDATE users SET role_id = ?, status = ? WHERE id = ?').run(roleId(nextRole), nextStatus, target.id);
    if (nextStatus === 'inactive') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }
    console.log(`[auth] Admin "${req.user.username}" set user "${target.username}" to role=${nextRole} status=${nextStatus}.`);
    res.json({ users: listUsers(), roles: ROLE_NAMES });
  });

  adminRouter.get('/directory', (_req, res) => {
    res.json(directory.getForAdmin());
  });

  adminRouter.put('/directory', (req, res) => {
    res.json(directory.save(req.body, req.user.username));
  });

  adminRouter.post('/directory/test', async (req, res) => {
    console.log(`[auth] Admin "${req.user.username}" ran a directory connection test.`);
    res.json(await directory.testConnection(req.body));
  });

  adminRouter.post('/directory/lookup', async (req, res) => {
    console.log(`[auth] Admin "${req.user.username}" looked up directory user ${JSON.stringify(String(req.body?.username ?? '').slice(0, 128))}.`);
    res.json(await directory.lookupUser(req.body?.settings, req.body?.username));
  });

  return {
    router,
    adminRouter,
    requireCsrfHeader,
    requireAuth,
    requireRole,
  };
}

function initAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      account_type TEXT NOT NULL CHECK (account_type IN ('local', 'ldap')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      role_id INTEGER NOT NULL REFERENCES roles(id),
      password_hash TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  ROLE_NAMES.forEach((name) => insertRole.run(name, ROLE_DESCRIPTIONS[name]));
}

function validateNewLocalUser(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(400, 'Username may only contain letters, numbers, dots, dashes, underscores and @ (max 128).');
  }
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    throw new AuthError(400, 'Please enter a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError(400, `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return { username, email, password };
}

function validateRole(value) {
  if (!ROLE_NAMES.includes(value)) {
    throw new AuthError(400, 'Unknown role.');
  }
  return value;
}

function validateStatus(value) {
  if (!ACCOUNT_STATUSES.includes(value)) {
    throw new AuthError(400, 'Status must be active or inactive.');
  }
  return value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    accountType: row.account_type,
    role: row.role,
  };
}

function readCookie(req, name) {
  const header = req.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(left, right) {
  return crypto.timingSafeEqual(Buffer.from(sha256(left), 'hex'), Buffer.from(sha256(right), 'hex'));
}


module.exports = { createAuth };
