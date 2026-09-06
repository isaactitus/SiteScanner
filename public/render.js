let proUnlockedDomains = new Set();

function isDomainUnlocked(hostname) {
  if (!hostname) return false;
  if (proUnlockedDomains.has(hostname)) return true;
  if (localStorage.getItem(`unlocked_${hostname}`) === "true") {
    proUnlockedDomains.add(hostname);
    return true;
  }
  return false;
}

function launchRazorpayCheckout(hostname, featureName, onSuccess) {
  const existingModal = document.getElementById("paywallModal");
  if (existingModal) existingModal.remove();

  if (typeof window.Razorpay === "undefined") {
    alert("Razorpay checkout is still loading. Please check your connection and refresh.");
    return;
  }

  const modalHtml = `
    <div id="paywallModal" style="position:fixed; inset:0; background:rgba(4, 7, 15, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;">
      <div class="card" style="max-width:460px; width:100%; border:1px solid rgba(139,92,246,0.4); box-shadow:0 0 40px -10px rgba(139,92,246,0.3); text-align:center; padding:32px;">
        <div style="width:48px; height:48px; border-radius:50%; background:rgba(139,92,246,0.15); color:var(--brand-purple); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:1.4rem;">
          🔒
        </div>
        <h3 style="color:#fff; font-size:1.35rem; font-weight:700; margin-bottom:8px;">Unlock Pro Feature</h3>
        <p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin-bottom:24px;">
          <strong>${featureName}</strong> is a Pro feature. Get full AI remediation guides and white-labeled PDF summaries for <strong>${hostname}</strong>.
        </p>
        <button id="paywallCheckoutBtn" class="cta-button" style="background:var(--brand-purple); border-color:var(--brand-purple); margin-bottom:12px; font-weight:700;">
          Unlock Audit for ₹499
        </button>
        <button id="paywallCloseBtn" type="button" style="background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:0.85rem; padding:6px 12px;">
          Dismiss
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  document.getElementById("paywallCloseBtn").onclick = () => {
    const modal = document.getElementById("paywallModal");
    if (modal) modal.remove();
  };

  document.getElementById("paywallCheckoutBtn").onclick = async () => {
    const btn = document.getElementById("paywallCheckoutBtn");
    btn.disabled = true;
    btn.textContent = "Creating Order...";

    try {
      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname }),
      });
      const order = await res.json();

      if (!res.ok || order.error) {
        throw new Error(order.error || "Order creation failed.");
      }

      const rzpOptions = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "SiteScanner Pro",
        description: `Security Audit Unlock for ${hostname}`,
        order_id: order.orderId,
        handler: async function (response) {
          btn.textContent = "Verifying Payment...";
          try {
            const verifyRes = await fetch("/api/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                hostname,
              }),
            });
            const verifyData = await verifyRes.json();

            if (verifyData.success) {
              proUnlockedDomains.add(hostname);
              localStorage.setItem(`unlocked_${hostname}`, "true");
              const modal = document.getElementById("paywallModal");
              if (modal) modal.remove();
              if (typeof onSuccess === "function") onSuccess();
            } else {
              alert("Payment verification failed: " + (verifyData.error || "Unknown error"));
              btn.disabled = false;
              btn.textContent = "Unlock Audit for ₹499";
            }
          } catch (err) {
            alert("Verification network error: " + err.message);
            btn.disabled = false;
            btn.textContent = "Unlock Audit for ₹499";
          }
        },
        modal: {
          ondismiss: function () {
            btn.disabled = false;
            btn.textContent = "Unlock Audit for ₹499";
          },
        },
        theme: {
          color: "#8b5cf6",
        },
      };

      const rzp = new window.Razorpay(rzpOptions);
      rzp.open();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Error: " + err.message;
    }
  };
}

function renderResults(data, targetId = "results") {
  const resultsEl = document.getElementById(targetId);
  if (!resultsEl) return;

  const { raw, hostname, score, grade, previousScan } = data;

  const gradeHex = score >= 75 ? "var(--brand-emerald)" : score >= 40 ? "var(--brand-amber)" : "var(--brand-rose)";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  let deltaHtml = '<span style="color:var(--text-tertiary);">First recorded scan</span>';
  if (previousScan) {
    const delta = score - previousScan.score;
    const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;
    const deltaColor = delta > 0 ? "var(--brand-emerald)" : delta < 0 ? "var(--brand-rose)" : "var(--text-tertiary)";
    deltaHtml = `<span style="color:${deltaColor}; font-weight:600;">${previousScan.grade} → ${grade} (${deltaSign})</span> vs previous audit`;
  }

  let critical = 0, warning = 0, passed = 0;
  if (!raw.tls?.valid) critical++; else passed++;
  (raw.headers?.missing || []).forEach(() => critical++);
  (raw.headers?.present || []).forEach(() => passed++);
  if ((raw.exposedFiles || []).length > 0) critical++; else passed++;

  const isSharedHost = raw.emailAuth?.isSharedHost;
  if (!isSharedHost) {
    if (!raw.emailAuth?.spf) warning++; else passed++;
    if (!raw.emailAuth?.dmarc) warning++; else passed++;
  } else {
    passed++;
  }

  if (raw.cors?.dangerousCombo) critical++; else if (raw.cors?.wildcardOpen) warning++; else passed++;
  if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length > 0) warning++; else if (raw.mixedContent?.checked) passed++;
  if (raw.malware?.checked && raw.malware.flagged) critical++; else if (raw.malware?.checked) passed++;

  const unlocked = isDomainUnlocked(hostname);

  let html = `
    <!-- Top Hero Metric Card -->
    <div class="card hero-grade-card">
      <div class="hero-grade-left">
        <div class="grade-ring">
          <svg viewBox="0 0 96 96">
            <circle class="grade-ring-bg" cx="48" cy="48" r="40"></circle>
            <circle class="grade-ring-fg" cx="48" cy="48" r="40"
              stroke="${gradeHex}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"></circle>
          </svg>
          <div class="grade-ring-letter" style="color:${gradeHex};">${grade}</div>
        </div>
        <div>
          <div class="hero-score-title" style="display:flex; align-items:center; gap:8px;">
            <span>${hostname}</span>
            ${unlocked ? '<span style="font-size:0.65rem; background:rgba(16,185,129,0.2); color:var(--brand-emerald); border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:9999px;">PRO UNLOCKED</span>' : ""}
          </div>
          <div class="hero-score-delta">${deltaHtml}</div>
        </div>
      </div>
      <div class="summary-badges">
        <span class="summary-pill pill-critical">${critical} Critical</span>
        <span class="summary-pill pill-warning">${warning} Warnings</span>
        <span class="summary-pill pill-passed">${passed} Passed</span>
      </div>
    </div>
  `;

  // SSL/TLS Card
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">🔒 SSL/TLS Transport Encryption</strong>`;
  if (raw.tls?.valid) {
    const days = raw.tls.daysUntilExpiry;
    const badgeClass = days < 14 ? "status-bad" : days < 30 ? "status-warn" : "status-ok";
    html += `
      <div class="result-item"><span>Certificate Validity</span><span class="status-badge ${badgeClass}">${days} Days Remaining</span></div>
      <div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono);">${raw.tls.issuer}</span></div>
    `;
  } else {
    html += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid / Insecure (${raw.tls?.error || "Timed out"})</span></div>`;
  }
  html += `</div>`;

  // Security Headers
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">🛡️ HTTP Hardening Headers</strong>`;
  (raw.headers?.missing || []).forEach((h) => {
    html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-bad">Missing</span></div>`;
  });
  (raw.headers?.present || []).forEach((h) => {
    html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`;
  });
  html += `</div>`;

  // Exposed Files
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">📁 Public File Leakage</strong>`;
  if (!raw.exposedFiles || raw.exposedFiles.length === 0) {
    html += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  } else {
    raw.exposedFiles.forEach((f) => {
      html += `<div class="result-item"><span style="font-family:var(--font-mono);">${f.path}</span><span class="status-badge status-bad">Exposed</span></div>`;
    });
  }
  html += `</div>`;

  // Email Spoofing
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">✉️ Domain Reputation & Anti-Spoofing</strong>`;
  if (isSharedHost) {
    html += `<div class="result-item"><span>SPF / DMARC Inspection</span><span class="status-badge status-ok">Skipped (Shared Subdomain)</span></div>`;
  } else {
    html += `
      <div class="result-item"><span>SPF Verification Record</span><span class="status-badge ${raw.emailAuth?.spf ? "status-ok" : "status-warn"}">${raw.emailAuth?.spf ? "Configured" : "Missing"}</span></div>
      <div class="result-item"><span>DMARC Enforcement Policy</span><span class="status-badge ${raw.emailAuth?.dmarc ? "status-ok" : "status-warn"}">${raw.emailAuth?.dmarc ? "Configured" : "Missing"}</span></div>
    `;
  }
  html += `</div>`;

  // Action Buttons
  html += `
    <div class="action-grid">
      <button id="exportPdfBtn" class="cta-button pdf-export-btn" type="button">📄 Export Executive PDF</button>
      <button id="explainBtn" class="cta-button" type="button">✨ Remediation Blueprint</button>
    </div>
    <div id="reportContainer" style="margin-top: 16px;"></div>
  `;

  resultsEl.innerHTML = html;

  function formatMarkdown(text) {
    if (!text) return "";
    return text
      .replace(/### (.*)/g, '<h4 style="margin-top:16px; margin-bottom:8px; color:#fff;">$1</h4>')
      .replace(/## (.*)/g, '<h3 style="margin-top:20px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:6px; color:#fff;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.3); color:#38bdf8; padding:2px 6px; border-radius:4px; font-family:var(--font-mono); font-size:0.85em;">$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre style="background:#070a12; padding:14px; border-radius:8px; overflow-x:auto; border:1px solid rgba(255,255,255,0.08); margin: 12px 0;"><code style="color:#e2e8f0; font-family:var(--font-mono); font-size:0.85em;">$1</code></pre>')
      .replace(/\n/g, "<br/>");
  }

  async function executeRemediationRequest() {
    const reportContainer = document.getElementById("reportContainer");
    reportContainer.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-secondary);">Querying Gemini 3.6 Flash security intelligence engine...</div>';

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw, hostname }),
      });
      const resData = await res.json();

      if (resData.error) throw new Error(resData.error);

      let reportsHtml = `
        <div class="card">
          <strong style="display:block; font-size:1.1rem; margin-bottom:12px; color:#fff;">Standard Security Report</strong>
          <div class="report">${formatMarkdown(resData.ruleBasedReport)}</div>
        </div>
      `;

      if (resData.aiReport) {
        reportsHtml += `
          <div class="card ai-card">
            <div class="ai-header">
              <div class="ai-header-title">
                <span>✨ Actionable AI Remediation Blueprint</span>
              </div>
              <span class="ai-pill">Gemini 3.6 Flash</span>
            </div>
            <div class="report">${formatMarkdown(resData.aiReport)}</div>
          </div>
        `;
      }

      reportContainer.innerHTML = reportsHtml;
    } catch (err) {
      reportContainer.innerHTML = `
        <div class="card" style="border-color:var(--brand-rose);">Report error: ${err.message}</div>
        <button id="retryReportBtn" class="cta-button" style="margin-top: 8px;">Retry Analysis</button>
      `;
      document.getElementById("retryReportBtn").addEventListener("click", executeRemediationRequest);
    }
  }

  // Hook PDF Export
  document.getElementById("exportPdfBtn").addEventListener("click", () => {
    if (!isDomainUnlocked(hostname)) {
      return launchRazorpayCheckout(hostname, "Executive PDF Export", () => {
        const originalTitle = document.title;
        document.title = `SiteScanner_Audit_${hostname}_${new Date().toISOString().slice(0, 10)}`;
        window.print();
        document.title = originalTitle;
      });
    }
    const originalTitle = document.title;
    document.title = `SiteScanner_Audit_${hostname}_${new Date().toISOString().slice(0, 10)}`;
    window.print();
    document.title = originalTitle;
  });

  // Hook AI Remediation
  document.getElementById("explainBtn").addEventListener("click", () => {
    if (!isDomainUnlocked(hostname)) {
      return launchRazorpayCheckout(hostname, "AI Remediation Blueprint", executeRemediationRequest);
    }
    executeRemediationRequest();
  });
}