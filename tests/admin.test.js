'use strict';
/**
 * لوحة الإدارة: الصلاحيات، الموافقة على الكباتن، الإيداع مرة واحدة فقط، تعديل المحفظة بدون تكرار،
 * التسعير والإعدادات مع السجل، إيقاف الحسابات، وحماية الملفات الخاصة.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-admin-test-' + Date.now() + '.db');
process.env.SQLITE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'development';
process.env.SMS_PROVIDER = 'dev';
process.env.CAPTAIN_AUTO_APPROVE = '0';
process.env.ADMIN_PHONES = '0792222000';

const db = require('../src/db');
const settings = require('../src/services/settings');
const seed = require('../src/db/seed');
const { server } = require('../src/server');

let base = '';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.before(async () => {
  await db.init();
  await settings.ensureDefaults();
  await seed.run({ quiet: true });
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  server.close();
  await db.close();
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

async function call(p, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function login(phone) {
  const a = await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const b = await call('/api/auth/otp/verify', { method: 'POST', body: { phone, code: a.data.devCode } });
  return b.data;
}

let owner, captainTok, captainId, finance, customerTok, customerId;

test('المالك من ADMIN_PHONES يصير مدير عام تلقائياً، وغيره ممنوع', async () => {
  const o = await login('0792222000');
  owner = o.accessToken;
  assert.equal(o.user.adminRole, 'SUPER_ADMIN');
  const me = await call('/api/admin/me', { token: owner });
  assert.equal(me.status, 200);
  assert.equal(me.data.isOwner, true);

  const c = await login('0792222009');
  customerTok = c.accessToken; customerId = c.user.id;
  const no = await call('/api/admin/dashboard', { token: customerTok });
  assert.equal(no.status, 403);
  assert.equal(no.data.error.code, 'NOT_ADMIN');
});

test('الكابتن يبدأ «قيد المراجعة» والمالك يوافق عليه', async () => {
  const c = await login('0792222001');
  captainTok = c.accessToken;
  const vt = (await call('/api/vehicle-types')).data.vehicleTypes[0].id;
  const r = await call('/api/captain/register', { method: 'POST', token: captainTok,
    body: { name: 'فراس الطراونة', vehicleTypeId: vt, make: 'كيا', model: 'سيراتو', color: 'أسود', year: 2019, plate: '22-33445' } });
  assert.equal(r.data.status, 'PENDING');
  const on = await call('/api/captain/online', { method: 'POST', token: captainTok, body: { online: true } });
  assert.equal(on.status, 403, 'غير المعتمد ما بيقدر يتصل');

  await call('/api/captain/documents', { method: 'POST', token: captainTok, body: { kind: 'license', dataUrl: PNG } });

  const list = await call('/api/admin/captains?status=PENDING', { token: owner });
  assert.equal(list.data.captains.length, 1);
  captainId = list.data.captains[0].id;

  const noReason = await call(`/api/admin/captains/${captainId}/status`, { method: 'POST', token: owner, body: { status: 'SUSPENDED' } });
  assert.equal(noReason.status, 400, 'الإيقاف يحتاج سبب');

  const ok = await call(`/api/admin/captains/${captainId}/status`, { method: 'POST', token: owner, body: { status: 'APPROVED' } });
  assert.equal(ok.status, 200);
  const on2 = await call('/api/captain/online', { method: 'POST', token: captainTok, body: { online: true } });
  assert.equal(on2.status, 200, 'بعد الموافقة بيقدر يتصل');
});

test('الوثائق الخاصة للإدارة فقط', async () => {
  const d = (await call(`/api/admin/captains/${captainId}`, { token: owner })).data.captain.documents[0];
  const adminView = await call(`/api/admin/files/${d.fileId}`, { token: owner, raw: true });
  assert.equal(adminView.status, 200);
  assert.equal(adminView.headers.get('content-type'), 'image/png');
  const pub = await call(`/media/${d.fileId}`, { raw: true });
  assert.equal(pub.status, 404, 'الوثيقة ما بتنفتح من الرابط العام');
  const other = await call(`/api/admin/files/${d.fileId}`, { token: customerTok });
  assert.equal(other.status, 403);
  const rev = await call(`/api/admin/documents/${d.id}`, { method: 'POST', token: owner, body: { status: 'APPROVED' } });
  assert.equal(rev.status, 200);
});

test('الموافقة على شحن مرتين بنفس اللحظة تضيف المبلغ مرة واحدة', async () => {
  await call('/api/captain/wallet/deposits', { method: 'POST', token: captainTok, body: { amountFils: 5000, proofDataUrl: PNG } });
  const dep = (await call('/api/admin/deposits', { token: owner })).data.deposits[0];
  assert.equal(dep.amountFils, 5000);
  const [a, b] = await Promise.all([
    call(`/api/admin/deposits/${dep.id}/approve`, { method: 'POST', token: owner, body: {} }),
    call(`/api/admin/deposits/${dep.id}/approve`, { method: 'POST', token: owner, body: {} }),
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const w = await call('/api/captain/wallet', { token: captainTok });
  assert.equal(w.data.balanceFils, 5000, 'الرصيد 5 دنانير بالضبط');
  const txs = await db.query("SELECT * FROM wallet_transactions WHERE transaction_type = 'DEPOSIT'", []);
  assert.equal(txs.length, 1);
  const rej = await call(`/api/admin/deposits/${dep.id}/reject`, { method: 'POST', token: owner, body: { reason: 'تجربة' } });
  assert.equal(rej.status, 409, 'ما بينفع ترفض طلب انقبل');
});

test('رفض شحن مع سبب — الرصيد ما بيتغير', async () => {
  await call('/api/captain/wallet/deposits', { method: 'POST', token: captainTok, body: { amountFils: 2000, proofDataUrl: PNG } });
  const dep = (await call('/api/admin/deposits', { token: owner })).data.deposits[0];
  const r = await call(`/api/admin/deposits/${dep.id}/reject`, { method: 'POST', token: owner, body: { reason: 'الإشعار غير واضح' } });
  assert.equal(r.status, 200);
  const w = await call('/api/captain/wallet', { token: captainTok });
  assert.equal(w.data.balanceFils, 5000);
  assert.equal(w.data.deposits[0].status, 'REJECTED');
});

test('تعديل المحفظة: نفس الطلب مرتين = حركة واحدة، ومسجّل بالسجل', async () => {
  const body = { amountFils: -1500, type: 'CORRECTION', reason: 'تصحيح رحلة', requestId: 'req-12345678' };
  const a = await call(`/api/admin/captains/${captainId}/wallet`, { method: 'POST', token: owner, body });
  const b = await call(`/api/admin/captains/${captainId}/wallet`, { method: 'POST', token: owner, body });
  assert.equal(a.status, 200); assert.equal(b.data.duplicate, true);
  const w = await call('/api/captain/wallet', { token: captainTok });
  assert.equal(w.data.balanceFils, 3500);
  const logs = (await call('/api/admin/audit', { token: owner })).data.logs;
  assert.ok(logs.some((l) => l.action === 'WALLET_CORRECTION' && l.reason === 'تصحيح رحلة'));
  assert.ok(logs.some((l) => l.action === 'DEPOSIT_APPROVED'));
});

test('المسؤول المالي ما بيقدر يغيّر حالة كابتن أو الأسعار', async () => {
  await call('/api/admin/admins', { method: 'POST', token: owner, body: { phone: '0792222005', role: 'FINANCE_ADMIN' } });
  finance = (await login('0792222005')).accessToken;
  const s = await call(`/api/admin/captains/${captainId}/status`, { method: 'POST', token: finance, body: { status: 'SUSPENDED', reason: 'تجربة' } });
  assert.equal(s.status, 403);
  const rules = (await call('/api/admin/pricing', { token: finance })).data.rules;
  const p = await call(`/api/admin/pricing/${rules[0].id}`, { method: 'PATCH', token: finance, body: { baseFils: 500, reason: 'تجربة' } });
  assert.equal(p.status, 403);
  const adj = await call(`/api/admin/captains/${captainId}/wallet`, { method: 'POST', token: finance,
    body: { amountFils: 1000, type: 'BONUS', reason: 'مكافأة أسبوع', requestId: 'req-bonus-001' } });
  assert.equal(adj.status, 200, 'المالي بيقدر يعمل مكافأة');
});

test('تعديل الأسعار ينعكس فوراً على تسعيرة العميل', async () => {
  const rules = (await call('/api/admin/pricing', { token: owner })).data.rules;
  const karakEco = rules.find((r) => r.cityCode === 'karak' && r.vehicle === 'عادية');
  const body = { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72 };
  const before = (await call('/api/trips/estimate', { method: 'POST', token: customerTok, body })).data.options[0].fareFils;
  const u = await call(`/api/admin/pricing/${karakEco.id}`, { method: 'PATCH', token: owner, body: { baseFils: karakEco.baseFils + 1000, reason: 'رفع الأساس' } });
  assert.equal(u.status, 200);
  const after = (await call('/api/trips/estimate', { method: 'POST', token: customerTok, body })).data.options[0].fareFils;
  assert.equal(after, before + 1000);
});

test('تعديل العمولة من الإعدادات بحدود آمنة', async () => {
  const bad = await call('/api/admin/settings/platform.commission_bp', { method: 'PATCH', token: owner, body: { value: 9000, reason: 'تجربة' } });
  assert.equal(bad.status, 400);
  const ok = await call('/api/admin/settings/platform.commission_bp', { method: 'PATCH', token: owner, body: { value: 1000, reason: 'عرض' } });
  assert.equal(ok.status, 200);
  assert.equal(await settings.get('platform.commission_bp'), 1000);
  await call('/api/admin/settings/platform.commission_bp', { method: 'PATCH', token: owner, body: { value: 750, reason: 'رجوع' } });
});

test('إيقاف عميل يمنعه فوراً، وإعادة تفعيله ترجعه', async () => {
  const s = await call(`/api/admin/customers/${customerId}/status`, { method: 'POST', token: owner, body: { status: 'SUSPENDED', reason: 'إلغاءات كثيرة' } });
  assert.equal(s.status, 200);
  const blocked = await call('/api/me', { token: customerTok });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'ACCOUNT_SUSPENDED');
  await call(`/api/admin/customers/${customerId}/status`, { method: 'POST', token: owner, body: { status: 'ACTIVE' } });
  assert.equal((await call('/api/me', { token: customerTok })).status, 200);
  const self = await call(`/api/admin/customers/${(await call('/api/admin/me', { token: owner })).data.user.id}/status`,
    { method: 'POST', token: owner, body: { status: 'SUSPENDED', reason: 'تجربة' } });
  assert.equal(self.status, 400, 'المالك ما بيوقف حاله');
});

test('المدير يلغي رحلة نشطة، ولوحة القيادة ترجع الأرقام', async () => {
  const vt = (await call('/api/vehicle-types')).data.vehicleTypes[0].id;
  const t = await call('/api/trips', { method: 'POST', token: customerTok,
    body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72, vehicleTypeId: vt } });
  const id = t.data.trip.id;
  const c = await call(`/api/admin/trips/${id}/cancel`, { method: 'POST', token: owner, body: { reason: 'اختبار الإدارة' } });
  assert.equal(c.status, 200);
  assert.equal((await call(`/api/trips/${id}`, { token: customerTok })).data.trip.status, 'CANCELLED_BY_SYSTEM');
  const d = await call('/api/admin/dashboard', { token: owner });
  assert.equal(d.status, 200);
  assert.equal(d.data.days.length, 7);
  assert.ok(d.data.kpis.cancelledToday >= 1);
  const detail = await call(`/api/admin/trips/${id}`, { token: owner });
  assert.ok(detail.data.trip.history.length >= 2);
});

test('صورة الحساب العامة تنحفظ بقاعدة البيانات وتنفتح على /media', async () => {
  const r = await call('/api/me/photo', { method: 'POST', token: customerTok, body: { dataUrl: PNG } });
  assert.equal(r.status, 200);
  assert.match(r.data.user.photoUrl, /^\/media\/[a-f0-9]{32}$/);
  const img = await call(r.data.user.photoUrl, { raw: true });
  assert.equal(img.status, 200);
  const fake = await call('/api/me/photo', { method: 'POST', token: customerTok, body: { dataUrl: 'data:image/png;base64,SGVsbG8gd29ybGQ=' } });
  assert.equal(fake.status, 400, 'ملف مش صورة حقيقية مرفوض');
});

test('المالك ما بتنشال صلاحيته', async () => {
  const list = (await call('/api/admin/admins', { token: owner })).data.admins;
  const fin = list.find((a) => a.role === 'FINANCE_ADMIN');
  const del = await call(`/api/admin/admins/${fin.id}`, { method: 'DELETE', token: owner });
  assert.equal(del.status, 200);
  const me = (await call('/api/admin/me', { token: owner })).data.user;
  const self = await call(`/api/admin/admins/${me.id}`, { method: 'DELETE', token: owner });
  assert.equal(self.status, 400);
});

test('التحقق من الرقم: حفظ App Secret، وما بينعرض، وواتساب ما بيتفعّل قبل ما يجهز', async () => {
  const bad = await call('/api/admin/whatsapp/secret', { method: 'POST', token: owner, body: { appSecret: 'short' } });
  assert.equal(bad.status, 400);
  const good = await call('/api/admin/whatsapp/secret', { method: 'POST', token: owner, body: { appSecret: 'a'.repeat(32) } });
  assert.equal(good.status, 200);
  assert.equal(await settings.get('wa.app_secret'), 'a'.repeat(32));

  const list = await call('/api/admin/settings', { token: owner });
  assert.ok(!list.data.settings.some((s) => s.key.startsWith('wa.') || s.key.startsWith('auth.')), 'الأسرار مخفية');
  const edit = await call('/api/admin/settings/wa.app_secret', { method: 'PATCH', token: owner, body: { value: 'x', reason: 'تجربة' } });
  assert.equal(edit.status, 404, 'ما بتنعدّل من صفحة الإعدادات');

  const on = await call('/api/admin/auth-mode', { method: 'POST', token: owner, body: { mode: 'whatsapp_link' } });
  assert.equal(on.status, 400, 'ما بيتفعّل وواتساب مش مجهّز');
  const dev = await call('/api/admin/auth-mode', { method: 'POST', token: owner, body: { mode: 'dev' } });
  assert.equal(dev.status, 200);
  await settings.set('auth.mode', '');
});
