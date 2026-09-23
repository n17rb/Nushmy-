'use strict';
/**
 * نشمي — الخادم.
 * بدون مكتبات خارجية: node:http + node:sqlite (أو pg في الإنتاج).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const log = require('./lib/log');
const { fail, ok, clientIp } = require('./lib/http');
const { E, AppError } = require('./lib/errors');
const rate = require('./lib/rate-limit');
const settings = require('./services/settings');
const dispatch = require('./services/dispatch');
const authService = require('./services/auth');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const placesRoutes = require('./routes/places');
const tripRoutes = require('./routes/trips');
const captainRoutes = require('./routes/captains');
const cap = require('./routes/captain');
const adm = require('./routes/admin');
const waRoutes = require('./routes/whatsapp');
const files = require('./services/files');
const searchRoutes = require('./routes/search');
const chatRoutes = require('./routes/chat');
const callRoutes = require('./routes/calls');
const notifRoutes = require('./routes/notifications');
const admx = require('./routes/admin-extra');
const vehicleCatalog = require('./data/vehicles');

/* ----------------------------- الموجِّه ----------------------------- */
const routes = [];
const add = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, auth: opts.auth !== false });

add('POST', '/api/auth/otp/request', authRoutes.requestOtp, { auth: false });
add('POST', '/api/auth/otp/verify',  authRoutes.verifyOtp,  { auth: false });
add('POST', '/api/auth/wa/start',    authRoutes.waStart,    { auth: false });
add('POST', '/api/auth/wa/check',    authRoutes.waCheck,    { auth: false });
add('GET',  '/api/whatsapp/webhook', waRoutes.verify,       { auth: false });
add('POST', '/api/whatsapp/webhook', waRoutes.receive,      { auth: false });
add('POST', '/api/auth/refresh',     authRoutes.refresh,    { auth: false });
add('POST', '/api/auth/logout',      authRoutes.logout,     { auth: false });

add('GET',  '/api/me',               profileRoutes.me);
add('PATCH','/api/me',               profileRoutes.update);
add('POST', '/api/me/photo',         profileRoutes.uploadPhoto);
add('DELETE','/api/me/photo',        profileRoutes.removePhoto);

add('GET',  '/api/places',           placesRoutes.list);
add('POST', '/api/places',           placesRoutes.save);
add('DELETE','/api/places/:id',      placesRoutes.remove);
add('GET',  '/api/search/places',    searchRoutes.search);
add('GET',  '/api/vehicle-catalog',  (req, res) => ok(res, vehicleCatalog.catalog), { auth: false });
add('GET',  '/api/class-images',     admx.classImages);

// المحادثات (الزبون والكابتن)
add('GET',  '/api/chat/threads',          chatRoutes.list);
add('GET',  '/api/chat/unread',           chatRoutes.unread);
add('GET',  '/api/chat/trips/:tripId',    chatRoutes.tripChat);
add('POST', '/api/chat/support',          chatRoutes.support);
add('GET',  '/api/chat/threads/:id',      chatRoutes.get);
add('POST', '/api/chat/threads/:id/messages', chatRoutes.send);

// المكالمات داخل التطبيق
add('GET',  '/api/calls/ice',             callRoutes.iceConfig);
add('GET',  '/api/calls/incoming',        callRoutes.incoming);
add('POST', '/api/calls',                 callRoutes.startCall);
add('GET',  '/api/calls/:id',             callRoutes.getCall);
add('POST', '/api/calls/:id/signal',      callRoutes.postSignal);
add('POST', '/api/calls/:id/accept',      callRoutes.acceptCall);
add('POST', '/api/calls/:id/end',         callRoutes.endCall);

// الإشعارات
add('GET',  '/api/notifications',         notifRoutes.list);
add('POST', '/api/notifications/read',    notifRoutes.markRead);
add('GET',  '/api/push/key',              notifRoutes.key, { auth: false });
add('POST', '/api/push/subscribe',        notifRoutes.subscribe);
add('POST', '/api/push/register',         notifRoutes.register);
add('POST', '/api/push/unsubscribe',      notifRoutes.unsubscribe);
add('POST', '/api/push/test',             notifRoutes.test);

add('GET',  '/api/vehicle-types',    tripRoutes.vehicleTypes, { auth: false });
add('GET',  '/api/captains/nearby',  captainRoutes.nearby);

// ----- تطبيق الكابتن -----
add('GET',  '/api/captain/me',                 cap.me);
add('POST', '/api/captain/register',           cap.register);
add('POST', '/api/captain/documents',          cap.uploadDocument);
add('PATCH','/api/captain/goal',               cap.setGoal);
add('POST', '/api/captain/online',             cap.setOnline);
add('POST', '/api/captain/location',           cap.updateLocation);
add('GET',  '/api/captain/offer',              cap.currentOffer);
add('POST', '/api/captain/offers/:id/accept',  cap.acceptOffer);
add('POST', '/api/captain/offers/:id/reject',  cap.rejectOffer);
add('GET',  '/api/captain/trip',               cap.activeTrip);
add('GET',  '/api/captain/trips/:id',          cap.getTrip);
add('POST', '/api/captain/trips/:id/arrived',  cap.arrived);
add('POST', '/api/captain/trips/:id/start',    cap.start);
add('POST', '/api/captain/trips/:id/complete', cap.complete);
add('POST', '/api/captain/trips/:id/cancel',   cap.cancel);
add('POST', '/api/captain/trips/:id/rate',     cap.rateCustomer);
add('GET',  '/api/captain/earnings',           cap.earnings);
add('GET',  '/api/captain/wallet',             cap.walletView);
add('POST', '/api/captain/wallet/deposits',    cap.requestDeposit);

// ----- لوحة الإدارة -----
add('GET',  '/api/admin/me',                     adm.me);
add('GET',  '/api/admin/dashboard',              adm.dashboard);
add('GET',  '/api/admin/live',                   adm.live);
add('GET',  '/api/admin/trips',                  adm.trips);
add('GET',  '/api/admin/trips/:id',              adm.tripDetail);
add('POST', '/api/admin/trips/:id/cancel',       adm.cancelTrip);
add('GET',  '/api/admin/captains',               adm.captains);
add('GET',  '/api/admin/captains/:id',           adm.captainDetail);
add('POST', '/api/admin/captains/:id/status',    adm.captainStatus);
add('POST', '/api/admin/captains/:id/offline',   adm.captainOffline);
add('POST', '/api/admin/captains/:id/wallet',    adm.walletAdjust);
add('POST', '/api/admin/documents/:id',          adm.documentReview);
add('GET',  '/api/admin/files/:id',              adm.fileView);
add('GET',  '/api/admin/deposits',               adm.deposits);
add('POST', '/api/admin/deposits/:id/approve',   adm.depositApprove);
add('POST', '/api/admin/deposits/:id/reject',    adm.depositReject);
add('GET',  '/api/admin/customers',              adm.customers);
add('GET',  '/api/admin/customers/:id',          adm.customerDetail);
add('POST', '/api/admin/customers/:id/status',   adm.customerStatus);
add('GET',  '/api/admin/pricing',                adm.pricingList);
add('PATCH','/api/admin/pricing/:id',            adm.pricingUpdate);
add('GET',  '/api/admin/settings',               adm.settingsList);
add('PATCH','/api/admin/settings/:key',          adm.settingUpdate);
add('PATCH','/api/admin/cities/:id',             adm.cityUpdate);
add('GET',  '/api/admin/admins',                 adm.admins);
add('POST', '/api/admin/admins',                 adm.adminAdd);
add('DELETE','/api/admin/admins/:id',            adm.adminRemove);
add('GET',  '/api/admin/audit',                  adm.auditList);
add('GET',  '/api/admin/whatsapp',               adm.whatsappStatus);
add('POST', '/api/admin/whatsapp/template',      adm.whatsappTemplate);
add('POST', '/api/admin/whatsapp/test',          adm.whatsappTest);
add('POST', '/api/admin/whatsapp/subscribe',     adm.whatsappSubscribe);
add('POST', '/api/admin/sms/test',               adm.smsTest);
add('POST', '/api/admin/whatsapp/secret',        adm.whatsappSecret);
add('POST', '/api/admin/auth-mode',              adm.authModeUpdate);
add('GET',  '/api/admin/chats',                  admx.chats);
add('GET',  '/api/admin/chats/badge',            admx.chatsBadge);
add('POST', '/api/admin/chats/start',            admx.chatStart);
add('GET',  '/api/admin/chats/:id',              admx.chatGet);
add('POST', '/api/admin/chats/:id/messages',     admx.chatSend);
add('POST', '/api/admin/chats/:id/status',       admx.chatStatus);
add('GET',  '/api/admin/broadcasts',             admx.broadcasts);
add('POST', '/api/admin/broadcasts',             admx.broadcastSend);
add('GET',  '/api/admin/pois',                   admx.pois);
add('POST', '/api/admin/pois',                   admx.poiSave);
add('PATCH','/api/admin/pois/:id',               admx.poiSave);
add('DELETE','/api/admin/pois/:id',              admx.poiDelete);
add('GET',  '/api/admin/alerts',                 admx.alerts);
add('POST', '/api/admin/alerts/read',            admx.alertsRead);
add('GET',  '/api/admin/car-images',             admx.carImages);
add('POST', '/api/admin/car-images',             admx.carImageSave);
add('DELETE','/api/admin/car-images/:id',        admx.carImageDelete);
add('POST', '/api/trips/estimate',   tripRoutes.estimate);
add('POST', '/api/trips',            tripRoutes.create);
add('GET',  '/api/trips/active',     tripRoutes.active);
add('GET',  '/api/trips/history',    tripRoutes.history);
add('GET',  '/api/trips/:id',        tripRoutes.get);
add('GET',  '/api/trips/:id/cancel-preview', tripRoutes.cancelPreview);
add('POST', '/api/trips/:id/cancel', tripRoutes.cancel);
add('POST', '/api/trips/:id/rate',   tripRoutes.rate);
add('POST', '/api/trips/:id/rider-location', tripRoutes.riderLocation);
add('PATCH','/api/captain/vehicle',  cap.updateVehicle);

function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const rp = r.pattern.split('/'), pp = pathname.split('/');
    if (rp.length !== pp.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(pp[i]);
      else if (rp[i] !== pp[i]) { hit = false; break; }
    }
    if (hit) return { route: r, params };
  }
  return null;
}

/* --------------------------- الملفات الثابتة --------------------------- */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

function serveFile(res, filePath, { immutable = false } = {}) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/uploads/')) {
    const name = path.basename(pathname);
    return serveFile(res, path.join(config.uploadsDir, name), { immutable: true });
  }
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) return false;
  if (serveFile(res, target)) return true;
  // تطبيق الكابتن ولوحة الإدارة لكل واحد صفحته الخاصة
  for (const app of ['captain', 'admin']) {
    if (rel === '/' + app || rel.startsWith('/' + app + '/')) {
      if (rel === '/' + app) { res.writeHead(301, { Location: '/' + app + '/' }); res.end(); return true; }
      if (!path.extname(rel)) return serveFile(res, path.join(PUBLIC_DIR, app, 'index.html'));
      return false;
    }
  }
  if (rel === '/privacy') return serveFile(res, path.join(PUBLIC_DIR, 'privacy.html'));
  // تطبيق صفحة واحدة: أي مسار غير معروف يعيد index.html
  if (!rel.startsWith('/api') && !path.extname(rel)) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  return false;
}

/* ------------------------------- الخادم ------------------------------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  try {
    if (pathname === '/api/health') {
      return ok(res, { status: 'up', driver: db.driver, env: config.NODE_ENV, time: new Date().toISOString() });
    }
    if (pathname === '/api/config') {
      const mode = await require('./services/authmode').mode();
      return ok(res, {
        maps: { ...(await require('./services/maps').tiles()), geocoderUrl: config.maps.geocoderUrl, routingUrl: config.maps.routingUrl },
        smsProvider: mode,
        loginMode: mode === 'whatsapp_link' ? 'wa_link' : 'otp',
        smsFallback: mode === 'whatsapp_link' && Boolean(config.sms.fallback),
        devMode: mode === 'dev' && config.sms.showDevCode,
        currency: 'JOD',
      });
    }

    if (pathname.startsWith('/api/')) {
      const ip = clientIp(req);
      if (!rate.hit(`api:${ip}`, 600, 60).allowed) throw E.RATE_LIMITED();

      const m = match(req.method, pathname);
      if (!m) throw E.NOT_FOUND('المسار غير موجود');

      const ctx = { ip, user: null };
      if (m.route.auth) ctx.user = await authService.authenticate(req);

      await m.route.handler(req, res, ctx, m.params, url);
      log.debug('طلب', { method: req.method, path: pathname, ms: Date.now() - started });
      return;
    }

    // صور الحسابات العامة المحفوظة بقاعدة البيانات
    if (pathname.startsWith('/media/')) {
      const f = await files.get(pathname.slice(7));
      if (f && !f.is_private) return files.send(res, f, { cacheSeconds: 31536000 });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('غير موجود'); return;
    }

    if (serveStatic(req, res, pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('غير موجود');
  } catch (err) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    return fail(res, err, { method: req.method, path: pathname });
  }
});

async function main() {
  const driver = await db.init();
  await settings.ensureDefaults();
  await require('./db/seed').run({ quiet: true });
  dispatch.start();
  server.listen(config.port, () => {
    log.info('نشمي يعمل', { port: config.port, db: driver, env: config.NODE_ENV });
    if (!config.isProd) log.info(`افتح المتصفح على  http://localhost:${config.port}`);
  });
}

process.on('SIGTERM', async () => { dispatch.stop(); server.close(); await db.close(); process.exit(0); });
process.on('SIGINT',  async () => { dispatch.stop(); server.close(); await db.close(); process.exit(0); });

if (require.main === module) {
  main().catch((e) => { log.error('فشل الإقلاع', { message: e.message, stack: e.stack }); process.exit(1); });
}

module.exports = { server, main, match };
