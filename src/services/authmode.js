'use strict';
/**
 * طريقة التحقق من الرقم الفعّالة + أسرار واتساب.
 * الأولوية: إعداد لوحة الإدارة ← وإذا فاضي، متغيرات Render.
 *   dev            رمز على الشاشة (تجربة فقط)
 *   whatsapp_link  الزبون بيبعت الرمز لرقم نشمي على واتساب (مجاني وآمن)
 *   whatsapp       نشمي بيبعت الرمز بقالب (بده توثيق نشاط تجاري)
 *   android/twilio SMS
 */
const config = require('../config');
const settings = require('./settings');

const MODES = ['dev', 'whatsapp_link', 'whatsapp', 'android', 'twilio'];

async function mode() {
  const m = await settings.get('auth.mode');
  return MODES.includes(m) ? m : config.sms.provider;
}
async function appSecret() { return config.sms.whatsapp.appSecret || (await settings.get('wa.app_secret')) || ''; }
async function verifyToken() { return config.sms.whatsapp.verifyToken || (await settings.get('wa.verify_token')) || ''; }

module.exports = { MODES, mode, appSecret, verifyToken };
