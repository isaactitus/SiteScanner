// public/render.js
let currentUser = null;
const GOOGLE_CLIENT_ID = "850082538445-h6ehbqqta1ebegfrdretko5plf5eaqme.apps.googleusercontent.com";

window.loadRecentFeed = async function() {
  const recentListEl = document.getElementById('recentList');
  if (!recentListEl) return;
  try {
    const items = await (await fetch('/api/recent')).json();
    if (!items || items.length === 0) return recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">No recent scans</span>';
    recentListEl.innerHTML = items.map(item => `<a href="/report/${encodeURIComponent(item.hostname)}" class="feed-chip"><span>${item.hostname}</span><span class="feed-chip-grade" style="color:${item.score >= 75 ? 'var(--brand-emerald)' : item.score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)'}">${item.grade} (${item.score})</span></a>`).join('');
  } catch { recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">Feed offline</span>'; }
};

async function checkAuthSession() { try { const data = await (await fetch("/api/auth/me")).json(); currentUser = data.user; updateNavAuthUI(); } catch { currentUser = null; updateNavAuthUI(); } }

function updateNavAuthUI() {
  const container = document.getElementById("authNavContainer");
  if (!container) return;
  if (currentUser) {
    const isPro = currentUser.is_pro; const badge = isPro ? "PRO" : "FREE"; const badgeColor = isPro ? "var(--brand-emerald)" : "var(--brand-purple)";
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; cursor: pointer;" id="userProfileBtn">
        <img src="${currentUser.avatar_url || 'https://via.placeholder.com/32'}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2);" />
        <span style="font-size: 0.85rem; color: #fff; font-weight: 600;">${currentUser.name ? currentUser.name.split(' ')[0] : 'User'}</span>
        <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 9999px; background: rgba(139,92,246,0.2); color: ${badgeColor}; border: 1px solid ${badgeColor}; font-weight: 700;">${badge}</span>
      </div>
      <div id="userDropdown" style="display: none; position: absolute; right: 0; top: 44px; background: #0b0f19; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; z-index: 10000; box-shadow: 0 10px 25px rgba(0,0,0,0.5); min-width: 200px;">
        <div style="font-size: 0.78rem; color: var(--text-tertiary); margin-bottom: 12px; word-break: break-all;">${currentUser.email}</div>
        <a href="/dashboard.html" style="display: block; font-size: 0.85rem; color: #fff; text-decoration: none; margin-bottom: 12px; padding: 6px 8px; background: rgba(255,255,255,0.05); border-radius: 6px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">Dashboard & Alerts</a>
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin-bottom: 8px;" />
        <button id="logoutBtn" style="background: transparent; border: none; color: var(--brand-rose); font-size: 0.85rem; cursor: pointer; padding: 4px 0; width: 100%; text-align: left;">Sign Out</button>
      </div>`;
    document.getElementById("userProfileBtn").onclick = (e) => { e.stopPropagation(); const dd = document.getElementById("userDropdown"); dd.style.display = dd.style.display === "none" ? "block" : "none"; };
    document.addEventListener("click", () => { const dd = document.getElementById("userDropdown"); if (dd) dd.style.display = "none"; });
    document.getElementById("logoutBtn").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }); currentUser = null; location.reload(); };
  } else {
    container.innerHTML = `<button id="navSignInBtn" class="cta-button" style="padding: 6px 14px; font-size: 0.85rem;" type="button">Sign In</button>`;
    document.getElementById("navSignInBtn").onclick = showSignInModal;
  }
}

function showSignInModal() {
  if (document.getElementById("authModal")) document.getElementById("authModal").remove();
  const modalHtml = `<div id="authModal" style="position:fixed; inset:0; background:rgba(4, 7, 15, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;"><div class="card" style="max-width:380px; width:100%; text-align:center; padding:32px; border:1px solid rgba(255,255,255,0.15);"><div style="width:44px; height:44px; border-radius:50%; background:rgba(56,189,248,0.15); color:var(--brand-cyan); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:1.3rem;">👤</div><h3 style="color:#fff; font-size:1.25rem; font-weight:700; margin-bottom:8px;">Sign in to SiteScanner</h3><p style="color:var(--text-secondary); font-size:0.88rem; line-height:1.5; margin-bottom:24px;">Log in with Google to sync your Pro audits, remediation blueprints, and target domains across devices.</p><div id="googleBtnContainer" style="display:flex; justify-content:center; margin-bottom:16px;"></div><button id="closeAuthModal" type="button" style="background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:0.85rem;">Dismiss</button></div></div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml); document.getElementById("closeAuthModal").onclick = () => document.getElementById("authModal").remove();
  if (window.google) { window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: async (res) => { try { const data = await (await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: res.credential }) })).json(); if (data.success) { currentUser = data.user; document.getElementById("authModal")?.remove(); updateNavAuthUI(); location.reload(); } else alert("Sign in failed: " + data.error); } catch (err) { alert("Sign in network error"); } } }); window.google.accounts.id.renderButton(document.getElementById("googleBtnContainer"), { theme: "filled_blue", size: "large", width: 260 }); }
}

window.launchRazorpayCheckout = function(featureName, onSuccess) {
  if (!currentUser) return showSignInModal();
  if (document.getElementById("paywallModal")) document.getElementById("paywallModal").remove();
  if (typeof window.Razorpay === "undefined") return alert("Payment checkout loading.");
  document.body.insertAdjacentHTML("beforeend", `<div id="paywallModal" style="position:fixed; inset:0; background:rgba(4, 7, 15, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;"><div class="card" style="max-width:460px; width:100%; border:1px solid rgba(139,92,246,0.4); box-shadow:0 0 40px -10px rgba(139,92,246,0.3); text-align:center; padding:32px;"><div style="width:48px; height:48px; border-radius:50%; background:rgba(139,92,246,0.15); color:var(--brand-purple); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:1.4rem;">🔒</div><h3 style="color:#fff; font-size:1.35rem; font-weight:700; margin-bottom:8px;">Upgrade to Pro</h3><p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin-bottom:24px;"><strong>${featureName}</strong> is a Pro feature. Upgrade now to unlock unlimited daily scans, full AI remediation guides, and automated monitoring.</p><button id="paywallCheckoutBtn" class="cta-button" style="background:var(--brand-purple); border-color:var(--brand-purple); margin-bottom:12px; font-weight:700;">Upgrade to Pro for ₹499</button><button id="paywallCloseBtn" type="button" style="background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; font-size:0.85rem; padding:6px 12px;">Dismiss</button></div></div>`);
  document.getElementById("paywallCloseBtn").onclick = () => document.getElementById("paywallModal").remove();
  document.getElementById("paywallCheckoutBtn").onclick = async () => {
    const btn = document.getElementById("paywallCheckoutBtn"); btn.disabled = true; btn.textContent = "Creating Order...";
    try {
      const order = await (await fetch("/api/create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })).json();
      if (order.error) throw new Error(order.error);
      const rzp = new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: "SiteScanner Pro", order_id: order.orderId, handler: async function (response) { btn.textContent = "Verifying Payment..."; try { const verifyData = await (await fetch("/api/verify-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature }) })).json(); if (verifyData.success) { currentUser.is_pro = true; document.getElementById("paywallModal")?.remove(); updateNavAuthUI(); if (onSuccess) onSuccess(); } else { alert("Failed"); btn.disabled = false; btn.textContent = "Upgrade to Pro for ₹499"; } } catch { alert("Error"); btn.disabled = false; btn.textContent = "Upgrade to Pro for ₹499"; } }, prefill: { name: currentUser.name || "Engineer", email: currentUser.email || "" }, theme: { color: "#8b5cf6" } });
      rzp.open();
    } catch (err) { btn.disabled = false; btn.textContent = "Error: " + err.message; }
  };
}

window.showDnsVerificationModal = async function(hostname, onSuccess) {
  if (document.getElementById("dnsModal")) document.getElementById("dnsModal").remove();
  let tokenData;
  try {
    const res = await fetch("/api/verification/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname }) });
    tokenData = await res.json(); if (tokenData.isVerified) return onSuccess();
  } catch (err) { return alert("Error fetching token"); }

  const modalHtml = `
    <div id="dnsModal" style="position:fixed; inset:0; background:rgba(4, 7, 15, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; overflow-y: auto;">
      <div class="card" style="max-width:560px; width:100%; border:1px solid rgba(16,185,129,0.4); text-align:left; padding:32px; margin-top: auto; margin-bottom: auto;">
        <h3 style="color:#fff; font-size:1.35rem; font-weight:700; margin-bottom:12px;">Active Audit Authorization</h3>
        <p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin-bottom:20px;">To perform active DAST scanning, you must prove ownership of <strong>${hostname}</strong> using one of the two methods below.</p>
        
        <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; border: 1px solid var(--surface-border); margin-bottom: 16px;">
          <strong style="color: #fff; font-size: 0.95rem; margin-bottom: 8px; display: block;">Method 1: DNS TXT Record (Best for Custom Domains)</strong>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Type</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px;">TXT</div></div>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Name / Host</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px;">@ <span style="color:var(--text-tertiary); font-size:0.8rem;">(or ${hostname})</span></div></div>
          <div><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Value / Content</span><div style="background: rgba(16,185,129,0.1); color:var(--brand-emerald); padding: 8px; border-radius: 4px; font-family:var(--font-mono); margin-top:4px; word-break: break-all; border: 1px solid rgba(16,185,129,0.2);">${tokenData.token}</div></div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; border: 1px solid var(--surface-border); margin-bottom: 24px;">
          <strong style="color: #fff; font-size: 0.95rem; margin-bottom: 8px; display: block;">Method 2: HTTP File (Best for Vercel/Netlify/Render)</strong>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 12px;">Create a text file accessible on your server at this exact path:</p>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">File Path</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px; word-break: break-all;">https://${hostname}/.well-known/sitescanner-verification.txt</div></div>
          <div><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">File Content</span><div style="background: rgba(16,185,129,0.1); color:var(--brand-emerald); padding: 8px; border-radius: 4px; font-family:var(--font-mono); margin-top:4px; word-break: break-all; border: 1px solid rgba(16,185,129,0.2);">${tokenData.token}</div></div>
        </div>

        <div style="display:flex; gap: 12px;">
          <button id="verifyDnsBtn" class="cta-button" style="background:var(--brand-emerald); border-color:var(--brand-emerald); flex:1; font-weight:700;">Check Verification</button>
          <button id="closeDnsModalBtn" type="button" class="cta-button" style="background:transparent; border-color:var(--surface-border); flex:1;">Cancel</button>
        </div>
        <div id="dnsErrorMsg" style="color: var(--brand-rose); font-size: 0.85rem; margin-top: 12px; text-align: center; display: none;"></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml); document.getElementById("closeDnsModalBtn").onclick = () => document.getElementById("dnsModal").remove();
  document.getElementById("verifyDnsBtn").onclick = async () => {
    const btn = document.getElementById("verifyDnsBtn"); const errMsg = document.getElementById("dnsErrorMsg");
    btn.disabled = true; btn.textContent = "Querying DNS & HTTP..."; errMsg.style.display = "none";
    try {
      const checkData = await (await fetch("/api/verification/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname }) })).json();
      if (checkData.success) { document.getElementById("dnsModal").remove(); onSuccess(); } else { errMsg.textContent = checkData.error; errMsg.style.display = "block"; btn.disabled = false; btn.textContent = "Check Verification"; }
    } catch { errMsg.textContent = "Network error connecting to the server."; errMsg.style.display = "block"; btn.disabled = false; btn.textContent = "Check Verification"; }
  };
}

function renderResults(data, targetId = "results") {
  const resultsEl = document.getElementById(targetId); if (!resultsEl) return;
  const { raw, hostname, score, grade, previousScan } = data; const isGuest = !currentUser; const isPro = currentUser && currentUser.is_pro;
  const gradeHex = score >= 75 ? "var(--brand-emerald)" : score >= 40 ? "var(--brand-amber)" : "var(--brand-rose)";
  const circumference = 2 * Math.PI * 40; const offset = circumference - (score / 100) * circumference;

  // --- FIXED MATH: Accurately count all 7 categories ---
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
  
  const badCookies = (raw.cookies?.cookies || []).filter(c => !c.secure || !c.httpOnly);
  if (badCookies.length > 0) badCookies.forEach(() => warning++); 
  else if (raw.cookies?.hasCookies) passed++;

  if (raw.malware?.checked) { if (raw.malware?.flagged) critical++; else passed++; }

  // --- Quick Status Banner ---
  let quickStatusHtml = '';
  const isMalware = raw.malware?.checked && raw.malware?.flagged;
  
  if (isMalware || score < 40 || !raw.tls?.valid) {
    quickStatusHtml = `<div class="card" style="background: rgba(244, 63, 94, 0.15); border-color: var(--brand-rose); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">🚨</span><div><strong style="color: var(--brand-rose); display: block; font-size: 1.05rem; margin-bottom: 2px;">Critical Security Alert</strong><span style="color: #cbd5e1; font-size: 0.88rem;">${isMalware ? 'Unsafe to browse: Google Safe Browsing detected malware or social engineering.' : 'Severe vulnerabilities detected. Immediate developer attention required.'}</span></div></div>`;
  } else if (score < 75) {
    quickStatusHtml = `<div class="card" style="background: rgba(245, 158, 11, 0.15); border-color: var(--brand-amber); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">⚠️</span><div><strong style="color: var(--brand-amber); display: block; font-size: 1.05rem; margin-bottom: 2px;">Needs Attention</strong><span style="color: #cbd5e1; font-size: 0.88rem;">Site is operational but missing key security policies. Developer review recommended.</span></div></div>`;
  } else {
    quickStatusHtml = `<div class="card" style="background: rgba(16, 185, 129, 0.15); border-color: var(--brand-emerald); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">✅</span><div><strong style="color: var(--brand-emerald); display: block; font-size: 1.05rem; margin-bottom: 2px;">Clean & Safe to Browse</strong><span style="color: #cbd5e1; font-size: 0.88rem;">No critical exploits or malware detected. Core security posture is solid.</span></div></div>`;
  }

  // Generate the Badges
  let html = quickStatusHtml + `<div class="card hero-grade-card"><div class="hero-grade-left"><div class="grade-ring"><svg viewBox="0 0 96 96"><circle class="grade-ring-bg" cx="48" cy="48" r="40"></circle><circle class="grade-ring-fg" cx="48" cy="48" r="40" stroke="${gradeHex}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><div class="grade-ring-letter" style="color:${gradeHex};">${grade}</div></div><div><div class="hero-score-title" style="display:flex; align-items:center; gap:8px;"><span>${hostname}</span>${isPro ? '<span style="font-size:0.65rem; background:rgba(16,185,129,0.2); color:var(--brand-emerald); border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:9999px;">PRO UNLOCKED</span>' : ""}</div></div></div><div class="summary-badges"><span class="summary-pill pill-critical" style="cursor:pointer;" id="filter-critical">${critical} Critical</span><span class="summary-pill pill-warning" style="cursor:pointer;" id="filter-warning">${warning} Warnings</span><span class="summary-pill pill-passed" style="cursor:pointer;" id="filter-passed">${passed} Passed</span></div></div>`;

  // --- DRAWING THE UI CARDS ---

  // 1. DAST Card
  if (raw.activeDastStatus) {
    html += `<div class="card" style="border-color: var(--brand-emerald); background: rgba(16,185,129,0.05); margin-bottom: 16px;"><strong style="color:var(--brand-emerald); font-size:1rem; display:block; margin-bottom:8px;">⚔️ Active DAST Engine</strong><div class="result-item"><span>Execution Status</span><span class="status-badge status-ok" style="background:var(--brand-emerald); color:#fff;">${raw.activeDastStatus}</span></div></div>`;
    if (raw.activeDastReport && raw.activeDastReport.site && raw.activeDastReport.site.length > 0) {
      const alerts = raw.activeDastReport.site[0].alerts || [];
      if (alerts.length === 0) {
        html += `<div class="card" style="border-color: var(--brand-emerald); margin-bottom: 24px;"><strong style="color:var(--brand-emerald); display:block;">🛡️ Zero Vulnerabilities Found</strong><p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">The active baseline scan did not detect any runtime exploits.</p></div>`;
      } else {
        html += `<h4 style="margin: 32px 0 16px; font-size: 1.1rem; color: #fff; letter-spacing: -0.02em;">Dynamic Analysis Findings</h4>`;
        alerts.forEach(alert => {
          let riskColor = "var(--text-secondary)";
          let riskBg = "var(--surface-subtle)";
          let riskText = "INFO";
          if (alert.riskcode === "3") { riskColor = "var(--brand-rose)"; riskBg = "rgba(244, 63, 94, 0.15)"; riskText = "HIGH"; }
          else if (alert.riskcode === "2") { riskColor = "var(--brand-amber)"; riskBg = "rgba(245, 158, 11, 0.15)"; riskText = "MEDIUM"; }
          else if (alert.riskcode === "1") { riskColor = "var(--brand-cyan)"; riskBg = "rgba(6, 182, 212, 0.15)"; riskText = "LOW"; }

          const cleanDesc = alert.desc.replace(/<[^>]+>/g, '').substring(0, 180) + '...';
          const cleanSol = alert.solution.replace(/<[^>]+>/g, '').substring(0, 220) + '...';

          html += `<div class="card" style="border-left: 4px solid ${riskColor}; margin-bottom: 16px; padding: 20px;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;"><strong style="color: #fff; font-size: 1rem;">${alert.name}</strong><span style="font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; background: ${riskBg}; color: ${riskColor}; letter-spacing: 0.05em;">${riskText}</span></div><div style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 16px;">${cleanDesc}</div><div style="background: rgba(0,0,0,0.25); padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.05);"><strong style="color: var(--text-tertiary); display: block; margin-bottom: 6px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Remediation Guidance</strong><span style="color: #cbd5e1; line-height: 1.5;">${cleanSol}</span></div></div>`;
        });
      }
    }
  }

  // 2. TLS Card
  html += `<div class="card"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🔒 SSL/TLS Transport Encryption</strong>`;
  if (raw.tls?.valid) { const days = raw.tls.daysUntilExpiry; html += `<div class="result-item"><span>Certificate Validity</span><span class="status-badge ${days < 14 ? "status-bad" : days < 30 ? "status-warn" : "status-ok"}">${days} Days Remaining</span></div><div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono);">${raw.tls.issuer}</span></div>`; } else html += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid / Insecure</span></div>`;
  html += `</div>`;

  // 3. Headers Card
  html += `<div class="card"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🛡️ HTTP Hardening Headers</strong>`;
  (raw.headers?.missing || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-bad">Missing</span></div>`);
  (raw.headers?.present || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`);
  html += `</div>`;

  // 4. Exposed Files Card
  html += `<div class="card" style="position: relative; overflow: hidden;"><strong style="font-size:1rem; display:block; margin-bottom:8px;">📁 Public File Leakage</strong>`;
  if (isGuest && (raw.exposedFiles || []).length > 0) html += `<div style="filter: blur(6px); pointer-events: none; opacity: 0.6;"><div class="result-item"><span style="font-family:var(--font-mono);">/.env</span><span class="status-badge status-bad">Exposed</span></div></div><div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10;"><button onclick="showSignInModal()" class="cta-button" style="background: rgba(15,23,42,0.9); border: 1px solid var(--brand-purple); color: #fff; padding: 8px 16px;">🔒 Sign in to view paths</button></div>`;
  else if (!raw.exposedFiles || raw.exposedFiles.length === 0) html += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  else raw.exposedFiles.forEach(f => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${f.path}</span><span class="status-badge status-bad">Exposed</span></div>`);
  html += `</div>`;

  // 5. NEW: Email Spoofing (SPF/DMARC)
  html += `<div class="card"><strong style="font-size:1rem; display:block; margin-bottom:8px;">📧 Email Spoofing Protection</strong>`;
  if (raw.emailAuth?.isSharedHost) {
      html += `<div class="result-item"><span>SPF / DMARC</span><span class="status-badge status-ok">Exempt (Shared Host)</span></div>`;
  } else {
      html += `<div class="result-item"><span>SPF Record</span><span class="status-badge ${raw.emailAuth?.spf ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.spf ? 'Verified' : 'Missing'}</span></div>`;
      html += `<div class="result-item"><span>DMARC Record</span><span class="status-badge ${raw.emailAuth?.dmarc ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.dmarc ? 'Verified' : 'Missing'}</span></div>`;
  }
  html += `</div>`;

  // 6. NEW: Cookies
  if (raw.cookies?.hasCookies) {
      html += `<div class="card"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🍪 Session & Cookie Security</strong>`;
      if (badCookies.length === 0) {
           html += `<div class="result-item"><span>Cookie Attributes</span><span class="status-badge status-ok">Secure</span></div>`;
      } else {
           badCookies.forEach(c => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${c.name}</span><span class="status-badge status-warn">Insecure Flags</span></div>`);
      }
      html += `</div>`;
  }

  // 7. NEW: CORS
  html += `<div class="card"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🔄 Cross-Origin Resource Sharing (CORS)</strong>`;
  if (raw.cors?.dangerousCombo) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-bad">Dangerous</span></div>`;
  else if (raw.cors?.wildcardOpen) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-warn">Wildcard Open</span></div>`;
  else html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-ok">Strict</span></div>`;
  html += `</div>`;

  if (isGuest) html += `<div class="card" style="text-align: center; border: 1px solid rgba(139,92,246,0.3); background: linear-gradient(180deg, rgba(30,27,75,0.3), rgba(15,23,42,0.8)); padding: 32px; margin-top: 24px;"><h3 style="color: #fff; margin-bottom: 8px;">Unlock Advanced Capabilities</h3><button onclick="showSignInModal()" class="cta-button" style="background: var(--brand-purple); border: none; max-width: 250px; margin: 0 auto;">Sign In with Google</button></div>`;
  else html += `<div class="action-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));"><button id="exportPdfBtn" class="cta-button pdf-export-btn" type="button">📄 Export Executive PDF</button><button id="explainBtn" class="cta-button" type="button">✨ Remediation Blueprint</button><button id="monitorBtn" class="cta-button" type="button" style="border-color: rgba(16,185,129,0.3); color: var(--brand-emerald);">🔔 Enable Alerts</button></div><div id="monitorFeedback" style="display:none; margin-top: 12px;"></div><div id="reportContainer" style="margin-top: 16px;"></div>`;
  
  resultsEl.innerHTML = html;

  if (!isGuest) {
    document.getElementById("exportPdfBtn")?.addEventListener("click", async () => {
      if (!currentUser.is_pro) return window.launchRazorpayCheckout("Executive PDF Export", () => window.location.reload());
      const btn = document.getElementById("exportPdfBtn"); btn.disabled = true; btn.textContent = "Generating PDF...";
      try { const blob = await (await fetch(`/api/download-pdf/${encodeURIComponent(hostname)}`)).blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `SiteScanner_${hostname}.pdf`; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url); } catch { alert("PDF Export Error"); } finally { btn.disabled = false; btn.textContent = "📄 Export Executive PDF"; }
    });
    
    document.getElementById("explainBtn")?.addEventListener("click", async () => {
      const container = document.getElementById("reportContainer"); container.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-secondary);">Compiling security intelligence blueprint...</div>';
      try {
        const resData = await (await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw, hostname }) })).json();
        
        // Parse Markdown to HTML if marked.js is loaded, otherwise fallback to plain text
        const parseMD = (text) => window.marked ? marked.parse(text) : text;

        let reportsHtml = `<div class="card"><strong style="display:block; font-size:1.1rem; margin-bottom:12px; color:#fff;">Standard Security Report</strong><div class="report">${parseMD(resData.ruleBasedReport)}</div></div>`;
        if (resData.aiReport) reportsHtml += `<div class="card ai-card"><div class="ai-header"><div class="ai-header-title"><span>✨ Actionable AI Remediation Blueprint</span></div></div><div class="report">${parseMD(resData.aiReport)}</div></div>`;
        else if (resData.aiError) reportsHtml += `<div class="card" style="border: 1px solid rgba(139,92,246,0.3); padding: 24px; text-align: center;"><strong style="color: var(--brand-purple); font-size: 1.1rem; display: block; margin-bottom: 8px;">✨ AI Blueprint Locked</strong><button onclick="window.launchRazorpayCheckout('AI Remediation Blueprint', () => window.location.reload())" class="cta-button" style="background: rgba(139,92,246,0.1); border: 1px solid var(--brand-purple); color: #fff; max-width: 250px; margin: 0 auto;">Upgrade to Pro</button></div>`;
        container.innerHTML = reportsHtml;
      } catch (err) { container.innerHTML = `<div class="card">Report error: ${err.message}</div>`; }
    });

    document.getElementById("monitorBtn")?.addEventListener("click", async () => {
      if (!currentUser.is_pro) return window.launchRazorpayCheckout("Automated Monitoring", () => window.location.reload());
      const btn = document.getElementById("monitorBtn"); btn.disabled = true; btn.textContent = "Configuring...";
      try {
        await fetch("/api/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, interval: "weekly", threshold: 75 }) });
        btn.textContent = "✓ Alerts Active"; btn.style.borderColor = "var(--brand-emerald)";
      } catch (err) { btn.disabled = false; btn.textContent = "🔔 Enable Alerts"; }
    });
  }

  // ==========================================
  // REAL-TIME POLLING LOOP
  // ==========================================
  if (raw.activeDastStatus && raw.activeDastStatus.toLowerCase().includes("executing")) {
    setTimeout(async () => {
      try {
        const res = await fetch(`/api/report/${encodeURIComponent(hostname)}`);
        if (res.ok) {
          const freshData = await res.json();
          renderResults(freshData, targetId);
        }
      } catch (err) {
        console.error("[Polling Error]", err);
      }
    }, 10000); 
  }
}
window.authReady = checkAuthSession();