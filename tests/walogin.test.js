'use strict';
/**
 * الدخول بواتساب (الزبون بيبعت الرمز): البداية، التوقيع، الرقم الغلط، الانتهاء، الدخول مرة وحدة، وطلب الحذف.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-walogin-test-' + Date.now() + '.db');
Object.assign(process.env, {
  SQLITE_PATH: TMP, DATABASE_URL: '', NODE_ENV: 'development', SMS_PROVIDER: 'whatsapp_link',
  WHATSAPP_TOKEN: 'T', WHATSAPP_PHONE_NUMBER_ID: '555', WHATSAPP_WABA_ID: '777',
  WHATSAPP_NUMBER: '962793510509', WHATSAPP_VERIFY_TOKEN: 'my-verify', WHATSAPP_APP_SECRET: 'app-secret',
  SMS_FALLBACK: 'android', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p',
});

const db = require('../src/db');
const settings = require('../src/services/settings');
const seed = require('../src/db/seed');
const { server } = require('../src/server');

let base = '';
const realFetch = global.fetch;
const replies = [];
const smsSent = [];
global.fetch = async (url, opts) => {
  if (String(url).includes('sms-gate.app')) {
    smsSent.push({ auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    return { ok: true, status: 202, json: async () => ({ id: 'm1' }), text: async () => '' };
  }
  if (String(url).includes('graph.facebook.com')) {
    replies.push(JSON.parse(opts.body || '{}'));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.R' }] }) };
  }
  return realFetch(url, opts);
};

test.before(async () => {
  await db.init(); await settings.ensureDefaults(); await seed.run({ quiet: true });
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  server.close(); await db.close(); global.fetch = realFetch;
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

const post = async (p, body, headers = {}) => {
  const r = await realFetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null), text: r.headers.get('content-type') };
};
const sign = (raw, secret = 'app-secret') => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const inbound = (from, body) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from, id: 'wamid.' + Math.random(), type: 'text', text: { body } }] } }] }] });
async function webhook(from, body, secret) {
  const raw = inbound(from, body);
  const r = await realFetch(base + '/api/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw, secret) }, body: raw });
  await new Promise((res) => setTimeout(res, 150)); // المعالجة بعد الرد
  return r.status;
}

test('الإعدادات بتقول للتطبيق يستخدم الدخول بواتساب', async () => {
  const c = await (await realFetch(base + '/api/config')).json();
  assert.equal(c.loginMode, 'wa_link');
});

test('ربط الـ Webhook: الرمز الصح بيرجّع التحدي، والغلط مرفوض', async () => {
  const ok = await realFetch(base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=my-verify&hub.challenge=12345');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await realFetch(base + '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1');
  assert.equal(bad.status, 403);
});

test('الدورة كاملة: بداية ← رسالة من نفس الرقم ← دخول مرة وحدة بس', async () => {
  const s = await post('/api/auth/wa/start', { phone: '0791234567' });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.match(s.data.code, /^\d{6}$/);
  assert.equal(s.data.number, '962793510509');
  assert.ok(s.data.link.startsWith('https://wa.me/962793510509?text='));
  assert.ok(decodeURIComponent(s.data.link).includes(s.data.code));

  const pending = await post('/api/auth/wa/check', { id: s.data.id });
  assert.equal(pending.data.status, 'PENDING');

  // الرسالة بأرقام عربية كمان بتنقبل
  const arabic = s.data.code.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  assert.equal(await webhook('962791234567', 'رمز الدخول لنشمي: ' + arabic), 200);
  assert.match(replies.at(-1).text.body, /تم تأكيد رقمك/);

  const done = await post('/api/auth/wa/check', { id: s.data.id });
  assert.ok(done.data.accessToken, JSON.stringify(done.data));
  assert.equal(done.data.user.phone, '+962791234567');

  const again = await post('/api/auth/wa/check', { id: s.data.id });
  assert.equal(again.data.status, 'USED', 'نفس الطلب ما بيفتح جلسة ثانية');
});

test('توقيع غلط = مرفوض وما بيأكد إشي', async () => {
  await new Promise((r) => setTimeout(r, 50));
  const s = await post('/api/auth/wa/start', { phone: '0791234568' });
  assert.equal(await webhook('962791234568', s.data.code, 'wrong-secret'), 401);
  const c = await post('/api/auth/wa/check', { id: s.data.id });
  assert.equal(c.data.status, 'PENDING');
});

test('الرمز من رقم ثاني ما بيأكد، وبيوصله رد واضح', async () => {
  const s = await post('/api/auth/wa/start', { phone: '0791234569' });
  await webhook('962799999999', s.data.code);
  assert.match(replies.at(-1).text.body, /رقم ثاني/);
  assert.equal((await post('/api/auth/wa/check', { id: s.data.id })).data.status, 'PENDING');
});

test('رسالة بدون رمز بترجع شرح، ورمز غلط بيرجع «انتهت أو مش صحيح»', async () => {
  await webhook('962791111111', 'مرحبا');
  assert.match(replies.at(-1).text.body, /تأكيد الدخول لتطبيق نشمي/);
  await webhook('962791111111', '000000');
  assert.match(replies.at(-1).text.body, /انتهت صلاحيته أو مش صحيح/);
});

test('انتهاء الصلاحية', async () => {
  const s = await post('/api/auth/wa/start', { phone: '0791234570' });
  await db.query('UPDATE wa_logins SET expires_at = $1 WHERE id = $2', [new Date(Date.now() - 1000).toISOString(), s.data.id]);
  await webhook('962791234570', s.data.code);
  assert.match(replies.at(-1).text.body, /انتهت/);
  assert.equal((await post('/api/auth/wa/check', { id: s.data.id })).data.status, 'EXPIRED');
});

test('طلبين ورا بعض لنفس الرقم بسرعة = مرفوض (حماية من الإزعاج)', async () => {
  await post('/api/auth/wa/start', { phone: '0791234571' });
  const b = await post('/api/auth/wa/start', { phone: '0791234571' });
  assert.equal(b.status, 429);
});

test('طلب حذف الحساب بينسجل بسجل العمليات', async () => {
  await webhook('962791234567', 'بدي حذف حسابي لو سمحت');
  assert.match(replies.at(-1).text.body, /طلب حذف حسابك/);
  const row = await db.one(`SELECT * FROM audit_logs WHERE action = 'DELETE_REQUEST'`, []);
  assert.ok(row);
});

test('احتياط SMS: «ما عندي واتساب» بيبعت الرمز من تلفون الأندرويد وبيدخل عادي', async () => {
  const c = await (await realFetch(base + '/api/config')).json();
  assert.equal(c.smsFallback, true);

  const noChannel = await post('/api/auth/otp/request', { phone: '0791239999' });
  assert.equal(noChannel.status, 400, 'بوضع واتساب الرمز العادي مسكّر إلا لـ SMS');

  const r = await post('/api/auth/otp/request', { phone: '0791239999', channel: 'sms' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.channel, 'sms');
  assert.equal(r.data.devCode, undefined);
  const sent = smsSent.at(-1);
  assert.equal(sent.auth, 'Basic ' + Buffer.from('u:p').toString('base64'));
  assert.deepEqual(sent.body.phoneNumbers, ['+962791239999']);
  const code = sent.body.textMessage.text.match(/\d{4}/)[0];
  assert.ok(sent.body.textMessage.text.length <= 70, 'رسالة وحدة');

  const v = await post('/api/auth/otp/verify', { phone: '0791239999', code });
  assert.ok(v.data.accessToken, JSON.stringify(v.data));
});

test('طريقة التحقق بتتغير من لوحة الإدارة (إعداد auth.mode) بدون Render', async () => {
  await settings.set('auth.mode', 'dev');
  let c = await (await realFetch(base + '/api/config')).json();
  assert.equal(c.loginMode, 'otp');
  const s = await post('/api/auth/wa/start', { phone: '0791230001' });
  assert.equal(s.status, 404, 'بوضع dev الدخول بواتساب مسكّر');
  await settings.set('auth.mode', '');
  c = await (await realFetch(base + '/api/config')).json();
  assert.equal(c.loginMode, 'wa_link', 'فاضي = حسب Render');
});

test('رمز ربط الـ Webhook بيتولّد لحاله، والأسرار مخفية من صفحة الإعدادات', async () => {
  const vt = await settings.get('wa.verify_token');
  assert.match(vt, /^nashmi-[a-f0-9]{16}$/);
  assert.equal(settings.isPrivate('wa.app_secret'), true);
  assert.equal(settings.isPrivate('platform.commission_bp'), false);
});
