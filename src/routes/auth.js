'use strict';
const db = require('../db');
const config = require('../config');
const otp = require('../services/otp');
const walogin = require('../services/walogin');
const authmode = require('../services/authmode');
const auth = require('../services/auth');
const { parseJson, ok, clientIp, parseCookies, cookie } = require('../lib/http');
const { normalizeJordanPhone } = require('../lib/validate');
const rate = require('../lib/rate-limit');
const { E } = require('../lib/errors');

const REFRESH_COOKIE = 'nashmi_rt';

function setRefreshCookie(res, token) {
  res.setHeader('Set-Cookie', cookie(REFRESH_COOKIE, token, {
    maxAge: config.refreshTokenTtlSec, secure: config.isProd, sameSite: 'Lax',
  }));
}

async function requestOtp(req, res) {
  const ip = clientIp(req);
  if (!rate.hit(`otp:ip:${ip}`, 20, 3600).allowed) throw E.RATE_LIMITED();
  const body = await parseJson(req);
  const phone = normalizeJordanPhone(body.phone);
  // «ما عندي واتساب»: الرمز برسالة SMS عن طريق مزوّد الاحتياط
  let providerName;
  const mode = await authmode.mode();
  if (body.channel === 'sms' && mode === 'whatsapp_link') {
    if (!config.sms.fallback) throw E.VALIDATION_FAILED('الرسائل النصية مش متاحة حالياً');
    providerName = config.sms.fallback;
  } else if (mode === 'whatsapp_link') {
    throw E.VALIDATION_FAILED('الدخول بيصير عن طريق واتساب');
  }
  const result = await otp.issue({ phone, ip, providerName });
  return ok(res, {
    phone,
    channel: result.channel,
    expiresInSec: result.expiresInSec,
    resendAfterSec: result.resendAfterSec,
    devCode: result.devCode,
    notice: result.notice,
  });
}

async function verifyOtp(req, res) {
  const ip = clientIp(req);
  if (!rate.hit(`otpv:ip:${ip}`, 40, 3600).allowed) throw E.RATE_LIMITED();
  const body = await parseJson(req);
  const phone = normalizeJordanPhone(body.phone);
  await otp.verifyCode({ phone, code: body.code });
  return loginPhone(req, res, phone, ip);
}

/** فتح جلسة لرقم تأكدنا منه (برمز أو برسالة واتساب) */
async function loginPhone(req, res, phone, ip) {
  const defaultCity = await db.one('SELECT id FROM cities WHERE is_active = 1 ORDER BY created_at', []);
  const found = await auth.findOrCreateUser(phone, defaultCity ? defaultCity.id : null);
  const isNew = found.isNew;
  const user = await auth.promoteOwner(found.user);
  if (user.status !== 'ACTIVE') throw E.ACCOUNT_SUSPENDED();

  const tokens = await auth.createSession(user, { ip, userAgent: req.headers['user-agent'] });
  setRefreshCookie(res, tokens.refreshToken);
  return ok(res, {
    isNewUser: isNew,
    user: auth.publicUser(user),
    accessToken: tokens.accessToken,
    expiresInSec: tokens.expiresInSec,
  });
}

async function refresh(req, res) {
  const cookies = parseCookies(req);
  let token = cookies[REFRESH_COOKIE];
  if (!token) {
    const body = await parseJson(req).catch(() => ({}));
    token = body.refreshToken;
  }
  const { user, tokens } = await auth.rotateSession(token, {
    ip: clientIp(req), userAgent: req.headers['user-agent'],
  });
  setRefreshCookie(res, tokens.refreshToken);
  return ok(res, { user: auth.publicUser(user), accessToken: tokens.accessToken, expiresInSec: tokens.expiresInSec });
}

async function logout(req, res) {
  const cookies = parseCookies(req);
  await auth.revokeSession(cookies[REFRESH_COOKIE]);
  res.setHeader('Set-Cookie', cookie(REFRESH_COOKIE, '', { maxAge: 0, secure: config.isProd }));
  return ok(res, {});
}

/* ------------------------- الدخول بواتساب (الزبون بيبعت الرمز) ------------------------- */
async function waStart(req, res) {
  if (!(await walogin.enabled())) throw E.NOT_FOUND('الدخول بواتساب مش مفعّل');
  const ip = clientIp(req);
  if (!rate.hit(`otp:ip:${ip}`, 20, 3600).allowed) throw E.RATE_LIMITED();
  const body = await parseJson(req);
  const phone = normalizeJordanPhone(body.phone);
  const r = await walogin.start({ phone, ip });
  return ok(res, { phone, id: r.id, code: r.code, link: r.link, number: r.number, text: r.text, expiresInSec: r.expiresInSec });
}

async function waCheck(req, res) {
  const ip = clientIp(req);
  if (!rate.hit(`wachk:ip:${ip}`, 1500, 3600).allowed) throw E.RATE_LIMITED();
  const body = await parseJson(req);
  const r = await walogin.check(body.id);
  if (r.status !== 'VERIFIED') return ok(res, { status: r.status, expiresInSec: r.expiresInSec });
  return loginPhone(req, res, r.phone, ip);
}

module.exports = { requestOtp, verifyOtp, waStart, waCheck, refresh, logout, REFRESH_COOKIE };
