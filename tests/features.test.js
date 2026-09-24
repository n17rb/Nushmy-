'use strict';
/**
 * الإضافات: كتالوج السيارات (الفئة)، بطاقة السيارة للزبون، المحادثات (رحلة + دعم + إدارة)،
 * الإبلاغ والأغراض المنسية، صندوق الإشعارات والرسائل الجماعية، تشفير Web Push، البحث العربي.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TMP = path.join('/tmp', 'nashmi-features-test-' + Date.now() + '.db');
process.env.SQLITE_PATH = TMP;
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'development';
process.env.SMS_PROVIDER = 'dev';
process.env.CAPTAIN_AUTO_APPROVE = '1';
process.env.ADMIN_PHONES = '0795550000';
process.env.UPLOADS_DIR = path.join('/tmp', 'nashmi-features-uploads-' + Date.now());

const db = require('../src/db');
const settings = require('../src/services/settings');
const seed = require('../src/db/seed');
const webpush = require('../src/services/webpush');
const arabic = require('../src/lib/arabic');
const { server } = require('../src/server');

let base = '';
let vehicleTypeId;
const PICKUP = { lat: 31.1850, lng: 35.7047 };
const DEST = { lat: 31.1700, lng: 35.7200 };

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

let customer, captain, admin, tripId, supportId;

test('البحث العربي: «عبدلي» = «العبدلي»، والهمزات والتاء المربوطة', () => {
  assert.equal(arabic.normalize('عبدلي'), arabic.normalize('العبدلي'));
  assert.equal(arabic.normalize('مستشفى الكَرَك'), arabic.normalize('مستشفي الكرك'));
  assert.equal(arabic.normalize('مكة'), arabic.normalize('مكه'));
  assert.ok(arabic.score('عبدلي', 'مجمع العبدلي') > 0.8);
  assert.equal(arabic.score('صيدليه', 'مخبز الأمل'), 0);
});

test('كتالوج السيارات: شركات وفئات (بدون كلمة «موديل» بالعربي)', async () => {
  const r = await call('/api/vehicle-catalog');
  assert.equal(r.status, 200);
  const h = r.data.makes.find((m) => m.id === 'hyundai');
  assert.ok(h.classes.find((c) => c.id === 'ioniq5' && c.fuel === 'electric' && c.seats === 5));
  assert.ok(r.data.colors.find((c) => c.id === 'silver' && c.ar === 'فضي'));
  assert.ok(r.data.makes.length >= 30);
});

test('تسجيل كابتن من الكتالوج: الشركة ← الفئة ← السنة ← اللون', async () => {
  captain = await login('0791110001');
  const r = await call('/api/captain/register', { method: 'POST', token: captain, body: {
    name: 'سامي المجالي', vehicleTypeId, makeId: 'hyundai', classId: 'sonata', year: 2020, colorKey: 'white',
    transmission: 'automatic', plate: '10-55555' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const me = await call('/api/captain/me', { token: captain });
  const v = me.data.vehicle;
  assert.equal(v.label, 'Hyundai Sonata');
  assert.equal(v.classAr, 'سوناتا');
  assert.equal(v.color, 'أبيض');
  assert.equal(v.seats, 5);
  assert.equal(v.fuelAr, 'بنزين');
  assert.equal(v.transmissionAr, 'أوتوماتيك');
  // فئة غلط مرفوضة، وسيارة مش بالكتالوج بتنكتب يدوي
  const bad = await call('/api/captain/vehicle', { method: 'PATCH', token: captain, body: { makeId: 'hyundai', classId: 'nope', year: 2020, colorKey: 'white' } });
  assert.equal(bad.status, 400);
  await call('/api/captain/online', { method: 'POST', token: captain, body: { online: true } });
  await call('/api/captain/location', { method: 'POST', token: captain, body: { lat: 31.1860, lng: 35.7050, heading: 90, accuracy: 8 } });
});

test('الزبون بيشوف بطاقة السيارة + الوقت المتوقع + محادثة الرحلة', async () => {
  customer = await login('0791110002');
  const c = await call('/api/trips', { method: 'POST', token: customer, body: {
    pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, pickupAddress: 'البيت', pickupAccuracy: 9, pickupNote: 'قدام صيدلية الشفاء',
    destLat: DEST.lat, destLng: DEST.lng, destAddress: 'مجمع العبدلي', vehicleTypeId, paymentMethod: 'CASH' } });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  tripId = c.data.trip.id;

  // قبل ما يقبل كابتن: ما في محادثة
  const early = await call(`/api/chat/trips/${tripId}`, { token: customer });
  assert.equal(early.status, 409);

  const offer = await call('/api/captain/offer', { token: captain });
  assert.ok(offer.data.offer, 'وصل العرض للكابتن');
  const acc = await call(`/api/captain/offers/${offer.data.offer.id}/accept`, { method: 'POST', token: captain, body: {} });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.trip.pickupNote, 'قدام صيدلية الشفاء');

  const t = await call(`/api/trips/${tripId}`, { token: customer });
  const v = t.data.trip.captain.vehicle;
  assert.equal(v.label, 'Hyundai Sonata');
  assert.equal(v.year, 2020);
  assert.equal(v.color, 'أبيض');
  assert.equal(v.plate, '10-55555');
  assert.ok(t.data.trip.eta && t.data.trip.eta.target === 'pickup' && t.data.trip.eta.seconds >= 60);

  // موقع الزبون المباشر بيوصل للكابتن
  const rl = await call(`/api/trips/${tripId}/rider-location`, { method: 'POST', token: customer, body: { lat: 31.18505, lng: 35.70475, accuracy: 6 } });
  assert.equal(rl.data.shared, true);
  const ct = await call(`/api/captain/trips/${tripId}`, { token: captain });
  assert.ok(ct.data.trip.riderLocation && ct.data.trip.riderLocation.accuracyM === 6);
});

test('محادثة الزبون ↔ الكابتن', async () => {
  const a = await call(`/api/chat/trips/${tripId}`, { token: customer });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const threadId = a.data.thread.id;
  assert.equal(a.data.thread.peer.name, 'سامي');           // الاسم الأول بس، بدون رقم
  const s1 = await call(`/api/chat/threads/${threadId}/messages`, { method: 'POST', token: customer, body: { body: 'أنا قدام الصيدلية' } });
  assert.equal(s1.status, 201);

  const un = await call('/api/chat/unread?as=captain', { token: captain });
  assert.equal(un.data.trips[tripId], 1);
  const g = await call(`/api/chat/trips/${tripId}?as=captain`, { token: captain });
  assert.equal(g.data.messages.length, 1);
  assert.equal(g.data.messages[0].mine, false);
  const s2 = await call(`/api/chat/threads/${threadId}/messages`, { method: 'POST', token: captain, body: { body: 'دقيقتين وبكون عندك', as: 'captain' } });
  assert.equal(s2.status, 201);
  const un2 = await call('/api/chat/unread?as=captain', { token: captain });
  assert.equal(un2.data.trips[tripId], undefined);

  // شخص ثالث ما بيقدر يقرأ
  const other = await login('0791110009');
  const x = await call(`/api/chat/threads/${threadId}`, { token: other });
  assert.equal(x.status, 404);
  const empty = await call(`/api/chat/threads/${threadId}/messages`, { method: 'POST', token: customer, body: { body: '   ' } });
  assert.equal(empty.status, 400);
});

test('الدعم الفني: إبلاغ عن كابتن + غرض منسي، والإدارة بترد', async () => {
  const r = await call('/api/chat/support', { method: 'POST', token: customer, body: { topic: 'report_captain', tripId, body: 'سايق بسرعة كبيرة' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  supportId = r.data.thread.id;
  assert.equal(r.data.thread.topicLabel, 'إبلاغ عن كابتن');
  // رسالة ثانية لنفس الموضوع والرحلة بتروح لنفس المحادثة
  const r2 = await call('/api/chat/support', { method: 'POST', token: customer, body: { topic: 'report_captain', tripId, body: 'وكمان كان عالتلفون' } });
  assert.equal(r2.data.thread.id, supportId);
  const lost = await call('/api/chat/support', { method: 'POST', token: customer, body: { topic: 'lost_item', tripId, body: 'نسيت شنتة سودا بالكنبة الورا' } });
  assert.notEqual(lost.data.thread.id, supportId);
  // رحلة مش إله مرفوضة
  const other = await login('0791110008');
  const bad = await call('/api/chat/support', { method: 'POST', token: other, body: { topic: 'lost_item', tripId, body: 'x' } });
  assert.equal(bad.status, 404);

  admin = await login('0795550000');
  const list = await call('/api/admin/chats?filter=unread', { token: admin });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.unreadThreads, 2);
  const th = list.data.threads.find((t) => t.id === supportId);
  assert.equal(th.trip.captain.name, 'سامي المجالي');
  const badge = await call('/api/admin/chats/badge', { token: admin });
  assert.equal(badge.data.waiting, 2);

  const get = await call(`/api/admin/chats/${supportId}`, { token: admin });
  assert.equal(get.data.messages.filter((m) => m.senderRole === 'customer').length, 2);
  assert.equal(get.data.messages.filter((m) => m.senderRole === 'system').length, 1);   // الرد التلقائي
  const rep = await call(`/api/admin/chats/${supportId}/messages`, { method: 'POST', token: admin, body: { body: 'تم، رح نتابع مع الكابتن' } });
  assert.equal(rep.status, 201);

  // الزبون بيشوف الرد + إشعار بصندوق الإشعارات
  const un = await call('/api/chat/unread', { token: customer });
  assert.ok(un.data.support >= 1);
  assert.ok(un.data.notifications >= 1);
  const n = await call('/api/notifications', { token: customer });
  assert.equal(n.data.notifications[0].type, 'support');

  // الإدارة بتراسل الكابتن عن الغرض المنسي
  const capUser = th.trip.captainUserId;
  const st = await call('/api/admin/chats/start', { method: 'POST', token: admin, body: { userId: capUser, side: 'captain', topic: 'lost_item', tripId, body: 'في زبون نسي شنتة سودا بسيارتك، شيّك عليها لو سمحت' } });
  assert.equal(st.status, 201, JSON.stringify(st.data));
  const capThreads = await call('/api/chat/threads?as=captain', { token: captain });
  assert.ok(capThreads.data.threads.find((t) => t.id === st.data.thread.id && t.unread === 1));

  // محادثة الرحلة للقراءة بس عند الإدارة
  const trips = await call('/api/admin/chats?kind=trip', { token: admin });
  assert.equal(trips.data.threads.length, 1);
  const ro = await call(`/api/admin/chats/${trips.data.threads[0].id}/messages`, { method: 'POST', token: admin, body: { body: 'x' } });
  assert.equal(ro.status, 409);
});

test('رسالة جماعية (عرض + كود) بتوصل لصندوق إشعارات الزباين والكباتن', async () => {
  const r = await call('/api/admin/broadcasts', { method: 'POST', token: admin, body: { audience: 'all', title: 'خصم الويكند', body: 'خصم 20% على كل الرحلات', code: 'nashmi20' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await new Promise((res) => setTimeout(res, 400));
  const n = await call('/api/notifications', { token: customer });
  const promo = n.data.notifications.find((x) => x.type === 'promo');
  assert.ok(promo);
  assert.equal(promo.data.code, 'NASHMI20');
  const nc = await call('/api/notifications?app=captain', { token: captain });
  assert.ok(nc.data.notifications.find((x) => x.type === 'promo'));
  await call('/api/notifications/read', { method: 'POST', token: customer, body: {} });
  const after = await call('/api/notifications', { token: customer });
  assert.equal(after.data.unread, 0);
  assert.ok(after.data.notifications.length >= 2, 'الإشعارات ما بتختفي بعد القراءة');
  const list = await call('/api/admin/broadcasts', { token: admin });
  assert.equal(list.data.broadcasts[0].code, 'NASHMI20');
});

test('Web Push: التشفير aes128gcm بينفك صح من طرف الجهاز (RFC 8291)', async () => {
  // «الجهاز»
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const body = webpush.encrypt('{"title":"نشمي"}', webpush.b64u(ua.getPublicKey()), webpush.b64u(authSecret));
  // فك التشفير كما يعمل المتصفح
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, -1).toString(), '{"title":"نشمي"}');
});

test('Web Push: مفاتيح VAPID بتتولّد مرة وحدة وتوقيع JWT صحيح', async () => {
  const k = await call('/api/push/key');
  assert.equal(k.status, 200);
  const pub = webpush.unb64u(k.data.publicKey);
  assert.equal(pub.length, 65);
  const k2 = await call('/api/push/key');
  assert.equal(k2.data.publicKey, k.data.publicKey);
  const keys = await webpush.vapidKeys();
  const auth = webpush.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:x@y.z');
  const [, jwt] = /t=([^,]+)/.exec(auth);
  const [h, p, s] = jwt.split('.');
  const x = webpush.b64u(pub.subarray(1, 33)), y = webpush.b64u(pub.subarray(33));
  const pk = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pk, dsaEncoding: 'ieee-p1363' }, webpush.unb64u(s)));
  assert.equal(JSON.parse(webpush.unb64u(p)).aud, 'https://fcm.googleapis.com');

  const sub = await call('/api/push/subscribe', { method: 'POST', token: customer, body: { app: 'customer',
    subscription: { endpoint: 'https://push.example.test/abc', keys: { p256dh: webpush.b64u(crypto.createECDH('prime256v1').generateKeys()), auth: webpush.b64u(crypto.randomBytes(16)) } } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const row = await db.one('SELECT * FROM push_subscriptions WHERE endpoint = $1', ['https://push.example.test/abc']);
  assert.equal(row.app, 'customer');
});

test('أماكن الإدارة بتطلع أول نتائج البحث', async () => {
  const add = await call('/api/admin/pois', { method: 'POST', token: admin, body: { name: 'مستشفى الكرك الحكومي', category: 'hospital', lat: 31.18, lng: 35.70 } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const s = await call('/api/search/places?q=' + encodeURIComponent('مستشفي كرك') + '&lat=31.18&lng=35.70', { token: customer });
  assert.equal(s.data.results[0].label, 'مستشفى الكرك الحكومي');
  const s2 = await call('/api/search/places?q=' + encodeURIComponent('عبدلي'), { token: customer });
  assert.ok(s2.data.results.find((r) => r.label === 'مجمع العبدلي'), 'الوجهات السابقة بتنلاقى بدون «ال»');
});

test('صور السيارات: صورة للفئة بتظهر للزبون', async () => {
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex').toString('base64');
  const up = await call('/api/admin/car-images', { method: 'POST', token: admin, body: { makeId: 'hyundai', classId: 'sonata', colorKey: '', dataUrl: png } });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const t = await call(`/api/trips/${tripId}`, { token: customer });
  assert.equal(t.data.trip.captain.vehicle.imageUrl, up.data.url);
  const img = await fetch(base + up.data.url);
  assert.equal(img.status, 200);
});

test('صور السيارات: صورة الفئة بتظهر للزبون، وبدونها تنبيه للإدارة', async () => {
  // الصورة المرفوعة بالاختبار السابق بتطلع للزبون
  const t = await call(`/api/trips/${tripId}`, { token: customer });
  assert.ok(t.data.trip.captain.vehicle.imageUrl.startsWith('/media/'));
  const cls = await call('/api/class-images', { token: captain });
  assert.ok(cls.data.images['hyundai/sonata']);

  // كابتن بفئة ما إلها صورة ← بدون صورة للزبون + تنبيه للإدارة
  const cap2 = await login('0791110003');
  const r = await call('/api/captain/register', { method: 'POST', token: cap2, body: {
    name: 'وليد النوايسة', vehicleTypeId, makeId: 'kia', classId: 'cerato', year: 2018, colorKey: 'silver', plate: '10-77777' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await new Promise((res) => setTimeout(res, 300));
  const al = await call('/api/admin/alerts', { token: admin });
  const miss = al.data.alerts.find((a) => a.type === 'car_image_missing');
  assert.ok(miss, 'وصل تنبيه للإدارة');
  assert.ok(miss.body.includes('سيراتو'));
  assert.equal(miss.data.classId, 'cerato');
  assert.ok(al.data.unread >= 1);

  // ما بيتكرر لنفس الفئة
  const before = al.data.alerts.filter((a) => a.type === 'car_image_missing').length;
  const cap3 = await login('0791110004');
  await call('/api/captain/register', { method: 'POST', token: cap3, body: {
    name: 'رامي القطاونة', vehicleTypeId, makeId: 'kia', classId: 'cerato', year: 2019, colorKey: 'white', plate: '10-88888' } });
  await new Promise((res) => setTimeout(res, 300));
  const al2 = await call('/api/admin/alerts', { token: admin });
  assert.equal(al2.data.alerts.filter((a) => a.type === 'car_image_missing').length, before);

  // بصفحة صور السيارات: الفئة بتطلع بقائمة «الناقص»
  const lib = await call('/api/admin/car-images', { token: admin });
  assert.ok(lib.data.missing.find((m) => m.classId === 'cerato' && m.captains === 2));

  // لما ترفع الصورة: التنبيه بينقرا لحاله
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex').toString('base64');
  await call('/api/admin/car-images', { method: 'POST', token: admin, body: { makeId: 'kia', classId: 'cerato', dataUrl: png } });
  const al3 = await call('/api/admin/alerts', { token: admin });
  assert.ok(!al3.data.alerts.find((a) => a.type === 'car_image_missing' && !a.read));
});

test('المكالمة داخل التطبيق: رنّة، رد، تبادل إشارات، وإنهاء', async () => {
  await call('/api/me', { method: 'PATCH', token: customer, body: { name: 'أحمد الخالدي' } });
  // الكابتن بيتصل بالزبون
  const r = await call('/api/calls', { method: 'POST', token: captain, body: { tripId, as: 'captain' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.call.id;
  assert.equal(r.data.call.status, 'RINGING');
  assert.equal(r.data.call.direction, 'out');
  assert.equal(r.data.call.peer.name, 'أحمد');            // الاسم الأول بس، بدون رقم
  assert.ok(r.data.ice.iceServers.length >= 1);

  // الزبون بيشوف مكالمة واردة
  const inc = await call('/api/calls/incoming', { token: customer });
  assert.equal(inc.data.call.id, id);
  assert.equal(inc.data.call.direction, 'in');
  assert.equal(inc.data.call.peer.name, 'سامي');

  // شخص ثالث ما بيقدر يتدخّل
  const other = await login('0791110007');
  assert.equal((await call('/api/calls/' + id, { token: other })).status, 404);
  assert.equal((await call('/api/calls/' + id + '/accept', { method: 'POST', token: other })).status, 404);

  // رد + تبادل offer/answer/ice
  const acc = await call('/api/calls/' + id + '/accept', { method: 'POST', token: customer });
  assert.equal(acc.data.call.status, 'ACTIVE');
  await call('/api/calls/' + id + '/signal', { method: 'POST', token: captain, body: { kind: 'offer', payload: '{"type":"offer","sdp":"v=0"}' } });
  await call('/api/calls/' + id + '/signal', { method: 'POST', token: customer, body: { kind: 'answer', payload: '{"type":"answer","sdp":"v=0"}' } });
  const forCustomer = await call('/api/calls/' + id, { token: customer });
  assert.equal(forCustomer.data.signals.length, 1);        // بس رسالة الطرف الثاني
  assert.equal(forCustomer.data.signals[0].kind, 'offer');
  const forCaptain = await call('/api/calls/' + id, { token: captain });
  assert.equal(forCaptain.data.signals[0].kind, 'answer');

  // إنهاء
  const end = await call('/api/calls/' + id + '/end', { method: 'POST', token: customer, body: { reason: 'hangup' } });
  assert.equal(end.data.call.status, 'ENDED');
  assert.equal((await call('/api/calls/incoming', { token: customer })).data.call, null);
  const row = await db.one('SELECT * FROM calls WHERE id = $1', [id]);
  assert.equal(row.end_reason, 'hangup');
  assert.ok(row.duration_s >= 0);
});

test('المكالمة: رنّة بدون رد بتصير «فايتة»، والرفض بينحسب رفض', async () => {
  await settings.set('call.ring_sec', '0');
  settings.invalidate();
  const r = await call('/api/calls', { method: 'POST', token: customer, body: { tripId, as: 'customer' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const inc = await call('/api/calls/incoming', { token: captain });
  assert.equal(inc.data.call, null, 'الرنّة انتهت ← مكالمة فايتة');
  const row = await db.one('SELECT * FROM calls WHERE id = $1', [r.data.call.id]);
  assert.equal(row.status, 'ENDED');
  assert.equal(row.end_reason, 'missed');

  await settings.set('call.ring_sec', '45');
  settings.invalidate();
  const r2 = await call('/api/calls', { method: 'POST', token: customer, body: { tripId, as: 'customer' } });
  const dec = await call('/api/calls/' + r2.data.call.id + '/end', { method: 'POST', token: captain, body: {} });
  assert.equal(dec.data.call.endReason, 'declined');
});
