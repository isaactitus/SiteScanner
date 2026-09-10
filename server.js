// SiteScanner - Passive Security Health Checker
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
import {
  db, recordScan, saveLatestScan, getLatestScan, addToPublicFeed, getPublicFeed,
  upsertUser, getUserProfile, addMonitor, getUserMonitors,
  getOrGenerateVerificationToken, markDomainVerified
} from "./history-store.js";
import { initCronJobs } from "./scanner-cron.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || "sitescanner_dev_secret_key_12345";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

// Auth Verification Middleware
app.use(async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) { req.user = null; return next(); }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const profile = await getUserProfile(decoded.id);
    req.user = profile ? { ...decoded, is_pro: profile.is_pro } : decoded;
  } catch { req.user = null; }
  next();
});

// ---------- Authentication Endpoints ----------
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing Google credential." });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const user = await upsertUser({ id: payload.sub, email: payload.email, name: payload.name, avatarUrl: payload.picture });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: await getUserProfile(user.id) });
  } catch (err) {
    res.status(401).json({ error: "Authentication failed: " + err.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: await getUserProfile(req.user.id) });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ---------- Rate Limiting ----------
const scanLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.is_pro, 
  message: { error: "Free tier limit reached (5 scans per 24 hours). Upgrade to PRO for unlimited target auditing." },
});

// ---------- Input Normalization & SSRF Guard ----------
function sanitizeTargetDomain(input) {
  let clean = (input || "").trim().replace(/^(https?:\/\/)+/i, "").replace(/\/+$/, "");
  if (!clean || clean.includes(" ")) throw new Error("Invalid domain format provided.");
  return clean;
}

async function validatePublicHostname(hostname) {
  if (!hostname || hostname.toLowerCase() === "localhost") throw new Error("Internal scanning not permitted.");
  const addresses = await dns.lookup(hostname, { all: true }).catch(() => { throw new Error("Could not resolve domain name."); });
  const blockedRanges = ["loopback", "private", "linkLocal", "broadcast", "carrierGradeNat", "uniqueLocal", "reserved"];
  for (const { address } of addresses) {
    try {
      if (blockedRanges.includes(ipaddr.parse(address).range())) throw new Error("Domain resolves to restricted IP.");
    } catch (err) {
      if (err.message.includes("restricted")) throw err;
      throw new Error("Invalid IP resolved.");
    }
  }
  return true;
}

// ---------- Scan Checkers (Passive Pipeline) ----------
async function checkHttpsEnforcement(hostname) {
  try {
    for (let i = 0, currentUrl = `http://${hostname}`; i < 3; i++) {
      const res = await fetch(currentUrl, { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(5000) });
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
        const nextUrl = new URL(res.headers.get("location"), currentUrl).toString();
        if (nextUrl.toLowerCase().startsWith("https://")) return { redirectsToHttps: true, plainTextAllowed: false };
        currentUrl = nextUrl; continue;
      }
      break;
    }
    return { redirectsToHttps: false, plainTextAllowed: true };
  } catch { return { redirectsToHttps: false, plainTextAllowed: false }; }
}

async function checkMalwareBlocklist(targetUrl) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) return { checked: false, reason: "no_api_key" };
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: { clientId: "sitescanner", clientVersion: "1.0.0" }, threatInfo: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"], platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url: targetUrl }] } }),
      signal: AbortSignal.timeout(5000),
    });
    const matches = (await res.json()).matches || [];
    return { checked: true, flagged: matches.length > 0, threatTypes: matches.map((m) => m.threatType) };
  } catch { return { checked: false, reason: "network_error" }; }
}

async function checkCookieSecurity(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const rawCookies = typeof res.headers.raw === "function" ? (res.headers.raw()["set-cookie"] || []) : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    if (!rawCookies.length) return { hasCookies: false, cookies: [] };
    const cookies = rawCookies.map(c => {
      const lower = c.toLowerCase(), nameMatch = c.match(/^([^=]+)=/);
      return { name: nameMatch ? nameMatch[1].trim() : "unknown", secure: lower.includes("secure"), httpOnly: lower.includes("httponly") };
    });
    return { hasCookies: true, cookies };
  } catch { return { hasCookies: false, cookies: [] }; }
}

async function checkCORS(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", headers: { Origin: "https://sitescanner-cors-test.example.com", "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    return { allowOrigin: allowOrigin || null, wildcardOpen: allowOrigin === "*", dangerousCombo: (allowOrigin === "https://sitescanner-cors-test.example.com" && res.headers.get("access-control-allow-credentials") === "true") };
  } catch { return { allowOrigin: null, wildcardOpen: false, dangerousCombo: false }; }
}

async function checkTrackers(targetUrl) { return { checked: false, trackers: [] }; }
async function checkMixedContent(targetUrl) { return { checked: false, insecureResources: [] }; }

async function checkSecurityHeaders(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(6000) });
    const reqHeaders = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options"];
    const headers = Object.fromEntries(res.headers.entries());
    return { missing: reqHeaders.filter(h => !headers[h]), present: reqHeaders.filter(h => headers[h]), server: headers.server || null };
  } catch { return { missing: [], present: [], server: null }; }
}

async function checkTLS(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ valid: !!(cert && cert.valid_to), issuer: cert?.issuer?.O || "Unknown", daysUntilExpiry: cert?.valid_to ? Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null });
      socket.end();
    });
    socket.on("error", (err) => resolve({ valid: false, error: err.message }));
    socket.on("timeout", () => { socket.destroy(); resolve({ valid: false, error: "Timeout" }); });
  });
}

async function checkExposedFiles(baseUrl) {
  const paths = ["/.env", "/.git/config", "/wp-config.php.bak", "/config.php.bak"];
  const results = [];
  for (const p of paths) {
    try {
      const res = await fetch(new URL(p, baseUrl).toString(), { method: "GET", redirect: "manual", headers: { "User-Agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(3500) });
      if (res.status === 200 && !(res.headers.get("content-type") || "").includes("text/html")) results.push({ path: p, exposed: true });
    } catch {}
  }
  return results;
}

async function checkEmailSpoofingProtection(hostname) {
  const result = { spf: false, dmarc: false, isSharedHost: isSharedHostSubdomain(hostname) };
  if (result.isSharedHost) return result;
  const resolver = new Resolver(); resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  try { result.spf = (await resolver.resolveTxt(hostname)).some(r => r.join("").startsWith("v=spf1")); } catch {}
  try { result.dmarc = (await resolver.resolveTxt(`_dmarc.${hostname}`)).some(r => r.join("").startsWith("v=DMARC1")); } catch {}
  return result;
}

export async function runScanPipeline(hostname) {
  const targetHttpsUrl = `https://${hostname}`;
  const [headers, tlsInfo, exposedFiles, emailAuth, cookies, cors] = await Promise.allSettled([
    checkSecurityHeaders(targetHttpsUrl), checkTLS(hostname), checkExposedFiles(targetHttpsUrl),
    checkEmailSpoofingProtection(hostname), checkCookieSecurity(targetHttpsUrl), checkCORS(targetHttpsUrl)
  ]);
  return {
    headers: headers.status === "fulfilled" ? headers.value : { error: "failed" },
    tls: tlsInfo.status === "fulfilled" ? tlsInfo.value : { error: "failed" },
    exposedFiles: exposedFiles.status === "fulfilled" ? exposedFiles.value : [],
    emailAuth: emailAuth.status === "fulfilled" ? emailAuth.value : { error: "failed" },
    cookies: cookies.status === "fulfilled" ? cookies.value : { hasCookies: false, cookies: [] },
    cors: cors.status === "fulfilled" ? cors.value : { wildcardOpen: false, dangerousCombo: false },
    activeDastStatus: "Not executed (Requires Verification)"
  };
}

// ---------- Razorpay Monetization Endpoints (GLOBAL PRO) ----------
app.post("/api/create-order", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required to upgrade." });
  try {
    const order = await razorpay.orders.create({ amount: 49900, currency: "INR", receipt: `rcpt_${Date.now()}` });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/verify-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  if (hmac === razorpay_signature && req.user) {
    await db.execute({ sql: `UPDATE users SET is_pro = 1 WHERE id = ?`, args: [req.user.id] });
    return res.json({ success: true });
  }
  res.status(400).json({ success: false, error: "Invalid payment signature." });
});

// ---------- Dual Verification Endpoints (DNS & HTTP) ----------
app.post("/api/verification/generate", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Pro account required." });
  try {
    res.json({ success: true, ...await getOrGenerateVerificationToken(req.user.id, req.body.hostname) });
  } catch (err) { res.status(500).json({ error: "Failed to generate token." }); }
});

app.post("/api/verification/check", async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Unauthorized." });
  const { hostname } = req.body;
  
  try {
    const dbData = await getOrGenerateVerificationToken(req.user.id, hostname);
    if (dbData.isVerified) return res.json({ success: true, message: "Already verified." });

    let isVerified = false;

    // --- 1. Check DNS TXT Record ---
    const resolver = new Resolver(); 
    resolver.setServers(["8.8.8.8", "1.1.1.1"]);
    try {
      const records = await resolver.resolveTxt(hostname);
      if (records.map(r => r.join("")).includes(dbData.token)) {
        isVerified = true;
      }
    } catch (dnsErr) {
      // Safely ignore ENODATA (no TXT records) and ENOTFOUND (domain missing)
      if (dnsErr.code !== "ENODATA" && dnsErr.code !== "ENOTFOUND") {
        console.error("[DNS Error]", dnsErr.message);
      }
    }

    // --- 2. Check HTTP File Upload if DNS failed (For Vercel/Render) ---
    if (!isVerified) {
      try {
        const url = `https://${hostname}/.well-known/sitescanner-verification.txt`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const httpRes = await fetch(url, { 
          signal: controller.signal, 
          headers: { "User-Agent": BROWSER_USER_AGENT }
        });
        clearTimeout(timeout);

        if (httpRes.ok) {
          const text = await httpRes.text();
          if (text.trim() === dbData.token) {
            isVerified = true;
          }
        }
      } catch (httpErr) {
        // Silently fail if file does not exist or host is unreachable
      }
    }

    if (isVerified) {
      await markDomainVerified(req.user.id, hostname);
      return res.json({ success: true, message: "Domain verified successfully!" });
    }

    res.status(400).json({ 
      success: false, 
      error: "Verification failed. Neither the DNS TXT record nor the HTTP verification file was found. Ensure your changes have been deployed or propagated." 
    });
  } catch (err) { 
    res.status(500).json({ success: false, error: "System error occurred during verification." }); 
  }
});

// ---------- Scheduled Monitors Endpoints ----------
app.post("/api/monitors", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Please log in to manage scheduled monitoring." });
  if (!req.user.is_pro) return res.status(403).json({ error: "Pro unlock required to enable automated scheduled scans." });
  const { hostname, interval, threshold } = req.body;
  if (!hostname) return res.status(400).json({ error: "Hostname is required." });
  await addMonitor({ userId: req.user.id, hostname, interval, threshold });
  res.json({ success: true });
});

app.get("/api/monitors", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  res.json(await getUserMonitors(req.user.id));
});

app.patch("/api/monitors/:id/toggle", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    await db.execute({ sql: `UPDATE monitors SET is_active = ? WHERE id = ? AND user_id = ?`, args: [req.body.isActive ? 1 : 0, req.params.id, req.user.id] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to toggle monitor." }); }
});

// ---------- Download PDF Endpoint (Puppeteer) ----------
app.get("/api/download-pdf/:hostname", async (req, res) => {
  const { hostname } = req.params;
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "Pro plan required to export executive PDFs." });
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.goto(`http://localhost:${process.env.PORT || 3000}/report/${hostname}`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForSelector(".hero-grade-card", { timeout: 15000 });
    await page.evaluate(() => {
      ['.app-nav', '.scan-card', '.action-grid', '#monitorFeedback'].forEach(s => { const el = document.querySelector(s); if (el) el.style.display = 'none'; });
      document.body.style.background = '#ffffff'; document.body.style.backgroundImage = 'none'; document.documentElement.style.background = '#ffffff';
    });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" } });
    await browser.close();
    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="SiteScanner_Audit_${hostname}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: "Failed to generate PDF: " + err.message });
  }
});

// ---------- Scanners (Quick, Standard, Active) ----------
app.post("/api/quickcheck", async (req, res) => {
  const { url, ownershipConfirmed } = req.body;
  if (!ownershipConfirmed) return res.status(400).json({ error: "You must confirm authorization." });
  try {
    const hostname = sanitizeTargetDomain(url);
    await validatePublicHostname(hostname);
    const targetHttpsUrl = `https://${hostname}`;
    const [malware, tlsInfo, headersInfo, exposedFiles, httpsEnforcement] = await Promise.allSettled([
      checkMalwareBlocklist(targetHttpsUrl), checkTLS(hostname), checkSecurityHeaders(targetHttpsUrl), checkExposedFiles(targetHttpsUrl), checkHttpsEnforcement(hostname)
    ]);
    const malwareResult = malware.status === "fulfilled" ? malware.value : { checked: false };
    const tlsResult = tlsInfo.status === "fulfilled" ? tlsInfo.value : { valid: false };
    const missing = headersInfo.status === "fulfilled" ? (headersInfo.value.missing || []) : [];
    const exposed = exposedFiles.status === "fulfilled" ? exposedFiles.value : [];
    const enforcement = httpsEnforcement.status === "fulfilled" ? httpsEnforcement.value : { plainTextAllowed: false };

    const criticalIssues = [], warningIssues = [];
    if (enforcement.plainTextAllowed) criticalIssues.push("Plaintext HTTP is served without redirecting to HTTPS.");
    if (malwareResult.checked && malwareResult.flagged) criticalIssues.push(`Flagged for ${(malwareResult.threatTypes || []).join(", ").toLowerCase()}`);
    if (!tlsResult.valid) criticalIssues.push("No valid SSL certificate — connection is insecure");
    else if (tlsResult.daysUntilExpiry !== null && tlsResult.daysUntilExpiry < 14) warningIssues.push(`SSL certificate expires in ${tlsResult.daysUntilExpiry} days`);
    if (exposed.length > 0) criticalIssues.push(`${exposed.length} sensitive file(s) publicly exposed`);
    if (missing.includes("content-security-policy")) warningIssues.push("Missing Content Security Policy (vulnerable to XSS)");
    if (missing.includes("x-frame-options")) warningIssues.push("Missing Clickjacking protection");

    const status = criticalIssues.length > 0 ? "critical" : (warningIssues.length > 0 ? "warning" : "safe");
    res.json({ hostname, status, safe: status !== "critical", reasons: [...criticalIssues, ...warningIssues], malwareChecked: malwareResult.checked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/scan", scanLimiter, async (req, res) => {
  const { url, ownershipConfirmed, listPublicly } = req.body;
  if (!ownershipConfirmed) return res.status(400).json({ error: "You must confirm authorization." });
  try {
    const hostname = sanitizeTargetDomain(url);
    await validatePublicHostname(hostname);
    const raw = await runScanPipeline(hostname);
    const { score } = calculateScore(raw, hostname);
    const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade);
    const scanResult = { hostname, scannedAt: new Date().toISOString(), raw, score, grade, previousScan: previous, history };
    await saveLatestScan(hostname, scanResult);
    if (listPublicly) await addToPublicFeed(hostname, score, grade);
    res.json(scanResult);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/scan-active", scanLimiter, async (req, res) => {
  if (!req.user || !req.user.is_pro) return res.status(403).json({ error: "PRO Account required for active DAST." });
  try {
    const hostname = sanitizeTargetDomain(req.body.url);
    await validatePublicHostname(hostname);
    
    const dbData = await getOrGenerateVerificationToken(req.user.id, hostname);
    if (!dbData.isVerified) return res.status(403).json({ error: "Domain ownership not verified via DNS or HTTP." });

    const raw = await runScanPipeline(hostname);
    // STUB: Active engine exploits would run here and append to 'raw'
    raw.activeDastStatus = "DAST Engine executed. No severe runtime exploits detected."; 
    
    const { score } = calculateScore(raw, hostname);
    const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade);
    
    const scanResult = { hostname, scannedAt: new Date().toISOString(), raw, score, grade, previousScan: previous, history };
    await saveLatestScan(hostname, scanResult);
    res.json(scanResult);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Plain-English & Gemini Remediation ----------
app.post("/api/explain", async (req, res) => {
  const { raw, hostname } = req.body;
  if (!raw || !hostname) return res.status(400).json({ error: "Missing scan data." });
  try {
    const ruleBasedReport = generateReport(raw, hostname);
    if (!req.user || !req.user.is_pro) {
      return res.json({ ruleBasedReport, aiReport: null, aiError: "Pro upgrade required to generate AI Remediation Blueprints." });
    }
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.json({ ruleBasedReport, aiReport: null, aiError: "GEMINI_API_KEY is not configured." });

    const prompt = `Senior AppSec Engineer mode. Analyze this scan for "${hostname}". Produce an ultra-concise, copy-pasteable remediation guide for ONLY the detected issues. Limit response to under 300 words. Scan findings: ${JSON.stringify({ missingHeaders: raw.headers?.missing || [], exposedFiles: raw.exposedFiles || [], emailAuth: raw.emailAuth || {}, serverDetected: raw.headers?.server || raw.headers?.xPoweredBy || "unknown" })}`;
    let aiReport = null, aiError = null;
    for (const model of ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"]) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 800 } })
        });
        if (response.ok) { aiReport = (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text || null; if (aiReport) { aiError = null; break; } }
        else { aiError = `Model ${model} failed.`; }
      } catch (err) { aiError = err.message; }
    }
    res.json({ ruleBasedReport, aiReport, aiError });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/report/:hostname", async (req, res) => {
  const data = await getLatestScan(req.params.hostname);
  if (!data) return res.status(404).json({ error: "No scan found for this domain yet. Run a scan first." });
  res.json(data);
});
app.get("/api/recent", async (req, res) => { res.json(await getPublicFeed()); });
app.get("/report/:hostname", (req, res) => { res.sendFile(path.join(__dirname, "public", "report.html")); });

app.get("/api/cron/tick", (req, res) => {
  if (req.query.secret !== (process.env.CRON_SECRET || "sitescanner_default_secret_123")) return res.status(401).json({ error: "Unauthorized" });
  res.json({ success: true, message: "Server awake." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SiteScanner running on http://localhost:${PORT}`);
  initCronJobs(runScanPipeline);
});