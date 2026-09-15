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

  let quickStatusHtml = '';
  const isMalware = raw.malware?.checked && raw.malware?.flagged;
  
  if (isMalware || score < 40 || !raw.tls?.valid) {
    quickStatusHtml = `<div class="card" style="background: rgba(244, 63, 94, 0.15); border-color: var(--brand-rose); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">🚨</span><div><strong style="color: var(--brand-rose); display: block; font-size: 1.05rem; margin-bottom: 2px;">Critical Security Alert</strong><span style="color: #cbd5e1; font-size: 0.88rem;">${isMalware ? 'Unsafe to browse: Google Safe Browsing detected malware or social engineering.' : 'Severe vulnerabilities detected. Immediate developer attention required.'}</span></div></div>`;
  } else if (score < 75) {
    quickStatusHtml = `<div class="card" style="background: rgba(245, 158, 11, 0.15); border-color: var(--brand-amber); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">⚠️</span><div><strong style="color: var(--brand-amber); display: block; font-size: 1.05rem; margin-bottom: 2px;">Needs Attention</strong><span style="color: #cbd5e1; font-size: 0.88rem;">Site is operational but missing key security policies. Developer review recommended.</span></div></div>`;
  } else {
    quickStatusHtml = `<div class="card" style="background: rgba(16, 185, 129, 0.15); border-color: var(--brand-emerald); padding: 16px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;"><span style="font-size: 1.8rem;">✅</span><div><strong style="color: var(--brand-emerald); display: block; font-size: 1.05rem; margin-bottom: 2px;">Clean & Safe to Browse</strong><span style="color: #cbd5e1; font-size: 0.88rem;">No critical exploits or malware detected. Core security posture is solid.</span></div></div>`;
  }

  let html = quickStatusHtml + `<div class="card hero-grade-card"><div class="hero-grade-left"><div class="grade-ring"><svg viewBox="0 0 96 96" width="90" height="90" xmlns="http://www.w3.org/2000/svg"><circle class="grade-ring-bg" cx="48" cy="48" r="40"></circle><circle class="grade-ring-fg" cx="48" cy="48" r="40" stroke="${gradeHex}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><div class="grade-ring-letter" style="color:${gradeHex};">${grade}</div></div><div><div class="hero-score-title" style="display:flex; align-items:center; gap:8px;"><span>${hostname}</span>${isPro ? '<span style="font-size:0.65rem; background:rgba(16,185,129,0.2); color:var(--brand-emerald); border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:9999px;">PRO UNLOCKED</span>' : ""}</div><div style="margin-top: 6px; font-size: 0.95rem; color: var(--text-secondary);"><span style="font-weight: 600;">Overall Security Score:</span> <strong style="color: ${gradeHex}; font-size: 1.15rem; margin-left: 4px;">${score}</strong> <span style="font-size: 0.85rem; opacity: 0.8;">/ 100</span></div></div></div><div class="summary-badges"><span class="summary-pill pill-critical" style="cursor:pointer;" id="filter-critical">${critical} Critical</span><span class="summary-pill pill-warning" style="cursor:pointer;" id="filter-warning">${warning} Warnings</span><span class="summary-pill pill-passed" style="cursor:pointer;" id="filter-passed">${passed} Passed</span></div></div>`;

  if (raw.activeDastStatus) {
    html += `<div class="card result-card" data-severity="passed" style="border-color: var(--brand-emerald); background: rgba(16,185,129,0.05); margin-bottom: 16px;"><strong style="color:var(--brand-emerald); font-size:1rem; display:block; margin-bottom:8px;">⚔️ Active DAST Engine</strong><div class="result-item"><span>Execution Status</span><span class="status-badge status-ok" style="background:var(--brand-emerald); color:#fff;">${raw.activeDastStatus}</span></div></div>`;
    if (raw.activeDastReport && raw.activeDastReport.site && raw.activeDastReport.site.length > 0) {
      const alerts = raw.activeDastReport.site[0].alerts || [];
      if (alerts.length === 0) {
        html += `<div class="card result-card" data-severity="passed" style="border-color: var(--brand-emerald); margin-bottom: 24px;"><strong style="color:var(--brand-emerald); display:block;">🛡️ Zero Vulnerabilities Found</strong><p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">The active baseline scan did not detect any runtime exploits.</p></div>`;
      } else {
        html += `<h4 style="margin: 32px 0 16px; font-size: 1.1rem; color: #fff; letter-spacing: -0.02em;">Dynamic Analysis Findings</h4>`;
        alerts.forEach(alert => {
          let riskColor = "var(--text-secondary)";
          let riskBg = "var(--surface-subtle)";
          let riskText = "INFO";
          let sev = "passed";
          if (alert.riskcode === "3") { riskColor = "var(--brand-rose)"; riskBg = "rgba(244, 63, 94, 0.15)"; riskText = "HIGH"; sev = "critical"; }
          else if (alert.riskcode === "2") { riskColor = "var(--brand-amber)"; riskBg = "rgba(245, 158, 11, 0.15)"; riskText = "MEDIUM"; sev = "warning"; }
          else if (alert.riskcode === "1") { riskColor = "var(--brand-cyan)"; riskBg = "rgba(6, 182, 212, 0.15)"; riskText = "LOW"; sev = "warning"; }

          const cleanDesc = alert.desc.replace(/<[^>]+>/g, '').substring(0, 180) + '...';
          const cleanSol = alert.solution.replace(/<[^>]+>/g, '').substring(0, 220) + '...';

          html += `<div class="card result-card" data-severity="${sev}" style="border-left: 4px solid ${riskColor}; margin-bottom: 16px; padding: 20px;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;"><strong style="color: #fff; font-size: 1rem;">${alert.name}</strong><span style="font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; background: ${riskBg}; color: ${riskColor}; letter-spacing: 0.05em;">${riskText}</span></div><div style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 16px;">${cleanDesc}</div><div style="background: rgba(0,0,0,0.25); padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.05);"><strong style="color: var(--text-tertiary); display: block; margin-bottom: 6px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Remediation Guidance</strong><span style="color: #cbd5e1; line-height: 1.5;">${cleanSol}</span></div></div>`;
        });
      }
    }
  }

  const tlsSev = !raw.tls?.valid ? "critical" : (raw.tls.daysUntilExpiry < 30 ? "warning" : "passed");
  html += `<div class="card result-card" data-severity="${tlsSev}"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🔒 SSL/TLS Transport Encryption</strong>`;
  if (raw.tls?.valid) { const days = raw.tls.daysUntilExpiry; html += `<div class="result-item"><span>Certificate Validity</span><span class="status-badge ${days < 14 ? "status-bad" : days < 30 ? "status-warn" : "status-ok"}">${days} Days Remaining</span></div><div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono);">${raw.tls.issuer}</span></div>`; } else html += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid / Insecure</span></div>`;
  html += `</div>`;

  const hasMissingHeaders = (raw.headers?.missing || []).length > 0;
  html += `<div class="card result-card" data-severity="${hasMissingHeaders ? "critical" : "passed"}"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🛡️ HTTP Hardening Headers</strong>`;
  (raw.headers?.missing || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-bad">Missing</span></div>`);
  (raw.headers?.present || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`);
  html += `</div>`;

  const hasExposed = (raw.exposedFiles || []).length > 0;
  html += `<div class="card result-card" data-severity="${hasExposed ? "critical" : "passed"}" style="position: relative; overflow: hidden;"><strong style="font-size:1rem; display:block; margin-bottom:8px;">📁 Public File Leakage</strong>`;
  if (isGuest && hasExposed) html += `<div style="filter: blur(6px); pointer-events: none; opacity: 0.6;"><div class="result-item"><span style="font-family:var(--font-mono);">/.env</span><span class="status-badge status-bad">Exposed</span></div></div><div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10;"><button onclick="showSignInModal()" class="cta-button" style="background: rgba(15,23,42,0.9); border: 1px solid var(--brand-purple); color: #fff; padding: 8px 16px;">🔒 Sign in to view paths</button></div>`;
  else if (!raw.exposedFiles || raw.exposedFiles.length === 0) html += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  else raw.exposedFiles.forEach(f => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${f.path}</span><span class="status-badge status-bad">Exposed</span></div>`);
  html += `</div>`;

  const emailSev = (!raw.emailAuth?.isSharedHost && (!raw.emailAuth?.spf || !raw.emailAuth?.dmarc)) ? "warning" : "passed";
  html += `<div class="card result-card" data-severity="${emailSev}"><strong style="font-size:1rem; display:block; margin-bottom:8px;">📧 Email Spoofing Protection</strong>`;
  if (raw.emailAuth?.isSharedHost) {
      html += `<div class="result-item"><span>SPF / DMARC</span><span class="status-badge status-ok">Exempt (Shared Host)</span></div>`;
  } else {
      html += `<div class="result-item"><span>SPF Record</span><span class="status-badge ${raw.emailAuth?.spf ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.spf ? 'Verified' : 'Missing'}</span></div>`;
      html += `<div class="result-item"><span>DMARC Record</span><span class="status-badge ${raw.emailAuth?.dmarc ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.dmarc ? 'Verified' : 'Missing'}</span></div>`;
  }
  html += `</div>`;

  if (raw.cookies?.hasCookies) {
      const cookieSev = badCookies.length > 0 ? "warning" : "passed";
      html += `<div class="card result-card" data-severity="${cookieSev}"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🍪 Session & Cookie Security</strong>`;
      if (badCookies.length === 0) {
           html += `<div class="result-item"><span>Cookie Attributes</span><span class="status-badge status-ok">Secure</span></div>`;
      } else {
           badCookies.forEach(c => html += `<div class="result-item"><span style="font-family:var(--font-mono);">${c.name}</span><span class="status-badge status-warn">Insecure Flags</span></div>`);
      }
      html += `</div>`;
  }

  const corsSev = raw.cors?.dangerousCombo ? "critical" : (raw.cors?.wildcardOpen ? "warning" : "passed");
  html += `<div class="card result-card" data-severity="${corsSev}"><strong style="font-size:1rem; display:block; margin-bottom:8px;">🔄 Cross-Origin Resource Sharing (CORS)</strong>`;
  if (raw.cors?.dangerousCombo) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-bad">Dangerous</span></div>`;
  else if (raw.cors?.wildcardOpen) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-warn">Wildcard Open</span></div>`;
  else html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-ok">Strict</span></div>`;
  html += `</div>`;

  if (isGuest) html += `<div class="card" style="text-align: center; border: 1px solid rgba(139,92,246,0.3); background: linear-gradient(180deg, rgba(30,27,75,0.3), rgba(15,23,42,0.8)); padding: 32px; margin-top: 24px;"><h3 style="color: #fff; margin-bottom: 8px;">Unlock Advanced Capabilities</h3><button onclick="showSignInModal()" class="cta-button" style="background: var(--brand-purple); border: none; max-width: 250px; margin: 0 auto;">Sign In with Google</button></div>`;
  else html += `<div class="action-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));"><button id="exportPdfBtn" class="cta-button pdf-export-btn" type="button">📄 Export Executive PDF</button><button id="explainBtn" class="cta-button" type="button">✨ Remediation Blueprint</button><button id="monitorBtn" class="cta-button" type="button" style="border-color: rgba(16,185,129,0.3); color: var(--brand-emerald);">🔔 Enable Alerts</button></div><div id="monitorFeedback" style="display:none; margin-top: 12px;"></div><div id="reportContainer" style="margin-top: 16px;"></div>`;
  
  resultsEl.innerHTML = html;

  let activeFilter = null;
  const filterCards = (severity) => {
    const cards = document.querySelectorAll(".result-card");
    if (activeFilter === severity) {
      activeFilter = null;
      cards.forEach(c => c.style.display = "");
      return;
    }
    activeFilter = severity;
    cards.forEach(c => {
      c.style.display = c.getAttribute("data-severity") === severity ? "" : "none";
    });
  };

  document.getElementById("filter-critical")?.addEventListener("click", () => filterCards("critical"));
  document.getElementById("filter-warning")?.addEventListener("click", () => filterCards("warning"));
  document.getElementById("filter-passed")?.addEventListener("click", () => filterCards("passed"));

  if (!isGuest) {
    let isMonitoring = false;

    if (currentUser.is_pro) {
      fetch("/api/monitors")
        .then(res => res.json())
        .then(monitors => {
          if (Array.isArray(monitors) && monitors.some(m => m.hostname.toLowerCase() === hostname.toLowerCase() && m.is_active === 1)) {
            isMonitoring = true;
            const btn = document.getElementById("monitorBtn");
            if (btn) {
              btn.textContent = "✓ Alerts Active";
              btn.style.borderColor = "var(--brand-emerald)";
              btn.style.color = "var(--brand-emerald)";
            }
          }
        }).catch(() => {}); 
    }

    document.getElementById("exportPdfBtn")?.addEventListener("click", async () => {
      if (!currentUser.is_pro) return window.launchRazorpayCheckout("Executive PDF Export", () => window.location.reload());
      const btn = document.getElementById("exportPdfBtn"); 
      btn.disabled = true; 
      btn.textContent = "Generating Corporate PDF...";
      try { 
        const hasAi = document.querySelector('.ai-card') ? '?ai=true' : '';
        const blob = await (await fetch(`/api/download-pdf/${encodeURIComponent(hostname)}${hasAi}`)).blob(); 
        const url = window.URL.createObjectURL(blob); 
        const a = document.createElement("a"); 
        a.href = url; 
        a.download = `SiteScanner_Executive_Audit_${hostname}.pdf`; 
        document.body.appendChild(a); 
        a.click(); 
        a.remove(); 
        window.URL.revokeObjectURL(url); 
      } catch { alert("PDF Export Error"); } 
      finally { btn.disabled = false; btn.textContent = "📄 Export Executive PDF"; }
    });
    
    document.getElementById("explainBtn")?.addEventListener("click", async () => {
      const container = document.getElementById("reportContainer"); 
      container.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-secondary);">Generating Standard Security Report...</div>';
      
      try {
        const resData = await (await fetch("/api/explain", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ raw, hostname, mode: 'standard' }) 
        })).json();
        
        const parseMD = (text) => window.marked ? marked.parse(text) : text;

        let reportsHtml = `<div class="card"><strong style="display:block; font-size:1.1rem; margin-bottom:12px; color:#fff;">Standard Security Report</strong><div class="report">${parseMD(resData.ruleBasedReport)}</div></div>`;
        
        reportsHtml += `
          <div id="aiReportContainer">
            <div class="card" style="text-align: center; border: 1px dashed rgba(139,92,246,0.4); padding: 32px; background: rgba(139,92,246,0.05);">
              <strong style="color: #c4b5fd; font-size: 1.1rem; display: block; margin-bottom: 8px;">✨ Deep AI Analysis Available</strong>
              <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 16px;">Run an Advanced AppSec review of this scan data using Google Gemini.</p>
              <button id="generateAiBtn" class="cta-button" style="max-width: 250px; margin: 0 auto; background: var(--brand-purple); border: none;">Generate AI Blueprint</button>
            </div>
          </div>
        `;

        container.innerHTML = reportsHtml;
        
        document.getElementById("generateAiBtn")?.addEventListener("click", async () => {
          const aiContainer = document.getElementById("aiReportContainer");
          aiContainer.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--brand-purple);">Compiling AI security intelligence blueprint...</div>';

          try {
            const aiRes = await (await fetch("/api/explain", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ raw, hostname, mode: 'ai' })
            })).json();

            let aiHtml = '';
            if (aiRes.aiReport) {
              aiHtml = `<div class="card ai-card"><div class="ai-header"><div class="ai-header-title"><span>✨ Actionable AI Remediation Blueprint</span></div></div><div class="report">${parseMD(aiRes.aiReport)}</div></div>`;
            } else if (aiRes.aiError) {
              if (currentUser && currentUser.is_pro) {
                 aiHtml = `<div class="card ai-error" style="border: 1px solid rgba(244,63,94,0.3); padding: 24px; text-align: center;"><strong style="color: var(--brand-rose); font-size: 1.1rem; display: block; margin-bottom: 8px;">⚠️ AI Engine Offline</strong><p style="color: var(--text-secondary); font-size: 0.9rem;">${aiRes.aiError}</p></div>`;
              } else {
                 aiHtml = `<div class="card ai-error" style="border: 1px solid rgba(139,92,246,0.3); padding: 24px; text-align: center;"><strong style="color: var(--brand-purple); font-size: 1.1rem; display: block; margin-bottom: 8px;">✨ AI Blueprint Locked</strong><button onclick="window.launchRazorpayCheckout('AI Remediation Blueprint', () => window.location.reload())" class="cta-button" style="background: rgba(139,92,246,0.1); border: 1px solid var(--brand-purple); color: #fff; max-width: 250px; margin: 0 auto;">Upgrade to Pro</button></div>`;
              }
            } else {
               aiHtml = `<div class="card ai-error" style="border: 1px solid rgba(244,63,94,0.3); padding: 24px; text-align: center;"><strong style="color: var(--brand-rose); font-size: 1.1rem; display: block; margin-bottom: 8px;">⚠️ AI Engine Offline</strong><p style="color: var(--text-secondary); font-size: 0.9rem;">Pro upgrade required or GEMINI_API_KEY missing.</p></div>`;
            }
            aiContainer.innerHTML = aiHtml;
          } catch (err) {
             aiContainer.innerHTML = `<div class="card ai-error">AI Report error: ${err.message}</div>`;
          }
        });

      } catch (err) { container.innerHTML = `<div class="card">Report error: ${err.message}</div>`; }
    });

    document.getElementById("monitorBtn")?.addEventListener("click", async () => {
      if (!currentUser.is_pro) return window.launchRazorpayCheckout("Automated Monitoring", () => window.location.reload());
      const btn = document.getElementById("monitorBtn"); 
      btn.disabled = true; 
      
      if (isMonitoring) {
        btn.textContent = "Disabling...";
        try {
          await fetch("/api/monitors/toggle-domain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, isActive: false }) });
          isMonitoring = false;
          btn.textContent = "🔔 Enable Alerts"; 
          btn.style.borderColor = "rgba(16,185,129,0.3)";
          btn.style.color = "var(--brand-emerald)";
        } catch (err) { btn.textContent = "Error"; }
      } else {
        btn.textContent = "Configuring...";
        try {
          await fetch("/api/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, interval: "weekly", threshold: 75 }) });
          isMonitoring = true;
          btn.textContent = "✓ Alerts Active"; 
          btn.style.borderColor = "var(--brand-emerald)";
          btn.style.color = "var(--brand-emerald)";
        } catch (err) { btn.textContent = "Error"; }
      }
      btn.disabled = false;
    });
  }

  if (raw.activeDastStatus && raw.activeDastStatus.toLowerCase().includes("executing")) {
    setTimeout(async () => {
      try {
        const res = await fetch(`/api/report/${encodeURIComponent(hostname)}`);
        if (res.ok) {
          const freshData = await res.json();
          renderResults(freshData, targetId);
        }
      } catch (err) { console.error("[Polling Error]", err); }
    }, 10000); 
  }
}
window.authReady = checkAuthSession();

window.activeLoadingInterval = null;

window.showLoadingState = function(container, mode) {
  clearInterval(window.activeLoadingInterval);
  const isActive = mode === 'active';
  const color = isActive ? 'var(--brand-emerald)' : 'var(--brand-cyan)';
  const title = isActive ? 'Injecting Payloads & Deep Scanning' : 'Running Standard Security Audit';

  container.innerHTML = `
    <div class="card" style="padding: 56px 32px; text-align: center; border-color: ${color}; background: linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.6) 100%); position: relative; overflow: hidden; animation: slideUp 0.35s ease-out forwards;">
      <div style="width: 64px; height: 64px; border-radius: 50%; background: ${isActive ? 'rgba(16,185,129,0.1)' : 'rgba(6,182,212,0.1)'}; color: ${color}; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; margin: 0 auto 24px; animation: pulse 2s infinite; border: 1px solid ${isActive ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}; box-shadow: 0 0 20px ${isActive ? 'rgba(16,185,129,0.2)' : 'rgba(6,182,212,0.2)'};">
         ${isActive ? '⚔️' : '🛡️'}
      </div>
      <h3 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin-bottom: 24px; letter-spacing: -0.01em;">${title}</h3>
      <div style="width: 100%; max-width: 360px; height: 4px; background: rgba(255,255,255,0.1); margin: 0 auto; border-radius: 8px; overflow: hidden;">
        <div id="scanProgressBar" style="width: 0%; height: 100%; background: ${color}; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 10px ${color};"></div>
      </div>
      <div id="scanProgressText" style="margin-top: 16px; font-family: var(--font-mono); font-size: 0.9rem; font-weight: 600; color: #fff;">0%</div>
      <div id="scanProgressLog" style="margin-top: 12px; font-size: 0.8rem; color: var(--text-tertiary); min-height: 20px; transition: opacity 0.2s;">Establishing secure connection...</div>
    </div>
  `;

  let progress = 0;
  const logs = isActive 
    ? ["Bypassing WAF...", "Injecting XSS payloads...", "Testing SQLi vectors...", "Analyzing CORS policies...", "Mapping attack surface...", "Compiling threat data..."]
    : ["Checking SSL/TLS certificates...", "Verifying DNS & SPF records...", "Analyzing HTTP headers...", "Scanning for exposed .env files...", "Testing cookie security...", "Finalizing health report..."];
  
  let logIndex = 0;
  const bar = document.getElementById("scanProgressBar");
  const text = document.getElementById("scanProgressText");
  const logEl = document.getElementById("scanProgressLog");

  window.activeLoadingInterval = setInterval(() => {
      const increment = (99 - progress) * 0.05; 
      progress += Math.max(increment, 0.1);
      if (progress >= 99.9) progress = 99.9;
      
      if (bar) bar.style.width = `${progress}%`;
      if (text) text.textContent = `${Math.floor(progress)}%`;

      if (Math.random() > 0.90 && logIndex < logs.length) {
          if (logEl) {
            logEl.style.opacity = 0;
            setTimeout(() => {
              logEl.textContent = logs[logIndex];
              logEl.style.opacity = 1;
              logIndex++;
            }, 200);
          }
      }
  }, 200);
};