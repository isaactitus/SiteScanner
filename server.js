// SiteScanner - Passive Security Health Checker
// Only performs read-only, non-intrusive checks (no exploitation, no brute force, no port scanning of arbitrary hosts).
// Users must confirm ownership/permission before scanning (enforced client-side + noted in ToS).

import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import dns from "dns/promises";
import { Resolver } from "dns/promises";
import tls from "tls";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { generateReport } from "./report-generator.js";
import { calculateScore, scoreToGrade } from "./report-generator.js";
import { recordScan } from "./history-store.js";
import { saveLatestScan, getLatestScan, addToPublicFeed, getPublicFeed } from "./history-store.js";
import rateLimit from "express-rate-limit";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Limits each IP to 10 scans per 15 minutes. Protects the server from being
// hammered and keeps it usable for everyone since this is a free public tool.
const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many scans from this IP. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------- Helper checks ----------

async function checkMalwareBlocklist(targetUrl) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) {
    return { checked: false, reason: "no_api_key" };
  }

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
      }
    );
    const data = await res.json();

    if (data.error) {
      console.error("Safe Browsing API error:", data.error.message);
      return { checked: false, reason: "api_error" };
    }

    const matches = data.matches || [];
    return {
      checked: true,
      flagged: matches.length > 0,
      threatTypes: matches.map((m) => m.threatType),
    };
  } catch (err) {
    console.error("Safe Browsing check failed:", err.message);
    return { checked: false, reason: "network_error" };
  }
}

async function checkCookieSecurity(targetUrl) {
  const res = await fetch(targetUrl, { method: "GET", redirect: "follow" });
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
}

async function checkCORS(targetUrl) {
  // Send a request with an arbitrary, clearly-foreign Origin header and see
  // what the server echoes back — the same thing a browser does automatically
  // on any cross-origin request. Fully passive, no exploitation.
  const res = await fetch(targetUrl, {
    method: "GET",
    headers: { Origin: "https://sitescanner-cors-test.example.com" },
  });

  const allowOrigin = res.headers.get("access-control-allow-origin");
  const allowCredentials = res.headers.get("access-control-allow-credentials");

  const reflectsAnyOrigin = allowOrigin === "https://sitescanner-cors-test.example.com";
  const wildcardOpen = allowOrigin === "*";
  const dangerousCombo = reflectsAnyOrigin && allowCredentials === "true";

  return { allowOrigin: allowOrigin || null, wildcardOpen, reflectsAnyOrigin, dangerousCombo };
}

const TRACKER_SIGNATURES = [
  { name: "Google Analytics", pattern: /google-analytics\.com|googletagmanager\.com\/gtag/i },
  { name: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm/i },
  { name: "Facebook Pixel", pattern: /connect\.facebook\.net.*fbevents/i },
  { name: "Hotjar (session recording)", pattern: /static\.hotjar\.com/i },
  { name: "Microsoft Clarity (session recording)", pattern: /clarity\.ms/i },
  { name: "FullStory (session recording)", pattern: /fullstory\.com/i },
  { name: "Mixpanel", pattern: /cdn\.mxpnl\.com/i },
  { name: "Segment", pattern: /cdn\.segment\.com/i },
  { name: "DoubleClick / Google Ads", pattern: /doubleclick\.net/i },
  { name: "Amplitude", pattern: /cdn\.amplitude\.com/i },
];

async function checkTrackers(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow" });
    const html = await res.text();

    const found = TRACKER_SIGNATURES.filter((t) => t.pattern.test(html)).map((t) => t.name);
    return { checked: true, trackers: found };
  } catch {
    return { checked: false, trackers: [] };
  }
}

async function checkMixedContent(targetUrl) {
  try {
    const res = await fetch(targetUrl, { method: "GET", redirect: "follow" });
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

  // Follow redirects manually so we always inspect the FINAL response's headers,
  // not an intermediate redirect hop that may not carry security headers itself.
  let currentUrl = targetUrl;
  let res;
  for (let i = 0; i < 5; i++) {
    res = await fetch(currentUrl, { method: "GET", redirect: "manual" });
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
    // Include raw server-identifying headers too — platform detection
    // (Vercel/WordPress/Nginx/etc.) needs these, and they were previously
    // dropped here, which silently broke platform-specific fix code.
    server: headers.server || null,
    xVercelId: headers["x-vercel-id"] || null,
    xPoweredBy: headers["x-powered-by"] || null,
  };
}

async function checkTLS(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 5000 },
      () => {
        // getPeerCertificate() is the correct API on a TLSSocket; getCertificate()
        // returns the LOCAL (client) cert, which is empty for outbound connections
        // and was causing valid_to to be undefined -> "null days".
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

  // Many hosts (Vercel, Netlify, etc.) return 200 with a custom "not found" page
  // instead of a real 404 status. To avoid false positives, first fetch a path
  // that definitely doesn't exist and use ITS response as the baseline "not found"
  // signature (status + rough content length). A sensitive path is only flagged
  // as exposed if it differs meaningfully from that baseline.
  const probePath = `/__sitescanner_probe_${Date.now()}`;
  let baseline = { status: 404, length: 0 };
  try {
    const probeRes = await fetch(new URL(probePath, baseUrl).toString(), {
      method: "GET",
      redirect: "manual",
    });
    const probeText = await probeRes.text().catch(() => "");
    baseline = { status: probeRes.status, length: probeText.length };
  } catch {
    // If the probe itself fails, fall back to assuming 404 = not found
  }

  const results = [];
  for (const path of sensitivePaths) {
    try {
      const res = await fetch(new URL(path, baseUrl).toString(), {
        method: "GET",
        redirect: "manual",
      });
      const text = await res.text().catch(() => "");

      const sameStatusAsBaseline = res.status === baseline.status;
      const similarLengthToBaseline =
        baseline.length > 0 && Math.abs(text.length - baseline.length) < 50;

      // Only flag as exposed if it returns success AND doesn't look like the
      // same generic "not found" page the baseline probe got back.
      const looksReal =
        res.status === 200 && !(sameStatusAsBaseline && similarLengthToBaseline);

      results.push({ path, exposed: looksReal, statusCode: res.status });
    } catch {
      results.push({ path, exposed: false, statusCode: null });
    }
  }
  return results.filter((r) => r.exposed);
}

async function checkEmailSpoofingProtection(hostname) {
  const result = { spf: false, dmarc: false };

  // Use an explicit, reliable public resolver (Google's 8.8.8.8) instead of
  // whatever DNS server the local machine happens to be configured with.
  // Some ISP/router DNS setups silently fail or truncate TXT record lookups,
  // which was causing false "Missing" results for domains that actually have
  // valid SPF/DMARC records (confirmed bug found testing against google.com).
  const resolver = new Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);

  try {
    const txt = await resolver.resolveTxt(hostname);
    const flat = txt.map((r) => r.join(""));
    result.spf = flat.some((r) => r.startsWith("v=spf1"));
  } catch (err) {
    console.error(`SPF lookup failed for ${hostname}:`, err.message);
  }

  try {
    const dmarcTxt = await resolver.resolveTxt(`_dmarc.${hostname}`);
    const flat = dmarcTxt.map((r) => r.join(""));
    result.dmarc = flat.some((r) => r.startsWith("v=DMARC1"));
  } catch (err) {
    console.error(`DMARC lookup failed for ${hostname}:`, err.message);
  }

  return result;
}

// ---------- Main scan endpoint ----------

// ---------- Quick Check: simple Safe/Unsafe answer, no technical report ----------
// Same pattern as Google's own Safe Browsing Site Status Tool: lead with one
// clear answer, let people drill into the full technical scan separately.

app.post("/api/quickcheck", scanLimiter, async (req, res) => {
  const { url, ownershipConfirmed } = req.body;

  if (!ownershipConfirmed) {
    return res.status(400).json({ error: "You must confirm you own or have permission to check this domain." });
  }
  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  let parsed;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const hostname = parsed.hostname;

  try {
    const [malware, tlsInfo] = await Promise.allSettled([
      checkMalwareBlocklist(parsed.toString()),
      checkTLS(hostname),
    ]);

    const malwareResult = malware.status === "fulfilled" ? malware.value : { checked: false };
    const tlsResult = tlsInfo.status === "fulfilled" ? tlsInfo.value : { valid: false };

    const reasons = [];
    let safe = true;

    if (malwareResult.checked && malwareResult.flagged) {
      safe = false;
      reasons.push(`Flagged by Google Safe Browsing for ${(malwareResult.threatTypes || []).join(", ").toLowerCase()}`);
    }
    if (!tlsResult.valid) {
      safe = false;
      reasons.push("No valid SSL certificate — connection is not secure");
    }

    res.json({
      hostname,
      safe,
      reasons,
      malwareChecked: malwareResult.checked,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Shareable report page + data ----------

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

// ---------- Progressive scan via Server-Sent Events ----------
// Runs the same checks as /api/scan, but streams a "progress" event the
// instant each individual check finishes, instead of making the browser
// wait for all 9 to complete before showing anything. Final event carries
// the complete result, identical in shape to the POST /api/scan response,
// so the same renderResults() function works for both.

app.get("/api/scan-stream", scanLimiter, async (req, res) => {
  const { url, confirmed, listPublicly } = req.query;

  if (confirmed !== "true") {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "You must confirm you own or have permission to scan this domain." }));
  }
  if (!url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing url" }));
  }

  let parsed;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid URL" }));
  }

  const hostname = parsed.hostname;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Each entry: [key in raw object, human label shown while it runs, promise]
  const checkList = [
    ["headers", "Checking security headers", checkSecurityHeaders(parsed.toString())],
    ["tls", "Checking SSL certificate", checkTLS(hostname)],
    ["exposedFiles", "Checking for exposed files", checkExposedFiles(parsed.toString())],
    ["emailAuth", "Checking email spoofing protection", checkEmailSpoofingProtection(hostname)],
    ["cookies", "Checking cookie security", checkCookieSecurity(parsed.toString())],
    ["cors", "Checking CORS policy", checkCORS(parsed.toString())],
    ["mixedContent", "Checking for mixed content", checkMixedContent(parsed.toString())],
    ["malware", "Checking malware/phishing status", checkMalwareBlocklist(parsed.toString())],
    ["trackers", "Checking for tracking scripts", checkTrackers(parsed.toString())],
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
    const { score } = calculateScore(raw);
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
    send("error", { error: err.message });
  }

  res.end();
});

app.post("/api/scan", scanLimiter, async (req, res) => {
  const { url, ownershipConfirmed } = req.body;

  if (!ownershipConfirmed) {
    return res.status(400).json({ error: "You must confirm you own or have permission to scan this domain." });
  }
  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  let parsed;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const hostname = parsed.hostname;

  try {
    const [headers, tlsInfo, exposedFiles, emailAuth, cookies, cors, mixedContent, malware, trackers] = await Promise.allSettled([
      checkSecurityHeaders(parsed.toString()),
      checkTLS(hostname),
      checkExposedFiles(parsed.toString()),
      checkEmailSpoofingProtection(hostname),
      checkCookieSecurity(parsed.toString()),
      checkCORS(parsed.toString()),
      checkMixedContent(parsed.toString()),
      checkMalwareBlocklist(parsed.toString()),
      checkTrackers(parsed.toString()),
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

    // Calculate score now (not just when the plain-English report is
    // requested) so every scan — even if the user never clicks "Get Report"
    // — contributes to that domain's progress history.
    const { score } = calculateScore(raw);
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

    // Save as the latest scan for this hostname so /report/:hostname can
    // show it later — same public-visibility model as SSL Labs/Mozilla
    // Observatory, where scanning a public site's security posture is
    // treated as public information, not a private user record.
    await saveLatestScan(hostname, scanResult);

    // Public activity feed is opt-in only (separate from the always-available
    // permalink above) since a feed surfaces scans proactively to everyone,
    // which is a bigger visibility step than a link only found if shared.
    if (req.body.listPublicly) {
      await addToPublicFeed(hostname, score, grade);
    }

    res.json(scanResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Plain-English report: rule-based, always free, no API needed ----------

app.post("/api/explain", async (req, res) => {
  const { raw, hostname } = req.body;

  if (!raw || !hostname) {
    return res.status(400).json({ error: "Missing scan data." });
  }

  try {
    const report = generateReport(raw, hostname);
    res.json({ report, engine: "rule-based" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SiteScanner running on http://localhost:${PORT}`));