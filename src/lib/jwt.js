'use strict';
/** JWT (HS256) بدون مكتبات خارجية. */
const crypto = require('crypto');
const config = require('../config');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = head + '.' + b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return data + '.' + sig;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { sign, verify };
