'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const auth = require('../services/auth');
const { parseJson, ok } = require('../lib/http');
const { str } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
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
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** الصورة تصل كـ data URL بعد تصغيرها في المتصفح (256×256) — لا حاجة لمعالجة صور على الخادم */
async function uploadPhoto(req, res, ctx) {
  const body = await parseJson(req);
  const dataUrl = String(body.dataUrl || '');
  const m = /^data:([\w/+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw E.UPLOAD_INVALID_TYPE();
  const ext = TYPES[m[1]];
  if (!ext) throw E.UPLOAD_INVALID_TYPE();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_PHOTO_BYTES) throw E.UPLOAD_TOO_LARGE();

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const name = `${ctx.user.id}-${uuid().slice(0, 8)}.${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, name), buf);

  const old = ctx.user.photo_url;
  const url = `/uploads/${name}`;
  await db.query('UPDATE users SET photo_url = $1, updated_at = $2 WHERE id = $3', [url, nowIso(), ctx.user.id]);
  if (old && old.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(config.uploadsDir, path.basename(old))); } catch {}
  }
  const user = await db.one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  return ok(res, { user: auth.publicUser(user) });
}

async function removePhoto(req, res, ctx) {
  const old = ctx.user.photo_url;
  await db.query('UPDATE users SET photo_url = NULL, updated_at = $1 WHERE id = $2', [nowIso(), ctx.user.id]);
  if (old && old.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(config.uploadsDir, path.basename(old))); } catch {}
  }
  const user = await db.one('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  return ok(res, { user: auth.publicUser(user) });
}

module.exports = { me, update, uploadPhoto, removePhoto };
