'use strict';
/**
 * Webhook واتساب — Meta بتبعتلنا عليه الرسائل الي بتوصل لرقم نشمي.
 *   GET  /api/whatsapp/webhook  ← تأكيد الربط (Meta بتبعت hub.challenge ومنرجّعه)
 *   POST /api/whatsapp/webhook  ← رسائل واردة (موقّعة بالـ App Secret)
 */
const log = require('../lib/log');
const { readBody } = require('../lib/http');
const walogin = require('../services/walogin');
const authmode = require('../services/authmode');
const settings = require('../services/settings');
const { nowIso } = require('../lib/ids');

async function verify(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const token = await authmode.verifyToken();
  if (q.get('hub.mode') === 'subscribe' && token && q.get('hub.verify_token') === token) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(q.get('hub.challenge') || '');
    log.info('واتساب: تم تأكيد ربط الـ Webhook');
    settings.set('wa.webhook_verified_at', nowIso()).catch(() => {});
    return;
  }
  log.warn('واتساب: محاولة ربط Webhook برمز تحقق غلط');
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('forbidden');
}

async function receive(req, res) {
  const raw = await readBody(req);
  if (!walogin.validSignature(raw, req.headers['x-hub-signature-256'], await authmode.appSecret())) {
    log.warn('واتساب: رسالة Webhook بتوقيع غلط أو WHATSAPP_APP_SECRET ناقص — انرفضت');
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad signature');
    return;
  }
  // منرد على Meta فوراً، ومنعالج الرسائل بعدها
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ok');
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
  for (const m of walogin.extractMessages(payload)) {
    try { await walogin.handleInbound(m.from, m.text); }
    catch (e) { log.error('واتساب: خطأ بمعالجة رسالة', { error: e.message }); }
  }
}

module.exports = { verify, receive };
