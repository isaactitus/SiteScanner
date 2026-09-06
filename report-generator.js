// report-generator.js
import { generateFixCode } from "./fix-code-generator.js";

// Platforms where users deploy subdomains and cannot modify root DNS records
const SHARED_HOST_SUFFIXES = [
  "vercel.app",
  "netlify.app",
  "github.io",
  "gitlab.io",
  "pages.dev",
  "onrender.com",
  "fly.dev",
  "railway.app",
  "azurewebsites.net",
  "herokuapp.com",
  "firebaseapp.com",
  "web.app"
];

function isSharedHostSubdomain(hostname) {
  const host = (hostname || "").toLowerCase().trim();
  return SHARED_HOST_SUFFIXES.some(
    suffix => host.endsWith(`.${suffix}`) || host === suffix
  );
}

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

// REBALANCED SCORING: 
// Modern browsers handle Referrer & Permissions natively. 
// Missing headers shouldn't drop a safe site below a C.
const HEADER_SEVERITY = {
  "content-security-policy": 15,
  "strict-transport-security": 10,
  "x-frame-options": 5,
  "x-content-type-options": 5,
  "referrer-policy": 0, 
  "permissions-policy": 0,
};

function calculateScore(raw, hostname = "") {
  let score = 100;
  const deductions = [];
  const sharedHost = isSharedHostSubdomain(hostname);

  // Critical: TLS
  if (!raw.tls?.valid) {
    score -= 40;
    deductions.push({ reason: "SSL/TLS certificate invalid or unreachable", points: 40 });
  } else if (raw.tls.daysUntilExpiry !== null && raw.tls.daysUntilExpiry < 14) {
    score -= 10;
    deductions.push({ reason: "SSL certificate expiring very soon", points: 10 });
  }

  // Best Practice: Headers
  (raw.headers?.missing || []).forEach((h) => {
    const pts = HEADER_SEVERITY[h];
    if (pts > 0) {
      score -= pts;
      deductions.push({ reason: `Missing ${h} header`, points: pts });
    }
  });

  // Critical: Exposed files
  const exposedCount = (raw.exposedFiles || []).length;
  if (exposedCount > 0) {
    const pts = Math.min(exposedCount * 20, 50);
    score -= pts;
    deductions.push({ reason: `${exposedCount} sensitive file(s) publicly exposed`, points: pts });
  }

  // Best Practice: Email spoofing
  if (!sharedHost) {
    if (!raw.emailAuth?.spf) {
      score -= 5;
      deductions.push({ reason: "No SPF record", points: 5 });
    }
    if (!raw.emailAuth?.dmarc) {
      score -= 5;
      deductions.push({ reason: "No DMARC record", points: 5 });
    }
  }

  // Best Practice: Cookies
  const insecureCookies = (raw.cookies?.cookies || []).filter((c) => !c.secure || !c.httpOnly);
  if (insecureCookies.length > 0) {
    const pts = Math.min(insecureCookies.length * 4, 12);
    score -= pts;
    deductions.push({ reason: `${insecureCookies.length} cookie(s) missing Secure/HttpOnly flags`, points: pts });
  }

  // High Risk: CORS
  if (raw.cors?.dangerousCombo) {
    score -= 30;
    deductions.push({ reason: "Dangerous CORS config: reflects any origin + allows credentials", points: 30 });
  } else if (raw.cors?.wildcardOpen) {
    score -= 5;
    deductions.push({ reason: "CORS wide open (Access-Control-Allow-Origin: *)", points: 5 });
  }

  // Medium Risk: Mixed content
  if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length > 0) {
    const pts = Math.min(raw.mixedContent.insecureResources.length * 5, 20);
    score -= pts;
    deductions.push({ reason: `${raw.mixedContent.insecureResources.length} insecure (HTTP) resource(s) on HTTPS page`, points: pts });
  }

  // Critical: Malware
  if (raw.malware?.checked && raw.malware.flagged) {
    score -= 60;
    deductions.push({ reason: `Flagged by Google Safe Browsing: ${(raw.malware.threatTypes || []).join(", ")}`, points: 60 });
  }

  return { score: Math.max(0, Math.round(score)), deductions, sharedHost };
}

const HEADER_EXPLANATIONS = {
  "content-security-policy": {
    what: "Your site does not declare which script, style, and media sources the browser is permitted to execute.",
    why: "Without this header, malicious code injected via cross-site scripting (XSS) executes without restriction.",
    fix: {
      vercel: "Add a Content-Security-Policy key under headers() in your next.config.js.",
      wordpress: "Configure CSP via a security plugin (e.g., Wordfence or Really Simple SSL).",
      unknown: "Define Content-Security-Policy in your web server config starting with default-src 'self'.",
    },
  },
  "strict-transport-security": {
    what: "Your site does not instruct browsers to exclusively use HTTPS for future connections.",
    why: "Users can be downgraded to plain unencrypted HTTP during man-in-the-middle network attacks.",
    fix: {
      vercel: "Add Strict-Transport-Security: max-age=63072000; includeSubDomains in next.config.js.",
      wordpress: "Enable HSTS in your SSL configuration plugin.",
      unknown: "Add Strict-Transport-Security: max-age=63072000; includeSubDomains at your edge or web server.",
    },
  },
  "x-frame-options": {
    what: "Your site does not declare whether other domains can embed it inside an iframe.",
    why: "Attackers can frame your site transparently and trick users into clicking buttons (Clickjacking).",
    fix: {
      vercel: "Add X-Frame-Options: SAMEORIGIN or DENY to your next.config.js headers.",
      wordpress: "Enable frame protection in your site headers or security plugin settings.",
      unknown: "Add X-Frame-Options: SAMEORIGIN in your server block.",
    },
  },
  "x-content-type-options": {
    what: "Browsers are permitted to guess MIME types rather than adhering strictly to Content-Type headers.",
    why: "An uploaded benign file like an image could be interpreted and executed by the browser as JavaScript.",
    fix: {
      vercel: "Add X-Content-Type-Options: nosniff in next.config.js.",
      wordpress: "Toggle nosniff headers in your server or security plugin.",
      unknown: "Add X-Content-Type-Options: nosniff to your response headers.",
    },
  },
};

function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function generateReport(raw, hostname) {
  const { score, deductions, sharedHost } = calculateScore(raw, hostname);
  const platform = detectPlatform(raw.headers, raw.exposedFiles);
  const grade = scoreToGrade(score);

  const lines = [];
  lines.push(`# Security Scan Report for ${hostname}`);
  lines.push("");
  lines.push(`## Overall Grade: ${grade} (${score}/100)`);
  lines.push("");

  if (score >= 90) {
    lines.push("Strong configuration. Your site has solid core security and defense-in-depth measures in place.");
  } else if (score >= 75) {
    lines.push("Good foundation. Essential defenses are present, with straightforward hardening steps remaining.");
  } else if (score >= 60) {
    lines.push("Moderate posture. Core connectivity is working, but key browser-level security policies are missing.");
  } else {
    lines.push("Vulnerable baseline. Critical security configurations or infrastructure protections are absent.");
  }
  lines.push("");

  const sortedDeductions = [...deductions].sort((a, b) => b.points - a.points);
  const insecureCookies = (raw.cookies?.cookies || []).filter((c) => !c.secure || !c.httpOnly);

  if (sortedDeductions.length === 0) {
    lines.push("## Findings");
    lines.push("All core passive checks passed. Continue monitoring SSL certificate expiration dates.");
  } else {
    lines.push("## Issues Found (Ranked by Severity)");
    lines.push("");

    let num = 1;

    if (raw.malware?.checked && raw.malware.flagged) {
      lines.push(`### ${num}. 🚨 Flagged by Google Safe Browsing`);
      lines.push(`**Finding:** Identified under threats: ${(raw.malware.threatTypes || []).join(", ").toLowerCase()}.`);
      lines.push(`**Remediation:** Inspect application code for unauthorized modifications and request a malware review in Google Search Console.`);
      lines.push("");
      num++;
    }

    if (!raw.tls?.valid) {
      lines.push(`### ${num}. Invalid SSL Certificate`);
      lines.push(`**Finding:** ${raw.tls?.error || "Certificate validation failed."}`);
      lines.push(`**Remediation:** Renew or reissue your certificate via your hosting dashboard or Let's Encrypt.`);
      lines.push("");
      num++;
    }

    if ((raw.exposedFiles || []).length > 0) {
      lines.push(`### ${num}. Sensitive Files Publicly Accessible`);
      lines.push(`**Finding:** Reachable paths: ${raw.exposedFiles.map(f => f.path).join(", ")}`);
      lines.push(`**Remediation:** Restrict web server access to these paths or remove them from the deployment output immediately.`);
      lines.push("");
      num++;
    }

    const missingHeaders = (raw.headers?.missing || []).filter(h => HEADER_SEVERITY[h] > 0).sort(
      (a, b) => HEADER_SEVERITY[b] - HEADER_SEVERITY[a]
    );
    
    missingHeaders.forEach((h) => {
      const info = HEADER_EXPLANATIONS[h];
      if (!info) return;
      lines.push(`### ${num}. Missing Header: ${h}`);
      lines.push(`**Risk:** ${info.why}`);
      lines.push(`**Remediation:** ${info.fix[platform] || info.fix.unknown}`);
      lines.push("");
      num++;
    });

    const fixCode = generateFixCode(platform, missingHeaders);
    if (fixCode) {
      lines.push(`### Recommended Configuration: ${fixCode.label}`);
      lines.push(`_${fixCode.disclaimer}_`);
      lines.push("");
      lines.push("```");
      lines.push(fixCode.code);
      lines.push("```");
      lines.push("");
    }

    if (!sharedHost && (!raw.emailAuth?.spf || !raw.emailAuth?.dmarc)) {
      lines.push(`### ${num}. Missing Email Spoofing Records`);
      lines.push(`**Risk:** Attackers can send spoofed emails claiming to originate from your domain.`);
      lines.push(`**Remediation:** Add valid SPF and DMARC TXT records in your DNS provider control panel.`);
      lines.push("");
      num++;
    }

    if (insecureCookies.length > 0) {
      lines.push(`### ${num}. Insecure Cookie Attributes`);
      lines.push(`**Finding:** Cookies lacking Secure or HttpOnly: ${insecureCookies.map(c => c.name).join(", ")}.`);
      lines.push(`**Remediation:** Append Secure; HttpOnly; SameSite=Lax flags when setting cookies.`);
      lines.push("");
      num++;
    }
  }

  const working = [];
  if (raw.tls?.valid) working.push("Valid SSL/TLS certificate configured");
  if ((raw.exposedFiles || []).length === 0) working.push("No exposed environment or source repository files found");
  (raw.headers?.present || []).forEach((h) => working.push(`Security header present: ${h}`));
  if (sharedHost) {
    working.push("Email SPF/DMARC: Exempted (Shared hosting subdomain)");
  } else {
    if (raw.emailAuth?.spf) working.push("SPF record verified in DNS");
    if (raw.emailAuth?.dmarc) working.push("DMARC record verified in DNS");
  }

  if (working.length > 0) {
    lines.push("## Passing Checks");
    working.forEach((w) => lines.push(`* ${w}`));
    lines.push("");
  }

  return lines.join("\n");
}

export { generateReport, calculateScore, detectPlatform, scoreToGrade, isSharedHostSubdomain };