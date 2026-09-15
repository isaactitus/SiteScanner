// server.js
import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import dns from "dns/promises";
import { Resolver } from "dns/promises";
import tls from "tls";
import { URL } from "url";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import ipaddr from "ipaddr.js";
import rateLimit from "express-rate-limit";
import Razorpay from "razorpay";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { generateReport, calculateScore, scoreToGrade, isSharedHostSubdomain } from "./report-generator.js";
import { db, recordScan, saveLatestScan, getLatestScan, addToPublicFeed, getPublicFeed, upsertUser, getUserProfile, addMonitor, getUserMonitors, getOrGenerateVerificationToken, markDomainVerified, toggleMonitorStatus, toggleMonitorByHostname, getUserHistory, updateMonitorScore } from "./history-store.js";
import { initCronJobs } from "./scanner-cron.js";
import { sendAlertEmail } from "./email-service.js"; // <-- Smart Email Import

const app = express();
app.set("trust proxy", 1); 
app.use(express.json({ limit: "10mb" })); 
app.use(cookieParser()); 
app.use(express.static("public"));

const aiCache = new Map();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || "sitescanner_dev_secret_key_12345";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

app.use(async (req, res, next) => {
  const token = req.cookies.token; if (!token) { req.user = null; return next(); }
  try { const decoded = jwt.verify(token, JWT_SECRET); const profile = await getUserProfile(decoded.id); req.user = profile ? { ...decoded, is_pro: profile.is_pro } : decoded; } catch { req.user = null; }
  next();
});

// ---------- Auth ----------
app.post("/api/auth/google", async (req, res) => {
  if (!req.body.credential) return res.status(400).json({ error: "Missing credential." });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const user = await upsertUser({ id: payload.sub, email: payload.email, name: payload.name, avatarUrl: payload.picture });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: await getUserProfile(user.id) });
  } catch (err) { res.status(401).json({ error: "Authentication failed: " + err.message }); }
});
app.get("/api/auth/me", async (req, res) => { res.json({ user: req.user ? await getUserProfile(req.user.id) : null }); });
app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ success: true }); });

const scanLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, skip: (req) => req.user && req.user.is_pro, message: { error: "Free tier limit reached. Upgrade to PRO." } });

function sanitizeTargetDomain(input) {
  let clean = (input || "").trim().replace(/^(https?:\/\/)+/i, "").replace(/\/+$/, "");
  if (!clean || clean.includes(" ")) throw new Error("Invalid domain format provided.");
  return clean;
}
async function validatePublicHostname(hostname) {
  if (!hostname || hostname.toLowerCase() === "localhost") throw new Error("Internal scanning not permitted.");
  const addresses = await dns.lookup(hostname, { all: true }).catch(() => { throw new Error("Could not resolve domain name."); });
  const blockedRanges = ["loopback", "private", "linkLocal", "broadcast", "carrierGradeNat", "uniqueLocal", "reserved"];
  for (const { address } of addresses) { try { if (blockedRanges.includes(ipaddr.parse(address).range())) throw new Error("Domain resolves to restricted IP."); } catch (err) { if (err.message.includes("restricted")) throw err; throw new Error("Invalid IP resolved."); } }
  return true;
}

async function dispatchGitHubScan(hostname) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;
  const appBaseUrl = process.env.APP_BASE_URL;
  const webhookSecret = process.env.SCAN_WEBHOOK_SECRET;

  if (!owner || !repo || !pat || !appBaseUrl || !webhookSecret) { throw new Error("Missing GitHub Action worker configuration in environment variables."); }
  const callbackUrl = `${appBaseUrl.replace(/\/+$/, "")}/api/webhooks/dast-callback`;
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${hostname}:${callbackUrl}`).digest("hex");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${pat}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "SiteScanner-Backend" },
    body: JSON.stringify({ event_type: "active_dast_scan", client_payload: { hostname, callback_url: callbackUrl, signature } }),
  });

  if (!response.ok) { const errText = await response.text(); throw new Error(`GitHub API Error: ${response.status} - ${errText}`); }
}

// ---------- Checkers ----------
async function checkHttpsEnforcement(hostname) {
  try {
    for (let i = 0, currentUrl = `http://${hostname}`; i < 3; i++) {
      const res = await fetch(currentUrl, { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(5000) });
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
        const nextUrl = new URL(res.headers.get("location"), currentUrl).toString();
        if (nextUrl.toLowerCase().startsWith("https://")) return { redirectsToHttps: true, plainTextAllowed: false }; currentUrl = nextUrl; continue;
      }
      break;
    } return { redirectsToHttps: false, plainTextAllowed: true };
  } catch { return { redirectsToHttps: false, plainTextAllowed: false }; }
}
async function checkMalwareBlocklist(targetUrl) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY; if (!apiKey) return { checked: false, reason: "no_api_key" };
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: { clientId: "sitescanner", clientVersion: "1.0.0" }, threatInfo: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"], platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url: targetUrl }] } }), signal: AbortSignal.timeout(5000) });
    const matches = (await res.json()).matches || []; return { checked: true, flagged: matches.length > 0, threatTypes: matches.map((m) => m.threatType) };
  } catch { return { checked: false, reason: "network_error" }; }
}
async function checkCookieSecurity(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const rawCookies = typeof res.headers.raw === "function" ? (res.headers.raw()["set-cookie"] || []) : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    if (!rawCookies.length) return { hasCookies: false, cookies: [] };
    const cookies = rawCookies.map(c => { const lower = c.toLowerCase(), nameMatch = c.match(/^([^=]+)=/); return { name: nameMatch ? nameMatch[1].trim() : "unknown", secure: lower.includes("secure"), httpOnly: lower.includes("httponly") }; });
    return { hasCookies: true, cookies };
  } catch { return { hasCookies: false, cookies: [] }; }
}
async function checkCORS(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", headers: { Origin: "https://sitescanner-cors-test.example.com", "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const allowOrigin = res.headers.get("access-control-allow-origin"); return { allowOrigin: allowOrigin || null, wildcardOpen: allowOrigin === "*", dangerousCombo: (allowOrigin === "https://sitescanner-cors-test.example.com" && res.headers.get("access-control-allow-credentials") === "true") };
  } catch { return { allowOrigin: null, wildcardOpen: false, dangerousCombo: false }; }
}
async function checkSecurityHeaders(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const reqHeaders = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options"];
    const headers = Object.fromEntries(res.headers.entries()); return { missing: reqHeaders.filter(h => !headers[h]), present: reqHeaders.filter(h => headers[h]), server: headers.server || null };
  } catch { return { missing: [], present: [], server: null }; }
}
async function checkTLS(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, timeout: 8000 }, () => { const cert = socket.getPeerCertificate(); resolve({ valid: !!(cert && cert.valid_to), issuer: cert?.issuer?.O || "Unknown", daysUntilExpiry: cert?.valid_to ? Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null }); socket.end(); });
    socket.on("error", (err) => resolve({ valid: false, error: err.message })); socket.on("timeout", () => { socket.destroy(); resolve({ valid: false, error: "Timeout" }); });
  });
}
async function checkExposedFiles(baseUrl) {
  const paths = ["/.env", "/.git/config", "/wp-config.php.bak", "/config.php.bak"]; const results = [];
  for (const p of paths) { try { const res = await fetch(new URL(p, baseUrl).toString(), { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(3500) }); if (res.status === 200 && !(res.headers.get("content-type") || "").includes("text/html")) results.push({ path: p, exposed: true }); } catch {} }
  return results;
}
async function checkEmailSpoofingProtection(hostname) {
  const result = { spf: false, dmarc: false, isSharedHost: isSharedHostSubdomain(hostname) }; if (result.isSharedHost) return result;
  const resolver = new Resolver(); resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  try { result.spf = (await resolver.resolveTxt(hostname)).some(r => r.join("").startsWith("v=spf1")); } catch {}
  try { result.dmarc = (await resolver.resolveTxt(`_dmarc.${hostname}`)).some(r => r.join("").startsWith("v=DMARC1")); } catch {}
  return result;
}
export async function runScanPipeline(hostname) {
  const targetHttpsUrl = `https://${hostname}`;
  const [headers, tlsInfo, exposedFiles, emailAuth, cookies, cors] = await Promise.allSettled([ checkSecurityHeaders(targetHttpsUrl), checkTLS(hostname), checkExposedFiles(targetHttpsUrl), checkEmailSpoofingProtection(hostname), checkCookieSecurity(targetHttpsUrl), checkCORS(targetHttpsUrl) ]);
  return { headers: headers.status === "fulfilled" ? headers.value : { error: "failed" }, tls: tlsInfo.status === "fulfilled" ? tlsInfo.value : { error: "failed" }, exposedFiles: exposedFiles.status === "fulfilled" ? exposedFiles.value : [], emailAuth: emailAuth.status === "fulfilled" ? emailAuth.value : { error: "failed" }, cookies: cookies.status === "fulfilled" ? cookies.value : { hasCookies: false, cookies: [] }, cors: cors.status === "fulfilled" ? cors.value : { wildcardOpen: false, dangerousCombo: false }, activeDastStatus: "Not executed (Requires Verification)" };
}

// ---------- Razorpay ----------
app.post("/api/create-order", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  try { const order = await razorpay.orders.create({ amount: 49900, currency: "INR", receipt: `rcpt_${Date.now()}` }); res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/verify-payment", async (req, res) => {
  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${req.body.razorpay_order_id}|${req.body.razorpay_payment_id}`).digest("hex");
  if (hmac === req.body.razorpay_signature && req.user) { 
    await db.execute({ sql: `UPDATE users SET is_pro = 1, pro_started_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [req.user.id] }); 
    return res.json({ success: true }); 
  }
  res.status(400).json({ success: false, error: "Invalid payment signature." });
});

// ---------- Dual Verification ----------
app.post("/api/verification/generate", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Pro account required." });
  try { res.json({ success: true, ...await getOrGenerateVerificationToken(req.user.id, req.body.hostname) }); } catch (err) { res.status(500).json({ error: "Failed to generate token." }); }
});
app.post("/api/verification/check", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Unauthorized." });
  const { hostname } = req.body;
  try {
    const dbData = await getOrGenerateVerificationToken(req.user.id, hostname);
    if (dbData.isVerified) return res.json({ success: true, message: "Already verified." });

    let isVerified = false;
    const resolver = new Resolver(); resolver.setServers(["8.8.8.8", "1.1.1.1"]);
    try {
      const records = await resolver.resolveTxt(hostname);
      if (records.map(r => r.join("")).includes(dbData.token)) isVerified = true;
    } catch (dnsErr) {}

    if (!isVerified) {
      try {
        const url = `https://${hostname}/.well-known/sitescanner-verification.txt`;
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
        const httpRes = await fetch(url, { signal: controller.signal, headers: { "User-Agent": BROWSER_USER_AGENT } });
        clearTimeout(timeout);
        if (httpRes.ok && (await httpRes.text()).trim() === dbData.token) isVerified = true;
      } catch (httpErr) {}
    }

    if (isVerified) { await markDomainVerified(req.user.id, hostname); return res.json({ success: true, message: "Domain verified successfully!" }); }
    res.status(400).json({ success: false, error: "Verification failed. Check your DNS TXT record or HTTP verification file." });
  } catch (err) { res.status(500).json({ success: false, error: "System error occurred during verification." }); }
});

// ---------- Monitors & Toggles (SMART ALERTS INTEGRATED) ----------
app.post("/api/monitors", async (req, res) => { 
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Pro unlock required" }); 
  await addMonitor({ userId: req.user.id, hostname: req.body.hostname, interval: req.body.interval, threshold: req.body.threshold }); 
  
  // Instantly send activation email and set the baseline
  const latest = await getLatestScan(req.body.hostname);
  if (latest && latest.score !== undefined) {
     await updateMonitorScore(req.user.id, req.body.hostname, latest.score);
     await sendAlertEmail(req.user.email, req.body.hostname, null, latest.score, "activated");
  }
  
  res.json({ success: true }); 
});

app.get("/api/monitors", async (req, res) => { if (!req.user) return res.status(401).json({ error: "Unauthorized" }); res.json(await getUserMonitors(req.user.id)); });
app.patch("/api/monitors/:id/toggle", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Unauthorized" });
  try { await toggleMonitorStatus(req.user.id, req.params.id, req.body.isActive); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch("/api/monitors/toggle-domain", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Unauthorized" });
  try { 
    await toggleMonitorByHostname(req.user.id, req.body.hostname, req.body.isActive); 
    
    // Instantly send activation email if they just toggled it ON
    if (req.body.isActive) {
       const latest = await getLatestScan(req.body.hostname);
       if (latest && latest.score !== undefined) {
          await updateMonitorScore(req.user.id, req.body.hostname, latest.score);
          await sendAlertEmail(req.user.email, req.body.hostname, null, latest.score, "activated");
       }
    }
    
    res.json({ success: true }); 
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- PDF Generation ----------
app.get("/api/download-pdf/:hostname", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Pro plan required" });
  const includeAi = req.query.ai === 'true';
  let browser = null;
  
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage(); 
    await page.setViewport({ width: 1200, height: 1600 });
    
    if (req.cookies && req.cookies.token) {
      await page.setCookie({ name: 'token', value: req.cookies.token, domain: 'localhost' });
    }

    await page.goto(`http://localhost:${process.env.PORT || 3000}/report/${req.params.hostname}`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForSelector('#explainBtn', { timeout: 10000 }).catch(() => {});

    await page.evaluate(async (includeAi) => {
      const explainBtn = document.getElementById('explainBtn');
      if(explainBtn) {
        explainBtn.click();
        await new Promise(r => setTimeout(r, 1500));
        
        if (includeAi) {
            const aiBtn = document.getElementById('generateAiBtn');
            if (aiBtn) {
                aiBtn.click();
                await new Promise(resolve => {
                  if (document.querySelector('.ai-card') || document.querySelector('.ai-error')) return resolve();
                  const observer = new MutationObserver(() => {
                    if (document.querySelector('.ai-card') || document.querySelector('.ai-error')) {
                      observer.disconnect();
                      resolve();
                    }
                  });
                  observer.observe(document.body, { childList: true, subtree: true });
                  setTimeout(resolve, 25000); 
                });
                await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            const aiContainer = document.getElementById('aiReportContainer');
            if (aiContainer) aiContainer.remove();
        }
      }
      
      ['.app-nav', '.scan-card', '.action-grid', '#monitorFeedback'].forEach(s => { 
        const el = document.querySelector(s); 
        if (el) el.style.display = 'none'; 
      }); 
      
      document.body.style.background = '#ffffff';
    }, includeAi);

    const pdfBuffer = await page.pdf({ 
      format: "A4", 
      printBackground: true, 
      displayHeaderFooter: true,
      headerTemplate: `<div style="width: 100%; font-size: 10px; color: #475569; padding: 0 1.2cm; display: flex; justify-content: space-between; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; text-transform: uppercase; font-weight: 700;"><span>Enterprise Security Audit Blueprint</span><span style="color: #e11d48;">CONFIDENTIAL / RESTRICTED</span></div>`,
      footerTemplate: `<div style="width: 100%; font-size: 10px; color: #475569; padding: 0 1.2cm; display: flex; justify-content: space-between; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-top: 2px solid #e2e8f0; padding-top: 6px;"><span>Target: ${req.params.hostname}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: "2.5cm", right: "1.2cm", bottom: "2.5cm", left: "1.2cm" } 
    }); 
    
    await browser.close();
    res.contentType("application/pdf"); 
    res.setHeader("Content-Disposition", `attachment; filename="SiteScanner_Executive_Audit_${req.params.hostname}.pdf"`); 
    res.send(Buffer.from(pdfBuffer));
  } catch (err) { 
    if (browser) await browser.close(); 
    res.status(500).json({ error: err.message }); 
  }
});

// ---------- Scan Routes ----------
app.post("/api/scan", scanLimiter, async (req, res) => {
  if (!req.body.ownershipConfirmed) return res.status(400).json({ error: "You must confirm authorization." });
  try {
    const hostname = sanitizeTargetDomain(req.body.url); await validatePublicHostname(hostname);
    const raw = await runScanPipeline(hostname); const { score } = calculateScore(raw, hostname); const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade, req.user ? req.user.id : null);
    const scanResult = { hostname, scannedAt: new Date().toISOString(), raw, score, grade, previousScan: previous, history };
    
    aiCache.delete(hostname);
    
    await saveLatestScan(hostname, scanResult); if (req.body.listPublicly) await addToPublicFeed(hostname, score, grade);
    res.json(scanResult);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/scan-active", scanLimiter, async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "PRO Account required for active DAST." });
  try {
    const hostname = sanitizeTargetDomain(req.body.url); await validatePublicHostname(hostname);
    const dbData = await getOrGenerateVerificationToken(req.user.id, hostname);
    if (!dbData.isVerified) return res.status(403).json({ error: "Domain ownership not verified." });

    const raw = await runScanPipeline(hostname);

    try {
      await dispatchGitHubScan(hostname);
      raw.activeDastStatus = "Worker Runner dispatched. Deep assessment is executing in background...";
    } catch (dispatchErr) {
      console.error("[Dispatch Error]", dispatchErr.message);
      raw.activeDastStatus = `Worker Dispatch Notice: ${dispatchErr.message}`;
    }

    const { score } = calculateScore(raw, hostname); const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade, req.user ? req.user.id : null);
    const scanResult = { hostname, scannedAt: new Date().toISOString(), raw, score, grade, previousScan: previous, history };
    
    aiCache.delete(hostname);
    
    await saveLatestScan(hostname, scanResult); 
    res.json(scanResult);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/webhooks/dast-callback", async (req, res) => {
  const { hostname, results } = req.body;
  const signature = req.headers["x-scan-signature"];
  const appBaseUrl = process.env.APP_BASE_URL || "";
  const webhookSecret = process.env.SCAN_WEBHOOK_SECRET || "";

  const callbackUrl = `${appBaseUrl.replace(/\/+$/, "")}/api/webhooks/dast-callback`;
  const expectedSig = crypto.createHmac("sha256", webhookSecret).update(`${hostname}:${callbackUrl}`).digest("hex");

  if (signature !== expectedSig) { return res.status(401).json({ error: "Invalid signature verification." }); }
  try {
    const existing = await getLatestScan(hostname);
    if (existing) {
      existing.raw.activeDastStatus = "Assessment Complete. Results ingested.";
      existing.raw.activeDastReport = results;
      aiCache.delete(hostname);
      await saveLatestScan(hostname, existing);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to persist scan output" }); }
});

app.post("/api/explain", async (req, res) => {
  if (!req.body.raw || !req.body.hostname) return res.status(400).json({ error: "Missing scan data." });
  
  const mode = req.body.mode || 'all'; 

  if (mode === 'standard') {
    const ruleBasedReport = generateReport(req.body.raw, req.body.hostname);
    return res.json({ ruleBasedReport });
  }

  if (aiCache.has(req.body.hostname)) {
    const cached = aiCache.get(req.body.hostname);
    if (mode === 'ai') return res.json({ aiReport: cached.aiReport, aiError: cached.aiError });
    return res.json(cached);
  }

  const ruleBasedReport = generateReport(req.body.raw, req.body.hostname);
  
  if (!req.user || !req.user.is_pro) return res.json({ ruleBasedReport, aiReport: null, aiError: "Pro upgrade required." });
  if (!process.env.GEMINI_API_KEY) return res.json({ ruleBasedReport, aiReport: null, aiError: "GEMINI_API_KEY missing." });
  
  let aiReport = null, aiError = null;
  let dastAlerts = [];
  if (req.body.raw.activeDastReport?.site?.[0]?.alerts) {
    dastAlerts = req.body.raw.activeDastReport.site[0].alerts.map(a => ({
      name: a.name,
      risk: a.riskcode === "3" ? "High" : a.riskcode === "2" ? "Medium" : "Low",
      description: a.desc.replace(/<[^>]+>/g, '').substring(0, 200) 
    }));
  }

  const payloadContext = {
    missingHeaders: req.body.raw.headers?.missing || [],
    exposedFiles: req.body.raw.exposedFiles || [],
    emailAuth: req.body.raw.emailAuth || {},
    activeVulnerabilities: dastAlerts
  };

  const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
  const prompt = `Act as a Senior AppSec Engineer. Analyze this security scan for "${req.body.hostname}" conducted on ${currentDate}. Produce a comprehensive, actionable remediation blueprint for the detected issues. Categorize clearly by Infrastructure (Headers/Files) and Application Runtime (Active Vulnerabilities). Use professional markdown formatting with clear headings and bullet points. Ensure the response is complete and do not cut off the output mid-sentence. Scan findings: ${JSON.stringify(payloadContext)}`;
  
  const model = "gemini-3.6-flash";
  const maxRetries = 3;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }], 
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
          safetySettings: [
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }
          ]
        }) 
      });
      
      if (response.ok) { 
        const jsonRes = await response.json();
        if (jsonRes.candidates?.[0]?.finishReason === "SAFETY") {
           aiError = "Google API blocked the response due to safety filters.";
           break;
        }
        aiReport = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text || null; 
        aiError = null; 
        
        const finalAiResponse = { aiReport, aiError };
        aiCache.set(req.body.hostname, finalAiResponse);
        setTimeout(() => aiCache.delete(req.body.hostname), 3600000);
        break; 
      } else { 
        const errorData = await response.json();
        const isRateLimit = response.status === 429 || response.status === 503;
        
        if (isRateLimit && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          attempt++;
          continue;
        }
        
        aiError = `Google API Error (${model}): ${errorData.error?.message || response.statusText}`; 
        break; 
      }
    } catch (err) { 
      if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          attempt++;
          continue;
      }
      aiError = `Network Error (${model}): ${err.message}`; 
      break;
    }
  }
  
  if (mode === 'ai') return res.json({ aiReport, aiError });
  res.json({ ruleBasedReport, aiReport, aiError });
});

app.get("/api/report/:hostname", async (req, res) => { const data = await getLatestScan(req.params.hostname); if (!data) return res.status(404).json({ error: "No scan found." }); res.json(data); });
app.get("/api/recent", async (req, res) => { res.json(await getPublicFeed()); });
app.get("/report/:hostname", (req, res) => { res.sendFile(path.join(__dirname, "public", "report.html")); });

app.get("/api/user-history", async (req, res) => { 
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  res.json(await getUserHistory(req.user.id)); 
});
app.get("/history", (req, res) => { res.sendFile(path.join(__dirname, "public", "history.html")); });

// ---------- Keep-Alive Route for Render/Cron-job.org ----------
app.get("/api/cron/tick", (req, res) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});

app.listen(process.env.PORT || 3000, () => { console.log(`Running on port ${process.env.PORT || 3000}`); initCronJobs(runScanPipeline); });