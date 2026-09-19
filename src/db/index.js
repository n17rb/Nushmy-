'use strict';
/**
 * طبقة قاعدة البيانات.
 * تعمل على محركين بنفس الكود:
 *   1) PostgreSQL  — عند وجود DATABASE_URL (الإنتاج / Neon)  [يحتاج حزمة pg]
 *   2) SQLite      — افتراضياً للتجربة المحلية (node:sqlite المدمجة، بدون تثبيت)
 *
 * كل الاستعلامات تُكتب بصيغة PostgreSQL ($1, $2 ...) ويُترجمها المحوّل تلقائياً.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let driver = null;      // 'pg' | 'sqlite'
let pool = null;        // pg Pool
let sqlite = null;      // node:sqlite DatabaseSync

/* ----------------------------- SQLite ----------------------------- */
function toSqliteSql(sql) {
  // $1 → ?   (الترتيب محفوظ لأننا نمرر المصفوفة بنفس الترتيب)
  return sql.replace(/\$(\d+)/g, '?');
}

function orderedParams(sql, params) {
  // يدعم إعادة استخدام نفس المعامل ($1 مرتين) بترتيب صحيح لـ SQLite
  const order = [];
  sql.replace(/\$(\d+)/g, (_, n) => { order.push(Number(n) - 1); return '?'; });
  return order.map((i) => normalizeParam(params[i]));
}

function normalizeParam(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/* ------------------------------ init ------------------------------ */
async function init() {
  if (config.db.url) {
    let pg;
    try {
      pg = require('pg');
    } catch (e) {
      throw new Error(
        'DATABASE_URL موجود لكن حزمة pg غير مثبتة. شغّل:  npm install pg'
      );
    }
    const needSsl = /neon\.tech|render\.com|supabase|amazonaws/.test(config.db.url)
      || /sslmode=require/.test(config.db.url);
    pool = new pg.Pool({
      connectionString: config.db.url,
      ssl: needSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    await pool.query('SELECT 1');
    driver = 'pg';
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const p = config.db.sqlitePath;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    sqlite = new DatabaseSync(p);
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('PRAGMA busy_timeout = 5000;');
    driver = 'sqlite';
  }
  await migrate();
  return driver;
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (driver === 'sqlite') {
    sqlite.exec(schema);
  } else {
    const client = await pool.connect();
    try { await client.query(schema); } finally { client.release(); }
  }
}

/* ----------------------------- queries ---------------------------- */
async function query(sql, params = []) {
  if (driver === 'pg') {
    const res = await pool.query(sql, params.map((p) => (p === undefined ? null : p)));
    return res.rows;
  }
  const stmt = sqlite.prepare(toSqliteSql(sql));
  const args = orderedParams(sql, params);
  if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) {
    return stmt.all(...args);
  }
  stmt.run(...args);
  return [];
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** تنفيذ مجموعة عمليات داخل معاملة واحدة (لمنع Race Conditions) */
async function transaction(fn) {
  if (driver === 'pg') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        query: async (sql, params = []) => (await client.query(sql, params.map((p) => (p === undefined ? null : p)))).rows,
        one: async (sql, params = []) => (await client.query(sql, params.map((p) => (p === undefined ? null : p)))).rows[0] || null,
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }
  // SQLite: المعاملات متزامنة والعمليات على نفس الاتصال
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const tx = { query, one };
    const out = await fn(tx);
    sqlite.exec('COMMIT');
    return out;
  } catch (err) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

async function close() {
  if (driver === 'pg' && pool) await pool.end();
  if (driver === 'sqlite' && sqlite) sqlite.close();
}

module.exports = { init, query, one, transaction, close, get driver() { return driver; } };
