'use strict';
/**
 * Firebase Cloud Messaging (FCM HTTP v1) — للتطبيقات المنشورة على Google Play و App Store.
 * لما تحوّل نشمي لتطبيق متجر (مثلاً بـ Capacitor)، التطبيق بيسجّل «رمز الجهاز» على
 *   POST /api/push/register   { platform: 'fcm', token, app }
 * والخادم بيبعت عن طريق Firebase — وهو نفسه بيوصل للآيفون (APNs) والأندرويد.
 *
 * الإعداد: من Firebase Console ← Project settings ← Service accounts ← Generate new private key
 * وحط محتوى ملف JSON كامل بـ Render بمتغير FCM_SERVICE_ACCOUNT (أو Base64 منه).
 */
const crypto = require('crypto');
const log = require('../lib/log');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let account;
function serviceAccount() {
  if (account !== undefined) return account;
  const raw = process.env.FCM_SERVICE_ACCOUNT || '';
  account = null;
  if (!raw) return account;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const j = JSON.parse(text);
    if (j.client_email && j.private_key && j.project_id) account = j;
  } catch { log.warn('FCM_SERVICE_ACCOUNT مش JSON صحيح'); }
  return account;
}
const configured = () => Boolean(serviceAccount());

/** JWT موقّع بـ RS256 بنبدّله بـ access token من Google */
function assertion(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key);
  return `${header}.${claims}.${b64u(sig)}`;
}

let token = null, tokenExp = 0;
async function accessToken() {
  const sa = serviceAccount();
  if (!sa) return null;
  if (token && Date.now() < tokenExp - 60_000) return token;
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(sa) }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) { log.warn('تعذّر الحصول على رمز Firebase', { status: res.status }); return null; }
  token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return token;
}

/** @returns {Promise<{ok:boolean, gone?:boolean}>} */
async function send(deviceToken, { title, body, url, tag, data = {} }) {
  const sa = serviceAccount();
  const at = sa && (await accessToken());
  if (!at) return { ok: false };
  const strData = Object.fromEntries(Object.entries({ ...data, url: url || '/' }).map(([k, v]) => [k, String(v)]));
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: strData,
          android: { priority: 'high', notification: { sound: 'default', tag: tag || undefined, color: '#A60E35' } },
          apns: { payload: { aps: { sound: 'default', 'thread-id': tag || 'nashmi' } } },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 400) {
      const j = await res.json().catch(() => ({}));
      const code = j.error && j.error.details && j.error.details.map((x) => x.errorCode).join(',');
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(code || '')) return { ok: false, gone: true };
    }
    return { ok: res.ok };
  } catch { return { ok: false }; }
}

module.exports = { configured, send, assertion, _reset: () => { account = undefined; token = null; } };
