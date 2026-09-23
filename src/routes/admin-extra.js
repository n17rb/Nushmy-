'use strict';
/**
 * لوحة الإدارة — الإضافات:
 *   المحادثات (صندوق الدعم + محادثات الرحلات)، الإشعارات الجماعية، الأماكن المشهورة، صور السيارات.
 */
const db = require('../db');
const { parseJson, ok, created } = require('../lib/http');
const { str, latLng, normalizeJordanPhone } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
const { E, AppError } = require('../lib/errors');
const { requireAdmin, audit } = require('./admin');
const chat = require('../services/chat');
const notify = require('../services/notify');
const files = require('../services/files');
const arabic = require('../lib/arabic');
const search = require('./search');
const vehicles = require('../data/vehicles');
const settings = require('../services/settings');
const log = require('../lib/log');

const q = (url) => url.searchParams;

/* ================================ المحادثات ================================ */
async function who(userId) {
  if (!userId) return null;
  const u = await db.one('SELECT id, name, phone_e164, photo_url FROM users WHERE id = $1', [userId]);
  return u && { id: u.id, name: u.name, phone: u.phone_e164, photoUrl: u.photo_url };
}

async function threadRow(th) {
  const user = await who(th.user_id);
  const peer = th.kind === 'trip' ? await who(th.peer_user_id) : null;
  let trip = null;
  if (th.trip_id) {
    const t = await db.one(
      `SELECT t.id, t.code, t.status, t.pickup_address, t.dest_address, t.requested_at, t.captain_id, c.user_id AS captain_user_id
         FROM trips t LEFT JOIN captains c ON c.id = t.captain_id WHERE t.id = $1`, [th.trip_id]);
    if (t) trip = { id: t.id, code: t.code, status: t.status, from: t.pickup_address, to: t.dest_address, at: t.requested_at,
      captainUserId: t.captain_user_id, captain: await who(t.captain_user_id) };
  }
  return {
    id: th.id, kind: th.kind, side: th.side, topic: th.topic, topicLabel: chat.TOPICS[th.topic] || 'محادثة رحلة',
    subject: th.subject, status: th.status, user, peer, trip,
    lastMessageAt: th.last_message_at, lastPreview: th.last_preview, lastSenderRole: th.last_sender_role,
    unread: th.kind === 'support' ? await chat.unreadCount(th, 'admin') : 0,
    createdAt: th.created_at,
  };
}

async function chats(req, res, ctx, params, url) {
  await requireAdmin(ctx, 'support');
  const kind = q(url).get('kind') === 'trip' ? 'trip' : 'support';
  const filter = q(url).get('filter') || 'open';
  const side = q(url).get('side');
  const topic = q(url).get('topic');
  const where = ['kind = $1', 'last_message_at IS NOT NULL'];
  const args = [kind];
  if (kind === 'support') {
    if (filter === 'open') where.push(`status = 'OPEN'`);
    if (filter === 'closed') where.push(`status = 'CLOSED'`);
    if (filter === 'unread') where.push(`last_sender_role IN ('customer','captain') AND (admin_read_at IS NULL OR admin_read_at < last_message_at)`);
    if (side === 'customer' || side === 'captain') { args.push(side); where.push(`side = $${args.length}`); }
    if (topic && chat.TOPICS[topic]) { args.push(topic); where.push(`topic = $${args.length}`); }
  }
  const rows = await db.query(`SELECT * FROM chat_threads WHERE ${where.join(' AND ')} ORDER BY last_message_at DESC LIMIT 100`, args);
  const out = [];
  for (const th of rows) out.push(await threadRow(th));
  const unread = await db.one(
    `SELECT COUNT(*) AS n FROM chat_threads WHERE kind = 'support' AND last_sender_role IN ('customer','captain')
       AND (admin_read_at IS NULL OR admin_read_at < last_message_at)`, []);
  return ok(res, { threads: out, unreadThreads: Number(unread.n), topics: chat.TOPICS });
}

/** عدد المحادثات الي بتستنى رد (للنقطة على القائمة الجانبية) */
async function chatsBadge(req, res, ctx) {
  await requireAdmin(ctx);
  const r = await db.one(
    `SELECT COUNT(*) AS n FROM chat_threads WHERE kind = 'support' AND status = 'OPEN' AND last_sender_role IN ('customer','captain')
       AND (admin_read_at IS NULL OR admin_read_at < last_message_at)`, []);
  return ok(res, { waiting: Number(r.n) });
}

async function chatGet(req, res, ctx, params, url) {
  await requireAdmin(ctx, 'support');
  const th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [params.id]);
  if (!th) throw E.NOT_FOUND('المحادثة غير موجودة');
  const after = q(url).get('after');
  const rows = await chat.messages(th.id, { after: after || null, limit: 500 });
  if (th.kind === 'support') await chat.markRead(th, 'admin');
  return ok(res, {
    thread: await threadRow(th),
    messages: rows.map((m) => ({ id: m.id, senderRole: m.sender_role, body: m.body, createdAt: m.created_at, mine: m.sender_role === 'admin' })),
  });
}

async function chatSend(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'support');
  const body = await parseJson(req);
  const th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [params.id]);
  if (!th) throw E.NOT_FOUND('المحادثة غير موجودة');
  if (th.kind !== 'support') throw new AppError('CHAT_READONLY', 'محادثات الرحلات للقراءة بس. افتح محادثة دعم مع الشخص', 409);
  const msg = await chat.post(th, { senderId: admin.id, role: 'admin', body: body.body });
  return created(res, { message: { ...msg, mine: true } });
}

async function chatStatus(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'support');
  const body = await parseJson(req);
  const status = body.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const th = await db.one('SELECT * FROM chat_threads WHERE id = $1', [params.id]);
  if (!th) throw E.NOT_FOUND('المحادثة غير موجودة');
  await db.query('UPDATE chat_threads SET status = $1, updated_at = $2 WHERE id = $3', [status, nowIso(), th.id]);
  if (status === 'CLOSED' && body.note) await chat.post(th, { senderId: admin.id, role: 'admin', body: String(body.note) });
  return ok(res, { status });
}

/** الإدارة بتبدأ محادثة مع زبون أو كابتن (مثلاً: راسل الكابتن عن غرض منسي) */
async function chatStart(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'support');
  const body = await parseJson(req);
  const side = body.side === 'captain' ? 'captain' : 'customer';
  let u = null;
  if (body.phone) {
    let phone;
    try { phone = normalizeJordanPhone(String(body.phone)); } catch { throw E.VALIDATION_FAILED('رقم الهاتف غير صحيح'); }
    u = await db.one('SELECT id FROM users WHERE phone_e164 = $1', [phone]);
    if (!u) throw E.NOT_FOUND('ما في حساب بهذا الرقم');
  } else {
    u = await db.one('SELECT id FROM users WHERE id = $1', [str(body.userId, { field: 'المستخدم' })]);
    if (!u) throw E.NOT_FOUND('المستخدم غير موجود');
  }
  const userId = u.id;
  if (side === 'captain' && !(await db.one('SELECT id FROM captains WHERE user_id = $1', [userId]))) throw E.VALIDATION_FAILED('هذا الحساب مش كابتن');
  chat.cleanBody(body.body);
  const topic = chat.TOPICS[body.topic] ? body.topic : (side === 'captain' ? 'captain_admin' : 'general');
  const th = await chat.openSupport({ userId, side, topic, tripId: body.tripId || null, body: body.body, byAdmin: admin });
  await audit(admin, 'CHAT_STARTED', 'user', userId, null, { threadId: th.id, side, topic }, null, ctx.ip);
  return created(res, { thread: await threadRow(th) });
}

/* ============================ الإشعارات الجماعية ============================ */
const AUDIENCE = { customers: 'كل الزباين', captains: 'كل الكباتن', all: 'الكل' };

async function broadcasts(req, res, ctx) {
  await requireAdmin(ctx, 'broadcast');
  const rows = await db.query('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50', []);
  const subs = await db.query('SELECT app, platform, COUNT(*) AS n FROM push_subscriptions GROUP BY app, platform', []);
  const reach = {
    customers: Number((await db.one(`SELECT COUNT(*) AS n FROM users WHERE status = 'ACTIVE' AND id NOT IN (SELECT user_id FROM captains)`, [])).n),
    captains: Number((await db.one(`SELECT COUNT(*) AS n FROM captains WHERE status = 'APPROVED'`, [])).n),
  };
  return ok(res, {
    broadcasts: rows.map((b) => ({ id: b.id, audience: b.audience, audienceLabel: AUDIENCE[b.audience], title: b.title, body: b.body,
      code: b.promo_code, sent: b.sent_count, pushed: b.push_count, createdAt: b.created_at })),
    push: subs.map((s) => ({ app: s.app, platform: s.platform, count: Number(s.n) })),
    reach, audiences: AUDIENCE,
  });
}

async function broadcastSend(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'broadcast');
  const body = await parseJson(req);
  const audience = AUDIENCE[body.audience] ? body.audience : null;
  if (!audience) throw E.VALIDATION_FAILED('اختار لمين الرسالة');
  const title = str(body.title, { min: 2, max: 80, field: 'العنوان' });
  const text = str(body.body, { min: 2, max: 600, field: 'نص الرسالة' });
  const code = body.code ? str(body.code, { min: 2, max: 30, field: 'الكود' }).toUpperCase().replace(/\s+/g, '') : null;

  // المستلمين: كل تطبيق لحاله
  const targets = [];
  if (audience !== 'captains') {
    const rows = await db.query(`SELECT id FROM users WHERE status = 'ACTIVE'`, []);
    for (const r of rows) targets.push([r.id, 'customer']);
  }
  if (audience !== 'customers') {
    const rows = await db.query(`SELECT user_id FROM captains WHERE status = 'APPROVED'`, []);
    for (const r of rows) targets.push([r.user_id, 'captain']);
  }

  const id = uuid();
  await db.query(
    `INSERT INTO broadcasts (id, audience, title, body, promo_code, sent_count, push_count, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8)`, [id, audience, title, text, code, targets.length, admin.id, nowIso()]);
  await audit(admin, 'BROADCAST_SENT', 'broadcast', id, null, { audience, title, code, recipients: targets.length }, null, ctx.ip);

  // بالخلفية: صندوق الإشعارات لكل واحد + إشعار فوري
  (async () => {
    let pushed = 0;
    for (const [userId, app] of targets) {
      try {
        await notify.toUser(userId, app, {
          type: code ? 'promo' : 'announcement', title, body: text, broadcastId: id,
          data: code ? { code } : null, push: false,
        });
        pushed += await notify.push(userId, app, { title, body: code ? `${text}\nالكود: ${code}` : text, tag: 'b-' + id.slice(0, 8), url: app === 'captain' ? '/captain/#notifications' : '/#notifications' });
      } catch (e) { log.warn('broadcast', { message: e.message }); }
    }
    await db.query('UPDATE broadcasts SET push_count = $1 WHERE id = $2', [pushed, id]);
  })();

  return created(res, { id, recipients: targets.length });
}

/* ============================== الأماكن المشهورة ============================== */
const CATS = { place: 'مكان', shop: 'محل', restaurant: 'مطعم', cafe: 'كافيه', hospital: 'مستشفى', pharmacy: 'صيدلية',
  school: 'مدرسة', university: 'جامعة', mosque: 'مسجد', government: 'دائرة حكومية', bank: 'بنك', fuel: 'محطة وقود',
  mall: 'مول', hotel: 'فندق', station: 'مجمّع', landmark: 'معلم' };

async function pois(req, res, ctx, params, url) {
  await requireAdmin(ctx, 'places');
  const text = q(url).get('q') || '';
  const rows = await db.query('SELECT * FROM pois ORDER BY created_at DESC LIMIT 1000', []);
  const list = text ? rows.filter((r) => arabic.score(text, r.name) > 0) : rows;
  return ok(res, {
    pois: list.slice(0, 300).map((p) => ({ id: p.id, name: p.name, category: p.category, categoryLabel: CATS[p.category] || p.category,
      address: p.address, lat: p.lat, lng: p.lng, isActive: Boolean(p.is_active), createdAt: p.created_at })),
    total: rows.length, categories: CATS,
  });
}

async function poiSave(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'places');
  const body = await parseJson(req);
  const name = str(body.name, { min: 2, max: 80, field: 'اسم المكان' });
  const category = CATS[body.category] ? body.category : 'place';
  const address = str(body.address, { max: 160, field: 'العنوان', required: false });
  const { lat, lng } = latLng(body.lat, body.lng);
  const now = nowIso();
  if (params && params.id) {
    const ex = await db.one('SELECT * FROM pois WHERE id = $1', [params.id]);
    if (!ex) throw E.NOT_FOUND('المكان غير موجود');
    await db.query('UPDATE pois SET name = $1, name_norm = $2, category = $3, address = $4, lat = $5, lng = $6, is_active = $7, updated_at = $8 WHERE id = $9',
      [name, arabic.normalize(name), category, address, lat, lng, body.isActive === false ? 0 : 1, now, ex.id]);
    await audit(admin, 'POI_UPDATED', 'poi', ex.id, { name: ex.name }, { name, category }, null, ctx.ip);
    search.invalidate();
    return ok(res, { id: ex.id });
  }
  const id = uuid();
  await db.query(
    `INSERT INTO pois (id, name, name_norm, category, address, lat, lng, is_active, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$9)`, [id, name, arabic.normalize(name), category, address, lat, lng, admin.id, now]);
  await audit(admin, 'POI_CREATED', 'poi', id, null, { name, category, lat, lng }, null, ctx.ip);
  search.invalidate();
  return created(res, { id });
}

async function poiDelete(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'places');
  const ex = await db.one('SELECT * FROM pois WHERE id = $1', [params.id]);
  if (!ex) throw E.NOT_FOUND('المكان غير موجود');
  await db.query('DELETE FROM pois WHERE id = $1', [ex.id]);
  await audit(admin, 'POI_DELETED', 'poi', ex.id, { name: ex.name }, null, null, ctx.ip);
  search.invalidate();
  return ok(res, {});
}

/* ================================ صور السيارات ================================ */
async function carImages(req, res, ctx) {
  await requireAdmin(ctx, 'settings');
  const rows = await db.query('SELECT * FROM car_images ORDER BY make_id, class_id', []);
  // الفئات الي عند الكباتن فعلاً — عشان تعرف شو الصور الناقصة وأهمها
  const used = await db.query(
    `SELECT v.make_id, v.class_id, COUNT(*) AS n FROM vehicles v
       JOIN captains c ON c.id = v.captain_id
      WHERE v.is_active = 1 AND v.class_id IS NOT NULL AND c.status <> 'REJECTED'
      GROUP BY v.make_id, v.class_id ORDER BY n DESC LIMIT 200`, []);
  const has = (m, c) => rows.some((r) => r.make_id === m && r.class_id === c);
  const label = (m, c) => {
    const mk = vehicles.makeById(m), cl = vehicles.classById(m, c);
    return [mk && mk.ar, cl && cl.ar].filter(Boolean).join(' ') || `${m} ${c}`;
  };
  return ok(res, {
    images: rows.map((r) => ({
      id: r.id, makeId: r.make_id, classId: r.class_id, url: '/media/' + r.file_id,
      label: label(r.make_id, r.class_id), captains: Number((used.find((u) => u.make_id === r.make_id && u.class_id === r.class_id) || {}).n || 0),
      createdAt: r.created_at,
    })),
    missing: used.filter((u) => !has(u.make_id, u.class_id)).map((u) => ({
      makeId: u.make_id, classId: u.class_id, captains: Number(u.n), label: label(u.make_id, u.class_id),
    })),
  });
}

async function carImageSave(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'settings');
  const body = await parseJson(req);
  const makeId = str(body.makeId, { field: 'الشركة' });
  const classId = str(body.classId, { field: 'الفئة' });
  if (!vehicles.classById(makeId, classId)) throw E.VALIDATION_FAILED('الفئة مش موجودة بالكتالوج');
  const fileId = await files.save(body.dataUrl, { ownerId: admin.id, kind: 'car_image', isPrivate: false, maxBytes: 900 * 1024 });
  const old = await db.one('SELECT * FROM car_images WHERE make_id = $1 AND class_id = $2', [makeId, classId]);
  if (old) {
    await db.query('UPDATE car_images SET file_id = $1, created_by = $2, created_at = $3 WHERE id = $4', [fileId, admin.id, nowIso(), old.id]);
    await files.remove(old.file_id);
  } else {
    await db.query(`INSERT INTO car_images (id, make_id, class_id, color_key, file_id, created_by, created_at) VALUES ($1,$2,$3,'',$4,$5,$6)`,
      [uuid(), makeId, classId, fileId, admin.id, nowIso()]);
  }
  await audit(admin, 'CAR_IMAGE_SAVED', 'car_image', `${makeId}/${classId}`, null, { fileId }, null, ctx.ip);
  // التنبيهات الي كانت تقول «هاي الفئة بدون صورة» ما عاد إلها داعي
  await db.query(`UPDATE notifications SET read_at = $1 WHERE app = 'admin' AND type = 'car_image_missing' AND read_at IS NULL AND data_json LIKE $2`,
    [nowIso(), `%"${classId}"%`]);
  return created(res, { url: '/media/' + fileId });
}

async function carImageDelete(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'settings');
  const r = await db.one('SELECT * FROM car_images WHERE id = $1', [params.id]);
  if (!r) throw E.NOT_FOUND('الصورة غير موجودة');
  await db.query('DELETE FROM car_images WHERE id = $1', [r.id]);
  await files.remove(r.file_id);
  await audit(admin, 'CAR_IMAGE_DELETED', 'car_image', r.id, { makeId: r.make_id, classId: r.class_id }, null, null, ctx.ip);
  return ok(res, {});
}

/* ============================== تنبيهات الإدارة ============================== */
async function alerts(req, res, ctx, params, url) {
  const admin = await requireAdmin(ctx);
  const rows = await db.query(
    `SELECT * FROM notifications WHERE user_id = $1 AND app = 'admin' ORDER BY created_at DESC LIMIT 100`, [admin.id]);
  const unread = rows.filter((r) => !r.read_at).length;
  return ok(res, {
    unread,
    alerts: rows.map((n) => {
      let data = null; try { data = n.data_json ? JSON.parse(n.data_json) : null; } catch {}
      return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, data, read: Boolean(n.read_at), createdAt: n.created_at };
    }),
  });
}

async function alertsRead(req, res, ctx) {
  const admin = await requireAdmin(ctx);
  const body = await parseJson(req);
  if (Array.isArray(body.ids) && body.ids.length) {
    for (const id of body.ids.slice(0, 100)) {
      await db.query(`UPDATE notifications SET read_at = $1 WHERE id = $2 AND user_id = $3`, [nowIso(), String(id), admin.id]);
    }
  } else {
    await db.query(`UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND app = 'admin' AND read_at IS NULL`, [nowIso(), admin.id]);
  }
  return ok(res, {});
}

/** صور الفئات (للتطبيقات) — مفتاح: makeId/classId */
async function classImages(req, res) {
  const rows = await db.query('SELECT make_id, class_id, file_id FROM car_images', []);
  const images = {};
  for (const r of rows) images[`${r.make_id}/${r.class_id}`] = '/media/' + r.file_id;
  return ok(res, { images });
}

module.exports = {
  chats, chatsBadge, chatGet, chatSend, chatStatus, chatStart,
  broadcasts, broadcastSend, pois, poiSave, poiDelete, carImages, carImageSave, carImageDelete, alerts, alertsRead, classImages,
};
