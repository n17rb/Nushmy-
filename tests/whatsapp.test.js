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
process.env.WHATSAPP_WABA_ID = '9999';

const db = require('../src/db');
const config = require('../src/config');
const otp = require('../src/services/otp');
const wa = require('../src/services/whatsapp');

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

/* ------------------------- صفحة «واتساب» بلوحة الإدارة ------------------------- */
function routeFetch(routes) {
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    for (const [re, [status, body]] of routes) if (re.test(url) && (!body.__method || body.__method === opts.method)) {
      return { ok: status < 400, status, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 100, message: 'unmocked ' + url } }) };
  };
}
const PHONE_OK = [/1234567890\?fields/, [200, { display_phone_number: '+962 7 9351 0509', verified_name: 'نشمي', name_status: 'APPROVED', platform_type: 'CLOUD_API', status: 'CONNECTED' }]];
const WABA_OK = [/9999\?fields/, [200, { name: 'Nashmi', account_review_status: 'APPROVED' }]];

test('الفحص: كل إشي جاهز لما القالب معتمد', async () => {
  routeFetch([PHONE_OK, WABA_OK, [/9999\/message_templates/, [200, { data: [{ name: 'nashmi_otp', status: 'APPROVED', language: 'ar' }] }]]]);
  const r = await wa.status();
  assert.equal(r.ready, true);
  const by = Object.fromEntries(r.steps.map((s) => [s.key, s.state]));
  assert.deepEqual([by.config, by.token, by.number, by.name, by.account, by.template], ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
});

test('الفحص: رمز منتهي بيوقف الفحص بسبب واضح', async () => {
  routeFetch([[/1234567890\?fields/, [401, { error: { code: 190, message: 'Session has expired' } }]]]);
  const r = await wa.status();
  const tok = r.steps.find((s) => s.key === 'token');
  assert.equal(tok.state, 'bad');
  assert.match(tok.detail, /رمز الوصول/);
  assert.equal(tok.error.message, 'Session has expired');
});

test('الفحص: رقم غير مسجّل + حساب قيد المراجعة + القالب ناقص', async () => {
  routeFetch([
    [/1234567890\?fields/, [200, { display_phone_number: '+962 7 9351 0509', name_status: 'PENDING_REVIEW', platform_type: 'NOT_APPLICABLE' }]],
    [/9999\?fields/, [200, { name: 'Nashmi', account_review_status: 'PENDING' }]],
    [/9999\/message_templates/, [200, { data: [] }]],
  ]);
  const r = await wa.status();
  const by = Object.fromEntries(r.steps.map((s) => [s.key, s]));
  assert.equal(by.number.state, 'bad');
  assert.equal(by.name.state, 'warn');
  assert.equal(by.account.state, 'warn');
  assert.equal(by.template.state, 'todo');
  assert.equal(by.template.canCreate, true);
  assert.equal(r.ready, false);
});

test('إنشاء القالب: شكل الطلب صحيح، والرفض بيرجع السبب الحقيقي', async () => {
  routeFetch([[/9999\/message_templates/, [200, { id: 'T1', status: 'PENDING', __method: 'POST' }]]]);
  const ok1 = await wa.createTemplate();
  assert.equal(ok1.ok, true);
  const b = calls[0].body;
  assert.equal(calls[0].method, 'POST');
  assert.equal(b.name, 'nashmi_otp');
  assert.equal(b.category, 'AUTHENTICATION');
  assert.equal(b.language, 'ar');
  assert.equal(b.components[2].buttons[0].otp_type, 'COPY_CODE');
  assert.equal(b.components[1].code_expiration_minutes, 2);

  routeFetch([[/9999\/message_templates/, [403, { error: { code: 200, message: 'Permissions error', __method: 'POST' } }]]]);
  const bad = await wa.createTemplate();
  assert.equal(bad.ok, false);
  assert.match(bad.error.ar, /صلاحية/);
  assert.equal(bad.error.message, 'Permissions error');

  routeFetch([[/9999\/message_templates/, [400, { error: { code: 100, error_subcode: 2388024, message: 'Content in this language already exists' } }]]]);
  const ex = await wa.createTemplate();
  assert.equal(ex.ok, true);
  assert.equal(ex.exists, true);
});

test('رمز التجربة بيروح لنفس القالب', async () => {
  routeFetch([[/1234567890\/messages/, [200, { messages: [{ id: 'wamid.T' }] }]]]);
  const r = await wa.sendTest('+962791110009', '1234');
  assert.equal(r.ok, true);
  assert.equal(calls[0].body.to, '962791110009');
  assert.equal(calls[0].body.template.components[0].parameters[0].text, '1234');
});

test('الفحص: قسم «الدخول بواتساب» بيبين الناقص، والخطأ الحقيقي للقالب بيطلع بالعربي', async () => {
  routeFetch([PHONE_OK, WABA_OK,
    [/9999\/subscribed_apps/, [200, { data: [{ whatsapp_business_api_data: { id: '1' } }] }]],
    [/9999\/message_templates/, [200, { data: [] }]]]);
  const r = await wa.status({ baseUrl: 'https://nushmy.onrender.com' });
  const by = Object.fromEntries(r.steps.map((s) => [s.key, s]));
  assert.equal(by.wh_config.state, 'bad', 'ناقص App Secret');
  assert.equal(by.wh_verified.copy, 'https://nushmy.onrender.com/api/whatsapp/webhook');
  assert.match(r.setup.verifyToken || 'none', /./);
  assert.equal(by.wh_subscribed.state, 'ok');
  assert.equal(r.linkReady, false);
  assert.ok(by.wh_config.group && by.template.group && by.wh_config.group !== by.template.group);

  const e = wa.describe({ code: 100, message: 'This WhatsApp Business account does not have permission to create message template' });
  assert.match(e.ar, /توثيق النشاط التجاري/);
  assert.match(e.ar, /whatsapp_link/);
});
