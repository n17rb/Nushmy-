'use strict';
const db = require('../db');
const { parseJson, ok, created } = require('../lib/http');
const { str, latLng } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');

async function list(req, res, ctx) {
  const saved = await db.query(
    'SELECT id, kind, label, address, lat, lng FROM saved_places WHERE user_id = $1 ORDER BY created_at',
    [ctx.user.id]
  );
  const recent = await db.query(
    'SELECT id, label, address, lat, lng, used_at FROM recent_places WHERE user_id = $1 ORDER BY used_at DESC LIMIT 8',
    [ctx.user.id]
  );
  return ok(res, { saved, recent });
}

async function save(req, res, ctx) {
  const body = await parseJson(req);
  const label = str(body.label, { min: 1, max: 60, field: 'اسم المكان' });
  const kind = ['home', 'work', 'custom'].includes(body.kind) ? body.kind : 'custom';
  const { lat, lng } = latLng(body.lat, body.lng);
  const address = str(body.address, { max: 250, field: 'العنوان', required: false });
  const now = nowIso();

  if (kind !== 'custom') {
    const existing = await db.one('SELECT id FROM saved_places WHERE user_id = $1 AND kind = $2', [ctx.user.id, kind]);
    if (existing) {
      await db.query(
        'UPDATE saved_places SET label = $1, address = $2, lat = $3, lng = $4, updated_at = $5 WHERE id = $6',
        [label, address, lat, lng, now, existing.id]
      );
      const row = await db.one('SELECT id, kind, label, address, lat, lng FROM saved_places WHERE id = $1', [existing.id]);
      return ok(res, { place: row });
    }
  }
  const id = uuid();
  await db.query(
    `INSERT INTO saved_places (id, user_id, kind, label, address, lat, lng, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [id, ctx.user.id, kind, label, address, lat, lng, now]
  );
  const row = await db.one('SELECT id, kind, label, address, lat, lng FROM saved_places WHERE id = $1', [id]);
  return created(res, { place: row });
}

async function remove(req, res, ctx, params) {
  const row = await db.one('SELECT id FROM saved_places WHERE id = $1 AND user_id = $2', [params.id, ctx.user.id]);
  if (!row) throw E.NOT_FOUND('المكان غير موجود');
  await db.query('DELETE FROM saved_places WHERE id = $1', [row.id]);
  return ok(res, {});
}

/** تسجيل وجهة مستخدمة حديثاً (تُستدعى عند تأكيد الرحلة) */
async function touchRecent(userId, { label, address, lat, lng }) {
  const existing = await db.one(
    'SELECT id FROM recent_places WHERE user_id = $1 AND ABS(lat - $2) < 0.0004 AND ABS(lng - $3) < 0.0004',
    [userId, lat, lng]
  );
  const now = nowIso();
  if (existing) {
    await db.query('UPDATE recent_places SET used_at = $1, label = $2, address = $3 WHERE id = $4',
      [now, label, address || null, existing.id]);
    return;
  }
  await db.query(
    'INSERT INTO recent_places (id, user_id, label, address, lat, lng, used_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuid(), userId, label, address || null, lat, lng, now]
  );
  const extra = await db.query(
    'SELECT id FROM recent_places WHERE user_id = $1 ORDER BY used_at DESC', [userId]
  );
  for (const row of extra.slice(12)) await db.query('DELETE FROM recent_places WHERE id = $1', [row.id]);
}

module.exports = { list, save, remove, touchRecent };
