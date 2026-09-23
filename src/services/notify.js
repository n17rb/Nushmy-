'use strict';
/**
 * الإشعارات:
 *   1) صندوق الإشعارات داخل التطبيق (دائم — ما بيختفي، بينحفظ بقاعدة البيانات)
 *   2) إشعار فوري على التلفون (Web Push أو Firebase للتطبيقات من المتجر)
 *
 * app = 'customer' | 'captain' — نفس الشخص ممكن يكون زبون وكابتن، وكل تطبيق إله إشعاراته.
 */
const db = require('../db');
const log = require('../lib/log');
const { uuid, nowIso } = require('../lib/ids');
const webpush = require('./webpush');
const fcm = require('./fcm');
const config = require('../config');
const { normalizeJordanPhone } = require('../lib/validate');

const APPS = ['customer', 'captain', 'admin'];
const HOME = { customer: '/', captain: '/captain/', admin: '/admin/' };

/** إرسال فوري لكل أجهزة المستخدم على هذا التطبيق. @returns {Promise<number>} عدد الأجهزة الي وصلها */
async function push(userId, app, { title, body, url, tag, data }) {
  const subs = await db.query('SELECT * FROM push_subscriptions WHERE user_id = $1 AND app = $2', [userId, app]);
  let delivered = 0;
  for (const s of subs) {
    const payload = { title, body: body || '', url: url || HOME[app] || '/', tag: tag || undefined, data: data || {}, app };
    const r = s.platform === 'fcm'
      ? await fcm.send(s.endpoint.replace(/^fcm:/, ''), payload)
      : await webpush.send(s, payload, { topic: tag });
    if (r.ok) {
      delivered++;
      await db.query('UPDATE push_subscriptions SET last_ok_at = $1, fail_count = 0 WHERE id = $2', [nowIso(), s.id]);
    } else if (r.gone) {
      await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
    } else {
      await db.query('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1', [s.id]);
      if (s.fail_count >= 20) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
    }
  }
  return delivered;
}

/**
 * إشعار لمستخدم واحد.
 * @param {object} o
 * @param {boolean} [o.inbox=true]  يتسجّل بصندوق الإشعارات؟ (رسائل المحادثة لا — بتظهر بالمحادثة نفسها)
 * @param {boolean} [o.push=true]   يوصل على التلفون؟
 */
async function toUser(userId, app, { type = 'info', title, body = '', url = null, tag = null, data = null, inbox = true, push: doPush = true, broadcastId = null }) {
  if (!APPS.includes(app)) app = 'customer';
  let id = null;
  if (inbox) {
    id = uuid();
    await db.query(
      `INSERT INTO notifications (id, user_id, type, title, body, data_json, read_at, created_at, app, url, broadcast_id)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)`,
      [id, userId, type, String(title).slice(0, 120), String(body || '').slice(0, 1000), data ? JSON.stringify(data) : null,
       nowIso(), app, url, broadcastId]);
  }
  if (doPush) {
    // ما منستنى الإرسال — الطلب الأصلي بيرجع فوراً
    push(userId, app, { title, body, url, tag, data: { ...(data || {}), notificationId: id } })
      .catch((e) => log.warn('push', { message: e.message }));
  }
  return id;
}

/** إشعار بدون انتظار وبدون ما يوقف العملية الأصلية لو صار خطأ */
function fire(userId, app, o) {
  toUser(userId, app, o).catch((e) => log.warn('notify', { message: e.message }));
}

/** كل حسابات الإدارة (المشرفين + رقم المالك من ADMIN_PHONES) */
async function adminUserIds() {
  const rows = await db.query(`SELECT id FROM users WHERE admin_role IS NOT NULL AND admin_role <> ''`, []);
  const ids = rows.map((r) => r.id);
  for (const raw of config.adminPhones || []) {
    let phone;
    try { phone = normalizeJordanPhone(raw); } catch { continue; }
    const u = await db.one('SELECT id FROM users WHERE phone_e164 = $1', [phone]);
    if (u && !ids.includes(u.id)) ids.push(u.id);
  }
  return ids;
}

/**
 * تنبيه لكل الإدارة (بيبين بجرس لوحة الإدارة + إشعار فوري للي مفعّلها).
 * @param {{type:string, title:string, body?:string, url?:string, data?:object, key?:string}} o
 *   key = مفتاح منع التكرار: إذا في تنبيه بنفس النوع والمفتاح لسا غير مقروء، ما منكرره.
 */
async function admins({ type, title, body = '', url = null, data = null, key = null }) {
  if (key) {
    const ex = await db.one(
      `SELECT id FROM notifications WHERE app = 'admin' AND type = $1 AND read_at IS NULL AND data_json LIKE $2`,
      [type, '%' + key + '%']);
    if (ex) return 0;
  }
  const ids = await adminUserIds();
  const payload = key ? { ...(data || {}), key } : data;
  for (const id of ids) await toUser(id, 'admin', { type, title, body, url, data: payload, tag: type });
  return ids.length;
}

const alert = (o) => admins(o).catch((e) => log.warn('admin alert', { message: e.message }));

module.exports = { toUser, fire, push, admins, alert, adminUserIds, APPS };
