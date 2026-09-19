'use strict';
/**
 * اختبارات تكامل تعمل على قاعدة بيانات مؤقتة وخادم حقيقي.
 * تغطي: الدخول، الملف الشخصي، التسعير، إنشاء الرحلة، منع التكرار، الإلغاء، التقييم.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-api-test-' + Date.now() + '.db');
process.env.SQLITE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'development';
process.env.SMS_PROVIDER = 'dev';
process.env.PORT = '0';

const db = require('../src/db');
const settings = require('../src/services/settings');
const seed = require('../src/db/seed');
const { server } = require('../src/server');
const S = require('../src/services/trip-state');

let base = '';

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

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(phone) {
  const a = await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  assert.equal(a.status, 200);
  const b = await call('/api/auth/otp/verify', { method: 'POST', body: { phone, code: a.data.devCode } });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  return b.data.accessToken;
}

test('الصحة والإعدادات العامة متاحة بدون تسجيل دخول', async () => {
  const h = await call('/api/health');
  assert.equal(h.data.status, 'up');
  const c = await call('/api/config');
  assert.equal(c.data.currency, 'JOD');
});

test('لا يمكن الوصول للمسارات المحمية بدون رمز', async () => {
  const r = await call('/api/me');
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'UNAUTHORIZED');
});

test('رمز تحقق خاطئ يُرفض', async () => {
  const phone = '0790000101';
  await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const r = await call('/api/auth/otp/verify', { method: 'POST', body: { phone, code: '0000' } });
  assert.equal(r.status, 400);
  assert.ok(['OTP_INVALID', 'OTP_ATTEMPTS_EXCEEDED'].includes(r.data.error.code));
});

test('طلب رمزين متتاليين بسرعة يُرفض', async () => {
  const phone = '0790000102';
  await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const r = await call('/api/auth/otp/request', { method: 'POST', body: { phone } });
  assert.equal(r.status, 429);
  assert.equal(r.data.error.code, 'OTP_RATE_LIMITED');
});

test('تسجيل الدخول ينشئ مستخدماً ويسمح بتعديل الملف الشخصي', async () => {
  const token = await login('0790000103');
  const me = await call('/api/me', { token });
  assert.equal(me.data.user.phone, '+962790000103');
  assert.equal(me.data.user.profileComplete, false);

  const up = await call('/api/me', { method: 'PATCH', token, body: { name: 'سالم الطراونة', theme: 'dark' } });
  assert.equal(up.data.user.name, 'سالم الطراونة');
  assert.equal(up.data.user.theme, 'dark');
  assert.equal(up.data.user.profileComplete, true);

  const bad = await call('/api/me', { method: 'PATCH', token, body: { email: 'not-an-email' } });
  assert.equal(bad.status, 400);
});

test('التسعير يعيد خيارات مرتبة بأسعار صحيحة', async () => {
  const token = await login('0790000104');
  const r = await call('/api/trips/estimate', {
    method: 'POST', token,
    body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.options.length >= 1);
  const eco = r.data.options[0];
  assert.ok(Number.isInteger(eco.fareFils), 'الأجرة عدد صحيح بالفلس');
  assert.ok(eco.fareFils % 50 === 0, 'مقرّبة لأقرب 50 فلساً');
  assert.ok(eco.fareFils >= 1000, 'لا تقل عن الحد الأدنى');
  assert.match(eco.fareText, /^\d+\.\d{3}$/);
});

test('الوجهة خارج منطقة الخدمة تُرفض', async () => {
  const token = await login('0790000105');
  const r = await call('/api/trips/estimate', {
    method: 'POST', token,
    body: { pickupLat: 48.85, pickupLng: 2.35, destLat: 48.86, destLng: 2.36 },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'OUT_OF_SERVICE_AREA');
});

test('دورة الرحلة: إنشاء → منع التكرار → إلغاء بدون رسوم → تظهر في السجل', async () => {
  const token = await login('0790000106');
  const vt = await call('/api/vehicle-types');
  const vehicleTypeId = vt.data.vehicleTypes[0].id;

  const created = await call('/api/trips', {
    method: 'POST', token,
    body: {
      pickupLat: 31.185, pickupLng: 35.7047, pickupAddress: 'وسط البلد',
      destLat: 31.17, destLng: 35.72, destAddress: 'شارع الجامعة',
      vehicleTypeId,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const trip = created.data.trip;
  assert.ok([S.STATUS.REQUESTED, S.STATUS.SEARCHING].includes(trip.status));
  assert.match(trip.code, /^NSH-/);

  const dup = await call('/api/trips', {
    method: 'POST', token,
    body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72, vehicleTypeId },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.code, 'TRIP_ACTIVE_EXISTS');

  const preview = await call(`/api/trips/${trip.id}/cancel-preview`, { token });
  assert.equal(preview.data.feeFils, 0, 'الإلغاء قبل إسناد كابتن مجاني');

  const cancel = await call(`/api/trips/${trip.id}/cancel`, { method: 'POST', token, body: { reason: 'اختبار' } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.feeFils, 0);

  const again = await call(`/api/trips/${trip.id}/cancel`, { method: 'POST', token, body: {} });
  assert.equal(again.status, 409, 'لا يمكن إلغاء رحلة ملغاة');

  const hist = await call('/api/trips/history', { token });
  assert.equal(hist.data.trips[0].status, S.STATUS.CANCELLED_BY_CUSTOMER);
});

test('لا يمكن تقييم رحلة غير مكتملة، ولا رحلة مستخدم آخر', async () => {
  const tokenA = await login('0790000107');
  const tokenB = await login('0790000108');
  const vt = await call('/api/vehicle-types');
  const vehicleTypeId = vt.data.vehicleTypes[0].id;

  const created = await call('/api/trips', {
    method: 'POST', token: tokenA,
    body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72, vehicleTypeId },
  });
  const id = created.data.trip.id;

  const rate = await call(`/api/trips/${id}/rate`, { method: 'POST', token: tokenA, body: { stars: 5 } });
  assert.equal(rate.status, 400);

  const other = await call(`/api/trips/${id}`, { token: tokenB });
  assert.equal(other.status, 404, 'رحلة مستخدم آخر غير مرئية');

  await call(`/api/trips/${id}/cancel`, { method: 'POST', token: tokenA, body: {} });
});

test('لا يوجد كابتن متاح ⇒ حالة واضحة وليس انتظاراً مفتوحاً', async () => {
  const token = await login('0790000109');
  const vt = await call('/api/vehicle-types');
  const created = await call('/api/trips', {
    method: 'POST', token,
    body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72, vehicleTypeId: vt.data.vehicleTypes[0].id },
  });
  const id = created.data.trip.id;

  // لا يوجد كباتن مسجّلون بعد ⇒ لا تُرسل أي عروض
  const offers = await db.query('SELECT COUNT(*) AS c FROM trip_offers WHERE trip_id = $1', [id]);
  assert.equal(Number(offers[0].c), 0);

  // تقصير مهلة البحث ثم تشغيل نبضة المحرك
  await db.query("UPDATE settings SET value = '0' WHERE key = 'dispatch.search_timeout_sec'", []);
  settings.invalidate();
  await require('../src/services/dispatch').tick();

  const after = await call(`/api/trips/${id}`, { token });
  assert.equal(after.data.trip.status, S.STATUS.NO_DRIVER_FOUND);
  assert.equal(after.data.trip.isFinal, true);

  await db.query("UPDATE settings SET value = '90' WHERE key = 'dispatch.search_timeout_sec'", []);
  settings.invalidate();
});

test('صورة الحساب: نوع غير مدعوم يُرفض', async () => {
  const token = await login('0790000110');
  const r = await call('/api/me/photo', { method: 'POST', token, body: { dataUrl: 'data:text/plain;base64,aGk=' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'UPLOAD_INVALID_TYPE');
});

test('الأماكن المحفوظة: إضافة، تحديث البيت، حذف', async () => {
  const token = await login('0790000111');
  const a = await call('/api/places', { method: 'POST', token, body: { kind: 'home', label: 'البيت', lat: 31.18, lng: 35.70, address: 'الكرك' } });
  assert.equal(a.status, 201);
  const b = await call('/api/places', { method: 'POST', token, body: { kind: 'home', label: 'البيت', lat: 31.19, lng: 35.71, address: 'الثنية' } });
  assert.equal(b.status, 200, 'تحديث وليس تكرار');

  const list = await call('/api/places', { token });
  assert.equal(list.data.saved.filter((p) => p.kind === 'home').length, 1);

  const del = await call('/api/places/' + list.data.saved[0].id, { method: 'DELETE', token });
  assert.equal(del.status, 200);
});

test('السيارات القريبة: تُعرض فقط للكباتن الحقيقيين المتصلين وبموقع حديث، بدون بيانات شخصية', async () => {
  const token = await login('0790000112');
  const { uuid, nowIso } = require('../src/lib/ids');
  const vt = await db.one("SELECT id FROM vehicle_types WHERE code = 'economy'", []);
  const now = nowIso();

  async function makeCaptain(phone, { online, fresh, status = 'APPROVED', lat = 31.186, lng = 35.705 }) {
    const uid = uuid(), cid = uuid();
    await db.query(`INSERT INTO users (id, role, phone_e164, name, status, language, theme, is_verified, created_at, updated_at)
                    VALUES ($1,'captain',$2,'كابتن تجربة','ACTIVE','ar','system',1,$3,$3)`, [uid, phone, now]);
    await db.query(`INSERT INTO captains (id, user_id, status, is_online, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)`,
      [cid, uid, status, online ? 1 : 0, now]);
    await db.query(`INSERT INTO vehicles (id, captain_id, vehicle_type_id, plate_number, created_at) VALUES ($1,$2,$3,'10-1234',$4)`,
      [uuid(), cid, vt.id, now]);
    const at = fresh ? now : new Date(Date.now() - 3600_000).toISOString();
    await db.query(`INSERT INTO driver_locations (captain_id, lat, lng, heading, updated_at) VALUES ($1,$2,$3,90,$4)`, [cid, lat, lng, at]);
    return cid;
  }

  await makeCaptain('+962791110001', { online: true, fresh: true });                 // يظهر
  await makeCaptain('+962791110002', { online: false, fresh: true });                // غير متصل
  await makeCaptain('+962791110003', { online: true, fresh: false });                // موقع قديم
  await makeCaptain('+962791110004', { online: true, fresh: true, status: 'PENDING' }); // غير معتمد
  await makeCaptain('+962791110005', { online: true, fresh: true, lat: 31.5, lng: 35.9 }); // بعيد

  const r = await call('/api/captains/nearby?lat=31.185&lng=35.7047', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.captains.length, 1, JSON.stringify(r.data));
  const car = r.data.captains[0];
  assert.deepEqual(Object.keys(car).sort(), ['heading', 'id', 'lat', 'lng']);
  assert.equal(car.heading, 90);

  const anon = await call('/api/captains/nearby?lat=31.185&lng=35.7047');
  assert.equal(anon.status, 401);
});

test('منطقة الخدمة: الكرك دائماً، وعمّان فقط عند تفعيل «كل الأردن»', async () => {
  const token = await login('0790000113');
  const amman = { pickupLat: 31.9772, pickupLng: 35.8847, destLat: 31.9630, destLng: 35.9060 };
  const off = await call('/api/trips/estimate', { method: 'POST', token, body: amman });
  assert.equal(off.status, 400);
  assert.equal(off.data.error.code, 'OUT_OF_SERVICE_AREA');

  process.env.SERVICE_ALL_JORDAN = '1';
  await seed.run({ quiet: true });
  const on = await call('/api/trips/estimate', { method: 'POST', token, body: amman });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.cityName, 'الأردن');
  const karak = await call('/api/trips/estimate', {
    method: 'POST', token, body: { pickupLat: 31.185, pickupLng: 35.7047, destLat: 31.17, destLng: 35.72 },
  });
  assert.equal(karak.data.cityName, 'الكرك', 'داخل الكرك تبقى المنطقة الأدق هي الكرك');

  delete process.env.SERVICE_ALL_JORDAN;
  await seed.run({ quiet: true });
  const back = await call('/api/trips/estimate', { method: 'POST', token, body: amman });
  assert.equal(back.data.error.code, 'OUT_OF_SERVICE_AREA', 'بعد حذف المتغير ترجع الكرك فقط');
});
