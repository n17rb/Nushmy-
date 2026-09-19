'use strict';
const db = require('../db');
const files = require('../services/files');
const auth = require('../services/auth');
const { parseJson, ok } = require('../lib/http');
const { str } = require('../lib/validate');
const { nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');

async function me(req, res, ctx) {
  return ok(res, { user: auth.publicUser(ctx.user) });
}

async function update(req, res, ctx) {
  const body = await parseJson(req);
  const fields = [];
  const params = [];
  let i = 1;

  if (body.name !== undefined) {
    const name = str(body.name, { min: 2, max: 60, field: 'الاسم' });
    fields.push(`name = $${i++}`); params.push(name);
  }
  if (body.email !== undefined) {
    const email = body.email === null || body.email === '' ? null : str(body.email, { max: 120, field: 'البريد الإلكتروني' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw E.VALIDATION_FAILED('البريد الإلكتروني غير صحيح');
    fields.push(`email = $${i++}`); params.push(email);
  }
  if (body.theme !== undefined) {
    if (!['system', 'light', 'dark'].includes(body.theme)) throw E.VALIDATION_FAILED('قيمة المظهر غير صحيحة');
    fields.push(`theme = $${i++}`); params.push(body.theme);
  }
  if (body.language !== undefined) {
    if (!['ar', 'en'].includes(body.language)) throw E.VALIDATION_FAILED('اللغة غير مدعومة');
    fields.push(`language = $${i++}`); params.push(body.language);
  }
  if (!fields.length) throw E.VALIDATION_FAILED('لا يوجد ما يتم تحديثه');

  fields.push(`updated_at = $${i++}`); params.push(nowIso());
  params.push(ctx.user.id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, params);

  const user = await db.one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  return ok(res, { user: auth.publicUser(user) });
}

const MAX_PHOTO_BYTES = 800 * 1024;

/** معرّف الملف من رابط الصورة /media/<id> */
const mediaId = (url) => (url && url.startsWith('/media/') ? url.slice(7) : null);

/** الصورة تصل كـ data URL بعد تصغيرها في المتصفح، وتُحفظ بقاعدة البيانات (ما بتضيع عند إعادة تشغيل السيرفر) */
async function uploadPhoto(req, res, ctx) {
  const body = await parseJson(req);
  const id = await files.save(body.dataUrl, { ownerId: ctx.user.id, kind: 'avatar', isPrivate: false, maxBytes: MAX_PHOTO_BYTES });
  const old = mediaId(ctx.user.photo_url);
  await db.query('UPDATE users SET photo_url = $1, updated_at = $2 WHERE id = $3', [`/media/${id}`, nowIso(), ctx.user.id]);
  await files.remove(old);
  const user = await db.one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  return ok(res, { user: auth.publicUser(user) });
}

async function removePhoto(req, res, ctx) {
  const old = mediaId(ctx.user.photo_url);
  await db.query('UPDATE users SET photo_url = NULL, updated_at = $1 WHERE id = $2', [nowIso(), ctx.user.id]);
  await files.remove(old);
  const user = await db.one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  return ok(res, { user: auth.publicUser(user) });
}

module.exports = { me, update, uploadPhoto, removePhoto };
