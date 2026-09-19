'use strict';
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const jwt = require('../lib/jwt');
const { sha256 } = require('../lib/hash');
const { uuid, nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');

async function findOrCreateUser(phone, cityId) {
  let user = await db.one('SELECT * FROM users WHERE phone_e164 = $1', [phone]);
  if (user) return { user, isNew: false };
  const now = nowIso();
  const id = uuid();
  await db.query(
    `INSERT INTO users (id, role, phone_e164, status, language, theme, city_id, is_verified, created_at, updated_at)
     VALUES ($1,'customer',$2,'ACTIVE','ar','system',$3,1,$4,$4)`,
    [id, phone, cityId || null, now]
  );
  await db.query(
    'INSERT INTO risk_scores (user_id, score, level, cancellations, trips, updated_at) VALUES ($1,0,\'NORMAL\',0,0,$2)',
    [id, now]
  );
  user = await db.one('SELECT * FROM users WHERE id = $1', [id]);
  return { user, isNew: true };
}

async function createSession(user, { ip, userAgent }) {
  const refresh = crypto.randomBytes(32).toString('base64url');
  const now = nowIso();
  await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at, created_at, last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
    [uuid(), user.id, sha256(refresh), (userAgent || '').slice(0, 250), ip || null,
     new Date(Date.now() + config.refreshTokenTtlSec * 1000).toISOString(), now]
  );
  await db.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, user.id]);
  return {
    accessToken: jwt.sign({ sub: user.id, role: user.role }, config.accessTokenTtlSec),
    refreshToken: refresh,
    expiresInSec: config.accessTokenTtlSec,
  };
}

async function rotateSession(refreshToken, ctx) {
  if (!refreshToken) throw E.UNAUTHORIZED();
  const row = await db.one(
    'SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL',
    [sha256(refreshToken)]
  );
  if (!row || Date.parse(row.expires_at) < Date.now()) throw E.UNAUTHORIZED();
  const user = await db.one('SELECT * FROM users WHERE id = $1', [row.user_id]);
  if (!user) throw E.UNAUTHORIZED();
  if (user.status !== 'ACTIVE') throw E.ACCOUNT_SUSPENDED();
  await db.query('UPDATE sessions SET revoked_at = $1 WHERE id = $2', [nowIso(), row.id]);
  const tokens = await createSession(user, ctx);
  return { user, tokens };
}

async function revokeSession(refreshToken) {
  if (!refreshToken) return;
  await db.query('UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
    [nowIso(), sha256(refreshToken)]);
}

/** التحقق من رمز الوصول وإرجاع المستخدم */
async function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw E.UNAUTHORIZED();
  const payload = jwt.verify(token);
  if (!payload) throw E.UNAUTHORIZED();
  const user = await db.one('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!user) throw E.UNAUTHORIZED();
  if (user.status !== 'ACTIVE') throw E.ACCOUNT_SUSPENDED();
  return user;
}

function publicUser(u) {
  return {
    id: u.id,
    phone: u.phone_e164,
    name: u.name,
    email: u.email,
    photoUrl: u.photo_url,
    role: u.role,
    language: u.language,
    theme: u.theme,
    profileComplete: Boolean(u.name && u.name.trim().length >= 2),
    createdAt: u.created_at,
  };
}

module.exports = { findOrCreateUser, createSession, rotateSession, revokeSession, authenticate, publicUser };
