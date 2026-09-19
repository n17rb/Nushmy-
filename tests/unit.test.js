'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.SQLITE_PATH = '/tmp/nashmi-test.db';

const { normalizeJordanPhone } = require('../src/lib/validate');
const money = require('../src/services/money');
const geo = require('../src/services/geo');
const S = require('../src/services/trip-state');
const jwt = require('../src/lib/jwt');
const { hashSecret, verifySecret } = require('../src/lib/hash');
const dispatch = require('../src/services/dispatch');

test('أرقام الهواتف الأردنية تُطبَّع إلى صيغة E.164', () => {
  for (const v of ['0792510509', '+962792510509', '962792510509', '00962792510509', '792510509', '079 251 0509']) {
    assert.equal(normalizeJordanPhone(v), '+962792510509');
  }
});

test('الأرقام غير الصحيحة تُرفض', () => {
  for (const v of ['123', '0612345678', '07925105', 'abc', '']) {
    assert.throws(() => normalizeJordanPhone(v), /.*/);
  }
});

test('الأموال أعداد صحيحة بالفلس ولا تفقد دقة', () => {
  assert.equal(money.toFils(2.5), 2500);
  assert.equal(money.format(2500), '2.500');
  assert.equal(money.format(0), '0.000');
  assert.equal(money.format(1), '0.001');
  assert.equal(money.format(-1500), '-1.500');
  // 0.1 + 0.2 بالفلس = 300 بالضبط
  assert.equal(money.toFils(0.1) + money.toFils(0.2), 300);
});

test('عمولة المنصة 7.5% كما في المواصفات', () => {
  // 4.000 د.أ → عمولة 0.300 وحصة الكابتن 3.700
  const gross = money.toFils(4);
  const commission = money.applyBp(gross, 750);
  assert.equal(commission, 300);
  assert.equal(gross - commission, 3700);
});

test('التقريب لأقرب 50 فلساً', () => {
  assert.equal(money.roundToNearest(1234, 50), 1250);
  assert.equal(money.roundToNearest(1010, 50), 1000);
});

test('المسافة الجغرافية تُحسب بشكل معقول', () => {
  const karak = { lat: 31.1850, lng: 35.7047 };
  const mutah = { lat: 31.0950, lng: 35.6900 };
  const d = geo.haversine(karak, mutah);
  assert.ok(d > 8000 && d < 12000, 'المسافة بين الكرك ومؤتة ~10 كم، القيمة: ' + d);
  assert.ok(geo.roadDistanceEstimate(karak, mutah) > d, 'مسافة الطريق أكبر من الهوائية');
});

test('آلة حالات الرحلة تمنع الانتقالات غير المنطقية', () => {
  assert.equal(S.canTransition('TRIP_COMPLETED', 'TRIP_STARTED'), false);
  assert.equal(S.canTransition('CANCELLED_BY_CUSTOMER', 'TRIP_COMPLETED'), false);
  assert.equal(S.canTransition('NO_DRIVER_FOUND', 'DRIVER_ASSIGNED'), false);
  assert.equal(S.canTransition('SEARCHING', 'DRIVER_ASSIGNED'), true);
  assert.equal(S.canTransition('TRIP_STARTED', 'TRIP_COMPLETED'), true);
  assert.equal(S.isActive('TRIP_STARTED'), true);
  assert.equal(S.isTerminal('TRIP_COMPLETED'), true);
});

test('كل حالة لها تسمية عربية', () => {
  for (const s of Object.keys(S.TRANSITIONS)) {
    assert.ok(S.LABEL_AR[s], 'ناقصة: ' + s);
  }
});

test('JWT يُوقَّع ويُتحقق منه ويرفض التلاعب', () => {
  const t = jwt.sign({ sub: 'u1', role: 'customer' }, 60);
  assert.equal(jwt.verify(t).sub, 'u1');
  assert.equal(jwt.verify(t.slice(0, -2) + 'xx'), null);
  assert.equal(jwt.verify('abc'), null);
  const expired = jwt.sign({ sub: 'u1' }, -10);
  assert.equal(jwt.verify(expired), null);
});

test('رموز التحقق تُخزَّن مجزّأة ولا تُقبل إلا بالقيمة الصحيحة', () => {
  const h = hashSecret('4821');
  assert.ok(!h.includes('4821'));
  assert.equal(verifySecret('4821', h), true);
  assert.equal(verifySecret('4822', h), false);
});

test('ترتيب الكباتن يقدّم الأقرب زمنياً', () => {
  const pickup = { lat: 31.185, lng: 35.7047 };
  const now = new Date().toISOString();
  const list = [
    { id: 'far',  etaS: 600, offers_sent: 10, offers_accepted: 9, trips_completed: 2, updated_at: now, lat: 31.25, lng: 35.75, heading: null },
    { id: 'near', etaS: 120, offers_sent: 10, offers_accepted: 8, trips_completed: 2, updated_at: now, lat: 31.19, lng: 35.71, heading: null },
  ];
  const ranked = dispatch.rank(list, pickup);
  assert.equal(ranked[0].id, 'near');
});

test('أوزان محرك التوزيع مجموعها 1', () => {
  const sum = Object.values(dispatch.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'المجموع: ' + sum);
});
