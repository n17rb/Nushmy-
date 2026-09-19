'use strict';
/**
 * محفظة الكابتن — سجل محاسبي (Ledger).
 * الرصيد لا يُعدَّل مباشرة أبداً: كل تغيير حركة مسجّلة فيها الرصيد قبل وبعد.
 * كل حركة لها مفتاح منع تكرار (idempotency) — نفس العملية لا تُسجَّل مرتين مهما تكرر الطلب.
 */
const db = require('../db');
const { uuid, nowIso } = require('../lib/ids');

const TYPES = ['DEPOSIT', 'COMMISSION', 'CANCELLATION', 'BONUS', 'REFUND', 'ADJUSTMENT', 'WITHDRAWAL', 'CORRECTION'];

async function ensureWallet(captainId, q = db) {
  let w = await q.one('SELECT * FROM wallets WHERE captain_id = $1', [captainId]);
  if (w) return w;
  const now = nowIso();
  await q.query(
    `INSERT INTO wallets (id, captain_id, balance_fils, created_at, updated_at) VALUES ($1,$2,0,$3,$3)
     ON CONFLICT (captain_id) DO NOTHING`,
    [uuid(), captainId, now]
  );
  return q.one('SELECT * FROM wallets WHERE captain_id = $1', [captainId]);
}

/**
 * تسجيل حركة. يجب استدعاؤها داخل معاملة (tx).
 * @param amountFils موجب = إضافة للرصيد، سالب = خصم
 */
async function post(tx, { captainId, type, amountFils, referenceId = null, idempotencyKey, description = null, createdBy = 'system' }) {
  if (!TYPES.includes(type)) throw new Error('نوع حركة غير معروف: ' + type);
  if (!Number.isInteger(amountFils)) throw new Error('المبلغ يجب أن يكون عدداً صحيحاً بالفلس');
  if (!idempotencyKey) throw new Error('مفتاح منع التكرار مطلوب');

  const existing = await tx.one('SELECT * FROM wallet_transactions WHERE idempotency_key = $1', [idempotencyKey]);
  if (existing) return { tx: existing, duplicate: true };

  await ensureWallet(captainId, tx);
  const wallet = await tx.one('SELECT * FROM wallets WHERE captain_id = $1' + db.forUpdate(), [captainId]);
  const before = Number(wallet.balance_fils);
  const after = before + amountFils;
  const now = nowIso();
  const id = 'TXN-' + uuid().replace(/-/g, '').slice(0, 12).toUpperCase();

  await tx.query('UPDATE wallets SET balance_fils = $1, updated_at = $2 WHERE id = $3', [after, now, wallet.id]);
  await tx.query(
    `INSERT INTO wallet_transactions (id, wallet_id, captain_id, transaction_type, amount_fils, balance_before, balance_after,
       reference_id, idempotency_key, description, status, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'POSTED',$11,$12)`,
    [id, wallet.id, captainId, type, amountFils, before, after, referenceId, idempotencyKey, description, createdBy, now]
  );
  return { tx: await tx.one('SELECT * FROM wallet_transactions WHERE id = $1', [id]), duplicate: false };
}

async function balance(captainId) {
  const w = await ensureWallet(captainId);
  return Number(w.balance_fils);
}

module.exports = { ensureWallet, post, balance, TYPES };
