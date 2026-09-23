'use strict';
/** صندوق الإشعارات + تسجيل الأجهزة للإشعارات الفورية */
const db = require('../db');
const { parseJson, ok } = require('../lib/http');
const { str } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');
const webpush = require('../services/webpush');
const fcm = require('../services/fcm');
const notify = require('../services/notify');

const appOf = (url, body) => {
  const a = (body && body.app) || (url && url.searchParams.get('app')) || 'customer';
  return notify.APPS.includes(a) ? a : 'customer';
};

function row(n) {
  let data = null;
  try { data = n.data_json ? JSON.parse(n.data_json) : null; } catch {}
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, data, read: Boolean(n.read_at), createdAt: n.created_at };
}

async function list(req, res, ctx, params, url) {
  const app = appOf(url);
  const rows = await db.query(
    'SELECT * FROM notifications WHERE user_id = $1 AND app = $2 ORDER BY created_at DESC LIMIT 100', [ctx.user.id, app]);
  const unread = await db.one(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND app = $2 AND read_at IS NULL', [ctx.user.id, app]);
  return ok(res, { notifications: rows.map(row), unread: Number(unread.n) });
}

async function markRead(req, res, ctx, params, url) {
  const body = await parseJson(req);
  const app = appOf(url, body);
  if (Array.isArray(body.ids) && body.ids.length) {
    for (const id of body.ids.slice(0, 100)) {
      await db.query('UPDATE notifications SET read_at = $1 WHERE id = $2 AND user_id = $3 AND read_at IS NULL', [nowIso(), String(id), ctx.user.id]);
    }
  } else {
    await db.query('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND app = $3 AND read_at IS NULL', [nowIso(), ctx.user.id, app]);
  }
  return ok(res, {});
}

/* ------------------------------ الإشعارات الفورية ------------------------------ */
async function key(req, res) {
  const k = await webpush.vapidKeys();
  return ok(res, { publicKey: k.publicKey, fcm: fcm.configured() });
}

/** اشتراك متصفح (PushSubscription.toJSON()) */
async function subscribe(req, res, ctx) {
  const body = await parseJson(req);
  const app = appOf(null, body);
  const s = body.subscription || {};
  const endpoint = str(s.endpoint, { max: 800, field: 'endpoint' });
  if (!/^https:\/\//.test(endpoint)) throw E.VALIDATION_FAILED('اشتراك غير صالح');
  const p256dh = str(s.keys && s.keys.p256dh, { max: 200, field: 'p256dh' });
  const auth = str(s.keys && s.keys.auth, { max: 100, field: 'auth' });
  await upsert(ctx.user.id, app, 'web', endpoint, p256dh, auth, req.headers['user-agent']);
  return ok(res, {});
}

/** رمز جهاز من تطبيق المتجر (Firebase) */
async function register(req, res, ctx) {
  const body = await parseJson(req);
  const app = appOf(null, body);
  const token = str(body.token, { min: 20, max: 500, field: 'رمز الجهاز' });
  await upsert(ctx.user.id, app, 'fcm', 'fcm:' + token, null, null, req.headers['user-agent']);
  return ok(res, {});
}

async function upsert(userId, app, platform, endpoint, p256dh, auth, ua) {
  const ex = await db.one('SELECT id FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  if (ex) {
    await db.query('UPDATE push_subscriptions SET user_id = $1, app = $2, p256dh = $3, auth = $4, fail_count = 0 WHERE id = $5',
      [userId, app, p256dh, auth, ex.id]);
  } else {
    await db.query(
      `INSERT INTO push_subscriptions (id, user_id, app, platform, endpoint, p256dh, auth, user_agent, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuid(), userId, app, platform, endpoint, p256dh, auth, String(ua || '').slice(0, 200), nowIso()]);
  }
}

async function unsubscribe(req, res, ctx) {
  const body = await parseJson(req);
  if (body.endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [String(body.endpoint), ctx.user.id]);
  return ok(res, {});
}

/** زر «جرّب الإشعار» بصفحة الإشعارات */
async function test(req, res, ctx) {
  const body = await parseJson(req);
  const app = appOf(null, body);
  const n = await notify.push(ctx.user.id, app, { title: 'نشمي 🦋', body: 'الإشعارات شغالة تمام ✓', tag: 'test' });
  return ok(res, { delivered: n });
}

module.exports = { list, markRead, key, subscribe, register, unsubscribe, test };
