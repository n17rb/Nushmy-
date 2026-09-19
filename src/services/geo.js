'use strict';
/** حسابات جغرافية أساسية (لا تعتمد على أي خدمة خارجية). */

const R = 6371000; // نصف قطر الأرض بالمتر
const rad = (d) => (d * Math.PI) / 180;

/** المسافة الهوائية بالمتر */
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * تقدير مسافة الطريق عند عدم توفّر مزوّد مسارات:
 * معامل التفافية للطرق داخل المدن الأردنية ≈ 1.35
 */
const ROAD_FACTOR = 1.35;
const roadDistanceEstimate = (a, b) => Math.round(haversine(a, b) * ROAD_FACTOR);

/** تقدير الزمن بالثواني من المسافة ومتوسط سرعة داخل المدينة (كم/س) */
function durationEstimate(meters, avgKmh = 32) {
  return Math.round((meters / 1000 / avgKmh) * 3600);
}

/** نقطة داخل مضلّع (خوارزمية ray casting) */
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = (yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

module.exports = { haversine, roadDistanceEstimate, durationEstimate, pointInPolygon, ROAD_FACTOR };
