'use strict';
/**
 * خدمة رموز التحقق.
 * المزوّد قابل للتبديل: dev (سجل الخادم) | whatsapp (WhatsApp Cloud API) | twilio.
 * لا يُخزَّن الرمز نصاً صريحاً، ولا يُسجَّل في اللوق في وضع الإنتاج.
 */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const log = require('../lib/log');
const { E, AppError } = require('../lib/errors');
const { uuid, nowIso } = require('../lib/ids');
const { hashSecret, verifySecret } = require('../lib/hash');
const authmode = require('./authmode');

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
  /**
   * واتساب — WhatsApp Cloud API.
   * واتساب ما بيسمح يبعت نص حر لرقم ما راسلك قبل، فالرمز بينبعت عبر «قالب مصادقة»
   * معتمد من Meta (اسمه في WHATSAPP_TEMPLATE) فيه متغير واحد للرمز وزر «نسخ الرمز».
   */
  async whatsapp({ phone, code }) {
    const w = config.sms.whatsapp;
    if (!w.token || !w.phoneNumberId) {
      log.error('واتساب غير مهيّأ', { hasToken: Boolean(w.token), hasPhoneId: Boolean(w.phoneNumberId) });
      throw new AppError('OTP_SEND_FAILED', 'إرسال الرمز على واتساب مش مجهّز بعد. حاول لاحقاً', 503);
    }
    const components = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
    if (w.copyButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
    let res, data;
    try {
      res = await fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + w.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone.replace(/^\+/, ''),
          type: 'template',
          template: { name: w.template, language: { code: w.lang }, components },
        }),
        signal: AbortSignal.timeout(10000),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      log.error('تعذّر الاتصال بواتساب', { error: e.message });
      throw new AppError('OTP_SEND_FAILED', 'تعذّر إرسال الرمز على واتساب حالياً. حاول بعد قليل', 502);
    }
    if (!res.ok || !data.messages) {
      const err = (data && data.error) || {};
      const detail = (err.error_data && err.error_data.details) || err.message || '';
      log.error('رفض واتساب إرسال الرمز', { status: res.status, code: err.code, subcode: err.error_subcode, detail: String(detail).slice(0, 300) });
      throw new AppError('OTP_SEND_FAILED', whatsappErrorText(err.code), 502);
    }
    log.info('OTP أُرسل عبر واتساب', { phone: phone.slice(0, 7) + '•••', messageId: data.messages[0] && data.messages[0].id });
    return { sent: true, channel: 'whatsapp' };
  },

  /**
   * SMS من تلفون أندرويد برقمك (تطبيق SMS Gateway for Android، الخادم السحابي المجاني).
   * الرسالة قصيرة عشان تضل رسالة وحدة (العربي 70 حرف للرسالة).
   */
  async android({ phone, code }) {
    const a = config.sms.android;
    if (!a.username || !a.password) {
      log.error('SMS أندرويد غير مهيّأ');
      throw new AppError('OTP_SEND_FAILED', 'إرسال الرسائل النصية مش مجهّز بعد. جرّب واتساب', 503);
    }
    let res;
    try {
      res = await fetch(a.url, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${a.username}:${a.password}`).toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ textMessage: { text: `رمز نشمي: ${code}\nلا تعطيه لحدا.` }, phoneNumbers: [phone] }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      log.error('تعذّر الاتصال بخادم رسائل أندرويد', { error: e.message });
      throw new AppError('OTP_SEND_FAILED', 'تعذّر إرسال الرسالة حالياً. جرّب بعد شوي', 502);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      log.error('رفض خادم رسائل أندرويد', { status: res.status, body: t.slice(0, 200) });
      throw new AppError('OTP_SEND_FAILED', res.status === 401 ? 'بيانات تلفون الرسائل غلط — راجع SMSGATE_USERNAME و SMSGATE_PASSWORD' : 'تعذّر إرسال الرسالة حالياً. جرّب بعد شوي', 502);
    }
    return { sent: true, channel: 'sms' };
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

/** رسائل عربية مفهومة لأشهر أخطاء واتساب (التفاصيل الكاملة بسجل الخادم) */
function whatsappErrorText(code) {
  switch (Number(code)) {
    case 131030: return 'هذا الرقم مش مضاف لقائمة الأرقام المسموحة بحساب واتساب التجريبي';
    case 131026: return 'ما قدرنا نوصل لهذا الرقم على واتساب. تأكد إنه عليه واتساب';
    case 190: return 'إعدادات واتساب منتهية الصلاحية. تواصل مع إدارة نشمي';
    case 132000: case 132001: case 132005: case 132007: case 132012:
      return 'قالب رسالة واتساب غير جاهز أو غير معتمد بعد';
    case 130429: case 131048: case 131056: case 80007:
      return 'طلبات كثيرة على واتساب. استنى شوي وجرّب مرة ثانية';
    default: return 'تعذّر إرسال الرمز على واتساب حالياً. حاول بعد قليل';
  }
}

async function issue({ phone, ip, purpose = 'login', providerName }) {
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
  const otpId = uuid();
  await db.query(
    `INSERT INTO otp_codes (id, phone_e164, code_hash, purpose, expires_at, ip, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [otpId, phone, hashSecret(code), purpose, new Date(now + config.otp.ttlSec * 1000).toISOString(), ip || null, nowIso()]
  );

  const pname = providerName || await authmode.mode();
  const provider = providers[pname] || providers.dev;
  let result;
  try {
    result = await provider({ phone, code });
  } catch (e) {
    // فترة المعاينة فقط (OTP_DEV_SHOW=1): إذا فشل واتساب/SMS نعرض الرمز على الشاشة
    // مع سبب الفشل، حتى ما ينقفل الدخول على أحد أثناء تجهيز المزوّد.
    // (مش مع احتياط SMS بوضع واتساب: هناك عرض الرمز بيفتح باب دخول على أرقام الناس)
    if (config.sms.showDevCode && pname !== 'dev' && !providerName) {
      log.warn('فشل المزوّد — عرض الرمز على الشاشة (فترة المعاينة)', { provider: pname });
      return {
        channel: 'dev', expiresInSec: config.otp.ttlSec, resendAfterSec: config.otp.resendCooldownSec,
        devCode: code, notice: e.message,
      };
    }
    // الإرسال فشل: نحذف الرمز حتى ما تنحسب المحاولة ضد المستخدم
    await db.query('DELETE FROM otp_codes WHERE id = $1', [otpId]);
    throw e;
  }

  // الرمز لا يُعاد للتطبيق إلا في وضع التطوير الصريح
  const exposeCode = result.channel === 'dev' && config.sms.showDevCode;
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

module.exports = { issue, verifyCode, generateCode, providers, whatsappErrorText };
