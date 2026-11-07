// Password hashing (scrypt) and session tokens — Node's built-in crypto only.
const crypto = require('node:crypto');
const { q } = require('./db');

const SESSION_DAYS = 7;
const COOKIE = 'he_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  q.createSession.run(sha256(token), userId, expires);
  return { token, expires };
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  return q.sessionUser.get(sha256(token), Date.now()) || null;
}

function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.deleteSession.run(sha256(token));
}

function sessionCookie(token, expires, secure) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

// Simple in-memory rate limiter for login/signup (per IP).
const hits = new Map();
function rateLimited(key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const rec = hits.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++;
  hits.set(key, rec);
  return rec.n > max;
}

setInterval(() => q.purgeSessions.run(Date.now()), 60 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, createSession, userFromRequest, destroySession, sessionCookie, clearCookie, rateLimited };
