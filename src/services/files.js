'use strict';
/**
 * تخزين الملفات داخل قاعدة البيانات.
 * السبب: قرص Render المجاني مؤقت ويُمسح عند كل إعادة تشغيل، فتضيع الوثائق وإشعارات التحويل.
 *   - الملفات العامة (صور الحسابات) تُقدَّم على /media/<id>
 *   - الملفات الخاصة (الوثائق، الإشعارات) لا تُفتح إلا للإدارة
 */
const db = require('../db');
const { uuid, nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function save(dataUrl, { ownerId = null, kind, isPrivate = true, maxBytes = 1500 * 1024 }) {
  const m = /^data:([\w/+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || !TYPES[m[1]]) throw E.UPLOAD_INVALID_TYPE();
  const size = Buffer.byteLength(m[2], 'base64');
  if (size > maxBytes) throw E.UPLOAD_TOO_LARGE();
  // نتأكد إنها صورة فعلاً من أول بايتات الملف (مش بس من الاسم)
  const head = Buffer.from(m[2].slice(0, 24), 'base64');
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  const isWebp = head.slice(0, 4).toString() === 'RIFF';
  if (!isJpeg && !isPng && !isWebp) throw E.UPLOAD_INVALID_TYPE();

  const id = uuid().replace(/-/g, '');
  await db.query(
    `INSERT INTO files (id, owner_user_id, kind, mime, size_bytes, data_base64, is_private, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, ownerId, kind, m[1], size, m[2], isPrivate ? 1 : 0, nowIso()]
  );
  return id;
}

async function get(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return null;
  return db.one('SELECT * FROM files WHERE id = $1', [id]);
}

async function remove(id) {
  if (id) await db.query('DELETE FROM files WHERE id = $1', [id]);
}

/** إرسال الملف في الرد */
function send(res, f, { cacheSeconds = 0 } = {}) {
  const buf = Buffer.from(f.data_base64, 'base64');
  res.writeHead(200, {
    'Content-Type': f.mime,
    'Content-Length': buf.length,
    'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}, immutable` : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

module.exports = { save, get, remove, send };
