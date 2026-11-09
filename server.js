'use strict';
/**
 * Hospital Management System - backend
 * Pure Node.js (no npm dependencies). Data is stored in data/db.json.
 *
 * Roles
 *  - admin   : creates/edits/deletes doctor, nurse & staff accounts; manages patients
 *  - doctor / nurse / staff : created by admin, can only VIEW the dashboard
 *  - patient : registers by himself/herself, sees own dashboard, edits & deletes own profile
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours
const STAFF_ROLES = ['doctor', 'nurse', 'staff'];
const GENDERS = ['Male', 'Female', 'Other'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* ------------------------------------------------------------------ */
/* Tiny JSON database                                                  */
/* ------------------------------------------------------------------ */
let db = { users: [], patients: [] };

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function newId() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function initDb() {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.users.some((u) => u.role === 'admin')) {
    const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
    const password = process.env.ADMIN_PASS || 'admin123';
    db.users.push({
      id: newId(),
      role: 'admin',
      username,
      name: 'System Admin',
      phone: '',
      department: '',
      ...hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    saveDb();
    console.log(`Default admin created -> username: ${username}  password: ${password}`);
    console.log('Please change it (set ADMIN_USER / ADMIN_PASS env vars before first run).');
  }
}

/* ------------------------------------------------------------------ */
/* Sessions & login rate limit                                         */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // token -> { userId, exp }
const attempts = new Map(); // ip -> { count, reset }

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, exp: Date.now() + SESSION_TTL });
  return token;
}

function destroySessionsOf(userId) {
  for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
}

function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) return false;
  return a.count >= 10;
}

function recordFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
  else a.count += 1;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function publicUser(u) {
  return {
    id: u.id,
    role: u.role,
    username: u.username,
    name: u.name,
    phone: u.phone,
    department: u.department,
    createdAt: u.createdAt,
  };
}

function parsePatientFields(b) {
  const name = clean(b.name, 100);
  const age = Number.parseInt(b.age, 10);
  const gender = clean(b.gender, 10);
  const phone = clean(b.phone, 20);
  const address = clean(b.address, 200);
  const bloodGroup = clean(b.bloodGroup, 3);
  const problem = clean(b.problem, 500);

  if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
  if (!Number.isInteger(age) || age < 0 || age > 150) throw new HttpError(400, 'Age must be between 0 and 150.');
  if (!GENDERS.includes(gender)) throw new HttpError(400, 'Please select a valid gender.');
  if (!/^[0-9+\-\s()]{6,20}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');
  if (bloodGroup && !BLOOD_GROUPS.includes(bloodGroup)) throw new HttpError(400, 'Invalid blood group.');
  return { name, age, gender, phone, address, bloodGroup, problem };
}

function checkUsername(username) {
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Username: 3-30 chars, lowercase letters, numbers, . _ - only.');
  }
  if (db.users.some((u) => u.username === username)) throw new HttpError(409, 'Username already taken.');
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
    throw new HttpError(400, 'Password must be 6-100 characters.');
  }
}

function removePatientAndUser(patient) {
  db.patients = db.patients.filter((p) => p.id !== patient.id);
  db.users = db.users.filter((u) => u.id !== patient.userId);
  destroySessionsOf(patient.userId);
  saveDb();
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* roles: null = public, [] = any logged-in user, [..] = listed roles  */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, roles, handler) {
  routes.push({ method, regex: new RegExp('^' + pattern.replace(':id', '([^/]+)') + '$'), roles, handler });
}

// ----- Auth -----
route('POST', '/api/login', null, ({ body, ip }) => {
  if (tooManyAttempts(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const username = clean(body.username, 30).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const user = db.users.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user)) {
    recordFailure(ip);
    throw new HttpError(401, 'Invalid username or password.');
  }
  return { token: createSession(user.id), user: publicUser(user) };
});

route('POST', '/api/logout', [], ({ token }) => {
  sessions.delete(token);
  return { ok: true };
});

// Patient registers himself/herself
route('POST', '/api/register', null, ({ body }) => {
  const fields = parsePatientFields(body);
  const username = clean(body.username, 30).toLowerCase();
  checkUsername(username);
  checkPassword(body.password);

  const now = new Date().toISOString();
  const user = {
    id: newId(),
    role: 'patient',
    username,
    name: fields.name,
    phone: fields.phone,
    department: '',
    ...hashPassword(body.password),
    createdAt: now,
  };
  const patient = { id: newId(), userId: user.id, ...fields, createdAt: now, updatedAt: now };
  db.users.push(user);
  db.patients.push(patient);
  saveDb();
  return { token: createSession(user.id), user: publicUser(user) };
});

route('GET', '/api/me', [], ({ user }) => {
  const patient = user.role === 'patient' ? db.patients.find((p) => p.userId === user.id) || null : null;
  return { user: publicUser(user), patient };
});

// Patient edits own profile
route('PUT', '/api/me', ['patient'], ({ user, body }) => {
  const patient = db.patients.find((p) => p.userId === user.id);
  if (!patient) throw new HttpError(404, 'Profile not found.');
  const fields = parsePatientFields(body);

  if (body.newPassword) {
    if (!body.currentPassword || !verifyPassword(body.currentPassword, user)) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
    checkPassword(body.newPassword);
    Object.assign(user, hashPassword(body.newPassword));
  }
  Object.assign(patient, fields, { updatedAt: new Date().toISOString() });
  user.name = fields.name;
  user.phone = fields.phone;
  saveDb();
  return { user: publicUser(user), patient };
});

// Patient deletes own profile (password confirmation required)
route('DELETE', '/api/me', ['patient'], ({ user, body }) => {
  if (!body.password || !verifyPassword(body.password, user)) {
    throw new HttpError(400, 'Password is incorrect.');
  }
  const patient = db.patients.find((p) => p.userId === user.id);
  if (patient) removePatientAndUser(patient);
  else {
    db.users = db.users.filter((u) => u.id !== user.id);
    destroySessionsOf(user.id);
    saveDb();
  }
  return { ok: true };
});

// ----- Dashboard (all roles) -----
route('GET', '/api/dashboard', [], ({ user }) => {
  if (user.role === 'patient') {
    return { role: 'patient', patient: db.patients.find((p) => p.userId === user.id) || null };
  }
  const count = (r) => db.users.filter((u) => u.role === r).length;
  const stats = { patients: db.patients.length, doctors: count('doctor'), nurses: count('nurse'), staff: count('staff') };
  const sorted = [...db.patients].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (user.role === 'admin') return { role: 'admin', stats, recentPatients: sorted.slice(0, 5) };
  // doctor / nurse / staff -> read-only view
  return { role: user.role, stats, patients: sorted };
});

// ----- Admin: doctor / nurse / staff accounts -----
route('GET', '/api/users', ['admin'], () => {
  return { users: db.users.filter((u) => STAFF_ROLES.includes(u.role)).map(publicUser) };
});

route('POST', '/api/users', ['admin'], ({ body }) => {
  const role = clean(body.role, 10);
  if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Role must be doctor, nurse or staff.');
  const name = clean(body.name, 100);
  if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
  const phone = clean(body.phone, 20);
  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) throw new HttpError(400, 'Invalid phone number.');
  const username = clean(body.username, 30).toLowerCase();
  checkUsername(username);
  checkPassword(body.password);

  const user = {
    id: newId(),
    role,
    username,
    name,
    phone,
    department: clean(body.department, 60),
    ...hashPassword(body.password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveDb();
  return { user: publicUser(user) };
});

route('PUT', '/api/users/:id', ['admin'], ({ body, params }) => {
  const target = db.users.find((u) => u.id === params[0] && STAFF_ROLES.includes(u.role));
  if (!target) throw new HttpError(404, 'User not found.');
  const role = clean(body.role, 10) || target.role;
  if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Role must be doctor, nurse or staff.');
  const name = clean(body.name, 100);
  if (name.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
  const phone = clean(body.phone, 20);
  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) throw new HttpError(400, 'Invalid phone number.');

  if (body.password) {
    checkPassword(body.password);
    Object.assign(target, hashPassword(body.password));
    destroySessionsOf(target.id);
  }
  Object.assign(target, { role, name, phone, department: clean(body.department, 60) });
  saveDb();
  return { user: publicUser(target) };
});

route('DELETE', '/api/users/:id', ['admin'], ({ params }) => {
  const target = db.users.find((u) => u.id === params[0] && STAFF_ROLES.includes(u.role));
  if (!target) throw new HttpError(404, 'User not found.');
  db.users = db.users.filter((u) => u.id !== target.id);
  destroySessionsOf(target.id);
  saveDb();
  return { ok: true };
});

// ----- Admin: patients -----
route('GET', '/api/patients', ['admin'], () => {
  const patients = db.patients.map((p) => {
    const u = db.users.find((x) => x.id === p.userId);
    return { ...p, username: u ? u.username : '' };
  });
  return { patients: patients.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

route('PUT', '/api/patients/:id', ['admin'], ({ body, params }) => {
  const patient = db.patients.find((p) => p.id === params[0]);
  if (!patient) throw new HttpError(404, 'Patient not found.');
  const fields = parsePatientFields(body);
  Object.assign(patient, fields, { updatedAt: new Date().toISOString() });
  const u = db.users.find((x) => x.id === patient.userId);
  if (u) {
    u.name = fields.name;
    u.phone = fields.phone;
  }
  saveDb();
  return { patient };
});

route('DELETE', '/api/patients/:id', ['admin'], ({ params }) => {
  const patient = db.patients.find((p) => p.id === params[0]);
  if (!patient) throw new HttpError(404, 'Patient not found.');
  removePatientAndUser(patient);
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) {
        reject(new HttpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  try {
    const match = routes
      .map((r) => ({ r, m: r.method === req.method ? pathname.match(r.regex) : null }))
      .find((x) => x.m);
    if (!match) throw new HttpError(404, 'Not found.');

    const { r, m } = match;
    let user = null;
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (r.roles !== null) {
      const s = sessions.get(token);
      if (!s || s.exp < Date.now()) {
        sessions.delete(token);
        throw new HttpError(401, 'Please log in.');
      }
      user = db.users.find((u) => u.id === s.userId);
      if (!user) throw new HttpError(401, 'Please log in.');
      if (r.roles.length && !r.roles.includes(user.role)) throw new HttpError(403, 'You do not have permission.');
    }
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const result = await r.handler({ req, user, token, body, params: m.slice(1), ip: req.socket.remoteAddress });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: 'Server error.' });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SECURITY_HEADERS });
    res.end(data);
  });
}

initDb();
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(req, res, pathname);
  })
  .listen(PORT, () => console.log(`Hospital Management System running at http://localhost:${PORT}`));
