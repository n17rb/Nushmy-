'use strict';
/**
 * المكالمة داخل التطبيق (صوت عبر الإنترنت) بين الزبون والكابتن.
 *
 * ليش: في ناس ما عندهم رصيد. المكالمة بتمشي على الإنترنت (WebRTC) متل الماسنجر،
 * والصوت بيروح بين التلفونين مباشرة — السيرفر بس بيمرّر رسائل الربط.
 * كمان ما بيبين رقم حدا للثاني.
 */
const db = require('../db');
const settings = require('./settings');
const notify = require('./notify');
const { uuid, nowIso } = require('../lib/ids');
const { E, AppError } = require('../lib/errors');

const ACTIVE_TRIP = ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'TRIP_STARTED'];
const AFTER_TRIP_MS = 2 * 3600 * 1000;      // بتضل تقدر تتصل ساعتين بعد الرحلة
const MAX_PAYLOAD = 12000;

/** إعدادات الاتصال للتطبيق (خوادم STUN/TURN) */
async function ice() {
  const [enabled, stun, turnUrl, turnUser, turnPass, ring] = await Promise.all([
    settings.get('call.enabled'), settings.get('call.stun_url'),
    settings.get('call.turn_url'), settings.get('call.turn_user'), settings.get('call.turn_pass'),
    settings.get('call.ring_sec'),
  ]);
  const iceServers = [];
  if (stun) iceServers.push({ urls: String(stun).split(',').map((u) => u.trim()).filter(Boolean) });
  if (turnUrl) iceServers.push({ urls: String(turnUrl).split(',').map((u) => u.trim()).filter(Boolean), username: turnUser || undefined, credential: turnPass || undefined });
  const ringSec = Number(ring);
  return { enabled: Boolean(enabled), iceServers, ringSec: Number.isFinite(ringSec) ? ringSec : 45 };
}

/** طرفا الرحلة: الزبون والكابتن (مع أسمائهم) */
async function partiesOf(tripId) {
  const t = await db.one(
    `SELECT t.id, t.code, t.status, t.customer_id, t.completed_at, t.cancelled_at, t.updated_at,
            c.user_id AS captain_user_id, cu.name AS customer_name, cu.photo_url AS customer_photo,
            capu.name AS captain_name, capu.photo_url AS captain_photo
       FROM trips t
       LEFT JOIN captains c ON c.id = t.captain_id
       LEFT JOIN users cu ON cu.id = t.customer_id
       LEFT JOIN users capu ON capu.id = c.user_id
      WHERE t.id = $1`, [tripId]);
  return t || null;
}

const firstName = (n) => (n ? String(n).trim().split(/\s+/)[0] : '');

function tripCallable(t) {
  if (!t || !t.captain_user_id) return false;
  if (ACTIVE_TRIP.includes(t.status)) return true;
  const end = Date.parse(t.completed_at || t.cancelled_at || t.updated_at);
  return Date.now() - end < AFTER_TRIP_MS;
}

/** بدء مكالمة */
async function start({ tripId, userId, as }) {
  const cfg = await ice();
  if (!cfg.enabled) throw new AppError('CALL_OFF', 'المكالمة داخل التطبيق مش مفعّلة حالياً', 409);
  const t = await partiesOf(tripId);
  if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
  const isCaptain = as === 'captain';
  const me = isCaptain ? t.captain_user_id : t.customer_id;
  if (me !== userId) throw E.NOT_FOUND('الرحلة غير موجودة');
  if (!tripCallable(t)) throw new AppError('CALL_CLOSED', 'المكالمة بتشتغل خلال الرحلة وبعدها بساعتين', 409);

  const peer = isCaptain ? t.customer_id : t.captain_user_id;
  const now = nowIso();

  // مكالمة شغالة أصلاً؟ منرجعها بدل ما نفتح وحدة جديدة
  const live = await db.one(
    `SELECT * FROM calls WHERE trip_id = $1 AND status IN ('RINGING','ACTIVE') ORDER BY created_at DESC`, [tripId]);
  if (live && (live.caller_id === userId || live.callee_id === userId)) return { call: live, ice: cfg, resumed: true };
  if (live) throw new AppError('CALL_BUSY', 'في مكالمة شغالة حالياً', 409);

  const id = uuid();
  await db.query(
    `INSERT INTO calls (id, trip_id, caller_id, callee_id, caller_role, status, created_at)
     VALUES ($1,$2,$3,$4,$5,'RINGING',$6)`,
    [id, tripId, userId, peer, isCaptain ? 'captain' : 'customer', now]);

  // رنّة على تلفون الطرف الثاني حتى لو التطبيق مسكّر
  const callerName = firstName(isCaptain ? t.captain_name : t.customer_name);
  notify.fire(peer, isCaptain ? 'customer' : 'captain', {
    type: 'call', title: `📞 ${callerName || (isCaptain ? 'الكابتن' : 'الزبون')} عم يتصل فيك`,
    body: 'مكالمة نشمي — افتح التطبيق للرد', url: isCaptain ? '/#call' : '/captain/#call',
    tag: 'call', inbox: false, data: { callId: id, tripId },
  });

  const call = await db.one('SELECT * FROM calls WHERE id = $1', [id]);
  return { call, ice: cfg, resumed: false };
}

/** المكالمة بشكلها الي بيوصل للتطبيق */
async function view(call, meId) {
  const t = call.trip_id ? await partiesOf(call.trip_id) : null;
  const iAmCaller = call.caller_id === meId;
  const peerIsCaptain = iAmCaller ? call.caller_role === 'customer' : call.caller_role === 'captain';
  const peerName = t ? (peerIsCaptain ? t.captain_name : t.customer_name) : '';
  const peerPhoto = t ? (peerIsCaptain ? t.captain_photo : t.customer_photo) : null;
  return {
    id: call.id, tripId: call.trip_id, status: call.status, endReason: call.end_reason,
    direction: iAmCaller ? 'out' : 'in',
    peer: { name: firstName(peerName) || (peerIsCaptain ? 'الكابتن' : 'الزبون'), photoUrl: peerPhoto, isCaptain: peerIsCaptain },
    tripCode: t ? t.code : null,
    createdAt: call.created_at, answeredAt: call.answered_at, endedAt: call.ended_at,
    ringingForSec: Math.round((Date.now() - Date.parse(call.created_at)) / 1000),
  };
}

/** المكالمة مع التأكد إني طرف فيها */
async function mine(callId, meId) {
  const c = await db.one('SELECT * FROM calls WHERE id = $1', [callId]);
  if (!c || (c.caller_id !== meId && c.callee_id !== meId)) throw E.NOT_FOUND('المكالمة غير موجودة');
  return c;
}

/** الرنّة الطويلة بتصير «مكالمة فايتة» لحالها */
async function expireIfLate(call, ringSec) {
  if (call.status !== 'RINGING') return call;
  if ((Date.now() - Date.parse(call.created_at)) / 1000 < ringSec) return call;
  await end(call, 'missed');
  return db.one('SELECT * FROM calls WHERE id = $1', [call.id]);
}

async function accept(call, meId) {
  if (call.callee_id !== meId) throw E.FORBIDDEN();
  if (call.status === 'ACTIVE') return call;
  if (call.status !== 'RINGING') throw new AppError('CALL_ENDED', 'المكالمة انتهت', 409);
  await db.query(`UPDATE calls SET status = 'ACTIVE', answered_at = $1 WHERE id = $2 AND status = 'RINGING'`, [nowIso(), call.id]);
  return db.one('SELECT * FROM calls WHERE id = $1', [call.id]);
}

async function end(call, reason) {
  if (call.status === 'ENDED') return call;
  const now = nowIso();
  const dur = call.answered_at ? Math.max(0, Math.round((Date.parse(now) - Date.parse(call.answered_at)) / 1000)) : 0;
  await db.query(
    `UPDATE calls SET status = 'ENDED', end_reason = $1, ended_at = $2, duration_s = $3 WHERE id = $4 AND status <> 'ENDED'`,
    [reason || 'hangup', now, dur, call.id]);
  // رسالة بالمحادثة عن المكالمة الفايتة حتى يعرف الطرف الثاني
  if ((reason === 'missed' || reason === 'cancelled') && call.trip_id) {
    try {
      const chat = require('./chat');
      const th = await db.one(`SELECT * FROM chat_threads WHERE kind = 'trip' AND trip_id = $1`, [call.trip_id]);
      if (th) await chat.post(th, { senderId: null, role: 'system', body: '📞 مكالمة فايتة', silent: true });
    } catch { /* ما بتوقف إنهاء المكالمة */ }
  }
  return db.one('SELECT * FROM calls WHERE id = $1', [call.id]);
}

async function signal(call, meId, kind, payload) {
  if (!['offer', 'answer', 'ice'].includes(kind)) throw E.VALIDATION_FAILED('نوع غير معروف');
  if (call.status === 'ENDED') throw new AppError('CALL_ENDED', 'المكالمة انتهت', 409);
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (!text || text.length > MAX_PAYLOAD) throw E.VALIDATION_FAILED('بيانات الاتصال غير صالحة');
  await db.query(
    'INSERT INTO call_signals (id, call_id, from_user, kind, payload, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuid(), call.id, meId, kind, text, nowIso()]);
}

/** رسائل الربط من الطرف الثاني بعد وقت معيّن */
async function signalsFor(call, meId, after) {
  const rows = after
    ? await db.query('SELECT * FROM call_signals WHERE call_id = $1 AND from_user <> $2 AND created_at > $3 ORDER BY created_at', [call.id, meId, after])
    : await db.query('SELECT * FROM call_signals WHERE call_id = $1 AND from_user <> $2 ORDER BY created_at', [call.id, meId]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, at: r.created_at }));
}

module.exports = { ice, start, view, mine, accept, end, signal, signalsFor, expireIfLate, tripCallable, partiesOf };
