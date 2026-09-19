'use strict';
const { E } = require('./errors');

/** تطبيع رقم أردني إلى صيغة E.164: 07XXXXXXXX / 7XXXXXXXX / +9627XXXXXXXX  →  +9627XXXXXXXX */
function normalizeJordanPhone(input) {
  if (typeof input !== 'string') throw E.PHONE_INVALID();
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+962')) d = d.slice(4);
  else if (d.startsWith('00962')) d = d.slice(5);
  else if (d.startsWith('962')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^7[789]\d{7}$/.test(d)) throw E.PHONE_INVALID();
  return '+962' + d;
}

function str(v, { min = 0, max = 500, field = 'الحقل', required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw E.VALIDATION_FAILED(`${field} مطلوب`);
    return null;
  }
  const s = String(v).trim();
  if (s.length < min) throw E.VALIDATION_FAILED(`${field} قصير جداً`);
  if (s.length > max) throw E.VALIDATION_FAILED(`${field} طويل جداً`);
  return s;
}

function coord(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw E.VALIDATION_FAILED(`${field} غير صحيح`);
  return n;
}

function latLng(lat, lng) {
  const la = coord(lat, 'خط العرض'), ln = coord(lng, 'خط الطول');
  if (la < -90 || la > 90 || ln < -180 || ln > 180) throw E.VALIDATION_FAILED('الإحداثيات خارج النطاق');
  return { lat: la, lng: ln };
}

module.exports = { normalizeJordanPhone, str, coord, latLng };
