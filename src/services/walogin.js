'use strict';
/**
 * الدخول بواتساب — بدون قالب وبدون توثيق نشاط تجاري.
 *
 * الفكرة: بدل ما نشمي يبعت رمز للزبون (بده قالب «مصادقة» وMeta بتطلب له سجل تجاري)،
 * الزبون هو الي بيبعت رسالة فيها الرمز لرقم نشمي. واتساب نفسه بيضمن إن الرسالة
 * طالعة من رقمه، فبنأكد إنه صاحب الرقم ومنسجّله دخول.
 *
 *   1. التطبيق: start(phone)  ← معرّف سري + رمز + رابط wa.me جاهز بالرسالة
 *   2. الزبون بيكبس «إرسال» بواتساب
 *   3. Meta بتبعتلنا الرسالة (Webhook) ← handleInbound(from, text) ← الطلب بيصير VERIFIED
 *   4. التطبيق بيسأل كل ثانيتين check(id) ← أول ما يصير VERIFIED بنفتح الجلسة
 *
 * رسائل الزبون وردودنا خلال 24 ساعة ما عليها رسوم من Meta.
 */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const log = require('../lib/log');
const { AppError } = require('../lib/errors');
const { uuid, nowIso } = require('../lib/ids');
const { normalizeJordanPhone } = require('../lib/validate');
const whatsapp = require('./whatsapp');
const authmode = require('./authmode');
const settings = require('./settings');

const TTL_SEC = 10 * 60;          // صلاحية الطلب
const COOLDOWN_SEC = 20;          // أقل مدة بين طلبين لنفس الرقم
const MAX_PER_HOUR = 10;

const w = () => config.sms.whatsapp;
const enabled = async () => (await authmode.mode()) === 'whatsapp_link';

/* ------------------------------ رقم نشمي ------------------------------ */
let cachedNumber = null;
async function businessNumber() {
  if (w().number) return w().number;
  if (cachedNumber) return cachedNumber;
  if (!w().token || !w().phoneNumberId) return null;
  const r = await whatsapp.graph('GET', `${w().phoneNumberId}?fields=display_phone_number`);
  if (r.ok && r.data.display_phone_number) cachedNumber = String(r.data.display_phone_number).replace(/\D/g, '');
  return cachedNumber;
}

const messageText = (code) => `رمز الدخول لنشمي: ${code}`;

/* ------------------------------ 1) بدء الطلب ------------------------------ */
async function start({ phone, ip }) {
  const number = await businessNumber();
  if (!number) throw new AppError('WA_NOT_READY', 'الدخول بواتساب مش مجهّز بعد. حاول لاحقاً', 503);

  const now = Date.now();
  const last = await db.one('SELECT created_at FROM wa_logins WHERE phone_e164 = $1 ORDER BY created_at DESC', [phone]);
  if (last) {
    const since = (now - Date.parse(last.created_at)) / 1000;
    if (since < COOLDOWN_SEC) throw new AppError('OTP_RATE_LIMITED', `استنى ${Math.ceil(COOLDOWN_SEC - since)} ثانية وجرّب`, 429);
  }
  const recent = await db.one('SELECT COUNT(*) AS n FROM wa_logins WHERE phone_e164 = $1 AND created_at > $2',
    [phone, new Date(now - 3600_000).toISOString()]);
  if (Number(recent.n) >= MAX_PER_HOUR) throw new AppError('OTP_TOO_MANY', 'طلبات كثيرة لهاد الرقم. جرّب بعد ساعة', 429);

  // رمز من 6 أرقام ما بيتكرر مع طلب شغال
  let code;
  for (let i = 0; i < 8; i++) {
    code = String(crypto.randomInt(100000, 1000000));
    const clash = await db.one(`SELECT id FROM wa_logins WHERE code = $1 AND status = 'PENDING' AND expires_at > $2`, [code, nowIso()]);
    if (!clash) break;
  }
  const id = crypto.randomBytes(16).toString('hex');
  await db.query(
    `INSERT INTO wa_logins (id, phone_e164, code, status, ip, created_at, expires_at) VALUES ($1,$2,$3,'PENDING',$4,$5,$6)`,
    [id, phone, code, ip || null, nowIso(), new Date(now + TTL_SEC * 1000).toISOString()]);

  const text = messageText(code);
  return {
    id, code, text, number,
    link: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    expiresInSec: TTL_SEC,
  };
}

/* ------------------------------ 4) فحص الحالة ------------------------------ */
async function check(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id || ''))) throw new AppError('WA_NOT_FOUND', 'طلب الدخول مش موجود. ابدأ من جديد', 404);
  const row = await db.one('SELECT * FROM wa_logins WHERE id = $1', [id]);
  if (!row) throw new AppError('WA_NOT_FOUND', 'طلب الدخول مش موجود. ابدأ من جديد', 404);
  if (row.status === 'VERIFIED') {
    // مرة وحدة بس: أول فحص بعد التأكيد بياخذ الجلسة
    const used = await db.query(`UPDATE wa_logins SET status = 'USED' WHERE id = $1 AND status = 'VERIFIED' RETURNING id`, [id]);
    if (used.length) return { status: 'VERIFIED', phone: row.phone_e164 };
    return { status: 'USED' };
  }
  if (row.status === 'USED') return { status: 'USED' };
  if (Date.parse(row.expires_at) < Date.now()) return { status: 'EXPIRED' };
  return { status: 'PENDING', expiresInSec: Math.max(0, Math.round((Date.parse(row.expires_at) - Date.now()) / 1000)) };
}

/* ------------------------------ 3) الرسالة الواردة ------------------------------ */
const toLatinDigits = (s) => String(s || '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const REPLY = {
  ok: '✅ تم تأكيد رقمك. ارجع لتطبيق نشمي — رح يفتح معك لحاله.',
  wrongNumber: '⚠️ هاد الرمز مطلوب لرقم ثاني. لازم تبعته من نفس الرقم الي كتبته بتطبيق نشمي.',
  expired: '⌛ الرمز انتهت صلاحيته أو مش صحيح. ارجع للتطبيق واطلب رمز جديد.',
  help: 'أهلاً 👋 هاد رقم تأكيد الدخول لتطبيق نشمي. لتسجّل دخول افتح التطبيق ودخّل رقمك، وبيطلعلك زر بيفتح واتساب برسالة جاهزة.',
  foreign: 'نشمي حالياً للأرقام الأردنية فقط.',
  deleteOk: 'وصلنا طلب حذف حسابك ✓. إدارة نشمي رح تحذف حسابك وبياناتك خلال 30 يوم (إلا الي القانون بيلزمنا نحتفظ فيه).',
};

let lastInbound = null;   // لصفحة «واتساب» بلوحة الإدارة (وبتنحفظ كمان حتى ما تضيع مع إعادة التشغيل)
async function stats() {
  return {
    lastInbound: lastInbound || (await settings.get('wa.last_inbound_at')) || null,
    webhookVerifiedAt: (await settings.get('wa.webhook_verified_at')) || null,
  };
}

/** @returns {Promise<string>} نتيجة المعالجة (للاختبارات والسجل) */
async function handleInbound(from, text) {
  lastInbound = nowIso();
  settings.set('wa.last_inbound_at', lastInbound).catch(() => {});
  let phone;
  try { phone = normalizeJordanPhone('+' + String(from).replace(/\D/g, '')); }
  catch { await reply(from, REPLY.foreign); return 'foreign'; }

  // طلب حذف الحساب (مذكور بسياسة الخصوصية) — بينسجل بسجل العمليات للإدارة
  if (/حذف\s*حساب/.test(String(text || ''))) {
    const u = await db.one('SELECT id FROM users WHERE phone_e164 = $1', [phone]);
    await db.query(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity, entity_id, before_json, after_json, reason, ip, created_at)
       VALUES ($1,'user',$2,'DELETE_REQUEST','user',$3,NULL,NULL,$4,NULL,$5)`,
      [uuid(), u ? u.id : null, u ? u.id : phone, 'طلب حذف الحساب عبر واتساب من ' + phone, nowIso()]);
    await reply(from, REPLY.deleteOk);
    return 'delete-request';
  }

  const m = toLatinDigits(text).match(/(?<!\d)(\d{6})(?!\d)/);
  if (!m) { await reply(from, REPLY.help); return 'help'; }

  const row = await db.one(
    `SELECT * FROM wa_logins WHERE code = $1 AND status = 'PENDING' ORDER BY created_at DESC`, [m[1]]);
  if (!row || Date.parse(row.expires_at) < Date.now()) { await reply(from, REPLY.expired); return 'expired'; }
  if (row.phone_e164 !== phone) { await reply(from, REPLY.wrongNumber); return 'wrong-number'; }

  const upd = await db.query(
    `UPDATE wa_logins SET status = 'VERIFIED', verified_at = $1 WHERE id = $2 AND status = 'PENDING' RETURNING id`,
    [nowIso(), row.id]);
  if (!upd.length) return 'duplicate';
  await reply(from, REPLY.ok);
  log.info('دخول بواتساب: تم تأكيد الرقم', { phone: phone.slice(0, 7) + '•••' });
  return 'verified';
}

async function reply(to, body) {
  if (!w().token || !w().phoneNumberId) return;
  const r = await whatsapp.graph('POST', `${w().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to).replace(/\D/g, ''),
    type: 'text', text: { body, preview_url: false },
  });
  if (!r.ok) log.warn('تعذّر الرد على رسالة واتساب', { code: r.error && r.error.code, message: r.error && r.error.message });
}

/* ------------------------------ الـ Webhook ------------------------------ */
/** التأكد إن الطلب جاي من Meta (توقيع X-Hub-Signature-256 بالـ App Secret) */
function validSignature(rawBody, header, secret) {
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(String(header));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/** بيستخرج الرسائل النصية من شكل Webhook تبع واتساب */
function extractMessages(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const msg of v.messages || []) {
        const text = msg.type === 'text' ? msg.text && msg.text.body
          : msg.type === 'button' ? msg.button && msg.button.text
          : msg.type === 'interactive' ? JSON.stringify(msg.interactive) : '';
        out.push({ from: msg.from, text: text || '', id: msg.id });
      }
    }
  }
  return out;
}

module.exports = { enabled, start, check, handleInbound, validSignature, extractMessages, businessNumber, stats, messageText, TTL_SEC };
