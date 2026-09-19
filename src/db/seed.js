'use strict';
/**
 * البيانات الأساسية: المدن (مناطق الخدمة)، أنواع المركبات، قواعد التسعير الافتراضية.
 * تُنفَّذ عند كل إقلاع ولا تكرّر ما هو موجود.
 *
 * ملاحظة التسعير: القيم أدناه قيم ابتداء منخفضة ومنافسة، وكلها قابلة
 * للتعديل من قاعدة البيانات/لوحة الإدارة لاحقاً دون تعديل الكود.
 */
const db = require('../db');
const { uuid, nowIso } = require('../lib/ids');

// مناطق الخدمة الدائمة
const CITIES = [
  { code: 'karak', name_ar: 'الكرك', name_en: 'Karak', lat: 31.1850, lng: 35.7047, radius: 30 },
];

/**
 * منطقة «كل الأردن» — مؤقتة للتجربة.
 * تشتغل فقط إذا كان متغير البيئة SERVICE_ALL_JORDAN = 1
 * وعند حذف المتغير ترجع الخدمة للكرك فقط تلقائياً بعد إعادة التشغيل.
 */
const ALL_JORDAN = { code: 'jordan', name_ar: 'الأردن', name_en: 'Jordan', lat: 31.25, lng: 36.50, radius: 320 };

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

async function insertCity(c, isActive, now) {
  await db.query(
    `INSERT INTO cities (id, code, name_ar, name_en, center_lat, center_lng, radius_km, is_active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uuid(), c.code, c.name_ar, c.name_en, c.lat, c.lng, c.radius, isActive ? 1 : 0, now]
  );
}

async function run({ quiet = false } = {}) {
  const now = nowIso();
  const log = quiet ? () => {} : console.log;

  for (const c of CITIES) {
    const ex = await db.one('SELECT id FROM cities WHERE code = $1', [c.code]);
    if (ex) continue;
    await insertCity(c, true, now);
    log(`+ مدينة: ${c.name_ar}`);
  }

  // «كل الأردن»: تُفعَّل أو تُطفأ حسب متغير البيئة في كل إقلاع
  const allJordan = process.env.SERVICE_ALL_JORDAN === '1';
  const jo = await db.one('SELECT id, is_active FROM cities WHERE code = $1', [ALL_JORDAN.code]);
  if (!jo) {
    await insertCity(ALL_JORDAN, allJordan, now);
  } else if (Boolean(jo.is_active) !== allJordan) {
    await db.query('UPDATE cities SET is_active = $1 WHERE id = $2', [allJordan ? 1 : 0, jo.id]);
  }
  log(allJordan ? '• منطقة الخدمة: كل الأردن (مؤقت)' : '• منطقة الخدمة: الكرك فقط');

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

  // قاعدة تسعير لكل مدينة × نوع مركبة (ما بتنكرر إذا موجودة)
  const cities = await db.query('SELECT id, code FROM cities', []);
  for (const city of cities) {
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
      log(`+ تسعيرة: ${city.code}/${code}`);
    }
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
