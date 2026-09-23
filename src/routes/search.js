'use strict';
/**
 * بحث الأماكن من قاعدة بيانات نشمي (قبل خرائط OpenStreetMap):
 *   1) الأماكن الي ضافتها الإدارة (محلات، مستشفيات، جامعات، دواوين…)
 *   2) الوجهات الي طلبها الزباين قبل (بدون أسماء أو أرقام — بس اسم المكان وإحداثياته)
 * البحث بيتجاهل «ال» والهمزات والتاء المربوطة — «عبدلي» بتلاقي «العبدلي».
 */
const db = require('../db');
const { ok } = require('../lib/http');
const arabic = require('../lib/arabic');
const { haversine: haversineM } = require('../services/geo');

let poiCache = null, poiAt = 0;
async function activePois() {
  if (poiCache && Date.now() - poiAt < 60_000) return poiCache;
  poiCache = await db.query('SELECT id, name, name_norm, category, address, lat, lng FROM pois WHERE is_active = 1', []);
  poiAt = Date.now();
  return poiCache;
}
const invalidate = () => { poiCache = null; };

const GENERIC = /^(موقعي الحالي|موقع محدد|موقع محدد على الخريطة|مكان محفوظ|البيت|الشغل)$/;

async function search(req, res, ctx, params, url) {
  const q = String(url.searchParams.get('q') || '').slice(0, 80);
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  if (arabic.normalize(q).length < 2) return ok(res, { results: [] });

  const out = [];
  for (const p of await activePois()) {
    const s = arabic.score(q, p.name);
    if (s > 0) out.push({ id: 'poi:' + p.id, label: p.name, address: p.address || '', lat: p.lat, lng: p.lng, category: p.category, source: 'nashmi', score: s + 0.15 });
  }

  // وجهات سابقة (مجمّعة حسب الموقع حتى ما تتكرر)
  const rows = await db.query(
    'SELECT label, address, lat, lng FROM recent_places ORDER BY used_at DESC LIMIT 3000', []);
  const seen = [];
  for (const r of rows) {
    if (!r.label || GENERIC.test(r.label.trim())) continue;
    const s = Math.max(arabic.score(q, r.label), arabic.score(q, r.address || '') * 0.8);
    if (s <= 0) continue;
    if (seen.some((x) => Math.abs(x.lat - r.lat) < 0.0006 && Math.abs(x.lng - r.lng) < 0.0006)) continue;
    seen.push(r);
    out.push({ id: `used:${r.lat.toFixed(5)},${r.lng.toFixed(5)}`, label: r.label, address: r.address || '', lat: r.lat, lng: r.lng, category: 'used', source: 'nashmi', score: s });
  }

  for (const r of out) {
    if (near) {
      r.distanceM = Math.round(haversineM(near, r));
      r.score -= Math.min(0.25, r.distanceM / 200_000);   // الأقرب أول
    }
  }
  out.sort((a, b) => b.score - a.score);
  return ok(res, { results: out.slice(0, 8) });
}

module.exports = { search, invalidate };
