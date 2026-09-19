'use strict';
/**
 * كل المبالغ أعداد صحيحة بوحدة الفلس (1 دينار = 1000 فلس).
 * لا نستخدم أرقاماً عشرية في أي عملية مالية.
 */
const FILS_PER_JOD = 1000;

const toFils = (jod) => Math.round(Number(jod) * FILS_PER_JOD);
const toJod = (fils) => Number(fils) / FILS_PER_JOD;

/** صيغة العرض: 2.500 د.أ */
function format(fils) {
  const sign = fils < 0 ? '-' : '';
  const v = Math.abs(Math.round(fils));
  const d = Math.floor(v / FILS_PER_JOD);
  const f = String(v % FILS_PER_JOD).padStart(3, '0');
  return `${sign}${d}.${f}`;
}

/** تقريب لأعلى إلى أقرب 50 فلساً — يعطي أسعاراً مريحة للدفع نقداً */
const roundToNearest = (fils, step = 50) => Math.round(fils / step) * step;

/** نسبة بنقاط الأساس: 750 = 7.5% */
const applyBp = (fils, bp) => Math.round((fils * bp) / 10000);

module.exports = { FILS_PER_JOD, toFils, toJod, format, roundToNearest, applyBp };
