// history-store.js
//
// Stores past scan scores per hostname so re-scanning the same site shows
// real progress over time ("improved from F to B since last scan"), not
// just a fresh one-shot snapshot every time.
//
// Uses a plain JSON file on disk — no database setup required. This is
// intentionally simple: fine for a free single-instance tool at this scale.
// Known limitation, stated honestly: on hosts with an ephemeral filesystem
// (some free tiers wipe disk on redeploy, not on restart), history can be
// lost on redeploy. Worth upgrading to a real database (e.g. SQLite file,
// or a hosted Postgres) if/when this matters — this file is written so that
// swap is a single-module change, not a rewrite.

import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "scan-history.json");
const MAX_ENTRIES_PER_HOST = 20;

async function ensureDataFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, JSON.stringify({}), "utf-8");
  }
}

async function readAll() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read history file, starting fresh:", err.message);
    return {};
  }
}

async function writeAll(data) {
  await ensureDataFile();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// Records a new scan result and returns the PREVIOUS entry (if any) so the
// caller can show a before/after comparison immediately, without a second read.
async function recordScan(hostname, score, grade) {
  const all = await readAll();
  const existing = all[hostname] || [];
  const previous = existing.length > 0 ? existing[existing.length - 1] : null;

  const entry = { timestamp: new Date().toISOString(), score, grade };
  const updated = [...existing, entry].slice(-MAX_ENTRIES_PER_HOST);

  all[hostname] = updated;
  await writeAll(all);

  return { previous, history: updated };
}

async function getHistory(hostname) {
  const all = await readAll();
  return all[hostname] || [];
}

export { recordScan, getHistory };