'use strict';
/**
 * واجهة الكابتن البرمجية.
 * الخادم هو صاحب القرار في كل شيء: القبول، الوصول، البدء، الإنهاء، الأجرة، العمولة، المحفظة.
 */
const db = require('../db');
const config = require('../config');
const geo = require('../services/geo');
const money = require('../services/money');
const pricing = require('../services/pricing');
const settings = require('../services/settings');
const wallet = require('../services/wallet');
const files = require('../services/files');
const S = require('../services/trip-state');
const authService = require('../services/auth');
const { parseJson, ok, created } = require('../lib/http');
const { str, latLng } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
const { E } = require('../lib/errors');
const log = require('../lib/log');

const ACTIVE_CAPTAIN_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'TRIP_STARTED'];
const IN_LIST = ACTIVE_CAPTAIN_STATUSES.map((s) => `'${s}'`).join(',');

/* ------------------------------ أدوات مساعدة ------------------------------ */
async function captainOf(user, { mustBeApproved = true } = {}) {
  const c = await db.one('SELECT * FROM captains WHERE user_id = $1', [user.id]);
  if (!c) throw E.CAPTAIN_NOT_REGISTERED();
  if (mustBeApproved && c.status !== 'APPROVED') throw E.CAPTAIN_NOT_APPROVED();
  return c;
}

/** بداية اليوم بتوقيت عمّان (أو قبل n أيام) كـ ISO */
function ammanDayStart(daysAgo = 0) {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Amman', timeZoneName: 'longOffset' })
    .formatToParts(now).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '+03:00';
  const d = new Date(`${ymd}T00:00:00${off}`);
  return new Date(d.getTime() - daysAgo * 86400000).toISOString();
}

async function totalsSince(captainId, sinceIso) {
  const r = await db.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(gross_fare_fils),0) AS gross,
            COALESCE(SUM(commission_fils),0) AS commission, COALESCE(SUM(captain_earnings_fils),0) AS net
       FROM trips WHERE captain_id = $1 AND status = 'TRIP_COMPLETED' AND completed_at >= $2`,
    [captainId, sinceIso]
  );
  return { trips: Number(r.n), grossFils: Number(r.gross), commissionFils: Number(r.commission), netFils: Number(r.net) };
}

function firstName(name) { return String(name || 'زبون').trim().split(/\s+/)[0]; }

async function audit(actorType, actorId, action, entity, entityId, after, reason = null) {
  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity, entity_id, after_json, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uuid(), actorType, actorId, action, entity, entityId, after ? JSON.stringify(after) : null, reason, nowIso()]
  );
}

async function history(q, tripId, from, to, actorType, actorId, note) {
  await q.query(
    `INSERT INTO trip_status_history (id, trip_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uuid(), tripId, from, to, actorType, actorId, note || null, nowIso()]
  );
}

/* --------------------------------- الحساب --------------------------------- */
async function me(req, res, ctx) {
  const c = await db.one('SELECT * FROM captains WHERE user_id = $1', [ctx.user.id]);
  const base = { user: authService.publicUser(ctx.user), autoApprove: config.captain.autoApprove };
  if (!c) return ok(res, { ...base, captain: null });

  const vehicle = await db.one(
    `SELECT v.*, vt.name_ar AS type_name, vt.code AS type_code FROM vehicles v
       JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      WHERE v.captain_id = $1 AND v.is_active = 1`, [c.id]);
  const docs = await db.query('SELECT kind, status, created_at FROM captain_documents WHERE captain_id = $1 ORDER BY created_at DESC', [c.id]);
  const bal = await wallet.balance(c.id);
  const minBal = await settings.get('wallet.min_balance_fils');
  const today = await totalsSince(c.id, ammanDayStart(0));

  return ok(res, {
    ...base,
    captain: {
      id: c.id,
      status: c.status,
      isOnline: Boolean(c.is_online),
      rating: c.rating_count ? Number((c.rating_sum / c.rating_count).toFixed(2)) : null,
      ratingCount: c.rating_count,
      tripsCompleted: c.trips_completed,
      acceptanceRate: c.offers_sent ? Math.round((c.offers_accepted / c.offers_sent) * 100) : null,
      dailyGoalFils: c.daily_goal_fils,
    },
    vehicle: vehicle && {
      typeId: vehicle.vehicle_type_id, typeName: vehicle.type_name, typeCode: vehicle.type_code,
      make: vehicle.make, model: vehicle.model, color: vehicle.color, year: vehicle.year, plate: vehicle.plate_number,
    },
    documents: docs,
    wallet: { balanceFils: bal, balanceText: money.format(bal), minBalanceFils: minBal, canReceive: bal >= minBal },
    today: { ...today, netText: money.format(today.netFils), grossText: money.format(today.grossFils) },
  });
}

async function register(req, res, ctx) {
  const existing = await db.one('SELECT id FROM captains WHERE user_id = $1', [ctx.user.id]);
  if (existing) throw E.CAPTAIN_ALREADY();
  const body = await parseJson(req);

  const name = str(body.name, { min: 2, max: 60, field: 'الاسم' });
  const vt = await db.one('SELECT id FROM vehicle_types WHERE id = $1 AND is_active = 1', [str(body.vehicleTypeId, { field: 'نوع السيارة' })]);
  if (!vt) throw E.VALIDATION_FAILED('نوع السيارة غير صحيح');
  const make = str(body.make, { min: 2, max: 30, field: 'نوع السيارة (الشركة)' });
  const model = str(body.model, { min: 1, max: 30, field: 'الموديل' });
  const color = str(body.color, { min: 2, max: 20, field: 'اللون' });
  const plate = str(body.plate, { min: 3, max: 15, field: 'رقم اللوحة' }).replace(/\s+/g, ' ');
  const year = Number(body.year);
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1995 || year > thisYear + 1) throw E.VALIDATION_FAILED('سنة الصنع غير صحيحة');

  const city = await db.one('SELECT id FROM cities WHERE is_active = 1 ORDER BY created_at', []);
  const now = nowIso();
  const captainId = uuid();
  const status = config.captain.autoApprove ? 'APPROVED' : 'PENDING';

  await db.transaction(async (tx) => {
    await tx.query('UPDATE users SET name = $1, updated_at = $2 WHERE id = $3', [name, now, ctx.user.id]);
    await tx.query(
      `INSERT INTO captains (id, user_id, status, is_online, city_id, approved_at, created_at, updated_at)
       VALUES ($1,$2,$3,0,$4,$5,$6,$6)`,
      [captainId, ctx.user.id, status, city ? city.id : null, status === 'APPROVED' ? now : null, now]
    );
    await tx.query(
      `INSERT INTO vehicles (id, captain_id, vehicle_type_id, make, model, color, year, plate_number, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
      [uuid(), captainId, vt.id, make, model, color, year, plate, now]
    );
    await wallet.ensureWallet(captainId, tx);
  });
  await audit('user', ctx.user.id, 'CAPTAIN_REGISTERED', 'captain', captainId, { status, autoApproved: status === 'APPROVED' });
  log.info('كابتن جديد', { captainId, status });
  return created(res, { status });
}

async function uploadDocument(req, res, ctx) {
  const c = await captainOf(ctx.user, { mustBeApproved: false });
  const body = await parseJson(req);
  const kind = ['license', 'id', 'registration'].includes(body.kind) ? body.kind : null;
  if (!kind) throw E.VALIDATION_FAILED('نوع الوثيقة غير صحيح');
  const name = await files.save(body.dataUrl, { ownerId: ctx.user.id, kind: 'doc-' + kind, isPrivate: true });
  await db.query(
    `INSERT INTO captain_documents (id, captain_id, kind, file_name, status, created_at) VALUES ($1,$2,$3,$4,'PENDING',$5)`,
    [uuid(), c.id, kind, name, nowIso()]
  );
  return created(res, {});
}

async function setGoal(req, res, ctx) {
  const c = await captainOf(ctx.user, { mustBeApproved: false });
  const body = await parseJson(req);
  const g = body.goalFils === null ? null : Number(body.goalFils);
  if (g !== null && (!Number.isInteger(g) || g < 0 || g > 500000)) throw E.VALIDATION_FAILED('الهدف غير صحيح');
  await db.query('UPDATE captains SET daily_goal_fils = $1, updated_at = $2 WHERE id = $3', [g, nowIso(), c.id]);
  return ok(res, { dailyGoalFils: g });
}

/* ------------------------------ الاتصال والموقع ------------------------------ */
async function setOnline(req, res, ctx) {
  const c = await captainOf(ctx.user);
  const body = await parseJson(req);
  const online = Boolean(body.online);

  if (online) {
    const v = await db.one('SELECT id FROM vehicles WHERE captain_id = $1 AND is_active = 1', [c.id]);
    if (!v) throw E.VALIDATION_FAILED('أضف بيانات سيارتك أولاً');
    const bal = await wallet.balance(c.id);
    const minBal = await settings.get('wallet.min_balance_fils');
    if (bal < minBal) throw E.WALLET_LOW(`رصيدك ${money.format(bal)} د.أ وأقل من الحد المسموح (${money.format(minBal)}). اشحن محفظتك لتتصل`);
  } else {
    await db.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE captain_id = $1 AND status = 'SENT'`, [c.id]);
  }
  await db.query('UPDATE captains SET is_online = $1, updated_at = $2 WHERE id = $3', [online ? 1 : 0, nowIso(), c.id]);
  return ok(res, { isOnline: online });
}

async function updateLocation(req, res, ctx) {
  const c = await captainOf(ctx.user);
  const body = await parseJson(req);
  const { lat, lng } = latLng(body.lat, body.lng);
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const heading = num(body.heading), speed = num(body.speed), accuracy = num(body.accuracy);
  const now = nowIso();

  const prev = await db.one('SELECT lat, lng, updated_at FROM driver_locations WHERE captain_id = $1', [c.id]);

  // عدّاد المسافة الفعلية أثناء الرحلة (نتجاهل القفزات غير المنطقية وتذبذب GPS)
  if (prev && (accuracy === null || accuracy <= 80)) {
    const trip = await db.one(`SELECT id FROM trips WHERE captain_id = $1 AND status = 'TRIP_STARTED'`, [c.id]);
    if (trip) {
      const gapS = (Date.now() - Date.parse(prev.updated_at)) / 1000;
      const d = geo.haversine({ lat: prev.lat, lng: prev.lng }, { lat, lng });
      const plausible = gapS > 0 && gapS < 120 && d >= 8 && d / gapS < 45; // أقل من ~160 كم/س
      if (plausible) await db.query('UPDATE trips SET odometer_m = odometer_m + $1 WHERE id = $2', [Math.round(d), trip.id]);
    }
  }

  await db.query(
    `INSERT INTO driver_locations (captain_id, lat, lng, heading, speed, accuracy, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (captain_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
       speed = excluded.speed, accuracy = excluded.accuracy, updated_at = excluded.updated_at`,
    [c.id, lat, lng, heading, speed, accuracy, now]
  );
  return ok(res, {});
}

/* --------------------------------- العروض --------------------------------- */
async function currentOffer(req, res, ctx) {
  const c = await captainOf(ctx.user);
  const now = nowIso();
  const o = await db.one(
    `SELECT o.*, t.pickup_lat, t.pickup_lng, t.pickup_address, t.dest_lat, t.dest_lng, t.dest_address,
            t.est_distance_m, t.est_duration_s, t.est_fare_fils, t.payment_method, t.status AS trip_status,
            u.name AS customer_name
       FROM trip_offers o
       JOIN trips t ON t.id = o.trip_id
       JOIN users u ON u.id = t.customer_id
      WHERE o.captain_id = $1 AND o.status = 'SENT' AND o.expires_at > $2
      ORDER BY o.sent_at DESC`,
    [c.id, now]
  );
  if (!o || o.trip_status !== 'SEARCHING') return ok(res, { offer: null });

  const bp = await settings.get('platform.commission_bp');
  const commission = money.applyBp(o.est_fare_fils, bp);
  const net = o.est_fare_fils - commission;
  const total = await settings.get('dispatch.offer_timeout_sec');

  return ok(res, {
    offer: {
      id: o.id,
      expiresInSec: Math.max(0, Math.round((Date.parse(o.expires_at) - Date.now()) / 1000)),
      totalSec: total,
      pickup: { lat: o.pickup_lat, lng: o.pickup_lng, address: o.pickup_address },
      destination: { lat: o.dest_lat, lng: o.dest_lng, address: o.dest_address },
      pickupDistanceM: o.distance_m,
      pickupEtaMin: Math.max(1, Math.round((o.eta_s || 0) / 60)),
      tripDistanceKm: (o.est_distance_m / 1000).toFixed(1),
      tripDurationMin: Math.max(1, Math.round(o.est_duration_s / 60)),
      fareFils: o.est_fare_fils,
      fareText: money.format(o.est_fare_fils),
      netFils: net,
      netText: money.format(net),
      commissionText: money.format(commission),
      commissionPct: bp / 100,
      paymentMethod: o.payment_method,
      customerName: firstName(o.customer_name),
    },
  });
}

async function acceptOffer(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  const tripId = await db.transaction(async (tx) => {
    const now = nowIso();
    const offer = await tx.one('SELECT * FROM trip_offers WHERE id = $1 AND captain_id = $2' + db.forUpdate(), [params.id, c.id]);
    if (!offer) throw E.NOT_FOUND('الطلب غير موجود');
    if (offer.status === 'ACCEPTED') return offer.trip_id;            // ضغطة مكررة على «قبول»
    if (offer.status !== 'SENT' || offer.expires_at <= now) throw E.OFFER_EXPIRED();

    const busy = await tx.one(`SELECT id FROM trips WHERE captain_id = $1 AND status IN (${IN_LIST})`, [c.id]);
    if (busy) throw E.CAPTAIN_BUSY();

    // الشرط داخل UPDATE نفسه: كابتن واحد فقط ينجح مهما ضغطوا بنفس اللحظة
    const won = await tx.query(
      `UPDATE trips SET captain_id = $1, status = 'DRIVER_ARRIVING', assigned_at = $2, accepted_at = $2, updated_at = $2
        WHERE id = $3 AND status = 'SEARCHING' AND captain_id IS NULL RETURNING id`,
      [c.id, now, offer.trip_id]
    );
    if (!won.length) {
      await tx.query(`UPDATE trip_offers SET status = 'SUPERSEDED', responded_at = $1 WHERE id = $2`, [now, offer.id]);
      throw E.TRIP_ALREADY_ASSIGNED();
    }
    await history(tx, offer.trip_id, 'SEARCHING', 'DRIVER_ASSIGNED', 'system', null, 'إسناد للكابتن');
    await history(tx, offer.trip_id, 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'captain', c.id, 'قبول الكابتن');
    await history(tx, offer.trip_id, 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'captain', c.id, 'الكابتن في الطريق');
    await tx.query(`UPDATE trip_offers SET status = 'ACCEPTED', responded_at = $1 WHERE id = $2`, [now, offer.id]);
    // باقي الكباتن الي وصلهم نفس الطلب: «سبقك كابتن ثاني» — ما بتنحسب عليهم
    await tx.query(`UPDATE trip_offers SET status = 'SUPERSEDED' WHERE trip_id = $1 AND id <> $2 AND status = 'SENT'`, [offer.trip_id, offer.id]);
    await tx.query('UPDATE captains SET offers_accepted = offers_accepted + 1 WHERE id = $1', [c.id]);
    return offer.trip_id;
  });
  return ok(res, { trip: await tripView(tripId, c.id) });
}

async function rejectOffer(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  await db.query(
    `UPDATE trip_offers SET status = 'REJECTED', responded_at = $1 WHERE id = $2 AND captain_id = $3 AND status = 'SENT'`,
    [nowIso(), params.id, c.id]
  );
  return ok(res, {});
}

/* --------------------------------- الرحلة --------------------------------- */
async function tripView(tripId, captainId) {
  const t = await db.one('SELECT * FROM trips WHERE id = $1 AND captain_id = $2', [tripId, captainId]);
  if (!t) return null;
  const u = await db.one('SELECT name, phone_e164, photo_url FROM users WHERE id = $1', [t.customer_id]);
  const rule = await db.one('SELECT free_waiting_sec, waiting_per_min_fils FROM pricing_rules WHERE id = $1', [t.pricing_rule_id]);
  const rated = await db.one(`SELECT id FROM ratings WHERE trip_id = $1 AND direction = 'captain_to_customer'`, [t.id]);
  return {
    id: t.id,
    code: t.code,
    status: t.status,
    statusLabel: S.LABEL_AR[t.status] || t.status,
    isFinal: S.isTerminal(t.status) || t.captain_id !== captainId,
    pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
    destination: { lat: t.dest_lat, lng: t.dest_lng, address: t.dest_address },
    customer: { name: u && u.name, firstName: firstName(u && u.name), phone: u && u.phone_e164, photoUrl: u && u.photo_url },
    estFareFils: t.est_fare_fils,
    estFareText: money.format(t.est_fare_fils),
    estDistanceKm: (t.est_distance_m / 1000).toFixed(1),
    estDurationMin: Math.max(1, Math.round(t.est_duration_s / 60)),
    paymentMethod: t.payment_method,
    arrivedAt: t.arrived_at,
    startedAt: t.started_at,
    freeWaitingSec: rule ? rule.free_waiting_sec : 180,
    waitingPerMinFils: rule ? rule.waiting_per_min_fils : 0,
    cancelReason: t.cancel_reason,
    cancelledBy: t.cancelled_by,
    rated: Boolean(rated),
    final: t.status === 'TRIP_COMPLETED' ? {
      grossFils: t.gross_fare_fils,
      grossText: money.format(t.gross_fare_fils),
      waitingFeeText: money.format(t.waiting_fee_fils || 0),
      commissionText: money.format(t.commission_fils),
      earningsText: money.format(t.captain_earnings_fils),
      distanceKm: ((t.final_distance_m || 0) / 1000).toFixed(1),
      durationMin: Math.max(1, Math.round((t.final_duration_s || 0) / 60)),
    } : null,
  };
}

async function activeTrip(req, res, ctx) {
  const c = await captainOf(ctx.user);
  const t = await db.one(`SELECT id FROM trips WHERE captain_id = $1 AND status IN (${IN_LIST}) ORDER BY assigned_at DESC`, [c.id]);
  return ok(res, { trip: t ? await tripView(t.id, c.id) : null });
}

async function getTrip(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  // الكابتن يرى الرحلة إن كانت له، أو إن ألغاها العميل وهو كان مسنداً إليها
  let view = await tripView(params.id, c.id);
  if (!view) {
    const h = await db.one(
      `SELECT t.status, t.cancel_reason FROM trips t
        WHERE t.id = $1 AND EXISTS (SELECT 1 FROM trip_offers o WHERE o.trip_id = t.id AND o.captain_id = $2 AND o.status = 'ACCEPTED')`,
      [params.id, c.id]
    );
    if (!h) throw E.NOT_FOUND('الرحلة غير موجودة');
    view = { id: params.id, status: 'REASSIGNED', statusLabel: 'لم تعد هذه الرحلة لك', isFinal: true, cancelReason: h.cancel_reason };
  }
  return ok(res, { trip: view });
}

async function transition(ctx, tripId, from, to, extra = {}) {
  const c = await captainOf(ctx.user);
  await db.transaction(async (tx) => {
    const t = await tx.one('SELECT * FROM trips WHERE id = $1 AND captain_id = $2' + db.forUpdate(), [tripId, c.id]);
    if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
    if (t.status === to) return;                             // ضغطة مكررة
    if (!from.includes(t.status) || !S.canTransition(t.status, to)) throw E.TRIP_INVALID_TRANSITION();
    if (extra.check) await extra.check(t, c);
    const now = nowIso();
    const col = extra.timeColumn ? `, ${extra.timeColumn} = $3` : '';
    await tx.query(`UPDATE trips SET status = $1, updated_at = $2${col} WHERE id = $${col ? 4 : 3}`,
      col ? [to, now, now, t.id] : [to, now, t.id]);
    await history(tx, t.id, t.status, to, 'captain', c.id, extra.note);
  });
  return c;
}

async function arrived(req, res, ctx, params) {
  const maxM = await settings.get('captain.arrive_max_distance_m');
  const c = await transition(ctx, params.id, ['DRIVER_ACCEPTED', 'DRIVER_ARRIVING'], 'DRIVER_ARRIVED', {
    timeColumn: 'arrived_at', note: 'الكابتن وصل',
    check: async (t, cap) => {
      const loc = await db.one('SELECT lat, lng, updated_at FROM driver_locations WHERE captain_id = $1', [cap.id]);
      if (!loc || Date.now() - Date.parse(loc.updated_at) > 120000) throw E.LOCATION_REQUIRED();
      const d = Math.round(geo.haversine({ lat: loc.lat, lng: loc.lng }, { lat: t.pickup_lat, lng: t.pickup_lng }));
      if (d > maxM) throw E.TOO_FAR_FROM_PICKUP(d);
    },
  });
  return ok(res, { trip: await tripView(params.id, c.id) });
}

async function start(req, res, ctx, params) {
  const c = await transition(ctx, params.id, ['DRIVER_ARRIVED'], 'TRIP_STARTED', { timeColumn: 'started_at', note: 'بدأت الرحلة' });
  return ok(res, { trip: await tripView(params.id, c.id) });
}

async function complete(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  const bp = await settings.get('platform.commission_bp');
  const threshold = await settings.get('fare.recalc_threshold_bp');

  await db.transaction(async (tx) => {
    const t = await tx.one('SELECT * FROM trips WHERE id = $1 AND captain_id = $2' + db.forUpdate(), [params.id, c.id]);
    if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
    if (t.status === 'TRIP_COMPLETED') return;                      // ضغطة مكررة — لا حساب مزدوج
    if (t.status !== 'TRIP_STARTED') throw E.TRIP_INVALID_TRANSITION();

    const now = new Date();
    const durationS = Math.max(60, Math.round((now - Date.parse(t.started_at)) / 1000));
    const actualM = t.odometer_m > 0 ? t.odometer_m : t.est_distance_m;

    // السعر المتفق عليه ثابت — إلا إذا زادت المسافة الفعلية كثيراً (تغيير وجهة / طريق أطول)
    let fare = t.est_fare_fils;
    if (actualM * 10000 > t.est_distance_m * threshold) {
      const q = await pricing.quote({ vehicleTypeId: t.vehicle_type_id, cityId: t.city_id, distanceM: actualM, durationS });
      fare = Math.max(fare, q.fareFils);
    }

    // رسوم الانتظار بعد الوقت المجاني
    const rule = await tx.one('SELECT free_waiting_sec, waiting_per_min_fils FROM pricing_rules WHERE id = $1', [t.pricing_rule_id]);
    let waitingFee = 0;
    if (rule && t.arrived_at && t.started_at) {
      const waitedS = (Date.parse(t.started_at) - Date.parse(t.arrived_at)) / 1000;
      const extraMin = Math.floor(Math.max(0, waitedS - rule.free_waiting_sec) / 60);
      waitingFee = extraMin * rule.waiting_per_min_fils;
    }

    const gross = money.roundToNearest(fare + waitingFee - (t.discount_fils || 0), 50);
    const commission = money.applyBp(gross, bp);
    const earnings = gross - commission;
    const iso = now.toISOString();

    const done = await tx.query(
      `UPDATE trips SET status = 'TRIP_COMPLETED', completed_at = $1, updated_at = $1, final_distance_m = $2, final_duration_s = $3,
              gross_fare_fils = $4, commission_fils = $5, captain_earnings_fils = $6, waiting_fee_fils = $7
        WHERE id = $8 AND status = 'TRIP_STARTED' RETURNING id`,
      [iso, actualM, durationS, gross, commission, earnings, waitingFee, t.id]
    );
    if (!done.length) return;
    await history(tx, t.id, 'TRIP_STARTED', 'TRIP_COMPLETED', 'captain', c.id, 'انتهت الرحلة');

    // الدفع نقداً: الكابتن استلم الأجرة كاملة، فتُخصم عمولة المنصة من محفظته
    if (commission > 0) {
      await wallet.post(tx, {
        captainId: c.id, type: 'COMMISSION', amountFils: -commission, referenceId: t.id,
        idempotencyKey: 'commission:' + t.id, description: `عمولة الرحلة ${t.code} (${bp / 100}%)`,
      });
    }
    await tx.query('UPDATE captains SET trips_completed = trips_completed + 1 WHERE id = $1', [c.id]);
    await tx.query('UPDATE risk_scores SET trips = trips + 1, updated_at = $1 WHERE user_id = $2', [iso, t.customer_id]);
  });
  return ok(res, { trip: await tripView(params.id, c.id) });
}

async function cancel(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  const body = await parseJson(req).catch(() => ({}));
  const noShow = Boolean(body.noShow);
  const reason = str(body.reason, { max: 200, field: 'السبب', required: false });

  const result = await db.transaction(async (tx) => {
    const t = await tx.one('SELECT * FROM trips WHERE id = $1 AND captain_id = $2' + db.forUpdate(), [params.id, c.id]);
    if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
    if (!['DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(t.status)) throw E.TRIP_INVALID_TRANSITION();
    const now = nowIso();

    if (noShow) {
      // الزبون ما حضر: مسموح فقط بعد انتهاء وقت الانتظار المجاني
      if (t.status !== 'DRIVER_ARRIVED') throw E.TRIP_INVALID_TRANSITION();
      const rule = await tx.one('SELECT free_waiting_sec, cancellation_fee_fils FROM pricing_rules WHERE id = $1', [t.pricing_rule_id]);
      const waited = (Date.now() - Date.parse(t.arrived_at)) / 1000;
      const need = rule ? rule.free_waiting_sec : 180;
      if (waited < need) throw E.NO_SHOW_TOO_EARLY(Math.ceil(need - waited));
      const fee = rule ? rule.cancellation_fee_fils : 0;
      await tx.query(
        `UPDATE trips SET status = 'CANCELLED_BY_CUSTOMER', cancelled_at = $1, updated_at = $1, cancelled_by = 'captain_no_show',
                cancel_reason = 'الزبون لم يحضر', cancellation_fee_fils = $2 WHERE id = $3`,
        [now, fee, t.id]
      );
      await history(tx, t.id, t.status, 'CANCELLED_BY_CUSTOMER', 'captain', c.id, 'عدم حضور الزبون');
      await tx.query('UPDATE risk_scores SET cancellations = cancellations + 1, updated_at = $1 WHERE user_id = $2', [now, t.customer_id]);
      return { mode: 'no_show', feeFils: fee };
    }

    // اعتذار الكابتن: الرحلة ترجع للبحث عن كابتن بديل فوراً، والعميل ما بيخسر طلبه
    await tx.query(
      `UPDATE trips SET status = 'SEARCHING', captain_id = NULL, assigned_at = NULL, accepted_at = NULL, arrived_at = NULL,
              requested_at = $1, updated_at = $1 WHERE id = $2`,
      [now, t.id]
    );
    await history(tx, t.id, t.status, 'SEARCHING', 'captain', c.id, 'اعتذار الكابتن — بحث عن بديل' + (reason ? `: ${reason}` : ''));
    await tx.query('UPDATE captains SET cancellations = cancellations + 1, updated_at = $1 WHERE id = $2', [now, c.id]);
    return { mode: 'reassigned', feeFils: 0 };
  });

  return ok(res, {
    ...result,
    message: result.mode === 'no_show'
      ? 'تم تسجيل عدم حضور الزبون'
      : 'تم إلغاء الرحلة من طرفك. نبحث للزبون عن كابتن ثاني',
  });
}

async function rateCustomer(req, res, ctx, params) {
  const c = await captainOf(ctx.user);
  const body = await parseJson(req);
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw E.VALIDATION_FAILED('التقييم من 1 إلى 5 نجوم');
  const t = await db.one('SELECT * FROM trips WHERE id = $1 AND captain_id = $2', [params.id, c.id]);
  if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
  if (t.status !== 'TRIP_COMPLETED') throw E.VALIDATION_FAILED('يمكن التقييم بعد انتهاء الرحلة فقط');
  const dup = await db.one(`SELECT id FROM ratings WHERE trip_id = $1 AND direction = 'captain_to_customer'`, [t.id]);
  if (dup) return ok(res, {});
  await db.query(
    `INSERT INTO ratings (id, trip_id, rater_id, ratee_id, direction, stars, tags, created_at)
     VALUES ($1,$2,$3,$4,'captain_to_customer',$5,$6,$7)`,
    [uuid(), t.id, ctx.user.id, t.customer_id, stars,
     Array.isArray(body.tags) ? JSON.stringify(body.tags.slice(0, 6)) : null, nowIso()]
  );
  return ok(res, {});
}

/* ------------------------------ الأرباح والمحفظة ------------------------------ */
async function earnings(req, res, ctx) {
  const c = await captainOf(ctx.user, { mustBeApproved: false });
  const range = new URL(req.url, 'http://x').searchParams.get('range') === 'week' ? 'week' : 'today';
  const since = ammanDayStart(range === 'week' ? 6 : 0);
  const totals = await totalsSince(c.id, since);
  const rows = await db.query(
    `SELECT code, completed_at, dest_address, gross_fare_fils, captain_earnings_fils, final_distance_m
       FROM trips WHERE captain_id = $1 AND status = 'TRIP_COMPLETED' AND completed_at >= $2
      ORDER BY completed_at DESC LIMIT 100`,
    [c.id, since]
  );
  return ok(res, {
    range,
    ...totals,
    grossText: money.format(totals.grossFils),
    commissionText: money.format(totals.commissionFils),
    netText: money.format(totals.netFils),
    goalFils: c.daily_goal_fils,
    trips: rows.map((r) => ({
      code: r.code, completedAt: r.completed_at, destAddress: r.dest_address,
      grossText: money.format(r.gross_fare_fils), netText: money.format(r.captain_earnings_fils),
      distanceKm: ((r.final_distance_m || 0) / 1000).toFixed(1),
    })),
  });
}

const TX_LABEL = {
  DEPOSIT: 'شحن رصيد', COMMISSION: 'عمولة رحلة', CANCELLATION: 'رسوم إلغاء', BONUS: 'مكافأة',
  REFUND: 'استرجاع', ADJUSTMENT: 'تعديل', WITHDRAWAL: 'سحب', CORRECTION: 'تصحيح',
};

async function walletView(req, res, ctx) {
  const c = await captainOf(ctx.user, { mustBeApproved: false });
  const bal = await wallet.balance(c.id);
  const minBal = await settings.get('wallet.min_balance_fils');
  const txs = await db.query(
    `SELECT id, transaction_type, amount_fils, balance_after, description, created_at
       FROM wallet_transactions WHERE captain_id = $1 ORDER BY created_at DESC LIMIT 50`, [c.id]);
  const deps = await db.query(
    `SELECT id, amount_fils, status, reject_reason, created_at FROM deposit_requests
      WHERE captain_id = $1 ORDER BY created_at DESC LIMIT 10`, [c.id]);
  return ok(res, {
    balanceFils: bal, balanceText: money.format(bal),
    minBalanceFils: minBal, minBalanceText: money.format(minBal), canReceive: bal >= minBal,
    cliqAlias: await settings.get('wallet.cliq_alias'),
    transactions: txs.map((t) => ({
      id: t.id, type: t.transaction_type, label: TX_LABEL[t.transaction_type] || t.transaction_type,
      amountFils: Number(t.amount_fils), amountText: money.format(Number(t.amount_fils)),
      balanceAfterText: money.format(Number(t.balance_after)), description: t.description, createdAt: t.created_at,
    })),
    deposits: deps.map((d) => ({
      id: d.id, amountText: money.format(Number(d.amount_fils)), status: d.status, rejectReason: d.reject_reason, createdAt: d.created_at,
    })),
  });
}

async function requestDeposit(req, res, ctx) {
  const c = await captainOf(ctx.user, { mustBeApproved: false });
  const body = await parseJson(req);
  const amount = Number(body.amountFils);
  if (!Number.isInteger(amount) || amount < 500 || amount > 200000) throw E.VALIDATION_FAILED('المبلغ بين 0.500 و 200 دينار');
  const pending = await db.one(`SELECT COUNT(*) AS n FROM deposit_requests WHERE captain_id = $1 AND status = 'PENDING_REVIEW'`, [c.id]);
  if (Number(pending.n) >= 3) throw E.VALIDATION_FAILED('عندك 3 طلبات شحن قيد المراجعة. انتظر مراجعتها أولاً');
  const proof = await files.save(body.proofDataUrl, { ownerId: ctx.user.id, kind: 'deposit-proof', isPrivate: true });
  const id = uuid();
  await db.query(
    `INSERT INTO deposit_requests (id, captain_id, amount_fils, proof_url, status, created_at) VALUES ($1,$2,$3,$4,'PENDING_REVIEW',$5)`,
    [id, c.id, amount, proof, nowIso()]
  );
  await audit('user', ctx.user.id, 'DEPOSIT_REQUESTED', 'deposit_request', id, { amountFils: amount });
  return created(res, { id, status: 'PENDING_REVIEW' });
}

module.exports = {
  me, register, uploadDocument, setGoal, setOnline, updateLocation,
  currentOffer, acceptOffer, rejectOffer,
  activeTrip, getTrip, arrived, start, complete, cancel, rateCustomer,
  earnings, walletView, requestDeposit, ammanDayStart,
};
