'use strict';
/**
 * لوحة الإدارة — واجهة برمجية.
 * كل إجراء حساس: صلاحية على الخادم + سبب + سجل عمليات (قبل/بعد) + منع التكرار للعمليات المالية.
 */
const db = require('../db');
const config = require('../config');
const money = require('../services/money');
const settings = require('../services/settings');
const wallet = require('../services/wallet');
const files = require('../services/files');
const authService = require('../services/auth');
const S = require('../services/trip-state');
const { ammanDayStart } = require('./captain');
const { parseJson, ok, created } = require('../lib/http');
const { str, normalizeJordanPhone } = require('../lib/validate');
const { uuid, nowIso } = require('../lib/ids');
const { E, AppError } = require('../lib/errors');

/* ================================ الصلاحيات ================================ */
const ROLES = {
  SUPER_ADMIN:    { label: 'مدير عام',        perms: ['*'] },
  FINANCE_ADMIN:  { label: 'مسؤول مالي',      perms: ['view', 'finance'] },
  DISPATCH_ADMIN: { label: 'مسؤول تشغيل',     perms: ['view', 'trips.manage', 'captains.manage'] },
  SUPPORT_ADMIN:  { label: 'دعم فني',         perms: ['view', 'trips.manage', 'customers.manage'] },
  MODERATOR:      { label: 'مراقب (عرض فقط)', perms: ['view'] },
};

async function requireAdmin(ctx, perm = 'view') {
  const user = await authService.promoteOwner(ctx.user);
  const role = user.admin_role && ROLES[user.admin_role];
  if (!role) throw new AppError('NOT_ADMIN', 'هذا الحساب ليس له صلاحية دخول لوحة الإدارة', 403);
  if (!role.perms.includes('*') && !role.perms.includes(perm)) throw E.FORBIDDEN();
  return user;
}

const isOwnerPhone = (phone) => config.adminPhones.some((p) => { try { return normalizeJordanPhone(p) === phone; } catch { return false; } });

function reasonOf(body, min = 3) {
  const r = str(body.reason, { min, max: 300, field: 'السبب' });
  return r;
}

async function audit(admin, action, entity, entityId, before, after, reason, ip) {
  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity, entity_id, before_json, after_json, reason, ip, created_at)
     VALUES ($1,'admin',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [uuid(), admin.id, action, entity, entityId, before ? JSON.stringify(before) : null,
     after ? JSON.stringify(after) : null, reason || null, ip || null, nowIso()]
  );
}

const q = (req) => new URL(req.url, 'http://x').searchParams;
const like = (s) => '%' + String(s || '').trim().toLowerCase().replace(/[%_]/g, '') + '%';
const page = (req) => Math.max(0, parseInt(q(req).get('page') || '0', 10) || 0);
const PAGE = 50;
const fmt = (f) => money.format(Number(f || 0));

/* ================================== أنا ================================== */
async function me(req, res, ctx) {
  const u = await requireAdmin(ctx);
  const role = ROLES[u.admin_role];
  return ok(res, {
    user: authService.publicUser(u),
    role: u.admin_role, roleLabel: role.label, perms: role.perms,
    isOwner: isOwnerPhone(u.phone_e164),
    roles: Object.entries(ROLES).map(([k, v]) => ({ key: k, label: v.label })),
  });
}

/* ============================== لوحة القيادة ============================== */
async function dashboard(req, res, ctx) {
  await requireAdmin(ctx);
  const today = ammanDayStart(0);
  const week = ammanDayStart(6);
  const staleSec = await settings.get('dispatch.stale_location_sec');
  const fresh = new Date(Date.now() - staleSec * 1000).toISOString();
  const n = async (sql, p = []) => Number((await db.one(sql, p)).n);

  const t = await db.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(gross_fare_fils),0) AS gross, COALESCE(SUM(commission_fils),0) AS comm
       FROM trips WHERE status = 'TRIP_COMPLETED' AND completed_at >= $1`, [today]);

  const k = {
    completedToday: Number(t.n),
    grossToday: Number(t.gross),
    commissionToday: Number(t.comm),
    cancelledToday: await n(`SELECT COUNT(*) AS n FROM trips WHERE status LIKE 'CANCELLED%' AND cancelled_at >= $1`, [today]),
    noDriverToday: await n(`SELECT COUNT(*) AS n FROM trips WHERE status = 'NO_DRIVER_FOUND' AND updated_at >= $1`, [today]),
    searchingNow: await n(`SELECT COUNT(*) AS n FROM trips WHERE status IN ('REQUESTED','SEARCHING')`),
    activeNow: await n(`SELECT COUNT(*) AS n FROM trips WHERE status IN ('DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')`),
    onlineCaptains: await n(`SELECT COUNT(*) AS n FROM captains c JOIN driver_locations dl ON dl.captain_id = c.id
                              WHERE c.is_online = 1 AND c.status = 'APPROVED' AND dl.updated_at > $1`, [fresh]),
    approvedCaptains: await n(`SELECT COUNT(*) AS n FROM captains WHERE status = 'APPROVED'`),
    pendingCaptains: await n(`SELECT COUNT(*) AS n FROM captains WHERE status = 'PENDING'`),
    pendingDeposits: await n(`SELECT COUNT(*) AS n FROM deposit_requests WHERE status = 'PENDING_REVIEW'`),
    customers: await n(`SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM captains c WHERE c.user_id = u.id)`),
    newCustomersToday: await n(`SELECT COUNT(*) AS n FROM users u WHERE created_at >= $1
                                  AND NOT EXISTS (SELECT 1 FROM captains c WHERE c.user_id = u.id)`, [today]),
  };

  // آخر 7 أيام — مجمّعة بتوقيت عمّان
  const rows = await db.query(
    `SELECT completed_at, gross_fare_fils, commission_fils FROM trips WHERE status = 'TRIP_COMPLETED' AND completed_at >= $1`, [week]);
  const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.parse(ammanDayStart(i)) + 3 * 3600 * 1000);
    days.push({ key: dayKey(d.toISOString()), trips: 0, grossFils: 0, commissionFils: 0 });
  }
  for (const r of rows) {
    const day = days.find((x) => x.key === dayKey(r.completed_at));
    if (day) { day.trips++; day.grossFils += Number(r.gross_fare_fils); day.commissionFils += Number(r.commission_fils); }
  }

  const recent = await db.query(
    `SELECT t.id, t.code, t.status, t.est_fare_fils, t.gross_fare_fils, t.pickup_address, t.dest_address, t.requested_at,
            u.name AS customer_name
       FROM trips t JOIN users u ON u.id = t.customer_id ORDER BY t.requested_at DESC LIMIT 8`);

  return ok(res, {
    kpis: { ...k, grossTodayText: fmt(k.grossToday), commissionTodayText: fmt(k.commissionToday) },
    days,
    recent: recent.map(tripRow),
  });
}

/* ============================== الخريطة الحية ============================== */
async function live(req, res, ctx) {
  await requireAdmin(ctx);
  const staleSec = await settings.get('dispatch.stale_location_sec');
  const fresh = new Date(Date.now() - staleSec * 1000).toISOString();
  const captains = await db.query(
    `SELECT c.id, u.name, v.plate_number, dl.lat, dl.lng, dl.heading, dl.updated_at,
            EXISTS (SELECT 1 FROM trips t WHERE t.captain_id = c.id AND t.status IN
              ('DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')) AS busy
       FROM captains c JOIN users u ON u.id = c.user_id
       JOIN driver_locations dl ON dl.captain_id = c.id
       LEFT JOIN vehicles v ON v.captain_id = c.id AND v.is_active = 1
      WHERE c.is_online = 1 AND c.status = 'APPROVED' AND dl.updated_at > $1`, [fresh]);
  const trips = await db.query(
    `SELECT id, code, status, pickup_lat, pickup_lng, dest_lat, dest_lng, captain_id FROM trips
      WHERE status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')`);
  return ok(res, {
    captains: captains.map((c) => ({ id: c.id, name: c.name, plate: c.plate_number, lat: c.lat, lng: c.lng, heading: c.heading, busy: Boolean(Number(c.busy)) })),
    trips: trips.map((t) => ({ id: t.id, code: t.code, status: t.status, statusLabel: S.LABEL_AR[t.status],
      pickup: { lat: t.pickup_lat, lng: t.pickup_lng }, destination: { lat: t.dest_lat, lng: t.dest_lng } })),
  });
}

/* ================================== الرحلات ================================== */
function tripRow(t) {
  const fare = t.gross_fare_fils ?? t.est_fare_fils;
  return {
    id: t.id, code: t.code, status: t.status, statusLabel: S.LABEL_AR[t.status] || t.status,
    isActive: S.isActive(t.status), fareText: fmt(fare),
    pickupAddress: t.pickup_address, destAddress: t.dest_address,
    customerName: t.customer_name, customerPhone: t.customer_phone, captainName: t.captain_name,
    requestedAt: t.requested_at,
  };
}

async function trips(req, res, ctx) {
  await requireAdmin(ctx);
  const p = q(req);
  const where = [], params = [];
  const status = p.get('status');
  if (status === 'active') where.push(`t.status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')`);
  else if (status === 'cancelled') where.push(`(t.status LIKE 'CANCELLED%' OR t.status = 'NO_DRIVER_FOUND')`);
  else if (status === 'completed') where.push(`t.status = 'TRIP_COMPLETED'`);
  if (p.get('q')) {
    params.push(like(p.get('q')));
    const i = params.length;
    where.push(`(LOWER(t.code) LIKE $${i} OR LOWER(COALESCE(u.name,'')) LIKE $${i} OR u.phone_e164 LIKE $${i}
               OR LOWER(COALESCE(cu.name,'')) LIKE $${i} OR cu.phone_e164 LIKE $${i})`);
  }
  params.push(PAGE + 1, page(req) * PAGE);
  const rows = await db.query(
    `SELECT t.*, u.name AS customer_name, u.phone_e164 AS customer_phone, cu.name AS captain_name
       FROM trips t JOIN users u ON u.id = t.customer_id
       LEFT JOIN captains c ON c.id = t.captain_id LEFT JOIN users cu ON cu.id = c.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.requested_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return ok(res, { trips: rows.slice(0, PAGE).map(tripRow), hasMore: rows.length > PAGE });
}

async function tripDetail(req, res, ctx, params) {
  await requireAdmin(ctx);
  const t = await db.one('SELECT * FROM trips WHERE id = $1', [params.id]);
  if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
  const cust = await db.one('SELECT id, name, phone_e164 FROM users WHERE id = $1', [t.customer_id]);
  const cap = t.captain_id ? await db.one(
    `SELECT c.id, u.name, u.phone_e164, v.plate_number, v.make, v.model FROM captains c JOIN users u ON u.id = c.user_id
       LEFT JOIN vehicles v ON v.captain_id = c.id AND v.is_active = 1 WHERE c.id = $1`, [t.captain_id]) : null;
  const hist = await db.query('SELECT * FROM trip_status_history WHERE trip_id = $1 ORDER BY created_at', [t.id]);
  const offers = await db.query(
    `SELECT o.status, o.eta_s, o.distance_m, o.sent_at, o.responded_at, u.name FROM trip_offers o
       JOIN captains c ON c.id = o.captain_id JOIN users u ON u.id = c.user_id WHERE o.trip_id = $1 ORDER BY o.sent_at`, [t.id]);
  return ok(res, {
    trip: {
      ...tripRow({ ...t, customer_name: cust && cust.name, customer_phone: cust && cust.phone_e164, captain_name: cap && cap.name }),
      pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
      destination: { lat: t.dest_lat, lng: t.dest_lng, address: t.dest_address },
      customer: cust && { id: cust.id, name: cust.name, phone: cust.phone_e164 },
      captain: cap && { id: cap.id, name: cap.name, phone: cap.phone_e164, plate: cap.plate_number, car: [cap.make, cap.model].filter(Boolean).join(' ') },
      money: {
        estText: fmt(t.est_fare_fils), grossText: t.gross_fare_fils == null ? null : fmt(t.gross_fare_fils),
        commissionText: t.commission_fils == null ? null : fmt(t.commission_fils),
        earningsText: t.captain_earnings_fils == null ? null : fmt(t.captain_earnings_fils),
        waitingText: fmt(t.waiting_fee_fils || 0), cancelFeeText: fmt(t.cancellation_fee_fils || 0),
      },
      distanceKm: ((t.final_distance_m ?? t.est_distance_m) / 1000).toFixed(1),
      odometerKm: ((t.odometer_m || 0) / 1000).toFixed(1),
      cancelReason: t.cancel_reason, cancelledBy: t.cancelled_by,
      history: hist.map((h) => ({ to: h.to_status, label: S.LABEL_AR[h.to_status] || h.to_status, actor: h.actor_type, note: h.note, at: h.created_at })),
      offers: offers.map((o) => ({ captain: o.name, status: o.status, etaMin: Math.round((o.eta_s || 0) / 60), distanceKm: ((o.distance_m || 0) / 1000).toFixed(1), sentAt: o.sent_at })),
    },
  });
}

async function cancelTrip(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'trips.manage');
  const body = await parseJson(req);
  const reason = reasonOf(body);
  const before = await db.transaction(async (tx) => {
    const t = await tx.one('SELECT * FROM trips WHERE id = $1' + db.forUpdate(), [params.id]);
    if (!t) throw E.NOT_FOUND('الرحلة غير موجودة');
    if (!S.isActive(t.status)) throw E.TRIP_INVALID_TRANSITION();
    const now = nowIso();
    await tx.query(
      `UPDATE trips SET status = 'CANCELLED_BY_SYSTEM', cancelled_at = $1, updated_at = $1, cancelled_by = 'admin', cancel_reason = $2
        WHERE id = $3`, [now, reason, t.id]);
    await tx.query(
      `INSERT INTO trip_status_history (id, trip_id, from_status, to_status, actor_type, actor_id, note, created_at)
       VALUES ($1,$2,$3,'CANCELLED_BY_SYSTEM','admin',$4,$5,$6)`, [uuid(), t.id, t.status, admin.id, reason, now]);
    await tx.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE trip_id = $1 AND status = 'SENT'`, [t.id]);
    return { status: t.status };
  });
  await audit(admin, 'TRIP_CANCELLED', 'trip', params.id, before, { status: 'CANCELLED_BY_SYSTEM' }, reason, ctx.ip);
  return ok(res, {});
}

/* ================================== الكباتن ================================== */
async function captains(req, res, ctx) {
  await requireAdmin(ctx);
  const p = q(req);
  const where = [], params = [];
  if (p.get('status')) { params.push(p.get('status')); where.push(`c.status = $${params.length}`); }
  if (p.get('q')) {
    params.push(like(p.get('q')));
    const i = params.length;
    where.push(`(LOWER(COALESCE(u.name,'')) LIKE $${i} OR u.phone_e164 LIKE $${i} OR LOWER(COALESCE(v.plate_number,'')) LIKE $${i})`);
  }
  params.push(PAGE + 1, page(req) * PAGE);
  const rows = await db.query(
    `SELECT c.*, u.name, u.phone_e164, u.photo_url, v.plate_number, v.make, v.model, COALESCE(w.balance_fils, 0) AS balance,
            (SELECT COUNT(*) FROM captain_documents d WHERE d.captain_id = c.id) AS docs
       FROM captains c JOIN users u ON u.id = c.user_id
       LEFT JOIN vehicles v ON v.captain_id = c.id AND v.is_active = 1
       LEFT JOIN wallets w ON w.captain_id = c.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE WHEN c.status = 'PENDING' THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return ok(res, {
    captains: rows.slice(0, PAGE).map((c) => ({
      id: c.id, name: c.name, phone: c.phone_e164, photoUrl: c.photo_url, status: c.status,
      isOnline: Boolean(c.is_online), plate: c.plate_number, car: [c.make, c.model].filter(Boolean).join(' '),
      balanceFils: Number(c.balance), balanceText: fmt(c.balance), trips: c.trips_completed,
      rating: c.rating_count ? Number((c.rating_sum / c.rating_count).toFixed(2)) : null,
      docs: Number(c.docs), createdAt: c.created_at,
    })),
    hasMore: rows.length > PAGE,
  });
}

async function captainDetail(req, res, ctx, params) {
  await requireAdmin(ctx);
  const c = await db.one(
    `SELECT c.*, u.name, u.phone_e164, u.photo_url, u.status AS user_status FROM captains c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [params.id]);
  if (!c) throw E.NOT_FOUND('الكابتن غير موجود');
  const v = await db.one(
    `SELECT v.*, vt.name_ar FROM vehicles v JOIN vehicle_types vt ON vt.id = v.vehicle_type_id WHERE v.captain_id = $1 AND v.is_active = 1`, [c.id]);
  const docs = await db.query('SELECT * FROM captain_documents WHERE captain_id = $1 ORDER BY created_at DESC', [c.id]);
  const bal = await wallet.balance(c.id);
  const txs = await db.query(
    `SELECT * FROM wallet_transactions WHERE captain_id = $1 ORDER BY created_at DESC LIMIT 30`, [c.id]);
  const recent = await db.query(
    `SELECT t.*, u.name AS customer_name FROM trips t JOIN users u ON u.id = t.customer_id
      WHERE t.captain_id = $1 ORDER BY t.requested_at DESC LIMIT 10`, [c.id]);
  const loc = await db.one('SELECT lat, lng, updated_at FROM driver_locations WHERE captain_id = $1', [c.id]);
  return ok(res, {
    captain: {
      id: c.id, userId: c.user_id, name: c.name, phone: c.phone_e164, photoUrl: c.photo_url,
      status: c.status, statusReason: c.status_reason, isOnline: Boolean(c.is_online),
      trips: c.trips_completed, cancellations: c.cancellations,
      acceptanceRate: c.offers_sent ? Math.round((c.offers_accepted / c.offers_sent) * 100) : null,
      rating: c.rating_count ? Number((c.rating_sum / c.rating_count).toFixed(2)) : null, ratingCount: c.rating_count,
      createdAt: c.created_at, approvedAt: c.approved_at,
      location: loc ? { lat: loc.lat, lng: loc.lng, updatedAt: loc.updated_at } : null,
      vehicle: v && { type: v.name_ar, make: v.make, model: v.model, color: v.color, year: v.year, plate: v.plate_number },
      documents: docs.map((d) => ({ id: d.id, kind: d.kind, status: d.status, fileId: d.file_name, createdAt: d.created_at })),
      wallet: {
        balanceFils: bal, balanceText: fmt(bal),
        transactions: txs.map((t) => ({ id: t.id, type: t.transaction_type, amountFils: Number(t.amount_fils), amountText: fmt(t.amount_fils),
          balanceAfterText: fmt(t.balance_after), description: t.description, createdAt: t.created_at, createdBy: t.created_by })),
      },
      recentTrips: recent.map(tripRow),
    },
  });
}

const CAPTAIN_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED'];

async function captainStatus(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'captains.manage');
  const body = await parseJson(req);
  const status = body.status;
  if (!CAPTAIN_STATUSES.includes(status)) throw E.VALIDATION_FAILED('حالة غير صحيحة');
  const reason = status === 'APPROVED' ? str(body.reason, { max: 300, field: 'السبب', required: false }) : reasonOf(body);
  const c = await db.one('SELECT * FROM captains WHERE id = $1', [params.id]);
  if (!c) throw E.NOT_FOUND('الكابتن غير موجود');
  if (status !== 'APPROVED') {
    const busy = await db.one(
      `SELECT id FROM trips WHERE captain_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','TRIP_STARTED')`, [c.id]);
    if (busy) throw E.VALIDATION_FAILED('الكابتن برحلة نشطة الآن. انتظر انتهاءها أو ألغِ الرحلة أولاً');
  }
  const now = nowIso();
  await db.query(
    `UPDATE captains SET status = $1, status_reason = $2, updated_at = $3,
            approved_at = CASE WHEN $4 = 1 THEN $3 ELSE approved_at END,
            is_online = CASE WHEN $4 = 1 THEN is_online ELSE 0 END
      WHERE id = $5`,
    [status, reason || null, now, status === 'APPROVED' ? 1 : 0, c.id]);
  if (status !== 'APPROVED') await db.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE captain_id = $1 AND status = 'SENT'`, [c.id]);
  await audit(admin, 'CAPTAIN_STATUS', 'captain', c.id, { status: c.status }, { status }, reason, ctx.ip);
  return ok(res, { status });
}

async function captainOffline(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'captains.manage');
  await db.query('UPDATE captains SET is_online = 0, updated_at = $1 WHERE id = $2', [nowIso(), params.id]);
  await db.query(`UPDATE trip_offers SET status = 'EXPIRED' WHERE captain_id = $1 AND status = 'SENT'`, [params.id]);
  await audit(admin, 'CAPTAIN_FORCED_OFFLINE', 'captain', params.id, null, { isOnline: false }, null, ctx.ip);
  return ok(res, {});
}

async function documentReview(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'captains.manage');
  const body = await parseJson(req);
  if (!['APPROVED', 'REJECTED'].includes(body.status)) throw E.VALIDATION_FAILED('حالة غير صحيحة');
  const d = await db.one('SELECT * FROM captain_documents WHERE id = $1', [params.id]);
  if (!d) throw E.NOT_FOUND('الوثيقة غير موجودة');
  await db.query('UPDATE captain_documents SET status = $1, reviewed_by = $2, reviewed_at = $3 WHERE id = $4',
    [body.status, admin.id, nowIso(), d.id]);
  await audit(admin, 'DOCUMENT_REVIEW', 'captain_document', d.id, { status: d.status }, { status: body.status }, null, ctx.ip);
  return ok(res, {});
}

async function fileView(req, res, ctx, params) {
  await requireAdmin(ctx);
  const f = await files.get(params.id);
  if (!f) throw E.NOT_FOUND('الملف غير متوفر');
  files.send(res, f);
}

const ADJUST_TYPES = { ADJUSTMENT: 'تعديل', BONUS: 'مكافأة', CORRECTION: 'تصحيح', REFUND: 'استرجاع' };

async function walletAdjust(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'finance');
  const body = await parseJson(req);
  const amount = Number(body.amountFils);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 500000) throw E.VALIDATION_FAILED('المبلغ غير صحيح (حد أقصى 500 دينار)');
  const type = ADJUST_TYPES[body.type] ? body.type : 'ADJUSTMENT';
  const reason = reasonOf(body);
  const requestId = str(body.requestId, { min: 8, max: 64, field: 'معرّف الطلب' });
  const c = await db.one('SELECT id FROM captains WHERE id = $1', [params.id]);
  if (!c) throw E.NOT_FOUND('الكابتن غير موجود');
  const r = await db.transaction((tx) => wallet.post(tx, {
    captainId: c.id, type, amountFils: amount, referenceId: null,
    idempotencyKey: 'admin:' + requestId, description: `${ADJUST_TYPES[type]}: ${reason}`, createdBy: admin.id,
  }));
  if (!r.duplicate) {
    await audit(admin, 'WALLET_' + type, 'captain', c.id,
      { balanceFils: Number(r.tx.balance_before) }, { balanceFils: Number(r.tx.balance_after), amountFils: amount }, reason, ctx.ip);
  }
  return ok(res, { transactionId: r.tx.id, balanceText: fmt(r.tx.balance_after), duplicate: r.duplicate });
}

/* ================================== الإيداعات ================================== */
async function deposits(req, res, ctx) {
  await requireAdmin(ctx);
  const status = q(req).get('status') || 'PENDING_REVIEW';
  const rows = await db.query(
    `SELECT d.*, u.name, u.phone_e164, COALESCE(w.balance_fils, 0) AS balance, ru.name AS reviewer
       FROM deposit_requests d JOIN captains c ON c.id = d.captain_id JOIN users u ON u.id = c.user_id
       LEFT JOIN wallets w ON w.captain_id = c.id LEFT JOIN users ru ON ru.id = d.reviewed_by
      WHERE d.status = $1 ORDER BY d.created_at ${status === 'PENDING_REVIEW' ? 'ASC' : 'DESC'} LIMIT 100`, [status]);
  return ok(res, {
    deposits: rows.map((d) => ({
      id: d.id, captainId: d.captain_id, captainName: d.name, captainPhone: d.phone_e164,
      amountFils: Number(d.amount_fils), amountText: fmt(d.amount_fils), balanceText: fmt(d.balance),
      proofId: d.proof_url, status: d.status, rejectReason: d.reject_reason, reviewer: d.reviewer,
      reviewedAt: d.reviewed_at, createdAt: d.created_at,
    })),
  });
}

async function depositApprove(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'finance');
  const result = await db.transaction(async (tx) => {
    const d = await tx.one('SELECT * FROM deposit_requests WHERE id = $1' + db.forUpdate(), [params.id]);
    if (!d) throw E.NOT_FOUND('الطلب غير موجود');
    if (d.status === 'APPROVED') return { duplicate: true };
    if (d.status !== 'PENDING_REVIEW') throw new AppError('WALLET_DEPOSIT_NOT_PENDING', 'هذا الطلب تمت مراجعته مسبقاً', 409);
    const r = await wallet.post(tx, {
      captainId: d.captain_id, type: 'DEPOSIT', amountFils: Number(d.amount_fils), referenceId: d.id,
      idempotencyKey: 'deposit:' + d.id, description: 'شحن رصيد عبر CliQ', createdBy: admin.id,
    });
    await tx.query(`UPDATE deposit_requests SET status = 'APPROVED', reviewed_by = $1, reviewed_at = $2 WHERE id = $3`,
      [admin.id, nowIso(), d.id]);
    return { duplicate: false, d, tx: r.tx };
  });
  if (!result.duplicate) {
    await audit(admin, 'DEPOSIT_APPROVED', 'deposit_request', params.id,
      { balanceFils: Number(result.tx.balance_before) }, { balanceFils: Number(result.tx.balance_after), amountFils: Number(result.d.amount_fils) }, null, ctx.ip);
  }
  return ok(res, { duplicate: result.duplicate, transactionId: result.tx && result.tx.id });
}

async function depositReject(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'finance');
  const body = await parseJson(req);
  const reason = reasonOf(body);
  const d = await db.one('SELECT * FROM deposit_requests WHERE id = $1', [params.id]);
  if (!d) throw E.NOT_FOUND('الطلب غير موجود');
  if (d.status !== 'PENDING_REVIEW') throw new AppError('WALLET_DEPOSIT_NOT_PENDING', 'هذا الطلب تمت مراجعته مسبقاً', 409);
  await db.query(
    `UPDATE deposit_requests SET status = 'REJECTED', reject_reason = $1, reviewed_by = $2, reviewed_at = $3
      WHERE id = $4 AND status = 'PENDING_REVIEW'`, [reason, admin.id, nowIso(), d.id]);
  await audit(admin, 'DEPOSIT_REJECTED', 'deposit_request', d.id, { status: d.status }, { status: 'REJECTED' }, reason, ctx.ip);
  return ok(res, {});
}

/* ================================== العملاء ================================== */
async function customers(req, res, ctx) {
  await requireAdmin(ctx);
  const p = q(req);
  const where = ['NOT EXISTS (SELECT 1 FROM captains c WHERE c.user_id = u.id)'], params = [];
  if (p.get('status')) { params.push(p.get('status')); where.push(`u.status = $${params.length}`); }
  if (p.get('q')) {
    params.push(like(p.get('q')));
    where.push(`(LOWER(COALESCE(u.name,'')) LIKE $${params.length} OR u.phone_e164 LIKE $${params.length})`);
  }
  params.push(PAGE + 1, page(req) * PAGE);
  const rows = await db.query(
    `SELECT u.*, COALESCE(r.trips, 0) AS trips, COALESCE(r.cancellations, 0) AS cancels, COALESCE(r.level, 'NORMAL') AS risk
       FROM users u LEFT JOIN risk_scores r ON r.user_id = u.id
      WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return ok(res, {
    customers: rows.slice(0, PAGE).map((u) => ({
      id: u.id, name: u.name, phone: u.phone_e164, photoUrl: u.photo_url, status: u.status,
      trips: Number(u.trips), cancellations: Number(u.cancels), risk: u.risk, adminRole: u.admin_role,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
    })),
    hasMore: rows.length > PAGE,
  });
}

async function customerDetail(req, res, ctx, params) {
  await requireAdmin(ctx);
  const u = await db.one('SELECT * FROM users WHERE id = $1', [params.id]);
  if (!u) throw E.NOT_FOUND('الحساب غير موجود');
  const r = await db.one('SELECT * FROM risk_scores WHERE user_id = $1', [u.id]);
  const t = await db.query(
    `SELECT t.*, cu.name AS captain_name FROM trips t LEFT JOIN captains c ON c.id = t.captain_id
       LEFT JOIN users cu ON cu.id = c.user_id WHERE t.customer_id = $1 ORDER BY t.requested_at DESC LIMIT 20`, [u.id]);
  const totals = await db.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(gross_fare_fils),0) AS spent FROM trips WHERE customer_id = $1 AND status = 'TRIP_COMPLETED'`, [u.id]);
  return ok(res, {
    customer: {
      id: u.id, name: u.name, phone: u.phone_e164, email: u.email, photoUrl: u.photo_url,
      status: u.status, statusReason: u.status_reason, adminRole: u.admin_role,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
      completedTrips: Number(totals.n), spentText: fmt(totals.spent),
      cancellations: r ? r.cancellations : 0, risk: r ? r.level : 'NORMAL',
      trips: t.map((x) => ({ ...tripRow(x), captainName: x.captain_name })),
    },
  });
}

async function customerStatus(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'customers.manage');
  const body = await parseJson(req);
  if (!['ACTIVE', 'SUSPENDED', 'BLOCKED'].includes(body.status)) throw E.VALIDATION_FAILED('حالة غير صحيحة');
  const reason = body.status === 'ACTIVE' ? str(body.reason, { max: 300, field: 'السبب', required: false }) : reasonOf(body);
  const u = await db.one('SELECT * FROM users WHERE id = $1', [params.id]);
  if (!u) throw E.NOT_FOUND('الحساب غير موجود');
  if (u.id === admin.id) throw E.VALIDATION_FAILED('ما بتقدر توقف حسابك أنت');
  if (isOwnerPhone(u.phone_e164)) throw E.VALIDATION_FAILED('ما بينفع إيقاف حساب المالك');
  await db.query('UPDATE users SET status = $1, status_reason = $2, updated_at = $3 WHERE id = $4',
    [body.status, reason || null, nowIso(), u.id]);
  if (body.status !== 'ACTIVE') await db.query('UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL', [nowIso(), u.id]);
  await audit(admin, 'USER_STATUS', 'user', u.id, { status: u.status }, { status: body.status }, reason, ctx.ip);
  return ok(res, {});
}

/* ================================== التسعير ================================== */
async function pricingList(req, res, ctx) {
  await requireAdmin(ctx);
  const rows = await db.query(
    `SELECT p.*, c.name_ar AS city, c.code AS city_code, c.is_active AS city_active, vt.name_ar AS vehicle, vt.sort_order
       FROM pricing_rules p LEFT JOIN cities c ON c.id = p.city_id LEFT JOIN vehicle_types vt ON vt.id = p.vehicle_type_id
      ORDER BY c.created_at, vt.sort_order`);
  return ok(res, {
    commissionBp: await settings.get('platform.commission_bp'),
    rules: rows.map((r) => ({
      id: r.id, city: r.city, cityCode: r.city_code, cityActive: Boolean(r.city_active), vehicle: r.vehicle,
      baseFils: r.base_fare_fils, perKmFils: r.per_km_fils, perMinFils: r.per_min_fils, minFils: r.min_fare_fils,
      waitingPerMinFils: r.waiting_per_min_fils, freeWaitingSec: r.free_waiting_sec,
      cancelFils: r.cancellation_fee_fils, peakBp: r.peak_multiplier_bp, isActive: Boolean(r.is_active), updatedAt: r.updated_at,
    })),
  });
}

const PRICE_FIELDS = {
  baseFils: ['base_fare_fils', 0, 20000], perKmFils: ['per_km_fils', 0, 5000], perMinFils: ['per_min_fils', 0, 2000],
  minFils: ['min_fare_fils', 0, 50000], waitingPerMinFils: ['waiting_per_min_fils', 0, 2000],
  freeWaitingSec: ['free_waiting_sec', 0, 1800], cancelFils: ['cancellation_fee_fils', 0, 20000], peakBp: ['peak_multiplier_bp', 5000, 30000],
};

async function pricingUpdate(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'pricing');
  const body = await parseJson(req);
  const reason = reasonOf(body);
  const r = await db.one('SELECT * FROM pricing_rules WHERE id = $1', [params.id]);
  if (!r) throw E.NOT_FOUND('قاعدة التسعير غير موجودة');
  const sets = [], vals = [], before = {}, after = {};
  for (const [k, [col, lo, hi]] of Object.entries(PRICE_FIELDS)) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) throw E.VALIDATION_FAILED(`قيمة غير صحيحة: ${k}`);
    if (v === r[col]) continue;
    vals.push(v); sets.push(`${col} = $${vals.length}`); before[k] = r[col]; after[k] = v;
  }
  if (!sets.length) return ok(res, { changed: false });
  vals.push(nowIso()); sets.push(`updated_at = $${vals.length}`);
  vals.push(r.id);
  await db.query(`UPDATE pricing_rules SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  await audit(admin, 'PRICING_UPDATED', 'pricing_rule', r.id, before, after, reason, ctx.ip);
  return ok(res, { changed: true });
}

/* ================================== الإعدادات ================================== */
async function settingsList(req, res, ctx) {
  await requireAdmin(ctx);
  const rows = await db.query('SELECT * FROM settings ORDER BY key');
  const cities = await db.query('SELECT * FROM cities ORDER BY created_at');
  return ok(res, {
    settings: rows.map((s) => ({ key: s.key, value: s.value, type: s.value_type, label: s.label_ar, updatedAt: s.updated_at })),
    cities: cities.map((c) => ({ id: c.id, code: c.code, name: c.name_ar, radiusKm: c.radius_km, isActive: Boolean(c.is_active),
      envManaged: c.code === 'jordan' })),
  });
}

const SETTING_LIMITS = {
  'platform.commission_bp': [0, 3000], 'wallet.min_balance_fils': [-100000, 0],
  'dispatch.offer_timeout_sec': [5, 60], 'dispatch.search_timeout_sec': [30, 600],
  'dispatch.initial_radius_m': [500, 20000], 'dispatch.max_radius_m': [1000, 60000], 'dispatch.batch_size': [1, 10],
  'dispatch.stale_location_sec': [20, 300], 'cancel.free_window_sec': [0, 1800], 'trip.max_distance_km': [5, 500],
  'captain.arrive_max_distance_m': [50, 2000], 'fare.recalc_threshold_bp': [10000, 30000],
};

async function settingUpdate(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'settings');
  const body = await parseJson(req);
  const reason = reasonOf(body);
  const s = await db.one('SELECT * FROM settings WHERE key = $1', [params.key]);
  if (!s) throw E.NOT_FOUND('الإعداد غير موجود');
  let value = body.value;
  if (s.value_type === 'int') {
    value = Number(value);
    if (!Number.isInteger(value)) throw E.VALIDATION_FAILED('القيمة لازم تكون رقم صحيح');
    const lim = SETTING_LIMITS[s.key];
    if (lim && (value < lim[0] || value > lim[1])) throw E.VALIDATION_FAILED(`القيمة لازم تكون بين ${lim[0]} و ${lim[1]}`);
    value = String(value);
  } else if (s.value_type === 'bool') {
    value = value === true || value === '1' || value === 1 ? '1' : '0';
  } else {
    value = str(value, { max: 120, field: 'القيمة', required: false }) || '';
  }
  if (value === s.value) return ok(res, { changed: false });
  await db.query('UPDATE settings SET value = $1, updated_at = $2, updated_by = $3 WHERE key = $4', [value, nowIso(), admin.id, s.key]);
  settings.invalidate();
  await audit(admin, 'SETTING_UPDATED', 'setting', s.key, { value: s.value }, { value }, reason, ctx.ip);
  return ok(res, { changed: true });
}

async function cityUpdate(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'settings');
  const body = await parseJson(req);
  const c = await db.one('SELECT * FROM cities WHERE id = $1', [params.id]);
  if (!c) throw E.NOT_FOUND('المنطقة غير موجودة');
  if (c.code === 'jordan') throw E.VALIDATION_FAILED('منطقة «كل الأردن» يتحكم فيها إعداد SERVICE_ALL_JORDAN في Render');
  const active = Boolean(body.isActive);
  await db.query('UPDATE cities SET is_active = $1 WHERE id = $2', [active ? 1 : 0, c.id]);
  await audit(admin, 'CITY_UPDATED', 'city', c.id, { isActive: Boolean(c.is_active) }, { isActive: active }, null, ctx.ip);
  return ok(res, {});
}

/* ================================== المشرفون ================================== */
async function admins(req, res, ctx) {
  await requireAdmin(ctx, 'admins');
  const rows = await db.query(`SELECT * FROM users WHERE admin_role IS NOT NULL ORDER BY created_at`);
  return ok(res, {
    admins: rows.map((u) => ({ id: u.id, name: u.name, phone: u.phone_e164, role: u.admin_role,
      roleLabel: (ROLES[u.admin_role] || {}).label, isOwner: isOwnerPhone(u.phone_e164), lastLoginAt: u.last_login_at })),
  });
}

async function adminAdd(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'admins');
  const body = await parseJson(req);
  const phone = normalizeJordanPhone(body.phone);
  if (!ROLES[body.role]) throw E.VALIDATION_FAILED('الدور غير صحيح');
  let u = await db.one('SELECT * FROM users WHERE phone_e164 = $1', [phone]);
  if (!u) u = (await authService.findOrCreateUser(phone, null)).user;
  if (body.name && !u.name) await db.query('UPDATE users SET name = $1 WHERE id = $2', [str(body.name, { max: 60, field: 'الاسم' }), u.id]);
  await db.query('UPDATE users SET admin_role = $1, updated_at = $2 WHERE id = $3', [body.role, nowIso(), u.id]);
  await audit(admin, 'ADMIN_GRANTED', 'user', u.id, { role: u.admin_role }, { role: body.role }, null, ctx.ip);
  return created(res, {});
}

async function adminRemove(req, res, ctx, params) {
  const admin = await requireAdmin(ctx, 'admins');
  const u = await db.one('SELECT * FROM users WHERE id = $1', [params.id]);
  if (!u) throw E.NOT_FOUND('الحساب غير موجود');
  if (u.id === admin.id) throw E.VALIDATION_FAILED('ما بتقدر تشيل صلاحيتك أنت');
  if (isOwnerPhone(u.phone_e164)) throw E.VALIDATION_FAILED('هذا رقم المالك (ADMIN_PHONES) — صلاحيته ثابتة');
  await db.query('UPDATE users SET admin_role = NULL, updated_at = $1 WHERE id = $2', [nowIso(), u.id]);
  await audit(admin, 'ADMIN_REVOKED', 'user', u.id, { role: u.admin_role }, { role: null }, null, ctx.ip);
  return ok(res, {});
}

/* ================================== واتساب ================================== */
const whatsapp = require('../services/whatsapp');
const otpService = require('../services/otp');

async function whatsappStatus(req, res, ctx) {
  await requireAdmin(ctx, 'settings');
  return ok(res, await whatsapp.status());
}

async function whatsappTemplate(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'settings');
  const r = await whatsapp.createTemplate();
  await audit(admin, 'WHATSAPP_TEMPLATE', 'setting', config.sms.whatsapp.template, null,
    { ok: r.ok, status: r.status || (r.exists ? 'EXISTS' : null), error: r.error ? `${r.error.code || ''} ${r.error.message || ''}`.trim() : null }, null, ctx.ip);
  return ok(res, r);
}

async function whatsappTest(req, res, ctx) {
  const admin = await requireAdmin(ctx, 'settings');
  const body = await parseJson(req);
  const phone = body.phone ? normalizeJordanPhone(body.phone) : admin.phone_e164;
  const r = await whatsapp.sendTest(phone, otpService.generateCode(config.otp.length));
  await audit(admin, 'WHATSAPP_TEST', 'user', admin.id, null, { to: phone, ok: r.ok, error: r.error ? r.error.code : null }, null, ctx.ip);
  return ok(res, { ...r, to: phone });
}

/* ================================== السجل ================================== */
const ACTION_LABEL = {
  TRIP_CANCELLED: 'إلغاء رحلة', CAPTAIN_STATUS: 'تغيير حالة كابتن', CAPTAIN_FORCED_OFFLINE: 'فصل كابتن',
  DOCUMENT_REVIEW: 'مراجعة وثيقة', WALLET_ADJUSTMENT: 'تعديل محفظة', WALLET_BONUS: 'مكافأة', WALLET_CORRECTION: 'تصحيح محفظة',
  WALLET_REFUND: 'استرجاع', DEPOSIT_APPROVED: 'موافقة شحن', DEPOSIT_REJECTED: 'رفض شحن', USER_STATUS: 'تغيير حالة حساب',
  PRICING_UPDATED: 'تعديل أسعار', SETTING_UPDATED: 'تعديل إعداد', CITY_UPDATED: 'تعديل منطقة', ADMIN_GRANTED: 'إضافة مشرف',
  ADMIN_REVOKED: 'إزالة مشرف', CAPTAIN_REGISTERED: 'تسجيل كابتن', DEPOSIT_REQUESTED: 'طلب شحن',
  WHATSAPP_TEMPLATE: 'إنشاء قالب واتساب', WHATSAPP_TEST: 'رمز تجربة واتساب',
};

async function auditList(req, res, ctx) {
  await requireAdmin(ctx);
  const rows = await db.query(
    `SELECT a.*, u.name AS actor_name, u.phone_e164 AS actor_phone FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [PAGE + 1, page(req) * PAGE]);
  return ok(res, {
    logs: rows.slice(0, PAGE).map((a) => ({
      id: a.id, action: a.action, label: ACTION_LABEL[a.action] || a.action, actorType: a.actor_type,
      actor: a.actor_name || a.actor_phone || a.actor_type, entity: a.entity, entityId: a.entity_id,
      before: a.before_json ? JSON.parse(a.before_json) : null, after: a.after_json ? JSON.parse(a.after_json) : null,
      reason: a.reason, createdAt: a.created_at,
    })),
    hasMore: rows.length > PAGE,
  });
}

module.exports = {
  ROLES, me, dashboard, live, trips, tripDetail, cancelTrip,
  captains, captainDetail, captainStatus, captainOffline, documentReview, fileView, walletAdjust,
  deposits, depositApprove, depositReject, customers, customerDetail, customerStatus,
  pricingList, pricingUpdate, settingsList, settingUpdate, cityUpdate, admins, adminAdd, adminRemove, auditList,
  whatsappStatus, whatsappTemplate, whatsappTest,
};
