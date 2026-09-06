// SiteScanner - Passive Security Health Checker
import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import dns from "dns/promises";
import { Resolver } from "dns/promises";
import tls from "tls";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import ipaddr from "ipaddr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { generateReport, calculateScore, scoreToGrade, isSharedHostSubdomain } from "./report-generator.js";
import { recordScan, saveLatestScan, getLatestScan, addToPublicFeed, getPublicFeed } from "./history-store.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------- SSRF Guard ----------
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
        throw new Error(`Domain resolves to a restricted or private IP address (${range}).`);
      }
    } catch (err) {
      if (err.message.includes("restricted")) throw err;
      throw new Error("Invalid IP address resolved for domain.");
    }
  }

  return true;
}

// ---------- Check Functions ----------

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
  } catch (err) {
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
        headers: { "User-Agent": "SiteScanner/1.0" },
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
  } catch (err) {}

  try {
    const dmarcTxt = await resolver.resolveTxt(`_dmarc.${hostname}`);
    const flat = dmarcTxt.map((r) => r.join(""));
    result.dmarc = flat.some((r) => r.startsWith("v=DMARC1"));
  } catch (err) {}

  return result;
}

// ---------- Quick Check ----------

app.post("/api/quickcheck", async (req, res) => {
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
    await validatePublicHostname(hostname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const [malware, tlsInfo, headersInfo, exposedFiles] = await Promise.allSettled([
      checkMalwareBlocklist(parsed.toString()),
      checkTLS(hostname),
      checkSecurityHeaders(parsed.toString()),
      checkExposedFiles(parsed.toString()),
    ]);

    const malwareResult = malware.status === "fulfilled" ? malware.value : { checked: false };
    const tlsResult = tlsInfo.status === "fulfilled" ? tlsInfo.value : { valid: false };
    const headersResult = headersInfo.status === "fulfilled" ? headersInfo.value : { missing: [] };
    const exposed = exposedFiles.status === "fulfilled" ? exposedFiles.value : [];

    const criticalIssues = [];
    const warningIssues = [];

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

// ---------- Progressive Scan (SSE) ----------

app.get("/api/scan-stream", async (req, res) => {
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

  try {
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

app.post("/api/scan", async (req, res) => {
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
    await validatePublicHostname(hostname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

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

    if (req.body.listPublicly) {
      await addToPublicFeed(hostname, score, grade);
    }

    res.json(scanResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Plain-English Report (Rule-based + Gemini Remediation) ----------

app.post("/api/explain", async (req, res) => {
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
      aiError = "No GEMINI_API_KEY found in .env file.";
      console.warn("API Explain: GEMINI_API_KEY is not defined in environment.");
    } else {
      try {
        const prompt = `You are a senior web application security engineer. Analyze the following passive security scan for "${hostname}".
Write a concise, actionable remediation guide for a developer. 
Do not waste time explaining basic concepts (like what XSS is). Instead, focus entirely on HOW to fix the missing headers or vulnerabilities. Provide exact configuration snippets matching the detected hosting platform.
Use clean markdown with headers and code blocks.

Raw Scan Data:
${JSON.stringify(raw, null, 2)}`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2 },
            }),
          }
        );

        if (!response.ok) {
          const errBody = await response.text();
          console.error(`Gemini API Error HTTP ${response.status}:`, errBody);
          aiError = `Gemini API returned status ${response.status}. Check server logs.`;
        } else {
          const data = await response.json();
          aiReport = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
          if (!aiReport) {
            console.warn("Gemini response missing candidate content:", JSON.stringify(data));
            aiError = "Gemini returned an empty candidate response.";
          }
        }
      } catch (err) {
        console.error("Gemini API call threw an exception:", err.message);
        aiError = `Request failed: ${err.message}`;
      }
    }

    res.json({ ruleBasedReport, aiReport, aiError });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SiteScanner running on http://localhost:${PORT}`));