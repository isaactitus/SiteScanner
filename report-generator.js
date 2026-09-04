// report-generator.js
// A rule-based (non-AI) engine that turns raw scan data into a genuinely
// useful, prioritized, plain-English report. No external API calls, no
// rate limits, no cost — runs instantly, forever, for free.

import { generateFixCode } from "./fix-code-generator.js";

// ---------- Platform detection ----------
// Tailors fix instructions to the actual hosting stack instead of generic advice.
function detectPlatform(headers, exposedFiles) {
  const h = headers || {};
  const server = (h.server || "").toLowerCase();
  const poweredBy = (h.xPoweredBy || "").toLowerCase();

  if (server.includes("vercel") || h.xVercelId) return "vercel";
  if (poweredBy.includes("wordpress") || (exposedFiles || []).some(f => f.path.includes("wp-"))) return "wordpress";
  if (server.includes("nginx")) return "nginx";
  if (server.includes("apache")) return "apache";
  if (server.includes("cloudflare")) return "cloudflare";
  return "unknown";
}

// ---------- Severity scoring ----------
// Not all issues are equal. Missing CSP is a bigger deal than missing
// Permissions-Policy. This weighting drives both the score and the
// "fix this first" ordering.
const HEADER_SEVERITY = {
  "content-security-policy": 20,
  "strict-transport-security": 18,
  "x-frame-options": 12,
  "x-content-type-options": 8,
  "referrer-policy": 6,
  "permissions-policy": 6,
};

function calculateScore(raw) {
  let score = 100;
  const deductions = [];

  // TLS
  if (!raw.tls?.valid) {
    score -= 30;
    deductions.push({ reason: "SSL/TLS certificate invalid or unreachable", points: 30 });
  } else if (raw.tls.daysUntilExpiry !== null && raw.tls.daysUntilExpiry < 14) {
    score -= 10;
    deductions.push({ reason: "SSL certificate expiring very soon", points: 10 });
  }

  // Headers
  (raw.headers?.missing || []).forEach((h) => {
    const pts = HEADER_SEVERITY[h] || 5;
    score -= pts;
    deductions.push({ reason: `Missing ${h} header`, points: pts });
  });

  // Exposed files — always severe, these are direct data leaks
  const exposedCount = (raw.exposedFiles || []).length;
  if (exposedCount > 0) {
    const pts = Math.min(exposedCount * 15, 40);
    score -= pts;
    deductions.push({ reason: `${exposedCount} sensitive file(s) publicly exposed`, points: pts });
  }

  // Email spoofing
  if (!raw.emailAuth?.spf) {
    score -= 5;
    deductions.push({ reason: "No SPF record", points: 5 });
  }
  if (!raw.emailAuth?.dmarc) {
    score -= 5;
    deductions.push({ reason: "No DMARC record", points: 5 });
  }

  // Cookies
  const insecureCookies = (raw.cookies?.cookies || []).filter((c) => !c.secure || !c.httpOnly);
  if (insecureCookies.length > 0) {
    const pts = Math.min(insecureCookies.length * 8, 20);
    score -= pts;
    deductions.push({ reason: `${insecureCookies.length} cookie(s) missing Secure/HttpOnly flags`, points: pts });
  }

  // CORS
  if (raw.cors?.dangerousCombo) {
    score -= 20;
    deductions.push({ reason: "Dangerous CORS config: reflects any origin + allows credentials", points: 20 });
  } else if (raw.cors?.wildcardOpen) {
    score -= 8;
    deductions.push({ reason: "CORS wide open (Access-Control-Allow-Origin: *)", points: 8 });
  }

  // Mixed content
  if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length > 0) {
    const pts = Math.min(raw.mixedContent.insecureResources.length * 4, 15);
    score -= pts;
    deductions.push({ reason: `${raw.mixedContent.insecureResources.length} insecure (HTTP) resource(s) on HTTPS page`, points: pts });
  }

  // Malware/blocklist — most severe possible finding, weighted accordingly
  if (raw.malware?.checked && raw.malware.flagged) {
    score -= 50;
    deductions.push({ reason: `Flagged by Google Safe Browsing: ${(raw.malware.threatTypes || []).join(", ")}`, points: 50 });
  }

  return { score: Math.max(0, Math.round(score)), deductions };
}

// ---------- Explanation templates ----------
// Multiple phrasing variants per issue so reports don't read like a robotic
// copy-paste — one is picked based on a simple hash of the hostname so the
// SAME site always gets the SAME phrasing (consistent), but different sites
// get variety.

const HEADER_EXPLANATIONS = {
  "content-security-policy": {
    what: [
      "Your site doesn't tell browsers which sources of scripts, styles, and content are allowed to run.",
      "There's no policy in place restricting what content sources your site trusts.",
    ],
    why: [
      "Without this, if an attacker manages to inject malicious code (via a comment field, ad, or compromised script), the browser has no rules stopping it from running.",
      "This is one of the strongest defenses against cross-site scripting (XSS) attacks — without it, injected scripts run freely.",
    ],
    fix: {
      vercel: "Add a `headers()` block in your `next.config.js` (or `vercel.json`) setting Content-Security-Policy. Start permissive (e.g. `default-src 'self'`) and tighten gradually.",
      wordpress: "Use a security plugin like Wordfence or Really Simple SSL, which can set CSP headers without touching code.",
      unknown: "Add a Content-Security-Policy header at your server or CDN level. Start with `default-src 'self'` and expand as needed.",
    },
  },
  "strict-transport-security": {
    what: [
      "Your site doesn't instruct browsers to always use HTTPS for future visits.",
      "There's no enforcement telling browsers 'never load this site over plain HTTP.'",
    ],
    why: [
      "Without it, a user's first visit (or a network attacker) could downgrade them to an insecure HTTP connection, exposing data in transit.",
      "This closes a small but real window where traffic could be intercepted before HTTPS kicks in.",
    ],
    fix: {
      vercel: "Add `Strict-Transport-Security: max-age=63072000; includeSubDomains` via your `next.config.js` headers config.",
      wordpress: "Most security plugins (Wordfence, iThemes Security) have a one-click HSTS toggle.",
      unknown: "Add `Strict-Transport-Security: max-age=63072000; includeSubDomains` at your server/CDN config.",
    },
  },
  "x-frame-options": {
    what: [
      "Your site can be embedded inside an invisible iframe on another website.",
      "There's nothing stopping other sites from loading your pages inside a hidden frame.",
    ],
    why: [
      "This enables 'clickjacking' — tricking users into clicking something on your real site while thinking they're interacting with a different page.",
      "Attackers can layer your login/payment buttons under fake content to steal clicks.",
    ],
    fix: {
      vercel: "Add `X-Frame-Options: DENY` (or `SAMEORIGIN` if you legitimately need framing) in your headers config.",
      wordpress: "Enable clickjacking protection in your security plugin's settings.",
      unknown: "Add `X-Frame-Options: DENY` or `SAMEORIGIN` at your server config.",
    },
  },
  "x-content-type-options": {
    what: [
      "Browsers are allowed to guess file types instead of trusting what your server declares.",
    ],
    why: [
      "This 'MIME sniffing' can let a malicious file disguised as an image actually execute as a script.",
    ],
    fix: {
      vercel: "Add `X-Content-Type-Options: nosniff` in your headers config — one line, no downside.",
      wordpress: "Most security plugins enable this by default; check under HTTP headers settings.",
      unknown: "Add `X-Content-Type-Options: nosniff` at your server config — safe, simple, no downside.",
    },
  },
  "referrer-policy": {
    what: [
      "Your site doesn't control how much of your URL gets shared with other sites when users click outbound links.",
    ],
    why: [
      "Full URLs (which can contain session tokens, search queries, or internal page structure) may leak to third-party sites in the Referer header.",
    ],
    fix: {
      vercel: "Add `Referrer-Policy: strict-origin-when-cross-origin` in your headers config — a safe, commonly used default.",
      wordpress: "Set this via your security plugin, or add it through a header-management plugin.",
      unknown: "Add `Referrer-Policy: strict-origin-when-cross-origin` at your server config.",
    },
  },
  "permissions-policy": {
    what: [
      "Your site doesn't restrict which browser features (camera, microphone, geolocation) pages are allowed to request.",
    ],
    why: [
      "If a third-party script gets injected via any other vulnerability, this is one more layer stopping it from accessing sensitive device features.",
    ],
    fix: {
      vercel: "Add a `Permissions-Policy` header disabling features you don't use, e.g. `camera=(), microphone=(), geolocation=()`.",
      wordpress: "Lower priority — add via a header plugin once the higher-severity items above are fixed.",
      unknown: "Add a `Permissions-Policy` header disabling unused browser features.",
    },
  },
};

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function pick(arr, seed) {
  return arr[seed % arr.length];
}

// ---------- Main report builder ----------

function generateReport(raw, hostname) {
  const { score, deductions } = calculateScore(raw);
  const platform = detectPlatform(raw.headers, raw.exposedFiles);
  const seed = simpleHash(hostname);

  let grade = scoreToGrade(score);

  const lines = [];
  lines.push(`# Security Scan Report for ${hostname}`);
  lines.push("");
  lines.push(`## Overall Grade: ${grade} (${score}/100)`);
  lines.push("");

  if (score >= 90) {
    lines.push("Excellent shape. Your site has strong, well-configured security fundamentals — only minor polish items below, if any.");
  } else if (score >= 75) {
    lines.push("Good foundation. Your core security (SSL, no exposed files) is solid, with some straightforward hardening left to do.");
  } else if (score >= 60) {
    lines.push("Decent starting point, but there are a few gaps worth closing soon — none of these are emergencies, but they add up.");
  } else if (score >= 40) {
    lines.push("Several important protections are missing. None of this means you've been hacked, but you're more exposed than you should be.");
  } else {
    lines.push("This site has significant gaps. Start with the highest-priority items below as soon as you can.");
  }
  lines.push("");

  // Sort issues by severity for "fix this first" ordering
  const sortedDeductions = [...deductions].sort((a, b) => b.points - a.points);
  const insecureCookies = (raw.cookies?.cookies || []).filter((c) => !c.secure || !c.httpOnly);

  if (sortedDeductions.length === 0) {
    lines.push("## No issues found");
    lines.push("Every check passed. Nothing to fix right now — just keep an eye on your SSL renewal date.");
  } else {
    lines.push("## Issues Found (highest priority first)");
    lines.push("");

    let num = 1;

    // Malware/blocklist — always shown first, most urgent possible finding
    if (raw.malware?.checked && raw.malware.flagged) {
      lines.push(`### ${num}. 🚨 Flagged by Google Safe Browsing`);
      lines.push(`**What this means:** Google has flagged this site for: ${(raw.malware.threatTypes || []).join(", ").toLowerCase()}.`);
      lines.push(`**Why it matters:** This is urgent — browsers (Chrome, Firefox, Safari) will show a full-page warning to visitors, and search engines will demote or delist the site. This usually means the site has been compromised.`);
      lines.push(`**Fix:** Check Google Search Console immediately for details, scan your site files for injected/unknown code, change all admin passwords, and request a review from Google once cleaned up.`);
      lines.push("");
      num++;
    }

    // TLS issues
    if (!raw.tls?.valid) {
      lines.push(`### ${num}. SSL Certificate Problem`);
      lines.push(`**What this means:** ${raw.tls?.error || "Your site's SSL certificate couldn't be verified."}`);
      lines.push(`**Why it matters:** Visitors will see security warnings, browsers may block the page entirely, and search engines penalize insecure sites.`);
      lines.push(`**Fix:** Check your certificate configuration with your hosting provider immediately — this is the highest priority item on this list.`);
      lines.push("");
      num++;
    } else if (raw.tls.daysUntilExpiry !== null && raw.tls.daysUntilExpiry < 14) {
      lines.push(`### ${num}. SSL Certificate Expiring Soon`);
      lines.push(`**What this means:** Your certificate expires in ${raw.tls.daysUntilExpiry} days.`);
      lines.push(`**Why it matters:** An expired certificate shows scary browser warnings to every visitor and can drop your search rankings.`);
      lines.push(`**Fix:** Most hosts (Vercel, Netlify, Cloudflare) auto-renew — verify auto-renewal is enabled in your dashboard.`);
      lines.push("");
      num++;
    }

    // Exposed files
    if ((raw.exposedFiles || []).length > 0) {
      lines.push(`### ${num}. Exposed Sensitive Files`);
      lines.push(`**What this means:** These paths are publicly accessible: ${raw.exposedFiles.map(f => f.path).join(", ")}`);
      lines.push(`**Why it matters:** These files often contain database passwords, API keys, or source code — anyone can view them right now.`);
      lines.push(`**Fix:** Remove or block public access to these files immediately. This is urgent — treat it like a live incident, not a backlog item.`);
      lines.push("");
      num++;
    }

    // Headers, sorted by severity
    const missingHeaders = (raw.headers?.missing || []).sort(
      (a, b) => (HEADER_SEVERITY[b] || 5) - (HEADER_SEVERITY[a] || 5)
    );
    missingHeaders.forEach((h) => {
      const info = HEADER_EXPLANATIONS[h];
      if (!info) return;
      lines.push(`### ${num}. Missing ${h} Header`);
      lines.push(`**What this means:** ${pick(info.what, seed + num)}`);
      lines.push(`**Why it matters:** ${pick(info.why, seed + num)}`);
      lines.push(`**Fix:** ${info.fix[platform] || info.fix.unknown}`);
      lines.push("");
      num++;
    });

    // Combined copy-paste fix code for all missing headers at once —
    // real syntax for the detected platform, not just prose per-header advice.
    const fixCode = generateFixCode(platform, missingHeaders);
    if (fixCode) {
      lines.push(`### Ready-to-review code: ${fixCode.label}`);
      lines.push(`_${fixCode.disclaimer}_`);
      lines.push("");
      lines.push("```");
      lines.push(fixCode.code);
      lines.push("```");
      lines.push("");
    }

    // Email auth
    if (!raw.emailAuth?.spf || !raw.emailAuth?.dmarc) {
      lines.push(`### ${num}. Email Spoofing Protection Incomplete`);
      const missing = [];
      if (!raw.emailAuth?.spf) missing.push("SPF");
      if (!raw.emailAuth?.dmarc) missing.push("DMARC");
      lines.push(`**What this means:** ${missing.join(" and ")} record(s) not found for this domain.`);
      lines.push(`**Why it matters:** Without these, scammers can send emails that appear to come from your domain, which can damage your reputation and get legitimate emails from you marked as spam.`);
      lines.push(`**Fix:** Add these DNS TXT records through your domain registrar (GoDaddy, Namecheap, etc.) — most offer guided setup wizards. Skip this if your domain doesn't send email at all.`);
      lines.push("");
      num++;
    }

    // Cookie security
    if (insecureCookies.length > 0) {
      lines.push(`### ${num}. Insecure Cookie Configuration`);
      lines.push(`**What this means:** ${insecureCookies.map(c => c.name).join(", ")} ${insecureCookies.length > 1 ? "are" : "is"} missing the Secure and/or HttpOnly flag.`);
      lines.push(`**Why it matters:** Without \`Secure\`, cookies can be sent over unencrypted connections. Without \`HttpOnly\`, malicious JavaScript (from an XSS attack) can steal the cookie directly — often used to hijack logged-in sessions.`);
      lines.push(`**Fix:** Set \`Secure; HttpOnly; SameSite=Lax\` (or \`Strict\`) on every cookie your server sets, especially session/auth cookies.`);
      lines.push("");
      num++;
    }

    // CORS
    if (raw.cors?.dangerousCombo) {
      lines.push(`### ${num}. Dangerous CORS Configuration`);
      lines.push(`**What this means:** Your site reflects back any origin that asks AND allows credentials (cookies) to be sent with cross-origin requests.`);
      lines.push(`**Why it matters:** This combination lets **any website on the internet** make authenticated requests to your site on behalf of a logged-in user and read the response — a serious data exposure risk.`);
      lines.push(`**Fix:** Never combine \`Access-Control-Allow-Credentials: true\` with a reflected/wildcard origin. Use an explicit allowlist of trusted origins instead.`);
      lines.push("");
      num++;
    } else if (raw.cors?.wildcardOpen) {
      lines.push(`### ${num}. Open CORS Policy`);
      lines.push(`**What this means:** Your site allows requests from any origin (\`Access-Control-Allow-Origin: *\`).`);
      lines.push(`**Why it matters:** Fine for public APIs with no sensitive data. Risky if this endpoint returns any private or user-specific information.`);
      lines.push(`**Fix:** If this API serves non-sensitive public data, this is acceptable. Otherwise, restrict to specific trusted origins.`);
      lines.push("");
      num++;
    }

    // Mixed content
    if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length > 0) {
      lines.push(`### ${num}. Mixed Content Detected`);
      lines.push(`**What this means:** This HTTPS page loads ${raw.mixedContent.insecureResources.length} resource(s) over plain HTTP.`);
      lines.push(`**Why it matters:** Insecure resources can be intercepted or modified in transit, undermining the security HTTPS is supposed to provide — browsers often block these resources outright.`);
      lines.push(`**Fix:** Update these resource URLs to use HTTPS, or use protocol-relative/relative URLs so they always match the page's protocol.`);
      lines.push("");
      num++;
    }
  }

  // What's working
  const working = [];
  if (raw.tls?.valid) working.push("Valid, trusted SSL certificate");
  if ((raw.exposedFiles || []).length === 0) working.push("No sensitive files exposed");
  (raw.headers?.present || []).forEach((h) => working.push(`${h} header configured`));
  if (raw.emailAuth?.spf) working.push("SPF record configured");
  if (raw.emailAuth?.dmarc) working.push("DMARC record configured");
  if (insecureCookies.length === 0 && (raw.cookies?.cookies || []).length > 0) working.push("All cookies properly secured");
  if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length === 0) working.push("No mixed content found");

  if (working.length > 0) {
    lines.push("## What You're Doing Right");
    working.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  lines.push("---");
  lines.push("*This report was generated by a rule-based scanner — no AI, no external API calls, runs instantly and free.*");

  return lines.join("\n");
}

export { generateReport, calculateScore, detectPlatform, scoreToGrade };