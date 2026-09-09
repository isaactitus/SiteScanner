// history-store.js
import { createClient } from "@libsql/client";
import crypto from "crypto";

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS latest_scans (
      hostname TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS public_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.execute(`ALTER TABLE public_feed ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      is_pro INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      order_id TEXT,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, hostname)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      check_interval TEXT DEFAULT 'weekly',
      alert_threshold INTEGER DEFAULT 70,
      next_run_at INTEGER NOT NULL,
      last_score INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, hostname)
    )
  `);

  // NEW: Active Verification Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS domain_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      token TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, hostname)
    )
  `);
}

initDb().catch(console.error);

export async function upsertUser({ id, email, name, avatarUrl }) {
  await db.execute({
    sql: `
      INSERT INTO users (id, email, name, avatar_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar_url = excluded.avatar_url
    `,
    args: [id, email, name, avatarUrl],
  });

  const res = await db.execute({
    sql: `SELECT id, email, name, avatar_url, is_pro FROM users WHERE id = ?`,
    args: [id],
  });
  return res.rows[0];
}

export async function getUserProfile(userId) {
  const userRes = await db.execute({
    sql: `SELECT id, email, name, avatar_url, is_pro FROM users WHERE id = ?`,
    args: [userId],
  });
  if (!userRes.rows.length) return null;

  const user = userRes.rows[0];
  const entitlementsRes = await db.execute({
    sql: `SELECT hostname, unlocked_at FROM entitlements WHERE user_id = ? ORDER BY unlocked_at DESC`,
    args: [userId],
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    is_pro: Boolean(user.is_pro),
    unlockedDomains: entitlementsRes.rows.map((r) => r.hostname),
  };
}

export async function grantDomainEntitlement(userId, hostname, orderId) {
  await db.execute({
    sql: `
      INSERT INTO entitlements (user_id, hostname, order_id)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, hostname) DO NOTHING
    `,
    args: [userId, hostname.toLowerCase(), orderId],
  });
}

export async function checkDomainEntitlement(userId, hostname) {
  if (!userId) return false;
  const userRes = await db.execute({
    sql: `SELECT is_pro FROM users WHERE id = ?`,
    args: [userId],
  });
  if (userRes.rows.length && userRes.rows[0].is_pro) return true;

  const entRes = await db.execute({
    sql: `SELECT 1 FROM entitlements WHERE user_id = ? AND hostname = ? LIMIT 1`,
    args: [userId, hostname.toLowerCase()],
  });
  return entRes.rows.length > 0;
}

export async function recordScan(hostname, score, grade) {
  const prev = await db.execute({
    sql: `SELECT score, grade, scanned_at FROM scan_history WHERE hostname = ? ORDER BY id DESC LIMIT 1`,
    args: [hostname],
  });
  
  await db.execute({
    sql: `INSERT INTO scan_history (hostname, score, grade, scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    args: [hostname, score, grade],
  });
  
  const history = await db.execute({
    sql: `SELECT score, grade, scanned_at FROM scan_history WHERE hostname = ? ORDER BY id DESC LIMIT 5`,
    args: [hostname],
  });
  
  return { previous: prev.rows[0] || null, history: history.rows };
}

export async function saveLatestScan(hostname, result) {
  await db.execute({
    sql: `INSERT INTO latest_scans (hostname, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(hostname) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
    args: [hostname, JSON.stringify(result)],
  });
}

export async function getLatestScan(hostname) {
  const res = await db.execute({
    sql: `SELECT data FROM latest_scans WHERE hostname = ?`,
    args: [hostname],
  });
  return res.rows[0] ? JSON.parse(res.rows[0].data) : null;
}

export async function addToPublicFeed(hostname, score, grade) {
  try {
    await db.execute({
      sql: `INSERT INTO public_feed (hostname, score, grade, scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [hostname, score, grade],
    });
  } catch {
    try {
      await db.execute({
        sql: `INSERT INTO public_feed (hostname, score, grade, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        args: [hostname, score, grade],
      });
    } catch {
      await db.execute({
        sql: `INSERT INTO public_feed (hostname, score, grade) VALUES (?, ?, ?)`,
        args: [hostname, score, grade],
      });
    }
  }
}

export async function getPublicFeed() {
  try {
    const res = await db.execute(`SELECT hostname, score, grade FROM public_feed ORDER BY id DESC LIMIT 10`);
    return res.rows;
  } catch (err) {
    return [];
  }
}

export async function addMonitor({ userId, hostname, interval = "weekly", threshold = 70 }) {
  const nextRun = Date.now();
  await db.execute({
    sql: `INSERT INTO monitors (user_id, hostname, check_interval, alert_threshold, next_run_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, hostname) DO UPDATE SET
            check_interval = excluded.check_interval,
            alert_threshold = excluded.alert_threshold,
            is_active = 1`,
    args: [userId, hostname.toLowerCase(), interval, threshold, nextRun],
  });
}

export async function getUserMonitors(userId) {
  const res = await db.execute({
    sql: `SELECT * FROM monitors WHERE user_id = ? ORDER BY id DESC`,
    args: [userId],
  });
  return res.rows;
}

// --- NEW: DNS Verification Helpers ---
export async function getOrGenerateVerificationToken(userId, hostname) {
  const cleanHost = hostname.toLowerCase();
  
  const existing = await db.execute({
    sql: `SELECT token, is_verified FROM domain_verifications WHERE user_id = ? AND hostname = ?`,
    args: [userId, cleanHost],
  });

  if (existing.rows.length > 0) {
    return { token: existing.rows[0].token, isVerified: Boolean(existing.rows[0].is_verified) };
  }

  const newToken = `sitescanner-verification=${crypto.randomBytes(16).toString("hex")}`;
  await db.execute({
    sql: `INSERT INTO domain_verifications (user_id, hostname, token) VALUES (?, ?, ?)`,
    args: [userId, cleanHost, newToken],
  });

  return { token: newToken, isVerified: false };
}

export async function markDomainVerified(userId, hostname) {
  await db.execute({
    sql: `UPDATE domain_verifications SET is_verified = 1 WHERE user_id = ? AND hostname = ?`,
    args: [userId, hostname.toLowerCase()],
  });
}