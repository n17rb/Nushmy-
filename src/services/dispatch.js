'use strict';
/**
 * محرك التوزيع الذكي (Smart Dispatch).
 * الهدف: أقل وقت انتظار ممكن للعميل.
 *
 * المبدأ:
 *   1) نجمع الكباتن المؤهلين فعلياً (معتمد + متصل + موقعه حديث + غير مشغول).
 *   2) نحسب Score لكل كابتن لا يعتمد على المسافة الهوائية وحدها.
 *   3) نرسل الطلب لدفعة من أفضل المرشحين معاً (وليس واحداً تلو الآخر).
 *   4) عند انتهاء مهلة الدفعة أو رفضها، نوسّع النطاق وننتقل للدفعة التالية فوراً.
 *   5) عند انتهاء مهلة البحث الكلية → NO_DRIVER_FOUND بوضوح، بلا انتظار مفتوح.
 */
const db = require('../db');
const geo = require('./geo');
const settings = require('./settings');
const log = require('../lib/log');
const { uuid, nowIso } = require('../lib/ids');
const S = require('./trip-state');

/** عوامل الترجيح — مجموعها 1. قابلة للضبط لاحقاً من الإعدادات. */
const WEIGHTS = {
  eta: 0.55,           // الأهم: كم يحتاج ليصل للعميل
  reliability: 0.20,   // نسبة قبول الكابتن للطلبات
  idleTime: 0.10,      // من انتظر أطول يأخذ أولوية (توزيع عادل)
  heading: 0.10,       // اتجاه سير الكابتن نحو نقطة الانطلاق
  workload: 0.05,      // عدد رحلاته اليوم
};

function headingScore(captain, pickup) {
  if (captain.heading === null || captain.heading === undefined) return 0.5;
  const dLng = pickup.lng - captain.lng, dLat = pickup.lat - captain.lat;
  const bearing = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  let diff = Math.abs(((bearing - captain.heading + 540) % 360) - 180);
  return 1 - diff / 180; // 1 = يتجه نحو العميل تماماً
}

/** الكباتن المؤهلون فعلياً ضمن نطاق معيّن */
async function candidates({ pickup, vehicleTypeId, radiusM, excludeCaptainIds = [] }) {
  const staleSec = await settings.get('dispatch.stale_location_sec');
  const freshAfter = new Date(Date.now() - staleSec * 1000).toISOString();

  const minBalance = await settings.get('wallet.min_balance_fils');
  const rows = await db.query(
    `SELECT c.id, c.offers_sent, c.offers_accepted, c.trips_completed, c.rating_sum, c.rating_count,
            dl.lat, dl.lng, dl.heading, dl.updated_at,
            v.vehicle_type_id
       FROM captains c
       JOIN driver_locations dl ON dl.captain_id = c.id
       JOIN vehicles v ON v.captain_id = c.id AND v.is_active = 1
       LEFT JOIN wallets w ON w.captain_id = c.id
      WHERE c.status = 'APPROVED'
        AND c.is_online = 1
        AND dl.updated_at > $1
        AND v.vehicle_type_id = $2
        AND COALESCE(w.balance_fils, 0) >= $3
        AND NOT EXISTS (
              SELECT 1 FROM trips t
               WHERE t.captain_id = c.id
                 AND t.status IN ('DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')
            )
        AND NOT EXISTS (
              SELECT 1 FROM trip_offers o
               WHERE o.captain_id = c.id AND o.status = 'SENT' AND o.expires_at > $4
            )`,
    [freshAfter, vehicleTypeId, minBalance, new Date().toISOString()]
  );

  const excluded = new Set(excludeCaptainIds);
  const out = [];
  for (const r of rows) {
    if (excluded.has(r.id)) continue;
    const airM = geo.haversine(pickup, { lat: r.lat, lng: r.lng });
    if (airM > radiusM) continue;
    const roadM = Math.round(airM * geo.ROAD_FACTOR);
    const etaS = geo.durationEstimate(roadM, 34);
    out.push({ ...r, distanceM: roadM, etaS });
  }
  return out;
}

/** ترتيب المرشحين حسب Score مركّب (كلما زاد كان أفضل) */
function rank(list, pickup, maxEtaS = 900) {
  const maxIdle = 1800;
  return list
    .map((c) => {
      const etaScore = 1 - Math.min(1, c.etaS / maxEtaS);
      const acceptRate = c.offers_sent > 0 ? c.offers_accepted / c.offers_sent : 0.7; // كابتن جديد يبدأ بتقدير محايد
      const idleSec = Math.max(0, (Date.now() - Date.parse(c.updated_at)) / 1000);
      const idleScore = Math.min(1, idleSec / maxIdle);
      const workloadScore = 1 - Math.min(1, (c.trips_completed % 12) / 12);
      const score =
        WEIGHTS.eta * etaScore +
        WEIGHTS.reliability * acceptRate +
        WEIGHTS.idleTime * idleScore +
        WEIGHTS.heading * headingScore(c, pickup) +
        WEIGHTS.workload * workloadScore;
      return { ...c, score: Number(score.toFixed(4)) };
    })
    .sort((a, b) => b.score - a.score);
}

/** دفعة عروض جديدة لرحلة في حالة البحث */
async function sendBatch(trip) {
  const [batchSize, offerTimeout, initialRadius, maxRadius] = await Promise.all([
    settings.get('dispatch.batch_size'),
    settings.get('dispatch.offer_timeout_sec'),
    settings.get('dispatch.initial_radius_m'),
    settings.get('dispatch.max_radius_m'),
  ]);

  const pickup = { lat: trip.pickup_lat, lng: trip.pickup_lng };
  const elapsedSec = (Date.now() - Date.parse(trip.requested_at)) / 1000;
  // توسيع تدريجي للنطاق كل 20 ثانية
  const radiusM = Math.min(maxRadius, initialRadius * (1 + Math.floor(elapsedSec / 20)));

  // نستبعد من رفض أو تجاهل أو اعتذر — لا من سبقه كابتن آخر (SUPERSEDED)
  const prior = await db.query(`SELECT captain_id FROM trip_offers WHERE trip_id = $1 AND status <> 'SUPERSEDED'`, [trip.id]);
  const exclude = prior.map((p) => p.captain_id);

  const pool = await candidates({ pickup, vehicleTypeId: trip.vehicle_type_id, radiusM, excludeCaptainIds: exclude });
  if (!pool.length) return { sent: 0, radiusM };

  const chosen = rank(pool, pickup).slice(0, batchSize);
  const now = nowIso();
  const expires = new Date(Date.now() + offerTimeout * 1000).toISOString();

  for (const c of chosen) {
    await db.query(
      `INSERT INTO trip_offers (id, trip_id, captain_id, score, eta_s, distance_m, status, sent_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'SENT',$7,$8)`,
      [uuid(), trip.id, c.id, c.score, c.etaS, c.distanceM, now, expires]
    );
    await db.query('UPDATE captains SET offers_sent = offers_sent + 1 WHERE id = $1', [c.id]);
  }
  log.info('دفعة عروض', { tripId: trip.id, count: chosen.length, radiusM });
  return { sent: chosen.length, radiusM };
}

/** نبضة المحرك: تُشغَّل كل ثانيتين على كل الرحلات التي تبحث عن كابتن */
async function tick() {
  const now = nowIso();
  // إنهاء العروض المنتهية
  await db.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE status = 'SENT' AND expires_at < $1`, [now]);

  const searchTimeout = await settings.get('dispatch.search_timeout_sec');
  const searching = await db.query(
    `SELECT * FROM trips WHERE status IN ($1,$2) ORDER BY requested_at`,
    [S.STATUS.REQUESTED, S.STATUS.SEARCHING]
  );

  for (const trip of searching) {
    const elapsed = (Date.now() - Date.parse(trip.requested_at)) / 1000;

    if (elapsed > searchTimeout) {
      await finish(trip, S.STATUS.NO_DRIVER_FOUND, 'انتهت مهلة البحث دون توفّر كابتن');
      continue;
    }
    if (trip.status === S.STATUS.REQUESTED) {
      await setStatus(trip, S.STATUS.SEARCHING, 'بدأ البحث عن كابتن');
      trip.status = S.STATUS.SEARCHING;
    }
    const live = await db.one(
      `SELECT COUNT(*) AS c FROM trip_offers WHERE trip_id = $1 AND status = 'SENT'`,
      [trip.id]
    );
    if (Number(live.c) === 0) await sendBatch(trip);
  }
}

async function setStatus(trip, to, note, actorType = 'system', actorId = null) {
  if (!S.canTransition(trip.status, to)) return false;
  await db.query('UPDATE trips SET status = $1, updated_at = $2 WHERE id = $3', [to, nowIso(), trip.id]);
  await db.query(
    `INSERT INTO trip_status_history (id, trip_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uuid(), trip.id, trip.status, to, actorType, actorId, note || null, nowIso()]
  );
  return true;
}

async function finish(trip, status, note) {
  const now = nowIso();
  await setStatus(trip, status, note);
  if (status !== S.STATUS.TRIP_COMPLETED) {
    await db.query('UPDATE trips SET cancelled_at = $1, cancel_reason = $2 WHERE id = $3', [now, note, trip.id]);
  }
  await db.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE trip_id = $1 AND status = 'SENT'`, [trip.id]);
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => log.error('خطأ في نبضة التوزيع', { message: e.message }));
  }, 2000);
  timer.unref();
  log.info('محرك التوزيع يعمل');
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick, sendBatch, candidates, rank, setStatus, WEIGHTS };
