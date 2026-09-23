'use strict';
/** إعدادات النظام المخزّنة في قاعدة البيانات — قابلة للتعديل من لوحة الإدارة بدون إعادة نشر. */
const db = require('../db');
const { nowIso } = require('../lib/ids');

let cache = null;
let cachedAt = 0;
const TTL_MS = 30_000;

const DEFAULTS = {
  'platform.commission_bp':      { value: '750',  type: 'int',    label: 'عمولة المنصة (نقطة أساس: 750 = 7.5%)' },
  'platform.currency':           { value: 'JOD',  type: 'string', label: 'العملة' },
  'platform.default_language':   { value: 'ar',   type: 'string', label: 'اللغة الافتراضية' },
  'dispatch.offer_timeout_sec':  { value: '12',   type: 'int',    label: 'مهلة رد الكابتن على الطلب (ثانية)' },
  'dispatch.search_timeout_sec': { value: '90',   type: 'int',    label: 'أقصى مدة بحث عن كابتن (ثانية)' },
  'dispatch.initial_radius_m':   { value: '3000', type: 'int',    label: 'نطاق البحث الأولي (متر)' },
  'dispatch.max_radius_m':       { value: '12000',type: 'int',    label: 'أقصى نطاق بحث (متر)' },
  'dispatch.batch_size':         { value: '3',    type: 'int',    label: 'عدد الكباتن في كل دفعة' },
  'dispatch.stale_location_sec': { value: '60',   type: 'int',    label: 'اعتبار موقع الكابتن قديماً بعد (ثانية)' },
  'cancel.free_window_sec':      { value: '120',  type: 'int',    label: 'مدة الإلغاء المجاني بعد قبول الكابتن (ثانية)' },
  'trip.max_distance_km':        { value: '150',  type: 'int',    label: 'أقصى مسافة رحلة (كم)' },
  'otp.dev_mode_visible':        { value: '1',    type: 'bool',   label: 'إظهار رمز التحقق على الشاشة (وضع التطوير فقط)' },
  'captain.arrive_max_distance_m': { value: '400', type: 'int',    label: 'أقصى بعد عن نقطة الانطلاق للضغط على «وصلت» (متر)' },
  'wallet.min_balance_fils':     { value: '-3000', type: 'int',    label: 'أدنى رصيد مسموح للكابتن ليستقبل رحلات (فلس، سالب = دين مسموح)' },
  'wallet.cliq_alias':           { value: '',     type: 'string', label: 'اسم CliQ لاستقبال إيداعات الكباتن' },
  'fare.recalc_threshold_bp':    { value: '12500', type: 'int',   label: 'إعادة حساب الأجرة إذا زادت المسافة الفعلية عن التقدير بهذه النسبة (12500 = 125%)' },
  // المكالمة داخل التطبيق
  'call.enabled':                { value: '1',    type: 'bool',   label: 'تفعيل المكالمات داخل التطبيق (بدون رصيد)' },
  'call.stun_url':               { value: 'stun:stun.l.google.com:19302', type: 'string', label: 'خادم STUN' },
  'call.turn_url':               { value: '',     type: 'string', label: 'خادم TURN (للشبكات المقفلة — اختياري)' },
  'call.turn_user':              { value: '',     type: 'string', label: 'مستخدم TURN' },
  'call.turn_pass':              { value: '',     type: 'string', label: 'كلمة سر TURN' },
  'call.ring_sec':               { value: '45',   type: 'int',    label: 'مدة الرنّة قبل ما تنعتبر مكالمة فايتة (ثانية)' },
  'maps.carto_key':              { value: '',     type: 'string', label: 'مفتاح خرائط CARTO (اختياري — بدونه منستخدم OpenStreetMap)' },
  // طريقة التحقق من الرقم — بتتغير من صفحة «واتساب» بلوحة الإدارة (فاضي = حسب SMS_PROVIDER بـ Render)
  'auth.mode':                   { value: '',     type: 'string', label: 'طريقة التحقق من رقم التلفون' },
  // أسرار واتساب — ما بتظهر بصفحة الإعدادات، بتنحط من صفحة «واتساب»
  'wa.app_secret':               { value: '',     type: 'string', label: 'App Secret' },
  'wa.verify_token':             { value: '',     type: 'string', label: 'Verify token' },
  'wa.webhook_verified_at':      { value: '',     type: 'string', label: 'آخر تأكيد ربط Webhook' },
  'wa.last_inbound_at':          { value: '',     type: 'string', label: 'آخر رسالة واتساب وصلت' },
  // مفاتيح الإشعارات الفورية — بتتولّد لحالها (مخفية)
  'push.vapid_public':           { value: '',     type: 'string', label: 'مفتاح الإشعارات العام' },
  'push.vapid_private':          { value: '',     type: 'string', label: 'مفتاح الإشعارات الخاص' },
  // رسالة ترحيب تلقائية لما حدا يفتح محادثة مع الدعم
  'support.auto_reply':          { value: 'أهلاً فيك 👋 وصلتنا رسالتك، وفريق نشمي رح يرد عليك بأقرب وقت.', type: 'string', label: 'الرد التلقائي على رسائل الدعم الفني' },
};
/** مفاتيح بتنعدّل من صفحاتها الخاصة بس (مخفية من صفحة الإعدادات) */
const PRIVATE_PREFIXES = ['wa.', 'auth.', 'push.'];
const isPrivate = (key) => PRIVATE_PREFIXES.some((p) => key.startsWith(p));

async function ensureDefaults() {
  const now = nowIso();
  for (const [key, d] of Object.entries(DEFAULTS)) {
    await db.query(
      `INSERT INTO settings (key, value, value_type, label_ar, updated_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`,
      [key, d.value, d.type, d.label, now]
    );
  }
  // رمز ربط الـ Webhook: بيتولّد مرة وحدة لحاله
  const vt = await db.one(`SELECT value FROM settings WHERE key = 'wa.verify_token'`, []);
  if (vt && !vt.value) {
    const token = 'nashmi-' + require('crypto').randomBytes(8).toString('hex');
    await db.query(`UPDATE settings SET value = $1, updated_at = $2 WHERE key = 'wa.verify_token'`, [token, now]);
  }
  cache = null;
}

/** حفظ قيمة (للمفاتيح الداخلية) */
async function set(key, value) {
  await db.query('UPDATE settings SET value = $1, updated_at = $2 WHERE key = $3', [String(value), nowIso(), key]);
  cache = null;
}

async function all() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await db.query('SELECT key, value, value_type FROM settings', []);
  const out = {};
  for (const r of rows) {
    out[r.key] = r.value_type === 'int' ? parseInt(r.value, 10)
      : r.value_type === 'bool' ? (r.value === '1' || r.value === 'true')
      : r.value;
  }
  cache = out; cachedAt = Date.now();
  return out;
}

async function get(key) {
  const s = await all();
  if (s[key] !== undefined) return s[key];
  const d = DEFAULTS[key];
  if (!d) return undefined;
  return d.type === 'int' ? parseInt(d.value, 10) : d.type === 'bool' ? d.value === '1' : d.value;
}

function invalidate() { cache = null; }

module.exports = { ensureDefaults, all, get, set, invalidate, isPrivate, DEFAULTS };
