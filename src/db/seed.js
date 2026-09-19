'use strict';
/**
 * البيانات الأساسية: المدن، أنواع المركبات، قواعد التسعير الافتراضية.
 * تُنفَّذ عند الإقلاع ولا تكرّر ما هو موجود.
 *
 * ملاحظة التسعير: القيم أدناه قيم ابتداء منخفضة ومنافسة، وكلها قابلة
 * للتعديل من قاعدة البيانات/لوحة الإدارة لاحقاً دون تعديل الكود.
 */
const db = require('../db');
const { uuid, nowIso } = require('../lib/ids');

const CITIES = [
  { code: 'karak',  name_ar: 'الكرك',  name_en: 'Karak',  lat: 31.1850, lng: 35.7047, radius: 30 },
];

const VEHICLE_TYPES = [
  { code: 'economy', name_ar: 'عادية',  desc_ar: 'سيارة اقتصادية — تكفي 4 ركاب', capacity: 4, icon: 'car',  sort: 1 },
  { code: 'comfort', name_ar: 'مريحة',  desc_ar: 'سيارة أحدث ومساحة أوسع',        capacity: 4, icon: 'car2', sort: 2 },
  { code: 'van',     name_ar: 'عائلية', desc_ar: 'تتسع حتى 6 ركاب',               capacity: 6, icon: 'van',  sort: 3 },
];

// بالفلس (1000 فلس = 1 دينار)
const PRICING = {
  economy: { base: 400, perKm: 300, perMin: 40, min: 1000, cancel: 500, waiting: 50 },
  comfort: { base: 600, perKm: 380, perMin: 50, min: 1300, cancel: 600, waiting: 60 },
  van:     { base: 800, perKm: 450, perMin: 60, min: 1800, cancel: 750, waiting: 70 },
};

async function run({ quiet = false } = {}) {
  const now = nowIso();
  const log = quiet ? () => {} : console.log;

  for (const c of CITIES) {
    const ex = await db.one('SELECT id FROM cities WHERE code = $1', [c.code]);
    if (ex) continue;
    await db.query(
      `INSERT INTO cities (id, code, name_ar, name_en, center_lat, center_lng, radius_km, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
      [uuid(), c.code, c.name_ar, c.name_en, c.lat, c.lng, c.radius, now]
    );
    log(`+ مدينة: ${c.name_ar}`);
  }

  for (const v of VEHICLE_TYPES) {
    const ex = await db.one('SELECT id FROM vehicle_types WHERE code = $1', [v.code]);
    if (ex) continue;
    await db.query(
      `INSERT INTO vehicle_types (id, code, name_ar, desc_ar, capacity, icon, sort_order, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
      [uuid(), v.code, v.name_ar, v.desc_ar, v.capacity, v.icon, v.sort, now]
    );
    log(`+ نوع مركبة: ${v.name_ar}`);
  }

  const city = await db.one('SELECT id FROM cities WHERE code = $1', ['karak']);
  for (const [code, p] of Object.entries(PRICING)) {
    const vt = await db.one('SELECT id FROM vehicle_types WHERE code = $1', [code]);
    if (!vt) continue;
    const ex = await db.one(
      'SELECT id FROM pricing_rules WHERE vehicle_type_id = $1 AND city_id = $2', [vt.id, city.id]
    );
    if (ex) continue;
    await db.query(
      `INSERT INTO pricing_rules (id, city_id, vehicle_type_id, base_fare_fils, per_km_fils, per_min_fils,
         min_fare_fils, waiting_per_min_fils, free_waiting_sec, cancellation_fee_fils, peak_multiplier_bp,
         priority, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,180,$9,10000,10,1,$10,$10)`,
      [uuid(), city.id, vt.id, p.base, p.perKm, p.perMin, p.min, p.waiting, p.cancel, now]
    );
    log(`+ تسعيرة: ${code}`);
  }
}

if (require.main === module) {
  (async () => {
    await db.init();
    await require('../services/settings').ensureDefaults();
    await run({});
    await db.close();
    console.log('تم تجهيز البيانات الأساسية.');
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
