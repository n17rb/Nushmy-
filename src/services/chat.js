'use strict';
/**
 * المحادثات:
 *   - رحلة: الزبون ↔ الكابتن (من القبول لحد ساعتين بعد نهاية الرحلة). الإدارة بتقرأها وقت الشكاوى.
 *   - دعم: الزبون أو الكابتن ↔ الإدارة. المواضيع: عام، غرض منسي، إبلاغ عن كابتن، مشكلة برحلة، دفع، حساب.
 * أرقام التلفونات ما بتنعرض بالمحادثة — والرسالة ما بتنحذف (مرجع للشكاوى).
 */
const db = require('../db');
const { uuid, nowIso } = require('../lib/ids');
const { E, AppError } = require('../lib/errors');
const settings = require('./settings');
const notify = require('./notify');

const TOPICS = {
  general:        'استفسار عام',
  lost_item:      'غرض منسي بالسيارة',
  report_captain: 'إبلاغ عن كابتن',
  report_rider:   'إبلاغ عن زبون',
  trip_issue:     'مشكلة برحلة',
  payment:        'الأجرة والدفع',
  account:        'حسابي',
  captain_admin:  'رسالة من الإدارة',
};
const ACTIVE = ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'TRIP_STARTED'];
const TRIP_CHAT_AFTER_MS = 2 * 3600 * 1000;       // المحادثة بتضل مفتوحة ساعتين بعد الرحلة
const MAX_LEN = 1000;

const cleanBody = (b) => {
  const s = String(b == null ? '' : b).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) throw E.VALIDATION_FAILED('اكتب الرسالة');
  if (s.length > MAX_LEN) throw E.VALIDATION_FAILED(`الرسالة طويلة (أقصى حد ${MAX_LEN} حرف)`);
  return s;
};
const preview = (s) => (s.length > 80 ? s.slice(0, 79) + '…' : s).replace(/\s+/g, ' ');

/* ------------------------------ صلاحيات القراءة ------------------------------ */
/** دور المستخدم بالمحادثة: 'customer' | 'captain' | null */
function roleIn(thread, userId) {
  if (thread.kind === 'trip') {
    if (thread.user_id === userId) return 'customer';
    if (thread.peer_user_id === userId) return 'captain';
    return null;
  }
  return thread.user_id === userId ? thread.side : null;
}

/** هل المحادثة مقفلة للكتابة؟ (محادثة الرحلة بعد ساعتين من نهايتها) */
async function locked(thread) {
  if (thread.kind !== 'trip') return false;
  const t = await db.one('SELECT status, completed_at, cancelled_at, updated_at FROM trips WHERE id = $1', [thread.trip_id]);
  if (!t) return true;
  if (ACTIVE.includes(t.status)) return false;
  const end = Date.parse(t.completed_at || t.cancelled_at || t.updated_at);
  return Date.now() - end > TRIP_CHAT_AFTER_MS;
}

/* ------------------------------ الإنشاء ------------------------------ */
async function tripThread(tripId, userId, as) {
  const t = await db.one(
    `SELECT t.id, t.code, t.status, t.customer_id, t.captain_id, c.user_id AS captain_user_id
       FROM trips t LEFT JOIN captains c ON c.id = t.captain_id WHERE t.id = $1`, [tripId]);
  if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
  const allowed = as === 'captain' ? t.captain_user_id === userId : t.customer_id === userId;
  if (!allowed) throw E.NOT_FOUND('الرحلة غير موجودة');
  if (!t.captain_user_id) throw new AppError('CHAT_NO_CAPTAIN', 'المحادثة بتفتح لما كابتن يقبل الطلب', 409);

  let th = await db.one(`SELECT * FROM chat_threads WHERE kind = 'trip' AND trip_id = $1 AND peer_user_id = $2`, [t.id, t.captain_user_id]);
  if (!th) {
    const now = nowIso();
    const id = uuid();
    await db.query(
      `INSERT INTO chat_threads (id, kind, trip_id, user_id, side, peer_user_id, topic, subject, status, created_at, updated_at)
       VALUES ($1,'trip',$2,$3,'customer',$4,'trip',$5,'OPEN',$6,$6)`,
      [id, t.id, t.customer_id, t.captain_user_id, 'رحلة ' + t.code, now]);
    th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [id]);
  }
  return th;
}

/**
 * فتح محادثة دعم (أو إكمال المفتوحة لنفس الموضوع والرحلة) وإضافة أول رسالة.
 * @param {{userId, side:'customer'|'captain', topic, tripId?, body, subject?}} o
 */
async function openSupport({ userId, side, topic = 'general', tripId = null, body, subject = null, byAdmin = null }) {
  if (!TOPICS[topic]) topic = 'general';
  if (!['customer', 'captain'].includes(side)) side = 'customer';
  if (tripId) {
    const t = await db.one(
      `SELECT t.id, t.customer_id, c.user_id AS captain_user_id FROM trips t LEFT JOIN captains c ON c.id = t.captain_id WHERE t.id = $1`, [tripId]);
    const mine = t && (side === 'captain' ? t.captain_user_id === userId : t.customer_id === userId);
    if (!mine && !byAdmin) throw E.NOT_FOUND('الرحلة غير موجودة');
  }
  let th = await db.one(
    `SELECT * FROM chat_threads WHERE kind = 'support' AND user_id = $1 AND side = $2 AND topic = $3
       AND COALESCE(trip_id, '') = $4 AND status = 'OPEN' ORDER BY created_at DESC`,
    [userId, side, topic, tripId || '']);
  const isNew = !th;
  if (!th) {
    const now = nowIso();
    const id = uuid();
    await db.query(
      `INSERT INTO chat_threads (id, kind, trip_id, user_id, side, topic, subject, status, created_at, updated_at)
       VALUES ($1,'support',$2,$3,$4,$5,$6,'OPEN',$7,$7)`,
      [id, tripId, userId, side, topic, subject || TOPICS[topic], now]);
    th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [id]);
  }
  if (body) {
    if (byAdmin) await post(th, { senderId: byAdmin.id, role: 'admin', body });
    else await post(th, { senderId: userId, role: side, body });
  }
  // رد تلقائي لأول رسالة من الزبون/الكابتن
  if (isNew && !byAdmin) {
    const auto = await settings.get('support.auto_reply');
    if (auto) await post(th, { senderId: null, role: 'system', body: auto, silent: true });
  }
  return db.one('SELECT * FROM chat_threads WHERE id = $1', [th.id]);
}

/* ------------------------------ الرسائل ------------------------------ */
async function post(thread, { senderId, role, body, silent = false }) {
  const text = cleanBody(body);
  if (role !== 'admin' && role !== 'system' && (await locked(thread))) {
    throw new AppError('CHAT_CLOSED', 'المحادثة انقفلت بعد نهاية الرحلة. لأي شي، راسل الدعم الفني', 409);
  }
  const now = nowIso();
  const id = uuid();
  await db.query(
    'INSERT INTO chat_messages (id, thread_id, sender_id, sender_role, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, thread.id, senderId, role, text, now]);
  // المرسل قرأ لحد رسالته — والمحادثة المقفولة بترجع تنفتح لما الزبون/الكابتن يكتب
  const readCol = role === 'admin' ? 'admin_read_at' : role === 'captain' && thread.kind === 'trip' ? 'peer_read_at' : role === 'system' ? null : 'user_read_at';
  // الرد التلقائي (system) ما بيغيّر «مين آخر واحد كتب» — المحادثة بتضل «بتستنى رد» عند الإدارة
  if (role !== 'system') {
    await db.query(
      `UPDATE chat_threads SET last_message_at = $1, last_preview = $2, last_sender_role = $3, updated_at = $1
         ${readCol ? `, ${readCol} = $1` : ''}${role !== 'admin' ? `, status = 'OPEN'` : ''} WHERE id = $4`,
      [now, preview(text), role, thread.id]);
  }

  if (!silent) notifyOthers(thread, role, text);
  return { id, threadId: thread.id, senderRole: role, body: text, createdAt: now, mine: true };
}

/** إشعار فوري للطرف الثاني (بدون ما يتسجل بصندوق الإشعارات) */
function notifyOthers(thread, role, text) {
  const body = preview(text);
  if (thread.kind === 'trip') {
    if (role === 'customer' && thread.peer_user_id) {
      notify.fire(thread.peer_user_id, 'captain', { type: 'chat', title: 'رسالة من الزبون', body, url: '/captain/#chat', tag: 'chat-' + thread.id, inbox: false, data: { threadId: thread.id, tripId: thread.trip_id } });
    } else if (role === 'captain') {
      notify.fire(thread.user_id, 'customer', { type: 'chat', title: 'رسالة من الكابتن', body, url: '/#chat', tag: 'chat-' + thread.id, inbox: false, data: { threadId: thread.id, tripId: thread.trip_id } });
    }
    return;
  }
  if (role === 'admin') {
    const app = thread.side === 'captain' ? 'captain' : 'customer';
    notify.fire(thread.user_id, app, {
      type: 'support', title: 'رد من الدعم الفني', body,
      url: (app === 'captain' ? '/captain/' : '/') + '#support/' + thread.id, tag: 'chat-' + thread.id, inbox: true,
      data: { threadId: thread.id },
    });
  }
}

async function messages(threadId, { after = null, limit = 200 } = {}) {
  const rows = after
    ? await db.query('SELECT * FROM chat_messages WHERE thread_id = $1 AND created_at > $2 ORDER BY created_at LIMIT $3', [threadId, after, limit])
    : await db.query(`SELECT * FROM (SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT $2) x ORDER BY created_at`, [threadId, limit]);
  return rows;
}

function msgView(m, myRole) {
  return { id: m.id, senderRole: m.sender_role, body: m.body, createdAt: m.created_at, mine: m.sender_role === myRole };
}

async function markRead(thread, role) {
  const col = role === 'admin' ? 'admin_read_at' : thread.kind === 'trip' && role === 'captain' ? 'peer_read_at' : 'user_read_at';
  await db.query(`UPDATE chat_threads SET ${col} = $1 WHERE id = $2`, [nowIso(), thread.id]);
}

/** عدد الرسائل غير المقروءة لهذا الدور */
async function unreadCount(thread, role) {
  const readAt = role === 'admin' ? thread.admin_read_at
    : thread.kind === 'trip' && role === 'captain' ? thread.peer_read_at : thread.user_read_at;
  const other = role === 'admin' ? `sender_role IN ('customer','captain')` : `sender_role <> '${role}'`;
  const r = await db.one(
    `SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = $1 AND ${other} AND created_at > $2`,
    [thread.id, readAt || '1970-01-01T00:00:00.000Z']);
  return Number(r.n);
}

module.exports = { TOPICS, ACTIVE, roleIn, locked, tripThread, openSupport, post, messages, msgView, markRead, unreadCount, cleanBody };
