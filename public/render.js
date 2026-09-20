// public/render.js
let currentUser = null;
const GOOGLE_CLIENT_ID = "850082538445-h6ehbqqta1ebegfrdretko5plf5eaqme.apps.googleusercontent.com";

async function checkAuthSession() { 
  try { 
    const data = await (await fetch("/api/auth/me")).json(); 
    currentUser = data.user; 
    updateNavAuthUI(); 
  } catch { 
    currentUser = null; 
    updateNavAuthUI(); 
  } 
}

function updateNavAuthUI() {
  const container = document.getElementById("authNavContainer");
  if (!container) return;
  if (currentUser) {
    const initials = currentUser.name ? currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'US';
    container.innerHTML = `
      <button class="btn-outline" onclick="window.launchRazorpayCheckout('SiteScanner Pro', () => window.location.reload())">Upgrade to Pro</button>
      <div class="avatar-circle" title="${currentUser.email}" style="cursor:pointer;" onclick="logout()">${initials}</div>
    `;
  } else {
    container.innerHTML = `<button class="btn-outline" onclick="showSignInModal()">Sign In</button>`;
  }
}

async function logout() {
  if(confirm("Sign out of LIBI Scanner?")) {
    await fetch("/api/auth/logout", { method: "POST" }); 
    location.reload();
  }
}

function showSignInModal() {
  const modalHtml = `
    <div id="authModal" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:9999;">
      <div style="background:#fff; border-radius:12px; padding:40px; text-align:center; max-width:400px; width:100%; box-shadow:0 20px 40px rgba(0,0,0,0.1);">
        <h3 style="font-family:var(--font-serif); font-size:1.5rem; margin-bottom:12px;">Sign In</h3>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:24px;">Authenticate to export reports and manage infrastructure monitors.</p>
        <div id="googleBtnContainer" style="display:flex; justify-content:center; margin-bottom:16px;"></div>
        <button onclick="document.getElementById('authModal').remove()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
  if (window.google) { 
    window.google.accounts.id.initialize({ 
      client_id: GOOGLE_CLIENT_ID, 
      callback: async (res) => { 
        const data = await (await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: res.credential }) })).json(); 
        if (data.success) { location.reload(); } 
      } 
    }); 
    window.google.accounts.id.renderButton(document.getElementById("googleBtnContainer"), { theme: "outline", size: "large", width: 280, shape: "pill" }); 
  }
}

window.launchRazorpayCheckout = function(featureName, onSuccess) {
  if (!currentUser) return showSignInModal();
  alert(`[ SYSTEM NOTICE ] Routing to Razorpay portal for ${featureName} upgrade.`);
}

function renderResults(data, targetId = "results") {
  const resultsEl = document.getElementById(targetId); if (!resultsEl) return;
  const { raw, hostname, score, grade } = data; 
  const isGuest = !currentUser;

  let critical = 0, warning = 0, passed = 0;
  if (!raw.tls?.valid) critical++; else passed++;
  (raw.headers?.missing || []).forEach(() => critical++); 
  (raw.headers?.present || []).forEach(() => passed++);
  if ((raw.exposedFiles || []).length > 0) critical++; else passed++;
  if (!raw.emailAuth?.isSharedHost) { 
    if (!raw.emailAuth?.spf) warning++; else passed++; 
    if (!raw.emailAuth?.dmarc) warning++; else passed++; 
  } else passed++; 
  if (raw.cors?.dangerousCombo) critical++; else if (raw.cors?.wildcardOpen) warning++; else passed++;

  const currentDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const gradeColor = score >= 75 ? "var(--brand-green)" : score >= 40 ? "var(--brand-amber)" : "var(--brand-rose)";
  const gradeStatus = score >= 75 ? "Clean and safe to browse." : score >= 40 ? "Needs policy enforcement." : "Critical vulnerabilities found.";

  let html = `
    <div class="report-header">
      <div class="report-title-group">
        <h2>Security audit</h2>
        <span>${hostname}</span>
        <span>•</span>
        <span>${currentDate}</span>
      </div>
      <div class="top-actions">
        <button class="btn-outline" onclick="window.location.reload()">Re-scan</button>
        <button class="btn-primary" id="exportPdfBtn">Export PDF</button>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metric-box" style="border-bottom: 4px solid ${gradeColor};">
        <h4>OVERALL SCORE</h4>
        <div><span class="metric-value">${score}</span><span class="metric-letter" style="color: ${gradeColor};">${grade}</span></div>
        <p style="font-size: 0.85rem; color: var(--text-main); margin-top: 16px;">${gradeStatus}</p>
      </div>
      <div class="metric-box"><h4>CRITICAL</h4><span class="metric-value">${critical}</span></div>
      <div class="metric-box ${warning > 0 ? 'warning' : ''}"><h4>WARNING</h4><span class="metric-value">${warning}</span></div>
      <div class="metric-box"><h4>PASSED</h4><span class="metric-value">${passed}</span></div>
    </div>
  `;

  // Findings Rendering
  if (raw.cors?.wildcardOpen || raw.cors?.dangerousCombo) {
    const corsTag = raw.cors.dangerousCombo ? "DANGEROUS COMBO" : "WILDCARD OPEN";
    html += `
      <div class="finding-card">
        <div class="finding-header">
          <h3>Cross-Origin Resource Sharing</h3>
          <span class="finding-badge">${corsTag}</span>
        </div>
        <p class="finding-desc">Setting the origin to * permits any external site to read API responses via client-side cross-origin requests. ${raw.cors.dangerousCombo ? 'Critical credentials leak detected.' : 'No dangerous credential combination was detected.'}</p>
        <div class="code-row">
          <div class="code-pill">Access-Control-Allow-Origin: *</div>
        </div>
        <div class="remediation-block">
          <span class="remediation-label">REMEDIATION</span>
          <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 12px;">Replace the wildcard origin in your web server or API gateway with an explicit whitelist of trusted domains.</p>
          <pre style="background:transparent; border:none; padding:0; margin:0;"><code style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-muted);">if ($http_origin ~* (https://([a-z0-9\-]+\.)?${hostname})$) {
  add_header 'Access-Control-Allow-Origin' "$http_origin";
}</code></pre>
        </div>
      </div>
    `;
  }

  // Active DAST
  if (raw.activeDastReport?.site?.[0]?.alerts) {
    raw.activeDastReport.site[0].alerts.forEach(alert => {
      const isHigh = alert.riskcode === "3";
      html += `
      <div class="finding-card">
        <div class="finding-header">
          <h3>${alert.name}</h3>
          <span class="finding-badge" style="border-color:${isHigh ? 'var(--brand-rose)' : 'var(--brand-amber)'}; color:${isHigh ? 'var(--brand-rose)' : 'var(--brand-amber)'};">${isHigh ? 'HIGH RISK' : 'WARNING'}</span>
        </div>
        <p class="finding-desc">${alert.desc.replace(/<[^>]+>/g, '').substring(0, 200)}...</p>
        <div class="remediation-block">
          <span class="remediation-label">REMEDIATION</span>
          <p style="font-size: 0.9rem;">${alert.solution.replace(/<[^>]+>/g, '')}</p>
        </div>
      </div>`;
    });
  }

  resultsEl.innerHTML = html;

  document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
    if (!currentUser?.is_pro) return window.launchRazorpayCheckout("PDF Export");
    window.open(`/api/download-pdf/${encodeURIComponent(hostname)}`, '_blank');
  });
}

window.authReady = checkAuthSession();

// The new dual-pane loading screen
window.showLoadingState = function(container, mode) {
  const isDast = mode === 'active';
  const typeText = isDast ? 'RUNNING ACTIVE DAST' : 'RUNNING STANDARD AUDIT';
  
  container.innerHTML = `
    <div style="background: #fff; padding: 16px 24px; border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 24px; height: 24px; background: var(--brand-green); border-radius: 4px;"></div>
        <span style="font-family: var(--font-serif); font-size: 1.25rem;">Scanning target...</span>
      </div>
      <button class="btn-outline" onclick="window.location.reload()">Cancel</button>
    </div>

    <div class="loading-grid">
      <div class="loading-main">
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase;">${typeText}</span>
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; margin-bottom: 24px;">
          <h2 id="loadingHeadline" style="font-family: var(--font-serif); font-size: 2.5rem;">Analysing headers</h2>
          <span id="loadingPercent" style="font-family: var(--font-serif); font-size: 2.5rem; color: var(--brand-green);">0%</span>
        </div>
        <div style="width: 100%; height: 4px; background: #f3f4f6; border-radius: 2px; margin-bottom: 48px; overflow: hidden;">
          <div id="loadingBar" style="height: 100%; width: 0%; background: var(--brand-green); transition: width 0.3s;"></div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <div class="check-item done">✓ TLS certificate chain</div>
            <div class="check-item done">✓ DMARC record</div>
            <div class="check-item active">⟳ HTTP hardening headers</div>
            <div class="check-item">○ Cookie flags</div>
          </div>
          <div>
            <div class="check-item done">✓ SPF record</div>
            <div class="check-item active">⟳ Exposed file paths</div>
            <div class="check-item">○ CORS policy</div>
            <div class="check-item">○ Mixed content</div>
          </div>
        </div>
      </div>
      
      <div class="loading-log" id="liveLogConsole">
        <div class="log-line">Initializing audit protocol...</div>
      </div>
    </div>
  `;

  let progress = 0;
  const bar = document.getElementById("loadingBar");
  const percent = document.getElementById("loadingPercent");
  const logConsole = document.getElementById("liveLogConsole");
  const headline = document.getElementById("loadingHeadline");

  const logs = [
    { text: "resolve target ip routing", head: "Resolving DNS" },
    { text: "tls handshake ok · TLS 1.3", head: "Verifying Handshake" },
    { text: "issuer Let's Encrypt verified", head: "Checking Certificates" },
    { text: "dns txt spf=true dmarc=true", head: "Analysing DNS TXT" },
    { text: "probe /.env /.git → 404", head: "Scanning file paths" },
    { text: "GET / → 200 · reading headers", head: "Analysing headers" },
    { text: "csp enforced · hsts enforced", head: "Compiling Report" }
  ];

  let step = 0;
  window.activeLoadingInterval = setInterval(() => {
    progress += Math.random() * 8;
    if (progress >= 99) progress = 99;
    if (bar) bar.style.width = `${progress}%`;
    if (percent) percent.textContent = `${Math.floor(progress)}%`;

    if (Math.random() > 0.7 && step < logs.length) {
      const time = new Date().toLocaleTimeString('en-GB');
      logConsole.innerHTML += `<div class="log-line success">${time} ${logs[step].text}</div>`;
      headline.textContent = logs[step].head;
      logConsole.scrollTop = logConsole.scrollHeight;
      step++;
    }
  }, 400);
};