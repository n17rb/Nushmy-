'use strict';
const crypto = require('crypto');

/** تجزئة رمز OTP بـ scrypt مع ملح — لا نخزّن الرمز نصاً صريحاً أبداً */
function hashSecret(value) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(value), salt, 32);
  return salt.toString('hex') + ':' + dk.toString('hex');
}

function verifySecret(value, stored) {
  try {
    const [saltHex, dkHex] = String(stored).split(':');
    const dk = crypto.scryptSync(String(value), Buffer.from(saltHex, 'hex'), 32);
    const a = Buffer.from(dkHex, 'hex');
    return a.length === dk.length && crypto.timingSafeEqual(a, dk);
  } catch { return false; }
}

/** تجزئة سريعة لرموز الجلسات (قيمة عشوائية أصلاً فلا تحتاج scrypt) */
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

module.exports = { hashSecret, verifySecret, sha256 };
