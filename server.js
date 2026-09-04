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
import { generateReport } from "./report-generator.js";
import { calculateScore, scoreToGrade } from "./report-generator.js";
import { recordScan } from "./history-store.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

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
    const [headers, tlsInfo, exposedFiles, emailAuth, cookies, cors, mixedContent, malware] = await Promise.allSettled([
      checkSecurityHeaders(parsed.toString()),
      checkTLS(hostname),
      checkExposedFiles(parsed.toString()),
      checkEmailSpoofingProtection(hostname),
      checkCookieSecurity(parsed.toString()),
      checkCORS(parsed.toString()),
      checkMixedContent(parsed.toString()),
      checkMalwareBlocklist(parsed.toString()),
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
    };

    // Calculate score now (not just when the plain-English report is
    // requested) so every scan — even if the user never clicks "Get Report"
    // — contributes to that domain's progress history.
    const { score } = calculateScore(raw);
    const grade = scoreToGrade(score);
    const { previous, history } = await recordScan(hostname, score, grade);

    res.json({
      hostname,
      scannedAt: new Date().toISOString(),
      raw,
      score,
      grade,
      previousScan: previous,
      history,
    });
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