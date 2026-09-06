import { createClient } from "@libsql/client";

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;

let db = null;
if (dbUrl) {
  db = createClient({
    url: dbUrl,
    authToken: dbAuthToken || "",
  });
}

// Auto-initialize SQLite tables on startup
let initialized = false;
async function initDb() {
  if (!db || initialized) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS latest_scans (
      hostname TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS public_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      scanned_at TEXT NOT NULL
    );
  `);

  initialized = true;
}

export async function recordScan(hostname, score, grade) {
  if (!db) return { previous: null, history: [] };
  await initDb();

  const now = new Date().toISOString();

  // Find the previous scan score for the delta
  const prevResult = await db.execute({
    sql: `SELECT score, grade, scanned_at FROM scan_history WHERE hostname = ? ORDER BY id DESC LIMIT 1`,
    args: [hostname],
  });

  const previous = prevResult.rows.length > 0 ? {
    score: Number(prevResult.rows[0].score),
    grade: prevResult.rows[0].grade,
    scannedAt: prevResult.rows[0].scanned_at,
  } : null;

  // Insert this scan into history
  await db.execute({
    sql: `INSERT INTO scan_history (hostname, score, grade, scanned_at) VALUES (?, ?, ?, ?)`,
    args: [hostname, score, grade, now],
  });

  // Fetch last 10 scans for this domain
  const historyResult = await db.execute({
    sql: `SELECT score, grade, scanned_at FROM scan_history WHERE hostname = ? ORDER BY id DESC LIMIT 10`,
    args: [hostname],
  });

  const history = historyResult.rows.map(r => ({
    score: Number(r.score),
    grade: r.grade,
    scannedAt: r.scanned_at,
  }));

  return { previous, history };
}

export async function saveLatestScan(hostname, scanResult) {
  if (!db) return;
  await initDb();

  const jsonString = JSON.stringify(scanResult);
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO latest_scans (hostname, data, updated_at) 
          VALUES (?, ?, ?) 
          ON CONFLICT(hostname) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [hostname, jsonString, now],
  });
}

export async function getLatestScan(hostname) {
  if (!db) return null;
  await initDb();

  const result = await db.execute({
    sql: `SELECT data FROM latest_scans WHERE hostname = ? LIMIT 1`,
    args: [hostname],
  });

  if (result.rows.length === 0) return null;
  try {
    return JSON.parse(result.rows[0].data);
  } catch {
    return null;
  }
}

export async function addToPublicFeed(hostname, score, grade) {
  if (!db) return;
  await initDb();

  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO public_feed (hostname, score, grade, scanned_at) VALUES (?, ?, ?, ?)`,
    args: [hostname, score, grade, now],
  });

  // Keep feed trimmed to the last 20 entries
  await db.execute(`
    DELETE FROM public_feed WHERE id NOT IN (
      SELECT id FROM public_feed ORDER BY id DESC LIMIT 20
    )
  `);
}

export async function getPublicFeed() {
  if (!db) return [];
  await initDb();

  const result = await db.execute(`
    SELECT hostname, score, grade, scanned_at 
    FROM public_feed 
    ORDER BY id DESC 
    LIMIT 10
  `);

  return result.rows.map(r => ({
    hostname: r.hostname,
    score: Number(r.score),
    grade: r.grade,
    scannedAt: r.scanned_at,
  }));
}