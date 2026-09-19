'use strict';
/**
 * محرك التسعير — كل القيم من جدول pricing_rules في قاعدة البيانات.
 * لا توجد أي أرقام تسعير ثابتة داخل الكود.
 */
const db = require('../db');
const money = require('./money');
const settings = require('./settings');
const { E } = require('../lib/errors');

/** اختيار قاعدة التسعير المناسبة: نوع المركبة + المدينة، مع تدرّج للقواعد العامة */
async function resolveRule({ vehicleTypeId, cityId }) {
  const rows = await db.query(
    `SELECT * FROM pricing_rules
      WHERE is_active = 1
        AND (vehicle_type_id = $1 OR vehicle_type_id IS NULL)
        AND (city_id = $2 OR city_id IS NULL)
      ORDER BY priority DESC`,
    [vehicleTypeId, cityId]
  );
  if (!rows.length) throw E.PRICING_NOT_CONFIGURED();
  // الأدق أولاً: القاعدة التي تطابق نوع المركبة والمدينة معاً
  rows.sort((a, b) => score(b) - score(a));
  return rows[0];
  function score(r) {
    return (r.vehicle_type_id === vehicleTypeId ? 2 : 0) + (r.city_id === cityId ? 1 : 0) + (r.priority || 0) / 100;
  }
}

/**
 * حساب الأجرة.
 * @returns تفصيل كامل بالفلس — يُخزَّن كما هو مع الرحلة.
 */
async function quote({ vehicleTypeId, cityId, distanceM, durationS, peakBp = null, discountFils = 0 }) {
  const rule = await resolveRule({ vehicleTypeId, cityId });
  const km1000 = Math.round(distanceM);          // متر
  const min = Math.max(0, Math.round(durationS / 60));

  const distanceComponent = Math.round((rule.per_km_fils * km1000) / 1000);
  const timeComponent = rule.per_min_fils * min;
  let subtotal = rule.base_fare_fils + distanceComponent + timeComponent;

  const multiplierBp = peakBp || rule.peak_multiplier_bp || 10000;
  subtotal = money.applyBp(subtotal, multiplierBp);

  let fare = Math.max(subtotal, rule.min_fare_fils);
  fare = money.roundToNearest(fare, 50);

  const discount = Math.max(0, Math.min(discountFils, fare));
  const gross = fare - discount;

  const commissionBp = await settings.get('platform.commission_bp');
  const commission = money.applyBp(gross, commissionBp);
  const captainEarnings = gross - commission;

  return {
    pricingRuleId: rule.id,
    breakdown: {
      baseFils: rule.base_fare_fils,
      distanceFils: distanceComponent,
      timeFils: timeComponent,
      minFareFils: rule.min_fare_fils,
      multiplierBp,
      discountFils: discount,
    },
    distanceM: Math.round(distanceM),
    durationS: Math.round(durationS),
    fareFils: fare,
    grossFareFils: gross,
    commissionBp,
    commissionFils: commission,
    captainEarningsFils: captainEarnings,
    currency: 'JOD',
  };
}

module.exports = { quote, resolveRule };
