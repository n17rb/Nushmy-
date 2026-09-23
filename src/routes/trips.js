'use strict';
const db = require('../db');
const geo = require('../services/geo');
const pricing = require('../services/pricing');
const settings = require('../services/settings');
const money = require('../services/money');
const S = require('../services/trip-state');
const dispatch = require('../services/dispatch');
const places = require('./places');
const { parseJson, ok, created } = require('../lib/http');
const { latLng, str } = require('../lib/validate');
const { uuid, nowIso, tripCode } = require('../lib/ids');
const { E } = require('../lib/errors');
const cars = require('../services/cars');

/** أنواع المركبات المتاحة */
async function vehicleTypes(req, res) {
  const rows = await db.query(
    'SELECT id, code, name_ar, desc_ar, capacity, icon FROM vehicle_types WHERE is_active = 1 ORDER BY sort_order',
    []
  );
  return ok(res, { vehicleTypes: rows });
}

/**
 * منطقة الخدمة التي تحتوي النقطة.
 * إذا وقعت النقطة داخل أكثر من منطقة (مثلاً الكرك وكل الأردن) نختار الأضيق — الأكثر تحديداً.
 */
async function resolveCity({ lat, lng }) {
  const cities = await db.query('SELECT * FROM cities WHERE is_active = 1', []);
  let best = null;
  for (const c of cities) {
    const d = geo.haversine({ lat, lng }, { lat: c.center_lat, lng: c.center_lng });
    if (d > c.radius_km * 1000) continue;
    if (!best || c.radius_km < best.radius_km) best = c;
  }
  return best;
}

/**
 * تسعيرة تقديرية قبل تأكيد الطلب.
 * المسافة والزمن يُحسبان على الخادم — لا نثق بقيم قادمة من التطبيق.
 */
async function estimate(req, res, ctx) {
  const body = await parseJson(req);
  const pickup = latLng(body.pickupLat, body.pickupLng);
  const dest = latLng(body.destLat, body.destLng);

  const city = await resolveCity(pickup);
  if (!city) throw E.OUT_OF_SERVICE_AREA();

  const maxKm = await settings.get('trip.max_distance_km');
  const distanceM = geo.roadDistanceEstimate(pickup, dest);
  if (distanceM / 1000 > maxKm) throw E.VALIDATION_FAILED(`أقصى مسافة للرحلة ${maxKm} كم`);
  if (distanceM < 150) throw E.VALIDATION_FAILED('المسافة قصيرة جداً. اختر وجهة أبعد');
  const durationS = geo.durationEstimate(distanceM);

  const types = await db.query(
    'SELECT id, code, name_ar, desc_ar, capacity, icon FROM vehicle_types WHERE is_active = 1 ORDER BY sort_order', []
  );
  const options = [];
  for (const t of types) {
    const q = await pricing.quote({ vehicleTypeId: t.id, cityId: city.id, distanceM, durationS });
    options.push({
      vehicleTypeId: t.id,
      code: t.code,
      nameAr: t.name_ar,
      descAr: t.desc_ar,
      capacity: t.capacity,
      icon: t.icon,
      fareFils: q.fareFils,
      fareText: money.format(q.fareFils),
      breakdown: q.breakdown,
    });
  }
  return ok(res, {
    cityId: city.id,
    cityName: city.name_ar,
    distanceM,
    durationS,
    distanceText: (distanceM / 1000).toFixed(1),
    durationText: String(Math.max(1, Math.round(durationS / 60))),
    options,
    currency: 'JOD',
  });
}

/** إنشاء طلب رحلة */
async function create(req, res, ctx) {
  const body = await parseJson(req);
  const pickup = latLng(body.pickupLat, body.pickupLng);
  const dest = latLng(body.destLat, body.destLng);
  const vehicleTypeId = str(body.vehicleTypeId, { field: 'نوع السيارة' });
  const paymentMethod = ['CASH'].includes(body.paymentMethod) ? body.paymentMethod : 'CASH';

  const active = await db.one(
    `SELECT id FROM trips WHERE customer_id = $1 AND status IN
      ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')`,
    [ctx.user.id]
  );
  if (active) throw E.TRIP_ACTIVE_EXISTS();

  const vt = await db.one('SELECT * FROM vehicle_types WHERE id = $1 AND is_active = 1', [vehicleTypeId]);
  if (!vt) throw E.NOT_FOUND('نوع السيارة غير متاح');

  const city = await resolveCity(pickup);
  if (!city) throw E.OUT_OF_SERVICE_AREA();

  const distanceM = geo.roadDistanceEstimate(pickup, dest);
  const durationS = geo.durationEstimate(distanceM);
  const q = await pricing.quote({ vehicleTypeId: vt.id, cityId: city.id, distanceM, durationS });

  const id = uuid();
  const now = nowIso();
  await db.query(
    `INSERT INTO trips (id, code, customer_id, vehicle_type_id, city_id, status,
       pickup_lat, pickup_lng, pickup_address, dest_lat, dest_lng, dest_address,
       est_distance_m, est_duration_s, est_fare_fils, payment_method, pricing_rule_id,
       requested_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$18)`,
    [id, tripCode(), ctx.user.id, vt.id, city.id, S.STATUS.REQUESTED,
     pickup.lat, pickup.lng, str(body.pickupAddress, { max: 250, field: 'عنوان الانطلاق', required: false }),
     dest.lat, dest.lng, str(body.destAddress, { max: 250, field: 'عنوان الوجهة', required: false }),
     distanceM, durationS, q.fareFils, paymentMethod, q.pricingRuleId, now]
  );
  await db.query(
    `INSERT INTO trip_status_history (id, trip_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES ($1,$2,NULL,$3,'customer',$4,'إنشاء الطلب',$5)`,
    [uuid(), id, S.STATUS.REQUESTED, ctx.user.id, now]
  );

  await places.touchRecent(ctx.user.id, {
    label: body.destAddress || 'وجهة', address: body.destAddress || null, lat: dest.lat, lng: dest.lng,
  });

  // بدء البحث فوراً بدل انتظار النبضة التالية
  const acc = Number(body.pickupAccuracy);
  const note = str(body.pickupNote, { max: 120, field: 'ملاحظة للكابتن', required: false });
  if (Number.isFinite(acc) || note) {
    await db.query('UPDATE trips SET pickup_accuracy_m = $1, pickup_note = $2 WHERE id = $3',
      [Number.isFinite(acc) ? Math.round(Math.min(5000, Math.max(0, acc))) : null, note || null, id]);
  }

  const trip = await db.one('SELECT * FROM trips WHERE id = $1', [id]);
  await dispatch.setStatus(trip, S.STATUS.SEARCHING, 'بدأ البحث عن كابتن');
  trip.status = S.STATUS.SEARCHING;
  await dispatch.sendBatch(trip);

  return created(res, { trip: await view(id, ctx.user.id) });
}

/** موقع الزبون المباشر وهو بستنى الكابتن — الكابتن بيشوفه ليوصل لعنده بالضبط */
async function riderLocation(req, res, ctx, params) {
  const body = await parseJson(req);
  const { lat, lng } = latLng(body.lat, body.lng);
  const acc = Number(body.accuracy);
  const t = await db.one('SELECT id, status FROM trips WHERE id = $1 AND customer_id = $2', [params.id, ctx.user.id]);
  if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
  if (!['DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(t.status)) return ok(res, { shared: false });
  if (Number.isFinite(acc) && acc > 150) return ok(res, { shared: false });   // دقة سيئة — ما منضلّل الكابتن
  await db.query('UPDATE trips SET rider_lat = $1, rider_lng = $2, rider_accuracy_m = $3, rider_loc_at = $4 WHERE id = $5',
    [lat, lng, Number.isFinite(acc) ? Math.round(acc) : null, nowIso(), t.id]);
  return ok(res, { shared: true });
}

/** حالة الرحلة — العميل يستعلم عنها بشكل دوري */
async function get(req, res, ctx, params) {
  const trip = await view(params.id, ctx.user.id);
  if (!trip) throw E.NOT_FOUND('الرحلة غير موجودة');
  return ok(res, { trip });
}

async function active(req, res, ctx) {
  const row = await db.one(
    `SELECT id FROM trips WHERE customer_id = $1 AND status IN
      ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')
     ORDER BY created_at DESC`,
    [ctx.user.id]
  );
  return ok(res, { trip: row ? await view(row.id, ctx.user.id) : null });
}

async function history(req, res, ctx) {
  const rows = await db.query(
    `SELECT id, code, status, dest_address, pickup_address, est_fare_fils, gross_fare_fils,
            est_distance_m, requested_at, completed_at
       FROM trips WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [ctx.user.id]
  );
  return ok(res, {
    trips: rows.map((t) => ({
      id: t.id, code: t.code, status: t.status, statusLabel: S.LABEL_AR[t.status] || t.status,
      pickupAddress: t.pickup_address, destAddress: t.dest_address,
      fareFils: t.gross_fare_fils ?? t.est_fare_fils,
      fareText: money.format(t.gross_fare_fils ?? t.est_fare_fils),
      distanceKm: (t.est_distance_m / 1000).toFixed(1),
      requestedAt: t.requested_at, completedAt: t.completed_at,
      isFinal: S.isTerminal(t.status),
    })),
  });
}

/** إلغاء العميل — الرسوم تُحسب على الخادم وفق السياسة */
async function cancel(req, res, ctx, params) {
  const body = await parseJson(req).catch(() => ({}));
  const reason = str(body.reason, { max: 200, field: 'سبب الإلغاء', required: false });

  const result = await db.transaction(async (tx) => {
    const trip = await tx.one('SELECT * FROM trips WHERE id = $1 AND customer_id = $2', [params.id, ctx.user.id]);
    if (!trip) throw E.NOT_FOUND('الرحلة غير موجودة');
    if (!S.isActive(trip.status)) throw E.TRIP_INVALID_TRANSITION();
    if (!S.canTransition(trip.status, S.STATUS.CANCELLED_BY_CUSTOMER)) throw E.TRIP_INVALID_TRANSITION();

    const freeWindow = await settings.get('cancel.free_window_sec');
    let feeFils = 0;
    if (trip.assigned_at) {
      const sinceAssign = (Date.now() - Date.parse(trip.assigned_at)) / 1000;
      const chargeable = [S.STATUS.DRIVER_ACCEPTED, S.STATUS.DRIVER_ARRIVING, S.STATUS.DRIVER_ARRIVED];
      if (chargeable.includes(trip.status) && sinceAssign > freeWindow) {
        const rule = await tx.one('SELECT cancellation_fee_fils FROM pricing_rules WHERE id = $1', [trip.pricing_rule_id]);
        feeFils = rule ? rule.cancellation_fee_fils : 0;
      }
    }
    const now = nowIso();
    await tx.query(
      `UPDATE trips SET status = $1, cancelled_at = $2, cancelled_by = 'customer',
              cancel_reason = $3, cancellation_fee_fils = $4, updated_at = $2 WHERE id = $5`,
      [S.STATUS.CANCELLED_BY_CUSTOMER, now, reason, feeFils, trip.id]
    );
    await tx.query(
      `INSERT INTO trip_status_history (id, trip_id, from_status, to_status, actor_type, actor_id, note, created_at)
       VALUES ($1,$2,$3,$4,'customer',$5,$6,$7)`,
      [uuid(), trip.id, trip.status, S.STATUS.CANCELLED_BY_CUSTOMER, ctx.user.id, reason || 'إلغاء من العميل', now]
    );
    await tx.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE trip_id = $1 AND status = 'SENT'`, [trip.id]);
    await tx.query(
      `UPDATE risk_scores SET cancellations = cancellations + 1, updated_at = $1 WHERE user_id = $2`,
      [now, ctx.user.id]
    );
    return { feeFils };
  });

  return ok(res, {
    cancelled: true,
    feeFils: result.feeFils,
    feeText: money.format(result.feeFils),
    message: result.feeFils > 0
      ? `تم إلغاء الرحلة. رسوم الإلغاء ${money.format(result.feeFils)} د.أ`
      : 'تم إلغاء الرحلة بدون أي رسوم',
  });
}

/** سياسة الإلغاء الحالية لرحلة — ليعرف العميل قبل التأكيد */
async function cancelPreview(req, res, ctx, params) {
  const trip = await db.one('SELECT * FROM trips WHERE id = $1 AND customer_id = $2', [params.id, ctx.user.id]);
  if (!trip) throw E.NOT_FOUND('الرحلة غير موجودة');
  const freeWindow = await settings.get('cancel.free_window_sec');
  let feeFils = 0;
  if (trip.assigned_at) {
    const sinceAssign = (Date.now() - Date.parse(trip.assigned_at)) / 1000;
    const chargeable = [S.STATUS.DRIVER_ACCEPTED, S.STATUS.DRIVER_ARRIVING, S.STATUS.DRIVER_ARRIVED];
    if (chargeable.includes(trip.status) && sinceAssign > freeWindow) {
      const rule = await db.one('SELECT cancellation_fee_fils FROM pricing_rules WHERE id = $1', [trip.pricing_rule_id]);
      feeFils = rule ? rule.cancellation_fee_fils : 0;
    }
  }
  return ok(res, { feeFils, feeText: money.format(feeFils) });
}

async function rate(req, res, ctx, params) {
  const body = await parseJson(req);
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw E.VALIDATION_FAILED('التقييم من 1 إلى 5 نجوم');
  const trip = await db.one('SELECT * FROM trips WHERE id = $1 AND customer_id = $2', [params.id, ctx.user.id]);
  if (!trip) throw E.NOT_FOUND('الرحلة غير موجودة');
  if (trip.status !== S.STATUS.TRIP_COMPLETED) throw E.VALIDATION_FAILED('يمكن التقييم بعد انتهاء الرحلة فقط');

  const existing = await db.one(
    `SELECT id FROM ratings WHERE trip_id = $1 AND direction = 'customer_to_captain'`, [trip.id]
  );
  if (existing) throw E.VALIDATION_FAILED('تم تقييم هذه الرحلة مسبقاً');

  const captain = trip.captain_id ? await db.one('SELECT user_id FROM captains WHERE id = $1', [trip.captain_id]) : null;
  await db.query(
    `INSERT INTO ratings (id, trip_id, rater_id, ratee_id, direction, stars, tags, comment, created_at)
     VALUES ($1,$2,$3,$4,'customer_to_captain',$5,$6,$7,$8)`,
    [uuid(), trip.id, ctx.user.id, captain ? captain.user_id : null, stars,
     Array.isArray(body.tags) ? JSON.stringify(body.tags.slice(0, 6)) : null,
     str(body.comment, { max: 300, field: 'التعليق', required: false }), nowIso()]
  );
  if (trip.captain_id) {
    await db.query('UPDATE captains SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id = $2',
      [stars, trip.captain_id]);
  }
  return ok(res, {});
}

/** تمثيل الرحلة كما يراه العميل */
async function view(tripId, customerId) {
  const t = await db.one('SELECT * FROM trips WHERE id = $1 AND customer_id = $2', [tripId, customerId]);
  if (!t) return null;

  let captain = null, eta = null;
  if (t.captain_id) {
    const c = await db.one(
      `SELECT c.id, c.rating_sum, c.rating_count, c.trips_completed, u.name, u.phone_e164, u.photo_url
         FROM captains c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, [t.captain_id]);
    if (c) {
      const v = await db.one('SELECT * FROM vehicles WHERE captain_id = $1 AND is_active = 1', [c.id]);
      const loc = await db.one('SELECT lat, lng, heading, speed, accuracy, updated_at FROM driver_locations WHERE captain_id = $1', [c.id]);
      captain = {
        name: c.name,
        phone: c.phone_e164,
        photoUrl: c.photo_url,
        rating: c.rating_count ? Number((c.rating_sum / c.rating_count).toFixed(1)) : null,
        tripsCompleted: c.trips_completed,
        vehicle: v ? await cars.view(v) : null,
        location: loc ? { lat: loc.lat, lng: loc.lng, heading: loc.heading, accuracy: loc.accuracy, updatedAt: loc.updated_at,
          ageSec: Math.round((Date.now() - Date.parse(loc.updated_at)) / 1000) } : null,
      };
      // الوقت المتوقع: للوصول لعندك (قبل الركوب) أو للوجهة (خلال الرحلة) — التطبيق بيحسّنه من خط الطريق الحقيقي
      if (loc) {
        const to = t.status === 'TRIP_STARTED' ? { lat: t.dest_lat, lng: t.dest_lng } : { lat: t.pickup_lat, lng: t.pickup_lng };
        const roadM = geo.roadDistanceEstimate({ lat: loc.lat, lng: loc.lng }, to);
        if (['DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'TRIP_STARTED'].includes(t.status)) {
          eta = { target: t.status === 'TRIP_STARTED' ? 'destination' : 'pickup', distanceM: roadM,
            seconds: Math.max(60, geo.durationEstimate(roadM)) };
        }
      }
    }
  }

  const fareFils = t.gross_fare_fils ?? t.est_fare_fils;
  return {
    id: t.id,
    code: t.code,
    status: t.status,
    statusLabel: S.LABEL_AR[t.status] || t.status,
    isActive: S.isActive(t.status),
    isFinal: S.isTerminal(t.status),
    pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
    destination: { lat: t.dest_lat, lng: t.dest_lng, address: t.dest_address },
    distanceKm: ((t.final_distance_m ?? t.est_distance_m) / 1000).toFixed(1),
    durationMin: Math.max(1, Math.round((t.final_duration_s ?? t.est_duration_s) / 60)),
    fareFils,
    fareText: money.format(fareFils),
    cancellationFeeFils: t.cancellation_fee_fils,
    cancellationFeeText: money.format(t.cancellation_fee_fils),
    paymentMethod: t.payment_method,
    captain,
    eta,
    pickupNote: t.pickup_note || null,
    requestedAt: t.requested_at,
    arrivedAt: t.arrived_at,
    completedAt: t.completed_at,
    searchElapsedSec: Math.round((Date.now() - Date.parse(t.requested_at)) / 1000),
  };
}

module.exports = { vehicleTypes, estimate, create, get, active, history, cancel, cancelPreview, rate, view, riderLocation };
