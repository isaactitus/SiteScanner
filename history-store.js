// history-store.js
//
// Stores past scan scores per hostname so re-scanning the same site shows
// real progress over time ("improved from F to B since last scan"), not
// just a fresh one-shot snapshot every time.
//
// Uses a plain JSON file on disk — no database setup required. This is
// intentionally simple: fine for a free single-instance tool at this scale.

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

// ---------- Latest full scan (for shareable /report/:hostname links) ----------

const LATEST_FILE = path.join(DATA_DIR, "latest-scans.json");

async function ensureLatestFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(LATEST_FILE);
  } catch {
    await fs.writeFile(LATEST_FILE, JSON.stringify({}), "utf-8");
  }
}

async function saveLatestScan(hostname, data) {
  await ensureLatestFile();
  let all = {};
  try {
    all = JSON.parse(await fs.readFile(LATEST_FILE, "utf-8"));
  } catch {}
  all[hostname] = { ...data, savedAt: new Date().toISOString() };
  await fs.writeFile(LATEST_FILE, JSON.stringify(all, null, 2), "utf-8");
}

async function getLatestScan(hostname) {
  await ensureLatestFile();
  try {
    const all = JSON.parse(await fs.readFile(LATEST_FILE, "utf-8"));
    return all[hostname] || null;
  } catch {
    return null;
  }
}

// ---------- Public activity feed (opt-in only, deduplicated) ----------

const FEED_FILE = path.join(DATA_DIR, "public-feed.json");
const MAX_FEED_ITEMS = 10;

async function ensureFeedFile() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.access(FEED_FILE);
  } catch {
    await fs.writeFile(FEED_FILE, JSON.stringify([]), "utf-8");
  }
}

async function addToPublicFeed(hostname, score, grade) {
  await ensureFeedFile();
  let feed = [];
  try {
    feed = JSON.parse(await fs.readFile(FEED_FILE, "utf-8"));
  } catch {}

  // Remove existing entry for this hostname so it doesn't duplicate
  feed = feed.filter((item) => item.hostname !== hostname);

  // Prepend the latest scan
  feed.unshift({ hostname, score, grade, timestamp: new Date().toISOString() });
  feed = feed.slice(0, MAX_FEED_ITEMS);

  await fs.writeFile(FEED_FILE, JSON.stringify(feed, null, 2), "utf-8");
}

async function getPublicFeed() {
  await ensureFeedFile();
  try {
    const feed = JSON.parse(await fs.readFile(FEED_FILE, "utf-8"));
    
    // Deduplicate on read as well in case old duplicates exist on disk
    const seen = new Set();
    const deduplicated = [];
    for (const item of feed) {
      if (!seen.has(item.hostname)) {
        seen.add(item.hostname);
        deduplicated.push(item);
      }
    }
    return deduplicated.slice(0, MAX_FEED_ITEMS);
  } catch {
    return [];
  }
}

export {
  recordScan,
  getHistory,
  saveLatestScan,
  getLatestScan,
  addToPublicFeed,
  getPublicFeed,
};