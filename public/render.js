function renderResults(data, targetId = 'results') {
  const resultsEl = document.getElementById(targetId);
  const { raw, hostname, score, grade, previousScan } = data;

  const gradeHex = score >= 75 ? 'var(--brand-emerald)' : score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  let deltaHtml = '<span style="color:var(--text-tertiary);">First recorded scan</span>';
  if (previousScan) {
    const delta = score - previousScan.score;
    const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;
    const deltaColor = delta > 0 ? 'var(--brand-emerald)' : delta < 0 ? 'var(--brand-rose)' : 'var(--text-tertiary)';
    deltaHtml = `<span style="color:${deltaColor}; font-weight:600;">${previousScan.grade} → ${grade} (${deltaSign})</span> vs previous audit`;
  }

  // Calculate summary tallies
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
          <div class="hero-score-title">${hostname}</div>
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

  // TLS
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">🔒 SSL/TLS Transport Encryption</strong>`;
  if (raw.tls.valid) {
    const days = raw.tls.daysUntilExpiry;
    const badgeClass = days < 14 ? 'status-bad' : days < 30 ? 'status-warn' : 'status-ok';
    html += `
      <div class="result-item"><span>Certificate Validity</span><span class="status-badge ${badgeClass}">${days} Days Remaining</span></div>
      <div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono);">${raw.tls.issuer}</span></div>
    `;
  } else {
    html += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid: ${raw.tls.error || 'Connection Failed'}</span></div>`;
  }
  html += `</div>`;

  // Security Headers
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">🛡️ HTTP Hardening Headers</strong>`;
  (raw.headers.missing || []).forEach(h => {
    html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-bad">Missing</span></div>`;
  });
  (raw.headers.present || []).forEach(h => {
    html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`;
  });
  html += `</div>`;

  // Exposed Files
  html += `<div class="card">
    <strong style="font-size:1rem; display:block; margin-bottom:8px;">📁 Public File Leakage</strong>`;
  if (raw.exposedFiles.length === 0) {
    html += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  } else {
    raw.exposedFiles.forEach(f => {
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
      <div class="result-item"><span>SPF Verification Record</span><span class="status-badge ${raw.emailAuth.spf ? 'status-ok' : 'status-warn'}">${raw.emailAuth.spf ? 'Configured' : 'Missing'}</span></div>
      <div class="result-item"><span>DMARC Enforcement Policy</span><span class="status-badge ${raw.emailAuth.dmarc ? 'status-ok' : 'status-warn'}">${raw.emailAuth.dmarc ? 'Configured' : 'Missing'}</span></div>
    `;
  }
  html += `</div>`;

  // Report Trigger Dock
  html += `
    <div id="reportContainer">
      <button id="explainBtn" class="cta-button" type="button">✨ Generate Plain-English & AI Architecture Guide</button>
    </div>
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
      .replace(/\n/g, '<br/>');
  }

  async function requestRemediation() {
    const reportContainer = document.getElementById('reportContainer');
    reportContainer.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-secondary);">Querying Gemini 3.6 Flash security intelligence engine...</div>';

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw, hostname }),
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      let reportsHtml = `
        <div class="card">
          <strong style="display:block; font-size:1.1rem; margin-bottom:12px; color:#fff;">Standard Security Report</strong>
          <div class="report">${formatMarkdown(data.ruleBasedReport)}</div>
        </div>
      `;

      if (data.aiReport) {
        reportsHtml += `
          <div class="card ai-card">
            <div class="ai-header">
              <div class="ai-header-title">
                <span>✨ Actionable AI Remediation Blueprint</span>
              </div>
              <span class="ai-pill">Gemini 3.6 Flash</span>
            </div>
            <div class="report">${formatMarkdown(data.aiReport)}</div>
          </div>
        `;
      }

      reportContainer.innerHTML = reportsHtml;
    } catch (err) {
      reportContainer.innerHTML = `
        <div class="card" style="border-color:var(--brand-rose);">Report error: ${err.message}</div>
        <button id="retryReportBtn" class="cta-button">Retry Analysis</button>
      `;
      document.getElementById('retryReportBtn').addEventListener('click', requestRemediation);
    }
  }

  document.getElementById('explainBtn').addEventListener('click', requestRemediation);
}