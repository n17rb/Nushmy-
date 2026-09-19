'use strict';
/** أدوات HTTP صغيرة بديلة عن Express — بدون مكتبات خارجية. */
const { AppError, E } = require('./errors');
const log = require('./log');
const crypto = require('crypto');

const MAX_BODY = 3 * 1024 * 1024; // 3MB (يكفي لصورة الحساب بعد التصغير)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(E.UPLOAD_TOO_LARGE()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw E.VALIDATION_FAILED('صيغة الطلب غير صحيحة'); }
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

const ok = (res, data = {}) => send(res, 200, { ok: true, ...data });
const created = (res, data = {}) => send(res, 201, { ok: true, ...data });

function fail(res, err, ctx = {}) {
  if (err instanceof AppError) {
    if (err.status >= 500) log.error(err.code, { ...ctx, message: err.message });
    return send(res, err.status, { ok: false, error: { code: err.code, message: err.messageAr, details: err.details } });
  }
  const id = crypto.randomUUID().slice(0, 8);
  log.error('UNHANDLED', { ...ctx, errorId: id, message: err && err.message, stack: err && err.stack });
  const e = E.INTERNAL();
  return send(res, 500, { ok: false, error: { code: e.code, message: `${e.messageAr} (رمز: ${id})` } });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, httpOnly = true, secure, sameSite = 'Lax', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  if (maxAge !== undefined) s += `; Max-Age=${maxAge}`;
  return s;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

module.exports = { parseJson, readBody, send, ok, created, fail, parseCookies, cookie, clientIp };
