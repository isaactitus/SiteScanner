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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { generateReport, calculateScore, scoreToGrade, isSharedHostSubdomain } from "./report-generator.js";
import {
  recordScan,
  saveLatestScan,
  getLatestScan,
  addToPublicFeed,
  getPublicFeed,
  upsertUser,
  getUserProfile,
  grantDomainEntitlement,
  checkDomainEntitlement,
} from "./history-store.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || "sitescanner_dev_secret_key_12345";

// Global Standard Browser User-Agent to bypass Bot-Protection
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

// Auth Verification Middleware
app.use(async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch {
    req.user = null;
  }
  next();
});

// ---------- Authentication Endpoints ----------

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing Google credential." });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const user = await upsertUser({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture,
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const profile = await getUserProfile(user.id);
    res.json({ success: true, user: profile });
  } catch (err) {
    res.status(401).json({ error: "Authentication failed: " + err.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const profile = await getUserProfile(req.user.id);
  res.json({ user: profile });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ---------- Rate Limiting ----------

const scanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Scan limit reached. You can perform up to 10 scans per 10 minutes." },
});

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI remediation quota reached (5 requests per 10 mins). Try again shortly." },
});

// ---------- Input Normalization & SSRF Guard ----------

function sanitizeTargetDomain(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Target domain is required.");
  }
  let clean = input.trim().replace(/^(https?:\/\/)+/i, "").replace(/\/+$/, "");
  if (!clean || clean.includes(" ")) {
    throw new Error("Invalid domain format provided.");
  }
  return clean;
}

async function validatePublicHostname(hostname) {
  if (!hostname || hostname.toLowerCase() === "localhost") {
    throw new Error("Scanning localhost or internal targets is not permitted.");
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Could not resolve domain name.");
  }

  if (!addresses || addresses.length === 0) {
    throw new Error("Could not resolve domain name.");
  }

  const blockedRanges = [
    "loopback",
    "private",
    "linkLocal",
    "broadcast",
    "carrierGradeNat",
    "uniqueLocal",
    "reserved",
  ];

  for (const { address } of addresses) {
    try {
      const addr = ipaddr.parse(address);
      const range = addr.range();

      if (blockedRanges.includes(range)) {
        throw new Error(`Domain resolves to a restricted IP address (${range}).`);
      }
    } catch (err) {
      if (err.message.includes("restricted")) throw err;
      throw new Error("Invalid IP address resolved for domain.");
    }
  }

  return true;
}

// ---------- Scan Checkers ----------

async function checkHttpsEnforcement(hostname) {
  let currentUrl = `http://${hostname}`;
  const maxHops = 3;

  try {
    for (let i = 0; i < maxHops; i++) {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": BROWSER_USER_AGENT },
        timeout: 5000,
      });

      const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
      const location = res.headers.get("location");

      if (isRedirect && location) {
        const nextUrl = new URL(location, currentUrl).toString();
        if (nextUrl.toLowerCase().startsWith("https://")) {
          return { redirectsToHttps: true, plainTextAllowed: false };
        }
        currentUrl = nextUrl;
        continue;
      }

      return { redirectsToHttps: false, plainTextAllowed: true };
    }
    return { redirectsToHttps: false, plainTextAllowed: true };
  } catch {
    return { redirectsToHttps: false, plainTextAllowed: false };
  }
}

async function checkMalwareBlocklist(targetUrl) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) return { checked: false, reason: "no_api_key" };

  const body = {
    client: { clientId: "sitescanner", clientVersion: "1.0.0" },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url: targetUrl }],
    },
  };

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeout: 5000,
      }
    );
    const data = await res.json();
    if (data.error) return { checked: false, reason: "api_error" };

    const matches = data.matches || [];
    return {
      checked: true,
      flagged: matches.length > 0,
      threatTypes: matches.map((m) => m.threatType),
    };
  } catch {
    return { checked: false, reason: "network_error" };
  }
}

async function checkCookieSecurity(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 6000,
    });
    let rawCookies = [];
    if (typeof res.headers.raw === "function") {
      rawCookies = res.headers.raw()["set-cookie"] || [];
    } else {
      const single = res.headers.get("set-cookie");
      if (single) rawCookies = [single];
    }

    if (rawCookies.length === 0) {
      return { hasCookies: false, cookies: [] };
    }

    const cookies = rawCookies.map((cookieStr) => {
      const lower = cookieStr.toLowerCase();
      const nameMatch = cookieStr.match(/^([^=]+)=/);
      return {
        name: nameMatch ? nameMatch[1].trim() : "unknown",
        secure: lower.includes("secure"),
        httpOnly: lower.includes("httponly"),
        sameSite: lower.includes("samesite=strict")
          ? "Strict"
          : lower.includes("samesite=lax")
          ? "Lax"
          : lower.includes("samesite=none")
          ? "None"
          : null,
      };
    });

    return { hasCookies: true, cookies };
  } catch {
    return { hasCookies: false, cookies: [] };
  }
}

async function checkCORS(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Origin: "https://sitescanner-cors-test.example.com",
        "User-Agent": BROWSER_USER_AGENT,
      },
      timeout: 6000,
    });

    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowCredentials = res.headers.get("access-control-allow-credentials");

    const reflectsAnyOrigin = allowOrigin === "https://sitescanner-cors-test.example.com";
    const wildcardOpen = allowOrigin === "*";
    const dangerousCombo = reflectsAnyOrigin && allowCredentials === "true";

    return { allowOrigin: allowOrigin || null, wildcardOpen, reflectsAnyOrigin, dangerousCombo };
  } catch {
    return { allowOrigin: null, wildcardOpen: false, reflectsAnyOrigin: false, dangerousCombo: false };
  }
}

const TRACKER_SIGNATURES = [
  { name: "Google Analytics", pattern: /google-analytics\.com|googletagmanager\.com\/gtag/i },
  { name: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm/i },
  { name: "Facebook Pixel", pattern: /connect\.facebook\.net.*fbevents/i },
  { name: "Hotjar", pattern: /static\.hotjar\.com/i },
  { name: "Microsoft Clarity", pattern: /clarity\.ms/i },
  { name: "FullStory", pattern: /fullstory\.com/i },
  { name: "Mixpanel", pattern: /cdn\.mxpnl\.com/i },
  { name: "Segment", pattern: /cdn\.segment\.com/i },
  { name: "DoubleClick / Google Ads", pattern: /doubleclick\.net/i },
  { name: "Amplitude", pattern: /cdn\.amplitude\.com/i },
];

async function checkTrackers(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 6000,
    });
    const html = await res.text();
    const found = TRACKER_SIGNATURES.filter((t) => t.pattern.test(html)).map((t) => t.name);
    return { checked: true, trackers: found };
  } catch {
    return { checked: false, trackers: [] };
  }
}

async function checkMixedContent(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 6000,
    });
    const html = await res.text();
    const isHttps = targetUrl.startsWith("https://");
    if (!isHttps) return { checked: false, insecureResources: [] };

    const matches = [...html.matchAll(/(?:src|href)=["']http:\/\/([^"']+)["']/gi)].map((m) => m[0]);
    const unique = [...new Set(matches)].slice(0, 10);
    return { checked: true, insecureResources: unique };
  } catch {
    return { checked: false, insecureResources: [] };
  }
}

async function checkSecurityHeaders(targetUrl) {
  const requiredHeaders = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
  ];

  let currentUrl = targetUrl;
  let res;
  for (let i = 0; i < 5; i++) {
    res = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": BROWSER_USER_AGENT },
      timeout: 6000,
    });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
      currentUrl = new URL(res.headers.get("location"), currentUrl).toString();
      continue;
    }
    break;
  }

  const headers = Object.fromEntries(res.headers.entries());
  const missing = requiredHeaders.filter((h) => !headers[h]);
  const present = requiredHeaders.filter((h) => headers[h]);

  return {
    missing,
    present,
    statusCode: res.status,
    finalUrl: currentUrl,
    server: headers.server || null,
    xVercelId: headers["x-vercel-id"] || null,
    xPoweredBy: headers["x-powered-by"] || null,
  };
}

async function checkTLS(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate();
        const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null;
        const daysLeft = validTo
          ? Math.round((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;
        resolve({
          valid: !!(cert && cert.valid_to),
          issuer: cert?.issuer?.O || cert?.issuer?.CN || "Unknown",
          validTo: cert?.valid_to || null,
          daysUntilExpiry: daysLeft,
          protocol: socket.getProtocol ? socket.getProtocol() : null,
        });
        socket.end();
      }
    );
    socket.on("error", (err) => resolve({ valid: false, error: err.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ valid: false, error: "Connection timed out" });
    });
  });
}

async function checkExposedFiles(baseUrl) {
  const sensitivePaths = [
    "/.env",
    "/.git/config",
    "/wp-config.php.bak",
    "/config.php.bak",
    "/.DS_Store",
    "/backup.zip",
  ];

  const results = [];
  for (const path of sensitivePaths) {
    try {
      const res = await fetch(new URL(path, baseUrl).toString(), {
        method: "GET",
        redirect: "manual",
        timeout: 3500,
        headers: { "User-Agent": BROWSER_USER_AGENT },
      });

      if (res.status !== 200) {
        results.push({ path, exposed: false, statusCode: res.status });
        continue;
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text().catch(() => "");

      const isHtmlPage =
        contentType.includes("text/html") ||
        text.trim().toLowerCase().startsWith("<!doctype") ||
        text.toLowerCase().includes("<html");

      const looksReal = !isHtmlPage && text.length > 0;

      results.push({ path, exposed: looksReal, statusCode: res.status });
    } catch {
      results.push({ path, exposed: false, statusCode: null });
    }
  }
  return results.filter((r) => r.exposed);
}

async function checkEmailSpoofingProtection(hostname) {
  const result = { spf: false, dmarc: false, isSharedHost: isSharedHostSubdomain(hostname) };
  if (result.isSharedHost) {
    return result;
  }

  const resolver = new Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);

  try {
    const txt = await resolver.resolveTxt(hostname);
    const flat = txt.map((r) => r.join(""));
    result.spf = flat.some((r) => r.startsWith("v=spf1"));
  } catch {}

  try {
    const dmarcTxt = await resolver.resolveTxt(`_dmarc.${hostname}`);
    const flat = dmarcTxt.map((r) => r.join(""));
    result.dmarc = flat.some((r) => r.startsWith("v=DMARC1"));
  } catch {}

  return result;
}

// ---------- Razorpay Monetization Endpoints ----------

app.post("/api/create-order", async (req, res) => {
  const { hostname } = req.body;
  if (!hostname) return res.status(400).json({ error: "Hostname is required." });
  if (!razorpay) return res.status(500).json({ error: "Razorpay credentials not configured." });

  try {
    const options = {
      amount: 49900,
      currency: "INR",
      receipt: `rcpt_${Date.now().toString().slice(-8)}`,
      notes: { hostname, userId: req.user?.id || "guest" },
    };

    const order = await razorpay.orders.create(options);
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, hostname } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: "Missing signature attributes." });
  }

  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const generatedSignature = hmac.digest("hex");

  if (generatedSignature === razorpay_signature) {
    if (req.user?.id && hostname) {
      await grantDomainEntitlement(req.user.id, hostname, razorpay_order_id);
    }
    res.json({ success: true, hostname });
  } else {
    res.status(400).json({ success: false, error: "Invalid payment signature." });
  }
});

// ---------- Quick Check Endpoint ----------

app.post("/api/quickcheck", async (req, res) => {
  const { url, ownershipConfirmed } = req.body;

  if (!ownershipConfirmed) {
    return res.status(400).json({ error: "You must confirm authorization to audit this domain." });
  }

  let hostname;
  try {
    hostname = sanitizeTargetDomain(url);
    await validatePublicHostname(hostname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const targetHttpsUrl = `https://${hostname}`;

  try {
    const [malware, tlsInfo, headersInfo, exposedFiles, httpsEnforcement] = await Promise.allSettled([
      checkMalwareBlocklist(targetHttpsUrl),
      checkTLS(hostname),
      checkSecurityHeaders(targetHttpsUrl),
      checkExposedFiles(targetHttpsUrl),
      checkHttpsEnforcement(hostname),
    ]);

    const malwareResult = malware.status === "fulfilled" ? malware.value : { checked: false };
    const tlsResult = tlsInfo.status === "fulfilled" ? tlsInfo.value : { valid: false };
    const headersResult = headersInfo.status === "fulfilled" ? headersInfo.value : { missing: [] };
    const exposed = exposedFiles.status === "fulfilled" ? exposedFiles.value : [];
    const enforcement = httpsEnforcement.status === "fulfilled" ? httpsEnforcement.value : { plainTextAllowed: false };

    const criticalIssues = [];
    const warningIssues = [];

    if (enforcement.plainTextAllowed) {
      criticalIssues.push("Plaintext HTTP is served without redirecting to HTTPS.");
    }
    if (malwareResult.checked && malwareResult.flagged) {
      criticalIssues.push(`Flagged for ${(malwareResult.threatTypes || []).join(", ").toLowerCase()}`);
    }
    if (!tlsResult.valid) {
      criticalIssues.push("No valid SSL certificate — connection is insecure");
    } else if (tlsResult.daysUntilExpiry !== null && tlsResult.daysUntilExpiry < 14) {
      warningIssues.push(`SSL certificate expires in ${tlsResult.daysUntilExpiry} days`);
    }

    if (exposed.length > 0) {
      criticalIssues.push(`${exposed.length} sensitive file(s) publicly exposed`);
    }

    const missing = headersResult.missing || [];
    if (missing.includes("content-security-policy")) {
      warningIssues.push("Missing Content Security Policy (vulnerable to XSS)");
    }
    if (missing.includes("x-frame-options")) {
      warningIssues.push("Missing Clickjacking protection");
    }

    let status = "safe";
    if (criticalIssues.length > 0) {
      status = "critical";
    } else if (warningIssues.length > 0) {
      status = "warning";
    }

    res.json({
      hostname,
      status,
      safe: status !== "critical",
      reasons: [...criticalIssues, ...warningIssues],
      malwareChecked: malwareResult.checked,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Reports & Feeds ----------

app.get("/report/:hostname", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/api/report/:hostname", async (req, res) => {
  const data = await getLatestScan(req.params.hostname);
  if (!data) {
    return res.status(404).json({ error: "No scan found for this domain yet. Run a scan first." });
  }
  res.json(data);
});

app.get("/api/recent", async (req, res) => {
  const feed = await getPublicFeed();
  res.json(feed);
});

// ---------- Deep Scan (SSE Stream) ----------

app.get("/api/scan-stream", scanLimiter, async (req, res) => {
  const { url, confirmed, listPublicly } = req.query;

  if (confirmed !== "true") {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "You must confirm authorization to scan this domain." }));
  }

  let hostname;
  try {
    hostname = sanitizeTargetDomain(url);
    await validatePublicHostname(hostname);
  } catch (err) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: error_msg\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    return res.end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const targetHttpsUrl = `https://${hostname}`;

  const checkList = [
    ["headers", "Checking security headers", checkSecurityHeaders(targetHttpsUrl)],
    ["tls", "Checking SSL certificate", checkTLS(hostname)],
    ["exposedFiles", "Checking for exposed files", checkExposedFiles(targetHttpsUrl)],
    ["emailAuth", "Checking email spoofing protection", checkEmailSpoofingProtection(hostname)],
    ["cookies", "Checking cookie security", checkCookieSecurity(targetHttpsUrl)],
    ["cors", "Checking CORS policy", checkCORS(targetHttpsUrl)],
    ["mixedContent", "Checking for mixed content", checkMixedContent(targetHttpsUrl)],
    ["malware", "Checking malware/phishing status", checkMalwareBlocklist(targetHttpsUrl)],
    ["trackers", "Checking for tracking scripts", checkTrackers(targetHttpsUrl)],
  ];

  const raw = {};
  const defaults = {
    headers: { error: "failed" },
    tls: { error: "failed" },
    exposedFiles: [],
    emailAuth: { error: "failed" },
    cookies: { hasCookies: false, cookies: [] },
    cors: { allowOrigin: null, wildcardOpen: false, reflectsAnyOrigin: false, dangerousCombo: false },
    mixedContent: { checked: false, insecureResources: [] },
    malware: { checked: false, reason: "error" },
    trackers: { checked: false, trackers: [] },
  };

  const settledPromises = checkList.map(([key, label, promise]) =>
    promise
      .then((value) => {
        raw[key] = value;
        send("progress", { key, label, status: "done" });
      })
      .catch((err) => {
        raw[key] = defaults[key];
        send("progress", { key, label, status: "error", message: err.message });
      })
  );

  await Promise.allSettled(settledPromises);

  try {
    const { score } = calculateScore(raw, hostname);
    const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade);

    const scanResult = {
      hostname,
      scannedAt: new Date().toISOString(),
      raw,
      score,
      grade,
      previousScan: previous,
      history,
    };

    await saveLatestScan(hostname, scanResult);
    if (listPublicly === "true") {
      await addToPublicFeed(hostname, score, grade);
    }

    send("done", scanResult);
  } catch (err) {
    send("error_msg", { error: err.message });
  }

  res.end();
});

// ---------- Standard Scan ----------

app.post("/api/scan", scanLimiter, async (req, res) => {
  const { url, ownershipConfirmed, listPublicly } = req.body;

  if (!ownershipConfirmed) {
    return res.status(400).json({ error: "You must confirm authorization to scan this domain." });
  }

  let hostname;
  try {
    hostname = sanitizeTargetDomain(url);
    await validatePublicHostname(hostname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const targetHttpsUrl = `https://${hostname}`;

  try {
    const [headers, tlsInfo, exposedFiles, emailAuth, cookies, cors, mixedContent, malware, trackers] = await Promise.allSettled([
      checkSecurityHeaders(targetHttpsUrl),
      checkTLS(hostname),
      checkExposedFiles(targetHttpsUrl),
      checkEmailSpoofingProtection(hostname),
      checkCookieSecurity(targetHttpsUrl),
      checkCORS(targetHttpsUrl),
      checkMixedContent(targetHttpsUrl),
      checkMalwareBlocklist(targetHttpsUrl),
      checkTrackers(targetHttpsUrl),
    ]);

    const raw = {
      headers: headers.status === "fulfilled" ? headers.value : { error: headers.reason?.message },
      tls: tlsInfo.status === "fulfilled" ? tlsInfo.value : { error: tlsInfo.reason?.message },
      exposedFiles: exposedFiles.status === "fulfilled" ? exposedFiles.value : [],
      emailAuth: emailAuth.status === "fulfilled" ? emailAuth.value : { error: emailAuth.reason?.message },
      cookies: cookies.status === "fulfilled" ? cookies.value : { hasCookies: false, cookies: [] },
      cors: cors.status === "fulfilled" ? cors.value : { allowOrigin: null, wildcardOpen: false, reflectsAnyOrigin: false, dangerousCombo: false },
      mixedContent: mixedContent.status === "fulfilled" ? mixedContent.value : { checked: false, insecureResources: [] },
      malware: malware.status === "fulfilled" ? malware.value : { checked: false, reason: "error" },
      trackers: trackers.status === "fulfilled" ? trackers.value : { checked: false, trackers: [] },
    };

    const { score } = calculateScore(raw, hostname);
    const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade);

    const scanResult = {
      hostname,
      scannedAt: new Date().toISOString(),
      raw,
      score,
      grade,
      previousScan: previous,
      history,
    };

    await saveLatestScan(hostname, scanResult);

    if (listPublicly) {
      await addToPublicFeed(hostname, score, grade);
    }

    res.json(scanResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Plain-English & Gemini Remediation ----------

app.post("/api/explain", aiLimiter, async (req, res) => {
  const { raw, hostname } = req.body;

  if (!raw || !hostname) {
    return res.status(400).json({ error: "Missing scan data." });
  }

  try {
    const ruleBasedReport = generateReport(raw, hostname);
    let aiReport = null;
    let aiError = null;

    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      aiError = "GEMINI_API_KEY is not configured in .env";
    } else {
      const prompt = `Senior AppSec Engineer mode. Analyze this scan for "${hostname}".
Produce an ultra-concise, copy-pasteable remediation guide for ONLY the detected issues.
Do not define concepts (no "What is XSS"). Give a 1-2 line diagnosis and the direct config block for the detected server/proxy (e.g. Nginx, Cloudflare, Next.js, or DNS).
Limit response to under 300 words.

Scan findings:
${JSON.stringify({
  missingHeaders: raw.headers?.missing || [],
  exposedFiles: raw.exposedFiles || [],
  emailAuth: raw.emailAuth || {},
  serverDetected: raw.headers?.server || raw.headers?.xPoweredBy || "unknown",
})}`;

      const candidateModels = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"];
      let succeeded = false;

      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 800,
                },
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            aiReport = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (aiReport) {
              succeeded = true;
              aiError = null;
              break;
            }
          } else {
            const errText = await response.text();
            aiError = `Model ${model} returned ${response.status}: ${errText}`;
          }
        } catch (err) {
          aiError = `Model ${model} request failed: ${err.message}`;
        }
      }

      if (!succeeded && !aiReport) {
        console.error("All Gemini candidate models failed. Last error:", aiError);
      }
    }

    res.json({ ruleBasedReport, aiReport, aiError });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SiteScanner running on http://localhost:${PORT}`));