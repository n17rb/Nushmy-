'use strict';
/**
 * رحلة كاملة من الطرفين: العميل يطلب ← كابتنان يستلمان العرض ← واحد فقط يقبل ← وصول ← بدء ← إنهاء
 * ← الأجرة والعمولة 7.5% ← خصم العمولة من المحفظة مرة واحدة فقط.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-captain-test-' + Date.now() + '.db');
process.env.SQLITE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'development';
process.env.SMS_PROVIDER = 'dev';
process.env.CAPTAIN_AUTO_APPROVE = '1';
process.env.UPLOADS_DIR = path.join('/tmp', 'nashmi-captain-uploads-' + Date.now());

const db = require('../src/db');
const settings = require('../src/services/settings');
const seed = require('../src/db/seed');
const dispatch = require('../src/services/dispatch');
const { server } = require('../src/server');

let base = '';
const PICKUP = { lat: 31.1850, lng: 35.7047 };
const DEST = { lat: 31.1700, lng: 35.7200 };
let vehicleTypeId;

test.before(async () => {
  await db.init();
  await settings.ensureDefaults();
  await seed.run({ quiet: true });
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  vehicleTypeId = (await db.one("SELECT id FROM vehicle_types WHERE code = 'economy'", [])).id;
});

test.after(async () => {
  server.close();
  await db.close();
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

async function call(p, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(phone) {
  const a = await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const b = await call('/api/auth/otp/verify', { method: 'POST', body: { phone, code: a.data.devCode } });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  return b.data.accessToken;
}

async function makeCaptain(phone, name, at) {
  const token = await login(phone);
  const r = await call('/api/captain/register', {
    method: 'POST', token,
    body: { name, vehicleTypeId, make: 'تويوتا', model: 'كورولا', color: 'أبيض', year: 2019, plate: '10-12345' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'APPROVED');
  const on = await call('/api/captain/online', { method: 'POST', token, body: { online: true } });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const loc = await call('/api/captain/location', { method: 'POST', token, body: { ...at, heading: 90, accuracy: 10 } });
  assert.equal(loc.status, 200);
  return token;
}

let customer, capA, capB, tripId;

test('تسجيل كابتنين واتصالهما', async () => {
  capA = await makeCaptain('0791000001', 'سامي المجالي', { lat: 31.1860, lng: 35.7050 });
  capB = await makeCaptain('0791000002', 'خالد الطراونة', { lat: 31.1870, lng: 35.7060 });
  const me = await call('/api/captain/me', { token: capA });
  assert.equal(me.data.captain.status, 'APPROVED');
  assert.equal(me.data.captain.isOnline, true);
  assert.equal(me.data.vehicle.plate, '10-12345');
  assert.equal(me.data.wallet.balanceFils, 0);
});

test('التسجيل مرتين مرفوض', async () => {
  const r = await call('/api/captain/register', {
    method: 'POST', token: capA,
    body: { name: 'x y', vehicleTypeId, make: 'كيا', model: 'ريو', color: 'أسود', year: 2020, plate: '11-1111' },
  });
  assert.equal(r.status, 409);
});

test('العميل يطلب ← العرض يصل للكابتنين معاً', async () => {
  customer = await login('0791000009');
  await call('/api/me', { method: 'PATCH', token: customer, body: { name: 'أحمد الخالدي' } });
  const c = await call('/api/trips', {
    method: 'POST', token: customer,
    body: { pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, pickupAddress: 'وسط البلد', destLat: DEST.lat, destLng: DEST.lng, destAddress: 'حي الحسين', vehicleTypeId },
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  tripId = c.data.trip.id;

  const oa = await call('/api/captain/offer', { token: capA });
  const ob = await call('/api/captain/offer', { token: capB });
  assert.ok(oa.data.offer, 'العرض وصل للكابتن الأول');
  assert.ok(ob.data.offer, 'العرض وصل للكابتن الثاني');
  // الكابتن يرى صافي ربحه بعد العمولة، والوجهة، واسم الزبون الأول فقط
  const o = oa.data.offer;
  assert.equal(o.customerName, 'أحمد');
  assert.ok(o.destination.address);
  assert.equal(o.netFils, o.fareFils - Math.round(o.fareFils * 750 / 10000));
});

test('قبول بنفس اللحظة: واحد فقط ينجح', async () => {
  const oa = (await call('/api/captain/offer', { token: capA })).data.offer;
  const ob = (await call('/api/captain/offer', { token: capB })).data.offer;
  const [ra, rb] = await Promise.all([
    call(`/api/captain/offers/${oa.id}/accept`, { method: 'POST', token: capA }),
    call(`/api/captain/offers/${ob.id}/accept`, { method: 'POST', token: capB }),
  ]);
  const wins = [ra, rb].filter((r) => r.status === 200);
  const loses = [ra, rb].filter((r) => r.status !== 200);
  assert.equal(wins.length, 1, JSON.stringify([ra.data, rb.data]));
  assert.equal(loses.length, 1);
  assert.ok(['TRIP_ALREADY_ASSIGNED', 'OFFER_EXPIRED'].includes(loses[0].data.error.code), JSON.stringify(loses[0].data));
  if (rb.status === 200) { const t = capA; capA = capB; capB = t; }   // capA = الفائز

  const dbl = await call(`/api/captain/offers/${oa.id}/accept`, { method: 'POST', token: capA });
  // ضغطة مكررة من الفائز على عرضه لا تكسر شيئاً
  assert.ok([200, 404].includes(dbl.status));

  const cust = await call(`/api/trips/${tripId}`, { token: customer });
  assert.equal(cust.data.trip.status, 'DRIVER_ARRIVING');
  assert.equal(cust.data.trip.captain.vehicle.plate, '10-12345');
});

test('الكابتن يرى رقم الزبون بعد القبول', async () => {
  const t = await call('/api/captain/trip', { token: capA });
  assert.equal(t.data.trip.customer.phone, '+962791000009');
  assert.equal(t.data.trip.status, 'DRIVER_ARRIVING');
});

test('«وصلت» مرفوض إذا كان بعيداً، ومقبول عند الزبون', async () => {
  await call('/api/captain/location', { method: 'POST', token: capA, body: { lat: 31.2000, lng: 35.7300, accuracy: 10 } });
  const far = await call(`/api/captain/trips/${tripId}/arrived`, { method: 'POST', token: capA });
  assert.equal(far.status, 409);
  assert.equal(far.data.error.code, 'TOO_FAR_FROM_PICKUP');

  await call('/api/captain/location', { method: 'POST', token: capA, body: { lat: PICKUP.lat + 0.0003, lng: PICKUP.lng, accuracy: 10 } });
  const near = await call(`/api/captain/trips/${tripId}/arrived`, { method: 'POST', token: capA });
  assert.equal(near.status, 200, JSON.stringify(near.data));
  assert.equal(near.data.trip.status, 'DRIVER_ARRIVED');
});

test('لا يمكن إنهاء رحلة قبل بدئها', async () => {
  const r = await call(`/api/captain/trips/${tripId}/complete`, { method: 'POST', token: capA });
  assert.equal(r.status, 409);
});

test('بدء ← إنهاء ← الأجرة والعمولة ← المحفظة تُخصم مرة واحدة', async () => {
  const s = await call(`/api/captain/trips/${tripId}/start`, { method: 'POST', token: capA });
  assert.equal(s.status, 200);
  assert.equal((await call(`/api/trips/${tripId}`, { token: customer })).data.trip.status, 'TRIP_STARTED');

  // ضغطتين «إنهاء» بنفس اللحظة
  const [c1, c2] = await Promise.all([
    call(`/api/captain/trips/${tripId}/complete`, { method: 'POST', token: capA }),
    call(`/api/captain/trips/${tripId}/complete`, { method: 'POST', token: capA }),
  ]);
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  assert.equal(c2.status, 200, JSON.stringify(c2.data));

  const t = await db.one('SELECT * FROM trips WHERE id = $1', [tripId]);
  assert.equal(t.status, 'TRIP_COMPLETED');
  assert.equal(t.commission_fils, Math.round(t.gross_fare_fils * 750 / 10000));
  assert.equal(t.captain_earnings_fils, t.gross_fare_fils - t.commission_fils);

  const txs = await db.query("SELECT * FROM wallet_transactions WHERE reference_id = $1", [tripId]);
  assert.equal(txs.length, 1, 'العمولة خُصمت مرة واحدة فقط');
  assert.equal(Number(txs[0].amount_fils), -t.commission_fils);
  assert.equal(Number(txs[0].balance_before), 0);
  assert.equal(Number(txs[0].balance_after), -t.commission_fils);

  const w = await call('/api/captain/wallet', { token: capA });
  assert.equal(w.data.balanceFils, -t.commission_fils);
  assert.equal(w.data.transactions[0].type, 'COMMISSION');

  const e = await call('/api/captain/earnings?range=today', { token: capA });
  assert.equal(e.data.trips.length, 1);
  assert.equal(e.data.netFils, t.captain_earnings_fils);
});

test('التقييم من الطرفين مرة واحدة', async () => {
  const a = await call(`/api/captain/trips/${tripId}/rate`, { method: 'POST', token: capA, body: { stars: 5 } });
  assert.equal(a.status, 200);
  const b = await call(`/api/trips/${tripId}/rate`, { method: 'POST', token: customer, body: { stars: 5 } });
  assert.equal(b.status, 200);
  const again = await call(`/api/trips/${tripId}/rate`, { method: 'POST', token: customer, body: { stars: 4 } });
  assert.equal(again.status, 400);
  const me = await call('/api/captain/me', { token: capA });
  assert.equal(me.data.captain.rating, 5);
  assert.equal(me.data.captain.tripsCompleted, 1);
});

test('اعتذار الكابتن يرجّع الرحلة للبحث تلقائياً، وكابتن ثاني يستلمها', async () => {
  const c = await call('/api/trips', {
    method: 'POST', token: customer,
    body: { pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, destLat: DEST.lat, destLng: DEST.lng, vehicleTypeId },
  });
  const id = c.data.trip.id;
  const offer = (await call('/api/captain/offer', { token: capB })).data.offer;
  assert.ok(offer, 'الكابتن الثاني استلم العرض');
  await call(`/api/captain/offers/${offer.id}/accept`, { method: 'POST', token: capB });

  const cancel = await call(`/api/captain/trips/${id}/cancel`, { method: 'POST', token: capB, body: { reason: 'عطل' } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.mode, 'reassigned');
  assert.equal((await call(`/api/trips/${id}`, { token: customer })).data.trip.status, 'SEARCHING');

  await call('/api/captain/location', { method: 'POST', token: capA, body: { lat: 31.1860, lng: 35.7050, accuracy: 10 } });
  await dispatch.tick();
  const oa = (await call('/api/captain/offer', { token: capA })).data.offer;
  assert.ok(oa, 'الرحلة عُرضت على الكابتن الأول');
  const ob = (await call('/api/captain/offer', { token: capB })).data.offer;
  assert.equal(ob, null, 'الكابتن الي اعتذر ما بترجعله نفس الرحلة');

  // العميل يلغي بعد قبول الكابتن الأول ← الكابتن يرى الإلغاء
  await call(`/api/captain/offers/${oa.id}/accept`, { method: 'POST', token: capA });
  await call(`/api/trips/${id}/cancel`, { method: 'POST', token: customer, body: {} });
  const seen = await call(`/api/captain/trips/${id}`, { token: capA });
  assert.equal(seen.data.trip.status, 'CANCELLED_BY_CUSTOMER');
  assert.equal(seen.data.trip.isFinal, true);
});

test('المحفظة تحت الحد المسموح تمنع الاتصال', async () => {
  const cap = await db.one("SELECT c.id FROM captains c JOIN users u ON u.id = c.user_id WHERE u.phone_e164 = '+962791000002'", []);
  await db.transaction((tx) => require('../src/services/wallet').post(tx, {
    captainId: cap.id, type: 'ADJUSTMENT', amountFils: -5000, idempotencyKey: 'test-adjust-1', description: 'اختبار',
  }));
  await call('/api/captain/online', { method: 'POST', token: capB, body: { online: false } });
  const on = await call('/api/captain/online', { method: 'POST', token: capB, body: { online: true } });
  assert.equal(on.status, 403);
  assert.equal(on.data.error.code, 'WALLET_LOW');
});

test('طلب شحن رصيد مع إثبات تحويل يدخل المراجعة', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const r = await call('/api/captain/wallet/deposits', { method: 'POST', token: capB, body: { amountFils: 5000, proofDataUrl: png } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const w = await call('/api/captain/wallet', { token: capB });
  assert.equal(w.data.deposits[0].status, 'PENDING_REVIEW');
  assert.equal(w.data.balanceFils, -5000, 'الرصيد لا يتغير قبل موافقة الإدارة');
});
