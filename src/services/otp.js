'use strict';
/**
 * خدمة رموز التحقق.
 * المزوّد قابل للتبديل: dev (سجل الخادم) | twilio | مزوّد محلي.
 * لا يُخزَّن الرمز نصاً صريحاً، ولا يُسجَّل في اللوق في وضع الإنتاج.
 */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const log = require('../lib/log');
const { E } = require('../lib/errors');
const { uuid, nowIso } = require('../lib/ids');
const { hashSecret, verifySecret } = require('../lib/hash');

function generateCode(len) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (const b of bytes) out += String(b % 10);
  return out;
}

const providers = {
  async dev({ phone, code }) {
    log.info('OTP (وضع التطوير)', { phone, code });
    return { sent: true, channel: 'dev', devCode: code };
  },
  async twilio({ phone, code }) {
    const { sid, token, from } = config.sms.twilio;
    if (!sid || !token || !from) {
      throw E.VALIDATION_FAILED('مزوّد الرسائل Twilio غير مهيّأ. أضف بيانات الحساب في متغيرات البيئة');
    }
    const body = new URLSearchParams({ To: phone, From: from, Body: `رمز الدخول إلى نشمي: ${code}` });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const t = await res.text();
      log.error('فشل إرسال الرسالة', { status: res.status, body: t.slice(0, 300) });
      throw E.VALIDATION_FAILED('تعذّر إرسال الرمز حالياً. حاول بعد قليل');
    }
    return { sent: true, channel: 'sms' };
  },
};

async function issue({ phone, ip, purpose = 'login' }) {
  const now = Date.now();
  // منع الإرسال المتكرر السريع
  const last = await db.one(
    'SELECT created_at FROM otp_codes WHERE phone_e164 = $1 ORDER BY created_at DESC',
    [phone]
  );
  if (last) {
    const since = (now - Date.parse(last.created_at)) / 1000;
    if (since < config.otp.resendCooldownSec) {
      throw E.OTP_RATE_LIMITED(Math.ceil(config.otp.resendCooldownSec - since));
    }
  }
  const hourAgo = new Date(now - 3600_000).toISOString();
  const recent = await db.one(
    'SELECT COUNT(*) AS c FROM otp_codes WHERE phone_e164 = $1 AND created_at > $2',
    [phone, hourAgo]
  );
  if (Number(recent.c) >= config.otp.maxPerHourPerPhone) throw E.OTP_TOO_MANY();

  const code = generateCode(config.otp.length);
  await db.query(
    `INSERT INTO otp_codes (id, phone_e164, code_hash, purpose, expires_at, ip, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuid(), phone, hashSecret(code), purpose, new Date(now + config.otp.ttlSec * 1000).toISOString(), ip || null, nowIso()]
  );

  const provider = providers[config.sms.provider] || providers.dev;
  const result = await provider({ phone, code });

  // الرمز لا يُعاد للتطبيق إلا في وضع التطوير الصريح وغير الإنتاجي
  const exposeCode = config.sms.provider === 'dev' && config.sms.showDevCode;
  return {
    channel: result.channel,
    expiresInSec: config.otp.ttlSec,
    resendAfterSec: config.otp.resendCooldownSec,
    devCode: exposeCode ? code : undefined,
  };
}

async function verifyCode({ phone, code }) {
  const row = await db.one(
    `SELECT * FROM otp_codes
      WHERE phone_e164 = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC`,
    [phone]
  );
  if (!row) throw E.OTP_NOT_FOUND();
  if (Date.parse(row.expires_at) < Date.now()) throw E.OTP_EXPIRED();
  if (row.attempts >= config.otp.maxAttempts) throw E.OTP_ATTEMPTS_EXCEEDED();

  if (!verifySecret(String(code).trim(), row.code_hash)) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw E.OTP_INVALID();
  }
  await db.query('UPDATE otp_codes SET consumed_at = $1 WHERE id = $2', [nowIso(), row.id]);
  return true;
}

module.exports = { issue, verifyCode, generateCode };
