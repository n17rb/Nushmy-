'use strict';
/**
 * الكباتن القريبون — لعرض السيارات على خريطة العميل (مثل أوبر).
 * يُعيد فقط كباتن حقيقيين: معتمدين + متصلين + موقعهم حديث + غير مشغولين برحلة.
 * للخصوصية: لا اسم ولا رقم، والموقع مقرّب (~50 متر)، والمعرّف مموّه لكل جلسة.
 */
const crypto = require('crypto');
const db = require('../db');
const geo = require('../services/geo');
const settings = require('../services/settings');
const config = require('../config');
const { ok } = require('../lib/http');
const { latLng } = require('../lib/validate');

const RADIUS_M = 5000;
const MAX_CARS = 12;
const round = (v) => Math.round(v * 2000) / 2000; // ~50 م

async function nearby(req, res, ctx) {
  const url = new URL(req.url, 'http://x');
  const center = latLng(url.searchParams.get('lat'), url.searchParams.get('lng'));
  const staleSec = await settings.get('dispatch.stale_location_sec');
  const freshAfter = new Date(Date.now() - staleSec * 1000).toISOString();

  const rows = await db.query(
    `SELECT c.id, dl.lat, dl.lng, dl.heading
       FROM captains c
       JOIN driver_locations dl ON dl.captain_id = c.id
      WHERE c.status = 'APPROVED' AND c.is_online = 1 AND dl.updated_at > $1
        AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.captain_id = c.id
              AND t.status IN ('DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED'))`,
    [freshAfter]
  );

  const captains = rows
    .map((r) => ({ ...r, d: geo.haversine(center, { lat: r.lat, lng: r.lng }) }))
    .filter((r) => r.d <= RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_CARS)
    .map((r) => ({
      id: crypto.createHmac('sha256', config.jwtSecret).update(ctx.user.id + ':' + r.id).digest('hex').slice(0, 12),
      lat: round(r.lat), lng: round(r.lng),
      heading: r.heading == null ? null : Math.round(r.heading),
    }));

  return ok(res, { captains });
}

module.exports = { nearby };
