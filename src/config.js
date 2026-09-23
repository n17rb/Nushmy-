'use strict';
/**
 * إعدادات التشغيل — كل القيم من متغيرات البيئة، ولا أسرار داخل الكود.
 */
const fs = require('fs');
const path = require('path');

// تحميل ملف .env بدون مكتبات خارجية
function loadEnvFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* الملف غير موجود — نعتمد على متغيرات البيئة */ }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const JWT_SECRET = process.env.JWT_SECRET || (isProd ? '' : 'dev-secret-not-for-production');
if (isProd && (!JWT_SECRET || JWT_SECRET.length < 24)) {
  throw new Error('JWT_SECRET مفقود أو قصير جداً. ضع قيمة عشوائية طويلة في متغيرات البيئة قبل النشر.');
}

module.exports = {
  NODE_ENV,
  isProd,
  port: Number(process.env.PORT || 3000),
  jwtSecret: JWT_SECRET,
  accessTokenTtlSec: 60 * 60,            // ساعة
  refreshTokenTtlSec: 60 * 60 * 24 * 60, // 60 يوم
  db: {
    url: process.env.DATABASE_URL || '',
    sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '..', 'db', 'nashmi.db'),
  },
  sms: {
    provider: (process.env.SMS_PROVIDER || 'dev').toLowerCase(),
    // فترة المعاينة فقط: يسمح بعرض رمز التحقق على الشاشة حتى على الخادم الحقيقي.
    // احذفه (أو اجعله 0) قبل الإطلاق للناس.
    showDevCode: process.env.NODE_ENV !== 'production' || process.env.OTP_DEV_SHOW === '1',
    // واتساب (WhatsApp Cloud API من Meta) — SMS_PROVIDER=whatsapp
    whatsapp: {
      token: process.env.WHATSAPP_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      // معرّف حساب واتساب للأعمال (WABA) — لازم لصفحة «واتساب» بلوحة الإدارة (فحص الحساب وإنشاء القالب)
      wabaId: process.env.WHATSAPP_WABA_ID || '',
      template: process.env.WHATSAPP_TEMPLATE || 'nashmi_otp',
      lang: process.env.WHATSAPP_TEMPLATE_LANG || 'ar',
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
      // الدخول بواتساب (SMS_PROVIDER=whatsapp_link): الزبون بيبعت الرمز لرقم نشمي
      // رقم نشمي بصيغة دولية بدون + (مثلاً 962793510509). إذا فاضي بنجيبه من Meta تلقائياً
      number: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
      // كلمة سر بتختارها إنت وبتحطها بـ Meta لما تربط الـ Webhook
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
      // App Secret من إعدادات التطبيق بـ Meta — للتأكد إن الرسائل جاية فعلاً من واتساب
      appSecret: process.env.WHATSAPP_APP_SECRET || '',
      // قوالب «المصادقة» فيها زر «نسخ الرمز» ولازم يوصله الرمز كمان. 0 = قالب بدون زر
      copyButton: process.env.WHATSAPP_COPY_BUTTON !== '0',
    },
    // احتياط SMS للي ما عنده واتساب (مع SMS_PROVIDER=whatsapp_link): android | twilio | فاضي
    fallback: (process.env.SMS_FALLBACK || '').toLowerCase(),
    // تلفون أندرويد برقمك بيبعت الرسائل (تطبيق SMS Gateway for Android — مجاني)
    android: {
      url: process.env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1/messages',
      username: process.env.SMSGATE_USERNAME || '',
      password: process.env.SMSGATE_PASSWORD || '',
    },
    twilio: {
      sid: process.env.TWILIO_ACCOUNT_SID || '',
      token: process.env.TWILIO_AUTH_TOKEN || '',
      from: process.env.TWILIO_FROM || '',
    },
  },
  // أرقام «المالك»: أي رقم هنا يصير مدير عام (SUPER_ADMIN) تلقائياً عند الدخول
  adminPhones: (process.env.ADMIN_PHONES || '').split(',').map((s) => s.trim()).filter(Boolean),
  captain: {
    // فترة المعاينة: يُقبل الكابتن تلقائياً بدون مراجعة. في الإنتاج لا يعمل إلا إذا فُعّل صراحة.
    autoApprove: process.env.CAPTAIN_AUTO_APPROVE === '1' || (process.env.NODE_ENV !== 'production' && process.env.CAPTAIN_AUTO_APPROVE !== '0'),
  },
  otp: {
    length: 4,
    ttlSec: 120,
    maxAttempts: 5,
    resendCooldownSec: 45,
    maxPerHourPerPhone: 6,
  },
  maps: {
    // CARTO صارت تطلب مفتاح (بدونه بتطلع «API KEY REQUIRED» على الخريطة).
    // الافتراضي: خرائط OpenStreetMap بدون مفتاح (بأسماء عربية) — ولو حطيت مفتاح CARTO منرجع لستايل أوبر الرمادي.
    tilesUrl: process.env.MAP_TILES_URL || '',
    tilesUrlDark: process.env.MAP_TILES_URL_DARK || '',
    cartoKey: process.env.CARTO_API_KEY || '',
    geocoderUrl: process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org',
    routingUrl: process.env.ROUTING_URL || 'https://router.project-osrm.org',
  },
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'db', 'uploads'),
};
