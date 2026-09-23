'use strict';
/**
 * المحادثات من تطبيق الزبون وتطبيق الكابتن.
 *   ?as=customer (افتراضي) أو ?as=captain — نفس الشخص ممكن يكون الاثنين.
 */
const db = require('../db');
const { parseJson, ok, created } = require('../lib/http');
const { E } = require('../lib/errors');
const chat = require('../services/chat');

const asOf = (url, body) => ((body && body.as) || (url && url.searchParams.get('as'))) === 'captain' ? 'captain' : 'customer';

async function ensureCaptain(userId) {
  const c = await db.one('SELECT id FROM captains WHERE user_id = $1', [userId]);
  if (!c) throw E.FORBIDDEN();
}

async function threadView(th, role) {
  let trip = null;
  if (th.trip_id) {
    const t = await db.one('SELECT id, code, status, pickup_address, dest_address, requested_at FROM trips WHERE id = $1', [th.trip_id]);
    if (t) trip = { id: t.id, code: t.code, status: t.status, from: t.pickup_address, to: t.dest_address, at: t.requested_at };
  }
  let peer = null;
  if (th.kind === 'trip') {
    const otherId = role === 'captain' ? th.user_id : th.peer_user_id;
    const u = await db.one('SELECT name, photo_url FROM users WHERE id = $1', [otherId]);
    const first = u && u.name ? String(u.name).trim().split(/\s+/)[0] : '';
    peer = { name: first || (role === 'captain' ? 'الزبون' : 'الكابتن'), photoUrl: u && u.photo_url };
  }
  return {
    id: th.id, kind: th.kind, topic: th.topic, topicLabel: chat.TOPICS[th.topic] || (th.kind === 'trip' ? 'محادثة الرحلة' : ''),
    subject: th.subject, status: th.status, trip, peer,
    lastMessageAt: th.last_message_at, lastPreview: th.last_preview, lastSenderRole: th.last_sender_role,
    unread: await chat.unreadCount(th, role),
    locked: await chat.locked(th),
  };
}

/** قائمة محادثاتي (الدعم + الرحلات) */
async function list(req, res, ctx, params, url) {
  const as = asOf(url);
  if (as === 'captain') await ensureCaptain(ctx.user.id);
  const rows = as === 'captain'
    ? await db.query(`SELECT * FROM chat_threads WHERE (kind = 'support' AND user_id = $1 AND side = 'captain') OR (kind = 'trip' AND peer_user_id = $1)
                       ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 60`, [ctx.user.id])
    : await db.query(`SELECT * FROM chat_threads WHERE user_id = $1 AND side = 'customer'
                       ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 60`, [ctx.user.id]);
  const threads = [];
  for (const th of rows) if (th.last_message_at || th.kind === 'support') threads.push(await threadView(th, as));
  return ok(res, { threads, topics: chat.TOPICS });
}

/** عدد غير المقروء (للنقطة الحمراء على الأيقونات) */
async function unread(req, res, ctx, params, url) {
  const as = asOf(url);
  const rows = as === 'captain'
    ? await db.query(`SELECT * FROM chat_threads WHERE ((kind = 'support' AND user_id = $1 AND side = 'captain') OR (kind = 'trip' AND peer_user_id = $1))
                        AND last_message_at IS NOT NULL AND last_sender_role <> 'captain'`, [ctx.user.id])
    : await db.query(`SELECT * FROM chat_threads WHERE user_id = $1 AND side = 'customer'
                        AND last_message_at IS NOT NULL AND last_sender_role <> 'customer'`, [ctx.user.id]);
  let support = 0; const trips = {};
  for (const th of rows) {
    const n = await chat.unreadCount(th, as);
    if (!n) continue;
    if (th.kind === 'trip') trips[th.trip_id] = (trips[th.trip_id] || 0) + n; else support += n;
  }
  const notif = await db.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND app = $2 AND read_at IS NULL', [ctx.user.id, as]);
  return ok(res, { support, trips, notifications: Number(notif.n) });
}

/** محادثة الرحلة مع الكابتن/الزبون */
async function tripChat(req, res, ctx, params, url) {
  const as = asOf(url);
  const th = await chat.tripThread(params.tripId, ctx.user.id, as);
  const rows = await chat.messages(th.id);
  await chat.markRead(th, as);
  return ok(res, { thread: await threadView(th, as), messages: rows.map((m) => chat.msgView(m, as)) });
}

/** فتح محادثة مع الدعم الفني (أو الإكمال على المفتوحة لنفس الموضوع) */
async function support(req, res, ctx) {
  const body = await parseJson(req);
  const as = asOf(null, body);
  if (as === 'captain') await ensureCaptain(ctx.user.id);
  chat.cleanBody(body.body);
  const th = await chat.openSupport({
    userId: ctx.user.id, side: as, topic: String(body.topic || 'general'),
    tripId: body.tripId ? String(body.tripId) : null, body: body.body,
  });
  return created(res, { thread: await threadView(th, as) });
}

async function load(ctx, id, as) {
  const th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [id]);
  if (!th) throw E.NOT_FOUND('المحادثة غير موجودة');
  const role = chat.roleIn(th, ctx.user.id);
  if (!role || (th.kind === 'support' && role !== as)) throw E.NOT_FOUND('المحادثة غير موجودة');
  return { th, role };
}

async function get(req, res, ctx, params, url) {
  const { th, role } = await load(ctx, params.id, asOf(url));
  const after = url.searchParams.get('after');
  const rows = await chat.messages(th.id, { after: after || null });
  await chat.markRead(th, role);
  return ok(res, { thread: await threadView(th, role), messages: rows.map((m) => chat.msgView(m, role)) });
}

async function send(req, res, ctx, params, url) {
  const body = await parseJson(req);
  const { th, role } = await load(ctx, params.id, asOf(url, body));
  const msg = await chat.post(th, { senderId: ctx.user.id, role, body: body.body });
  return created(res, { message: msg });
}

module.exports = { list, unread, tripChat, support, get, send };
