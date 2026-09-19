'use strict';
/**
 * رموز الدخول عبر واتساب: شكل الطلب لـ Meta، عدم كشف الرمز، الأخطاء المفهومة،
 * وعرض الرمز على الشاشة فقط بفترة المعاينة إذا فشل واتساب.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-wa-test-' + Date.now() + '.db');
process.env.SQLITE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-123456';
process.env.SMS_PROVIDER = 'whatsapp';
process.env.OTP_DEV_SHOW = '0';
process.env.WHATSAPP_TOKEN = 'TEST_TOKEN';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';

const db = require('../src/db');
const config = require('../src/config');
const otp = require('../src/services/otp');

const realFetch = global.fetch;
let calls = [];
function mockFetch(status, body) {
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: status < 400, status, json: async () => body };
  };
}

test.before(async () => { await db.init(); });
test.after(async () => {
  global.fetch = realFetch;
  await db.close();
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

test('يبعت قالب المصادقة لواتساب بالرمز، وما بيرجع الرمز للتطبيق', async () => {
  calls = [];
  mockFetch(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.X' }] });
  const r = await otp.issue({ phone: '+962791110001', ip: '1.1.1.1' });
  assert.equal(r.channel, 'whatsapp');
  assert.equal(r.devCode, undefined, 'الرمز ما بيطلع للتطبيق');
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://graph.facebook.com/v21.0/1234567890/messages');
  assert.equal(c.opts.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(c.body.to, '962791110001', 'الرقم بدون +');
  assert.equal(c.body.type, 'template');
  assert.equal(c.body.template.name, 'nashmi_otp');
  assert.equal(c.body.template.language.code, 'ar');
  const code = c.body.template.components[0].parameters[0].text;
  assert.match(code, /^\d{4}$/);
  assert.equal(c.body.template.components[1].sub_type, 'url', 'زر نسخ الرمز');
  assert.equal(c.body.template.components[1].parameters[0].text, code);
  // الرمز المرسل هو نفسه الي بيقبله التحقق
  assert.equal(await otp.verifyCode({ phone: '+962791110001', code }), true);
});

test('خطأ «الرقم مش بالقائمة المسموحة» بيطلع برسالة عربية، والمحاولة ما بتنحسب', async () => {
  mockFetch(400, { error: { code: 131030, message: 'Recipient phone number not in allowed list' } });
  await assert.rejects(otp.issue({ phone: '+962791110002', ip: '1.1.1.1' }), (e) => {
    assert.equal(e.code, 'OTP_SEND_FAILED');
    assert.match(e.message, /قائمة الأرقام المسموحة/);
    return true;
  });
  const row = await db.one('SELECT COUNT(*) AS n FROM otp_codes WHERE phone_e164 = $1', ['+962791110002']);
  assert.equal(Number(row.n), 0, 'الرمز الفاشل انحذف فبيقدر يعيد فوراً');
});

test('بفترة المعاينة (OTP_DEV_SHOW=1) إذا فشل واتساب الرمز بيطلع على الشاشة مع السبب', async () => {
  config.sms.showDevCode = true;
  mockFetch(401, { error: { code: 190, message: 'Error validating access token' } });
  const r = await otp.issue({ phone: '+962791110003', ip: '1.1.1.1' });
  assert.equal(r.channel, 'dev');
  assert.match(r.devCode, /^\d{4}$/);
  assert.match(r.notice, /منتهية الصلاحية/);
  config.sms.showDevCode = false;
});

test('بدون إعدادات واتساب: رسالة واضحة', async () => {
  const saved = config.sms.whatsapp.token;
  config.sms.whatsapp.token = '';
  await assert.rejects(otp.issue({ phone: '+962791110004', ip: '1.1.1.1' }), /مش مجهّز/);
  config.sms.whatsapp.token = saved;
});
