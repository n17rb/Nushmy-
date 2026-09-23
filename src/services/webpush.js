'use strict';
/**
 * Web Push — إشعارات تظهر على التلفون حتى لو التطبيق مسكّر (متل إنستقرام).
 * بدون أي مكتبة: تشفير الرسالة (RFC 8291 / aes128gcm) وتوقيع VAPID (ES256) بـ node:crypto.
 *
 *  - أندرويد (Chrome) والكمبيوتر: شغال مباشرة من الموقع.
 *  - آيفون: لازم الزبون «يضيف نشمي للشاشة الرئيسية» (iOS 16.4+) وبعدها بيسمح بالإشعارات.
 *  - تطبيقات المتجر (Play / App Store): بتستخدم Firebase — شوف services/fcm.js
 *
 * مفاتيح VAPID بتتولّد لحالها أول مرة وبتنحفظ بالإعدادات (أو من Render: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
 */
const crypto = require('crypto');
const settings = require('./settings');
const log = require('../lib/log');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ------------------------------ مفاتيح VAPID ------------------------------ */
let keys = null;
async function vapidKeys() {
  if (keys) return keys;
  let pub = process.env.VAPID_PUBLIC_KEY || (await settings.get('push.vapid_public')) || '';
  let priv = process.env.VAPID_PRIVATE_KEY || (await settings.get('push.vapid_private')) || '';
  if (!pub || !priv) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey());          // 65 بايت (غير مضغوط)
    priv = b64u(ecdh.getPrivateKey());        // 32 بايت
    await settings.set('push.vapid_public', pub);
    await settings.set('push.vapid_private', priv);
    log.info('تم توليد مفاتيح الإشعارات (VAPID)');
  }
  keys = { publicKey: pub, privateKey: priv };
  return keys;
}

/** مفتاح خاص بصيغة KeyObject من (d + النقطة العامة) */
function privateKeyObject(pubB64u, privB64u) {
  const pubRaw = unb64u(pubB64u);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privB64u, x: b64u(pubRaw.subarray(1, 33)), y: b64u(pubRaw.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** توقيع VAPID: JWT بـ ES256 للجهة الي بتستقبل (FCM / Mozilla / Apple) */
function vapidAuth(endpoint, k, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKeyObject(k.publicKey, k.privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${k.publicKey}`;
}

/* ------------------------------ تشفير الرسالة ------------------------------ */
/**
 * RFC 8291: الرسالة بتتشفّر بمفتاح الجهاز، فحتى Google/Apple ما بيقدروا يقرؤوها.
 * @returns {Buffer} جسم الطلب (رأس aes128gcm + النص المشفّر)
 */
function encrypt(payload, p256dhB64u, authB64u, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = unb64u(p256dhB64u);
  const authSecret = unb64u(authB64u);
  const server = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);   // 0x02 = آخر سجل
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/**
 * إرسال إشعار لاشتراك واحد.
 * @returns {Promise<{ok:boolean, gone?:boolean, status?:number}>} gone = الاشتراك انتهى (لازم ينحذف)
 */
async function send(sub, data, { ttl = 86400, urgency = 'high', topic } = {}) {
  const k = await vapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@nashmi.app';
  const body = encrypt(JSON.stringify(data), sub.p256dh, sub.auth);
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: vapidAuth(sub.endpoint, k, subject),
  };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
    if (!res.ok) {
      log.warn('فشل إرسال إشعار', { status: res.status, host: new URL(sub.endpoint).host });
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

module.exports = { vapidKeys, send, encrypt, vapidAuth, b64u, unb64u, _reset: () => { keys = null; } };
