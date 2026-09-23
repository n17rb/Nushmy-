'use strict';
/** المكالمات داخل التطبيق — من تطبيق الزبون (as=customer) وتطبيق الكابتن (as=captain) */
const db = require('../db');
const { parseJson, ok, created } = require('../lib/http');
const { E } = require('../lib/errors');
const calls = require('../services/calls');

const asOf = (url, body) => (((body && body.as) || (url && url.searchParams.get('as'))) === 'captain' ? 'captain' : 'customer');

async function iceConfig(req, res) {
  const cfg = await calls.ice();
  return ok(res, cfg);
}

async function startCall(req, res, ctx) {
  const body = await parseJson(req);
  const r = await calls.start({ tripId: String(body.tripId || ''), userId: ctx.user.id, as: asOf(null, body) });
  return created(res, { call: await calls.view(r.call, ctx.user.id), ice: r.ice, resumed: r.resumed });
}

/** التطبيق بيسأل: في حدا عم يرنّ عليّ؟ */
async function incoming(req, res, ctx) {
  const cfg = await calls.ice();
  const rows = await db.query(
    `SELECT * FROM calls WHERE (callee_id = $1 OR caller_id = $1) AND status IN ('RINGING','ACTIVE')
      ORDER BY created_at DESC LIMIT 3`, [ctx.user.id]);
  for (const c of rows) {
    const fresh = await calls.expireIfLate(c, cfg.ringSec);
    if (fresh.status === 'ENDED') continue;
    return ok(res, { call: await calls.view(fresh, ctx.user.id), ice: cfg });
  }
  return ok(res, { call: null, ice: cfg });
}

async function getCall(req, res, ctx, params, url) {
  const c = await calls.mine(params.id, ctx.user.id);
  const cfg = await calls.ice();
  const fresh = await calls.expireIfLate(c, cfg.ringSec);
  const after = url.searchParams.get('after');
  return ok(res, {
    call: await calls.view(fresh, ctx.user.id),
    signals: fresh.status === 'ENDED' ? [] : await calls.signalsFor(fresh, ctx.user.id, after || null),
  });
}

async function postSignal(req, res, ctx, params) {
  const body = await parseJson(req);
  const c = await calls.mine(params.id, ctx.user.id);
  await calls.signal(c, ctx.user.id, String(body.kind || ''), body.payload);
  return ok(res, {});
}

async function acceptCall(req, res, ctx, params) {
  const c = await calls.mine(params.id, ctx.user.id);
  const fresh = await calls.accept(c, ctx.user.id);
  return ok(res, { call: await calls.view(fresh, ctx.user.id), ice: await calls.ice() });
}

async function endCall(req, res, ctx, params) {
  const body = await parseJson(req).catch(() => ({}));
  const c = await calls.mine(params.id, ctx.user.id);
  const reasons = ['hangup', 'declined', 'cancelled', 'failed', 'missed'];
  let reason = reasons.includes(body.reason) ? body.reason : 'hangup';
  if (c.status === 'RINGING') reason = c.callee_id === ctx.user.id ? 'declined' : 'cancelled';
  const fresh = await calls.end(c, reason);
  return ok(res, { call: await calls.view(fresh, ctx.user.id) });
}

module.exports = { iceConfig, startCall, incoming, getCall, postSignal, acceptCall, endCall };
