function renderResults(data, targetId = 'results') {
  const resultsEl = document.getElementById(targetId);
  const { raw, hostname, score, grade, previousScan } = data;
  let html = `<div class="card"><strong>Results for ${hostname}</strong></div>`;

  // Hero grade ring
  const gradeHex = score >= 75 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  html += `<div class="card hero-grade-wrap">
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
    <div class="hero-grade-info">
      <div class="hero-grade-score">${score}/100</div>`;

  if (previousScan) {
    const delta = score - previousScan.score;
    const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
    const deltaColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : 'var(--muted)';
    html += `<div class="hero-grade-delta" style="color:${deltaColor};">${previousScan.grade} → ${grade} (${deltaText}) since last scan</div>`;
  } else {
    html += `<div class="hero-grade-delta" style="color:var(--muted);">First scan of this site</div>`;
  }
  html += `</div></div>`;

  // At-a-glance summary counts
  let critical = 0, warning = 0, passed = 0;
  if (!raw.tls?.valid) critical++; else passed++;
  (raw.headers?.missing || []).forEach(() => critical++);
  (raw.headers?.present || []).forEach(() => passed++);
  if ((raw.exposedFiles || []).length > 0) critical++; else passed++;
  if (!raw.emailAuth?.spf) warning++; else passed++;
  if (!raw.emailAuth?.dmarc) warning++; else passed++;
  if (raw.cors?.dangerousCombo) critical++; else if (raw.cors?.wildcardOpen) warning++; else passed++;
  if (raw.mixedContent?.checked && raw.mixedContent.insecureResources.length > 0) warning++; else if (raw.mixedContent?.checked) passed++;
  if (raw.malware?.checked && raw.malware.flagged) critical++; else if (raw.malware?.checked) passed++;

  html += `<div class="summary-line">
    <span class="summary-critical">${critical} critical</span> ·
    <span class="summary-warning">${warning} warning${warning !== 1 ? 's' : ''}</span> ·
    <span class="summary-passed">${passed} passed</span>
  </div>`;

  // TLS
  html += `<div class="card fade-in"><strong>🔒 SSL/TLS Certificate</strong>`;
  if (raw.tls.valid) {
    const days = raw.tls.daysUntilExpiry;
    const cls = days < 14 ? 'bad' : days < 30 ? 'warn' : 'ok';
    html += `<div class="result-item"><span>Expires in</span><span class="status ${cls}">${days} days</span></div>`;
    html += `<div class="result-item"><span>Issuer</span><span>${raw.tls.issuer}</span></div>`;
  } else {
    html += `<div class="result-item"><span>Certificate check failed</span><span class="status bad">${raw.tls.error || 'error'}</span></div>`;
  }
  html += `</div>`;

  // Headers
  html += `<div class="card fade-in"><strong>🛡️ Security Headers</strong>`;
  (raw.headers.missing || []).forEach(h => {
    html += `<div class="result-item"><span>${h}</span><span class="status bad">Missing</span></div>`;
  });
  (raw.headers.present || []).forEach(h => {
    html += `<div class="result-item"><span>${h}</span><span class="status ok">Present</span></div>`;
  });
  html += `</div>`;

  // Exposed files
  html += `<div class="card fade-in"><strong>📁 Exposed Sensitive Files</strong>`;
  if (raw.exposedFiles.length === 0) {
    html += `<div class="result-item"><span>None found</span><span class="status ok">Good</span></div>`;
  } else {
    raw.exposedFiles.forEach(f => {
      html += `<div class="result-item"><span>${f.path}</span><span class="status bad">Exposed</span></div>`;
    });
  }
  html += `</div>`;

  // Email spoofing
  html += `<div class="card fade-in"><strong>✉️ Email Spoofing Protection</strong>`;
  html += `<div class="result-item"><span>SPF record</span><span class="status ${raw.emailAuth.spf ? 'ok' : 'warn'}">${raw.emailAuth.spf ? 'Found' : 'Missing'}</span></div>`;
  html += `<div class="result-item"><span>DMARC record</span><span class="status ${raw.emailAuth.dmarc ? 'ok' : 'warn'}">${raw.emailAuth.dmarc ? 'Found' : 'Missing'}</span></div>`;
  html += `</div>`;

  // Cookies
  if (raw.cookies?.hasCookies) {
    html += `<div class="card fade-in"><strong>🍪 Cookie Security</strong>`;
    raw.cookies.cookies.forEach(c => {
      const secure = c.secure && c.httpOnly;
      html += `<div class="result-item"><span>${c.name}</span><span class="status ${secure ? 'ok' : 'warn'}">${secure ? 'Secured' : 'Missing flags'}</span></div>`;
    });
    html += `</div>`;
  }

  // CORS
  html += `<div class="card fade-in"><strong>🌐 CORS Policy</strong>`;
  if (raw.cors?.dangerousCombo) {
    html += `<div class="result-item"><span>Reflects origin + credentials</span><span class="status bad">Dangerous</span></div>`;
  } else if (raw.cors?.wildcardOpen) {
    html += `<div class="result-item"><span>Allows any origin</span><span class="status warn">Open</span></div>`;
  } else {
    html += `<div class="result-item"><span>Origin restrictions</span><span class="status ok">Good</span></div>`;
  }
  html += `</div>`;

  // Mixed content
  if (raw.mixedContent?.checked) {
    html += `<div class="card fade-in"><strong>🔓 Mixed Content</strong>`;
    if (raw.mixedContent.insecureResources.length === 0) {
      html += `<div class="result-item"><span>HTTP resources on HTTPS page</span><span class="status ok">None found</span></div>`;
    } else {
      html += `<div class="result-item"><span>Insecure resources found</span><span class="status bad">${raw.mixedContent.insecureResources.length}</span></div>`;
    }
    html += `</div>`;
  }

  // Malware/blocklist
  if (raw.malware?.checked) {
    html += `<div class="card fade-in"><strong>🚨 Malware / Phishing Check</strong>`;
    if (raw.malware.flagged) {
      html += `<div class="result-item"><span>Google Safe Browsing</span><span class="status bad">FLAGGED</span></div>`;
    } else {
      html += `<div class="result-item"><span>Google Safe Browsing</span><span class="status ok">Clean</span></div>`;
    }
    html += `</div>`;
  }

  // Trackers
  if (raw.trackers?.checked) {
    html += `<div class="card fade-in"><strong>👁️ Tracking Scripts</strong>`;
    if (raw.trackers.trackers.length === 0) {
      html += `<div class="result-item"><span>Known trackers</span><span class="status ok">None detected</span></div>`;
    } else {
      raw.trackers.trackers.forEach(t => {
        html += `<div class="result-item"><span>${t}</span><span class="status warn">Detected</span></div>`;
      });
    }
    html += `</div>`;
  }

  html += `<button id="explainBtn">Get Plain-English Report</button>`;
  resultsEl.innerHTML = html;

  document.getElementById('explainBtn').addEventListener('click', async () => {
    resultsEl.insertAdjacentHTML('beforeend', '<div class="card loading">Generating report…</div>');
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, hostname }),
    });
    const data = await res.json();
    document.querySelector('.loading').outerHTML = `<div class="card report">${data.report || data.error}</div>`;
  });
}

// Apply staggered fade-in timing to result cards after they're inserted into the DOM.
function applyStaggeredFadeIn(containerEl) {
  const cards = containerEl.querySelectorAll('.fade-in');
  cards.forEach((el, i) => {
    el.style.animationDelay = `${i * 70}ms`;
  });
}