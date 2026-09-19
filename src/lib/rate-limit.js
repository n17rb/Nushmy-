'use strict';
/** حدّ بسيط للطلبات في الذاكرة — كافٍ لخادم واحد، ويُستبدل بـ Redis عند التوسع. */
const buckets = new Map();

function hit(key, limit, windowSec) {
  const now = Date.now();
  const winMs = windowSec * 1000;
  let b = buckets.get(key);
  if (!b || now - b.start > winMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
  b.count += 1;
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetInSec: Math.ceil((b.start + winMs - now) / 1000) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 3600_000) buckets.delete(k);
}, 600_000).unref();

module.exports = { hit };
