'use strict';
const db = require('../db');
const config = require('../config');
const otp = require('../services/otp');
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
  const result = await otp.issue({ phone, ip });
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

module.exports = { requestOtp, verifyOtp, refresh, logout, REFRESH_COOKIE };
