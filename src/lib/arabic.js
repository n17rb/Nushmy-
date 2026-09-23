'use strict';
/**
 * توحيد النص العربي للبحث:
 *   «العبدلي» = «عبدلي» = «الْعَبْدَلي»،  «مكة» = «مكه»،  «أبو» = «ابو»،  «مستشفى» = «مستشفي»
 * نفس الدالة موجودة بالمتصفح (public/js/map.js) — لازم يضلّوا متطابقين.
 */
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')           // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => DIGITS[d])
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))   // «ال» التعريف
    .map((w) => (w.length > 4 && /^[وب]ال/.test(w) ? w.slice(3) : w))     // «وال» «بال»
    .join(' ');
}

/** درجة تطابق 0..1 بين نص البحث واسم المكان */
function score(query, name) {
  const q = normalize(query), n = normalize(name);
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.92;
  const words = n.split(' ');
  if (words.some((w) => w.startsWith(q))) return 0.85;
  if (n.includes(q)) return 0.75;
  const qw = q.split(' ');
  const hits = qw.filter((w) => words.some((x) => x.startsWith(w) || (w.length > 3 && x.includes(w)))).length;
  return hits ? 0.4 + 0.3 * (hits / qw.length) : 0;
}

module.exports = { normalize, score };
