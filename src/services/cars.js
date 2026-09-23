'use strict';
/** بطاقة السيارة كما يشوفها الزبون: الصورة (حسب Style Bible) + الشركة والفئة + السنة واللون + المواصفات */
const db = require('../db');
const V = require('../data/vehicles');

/** صورة الفئة من مكتبة الإدارة (صورة وحدة لكل فئة — اللون بيبين كدائرة بالبطاقة) */
async function imageFor(makeId, classId) {
  if (!makeId || !classId) return null;
  const r = await db.one('SELECT file_id FROM car_images WHERE make_id = $1 AND class_id = $2', [makeId, classId]);
  return r ? '/media/' + r.file_id : null;
}

/** @param {object} v صف من جدول vehicles */
async function view(v) {
  if (!v) return null;
  const mk = V.makeById(v.make_id), cl = V.classById(v.make_id, v.class_id), co = V.colorById(v.color_key);
  const seats = v.seats || (cl && cl.seats) || null;
  const fuel = v.fuel || (cl && cl.fuel) || null;
  const body = v.body || (cl && cl.body) || 'sedan';
  return {
    make: mk ? mk.en : v.make, makeAr: mk ? mk.ar : v.make,
    model: cl ? cl.en : v.model, classAr: cl ? cl.ar : v.model,          // «الفئة» — مش الموديل/السنة
    label: [mk ? mk.en : v.make, cl ? cl.en : v.model].filter(Boolean).join(' '),
    year: v.year, color: co ? co.ar : v.color, colorKey: v.color_key || null, colorHex: co ? co.hex : null,
    plate: v.plate_number, seats, fuel, fuelAr: fuel ? V.FUEL_AR[fuel] : null,
    transmission: v.transmission || 'automatic', transmissionAr: V.TRANSMISSION_AR[v.transmission || 'automatic'],
    body, bodyAr: V.BODY_AR[body],
    // صورة الفئة إذا الإدارة رافعتها، وإلا بدون صورة (ما منعرض شكل سيارة غلط)
    imageUrl: await imageFor(v.make_id, v.class_id),
  };
}

module.exports = { view, imageFor };
