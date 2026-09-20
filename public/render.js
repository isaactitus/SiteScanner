// public/render.js
let currentUser = null;
const GOOGLE_CLIENT_ID = "850082538445-h6ehbqqta1ebegfrdretko5plf5eaqme.apps.googleusercontent.com";

window.loadRecentFeed = async function() {
  const recentListEl = document.getElementById('recentList');
  if (!recentListEl) return;
  try {
    const items = await (await fetch('/api/recent')).json();
    if (!items || items.length === 0) return recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">[ NO_RECENT_SCANS ]</span>';
    recentListEl.innerHTML = items.map(item => `<a href="/report/${encodeURIComponent(item.hostname)}" class="feed-chip"><span>${item.hostname}</span><span class="feed-chip-grade" style="color:${item.score >= 75 ? 'var(--brand-emerald)' : item.score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)'}">${item.grade} (${item.score})</span></a>`).join('');
  } catch { recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">[ SYSTEM_OFFLINE ]</span>'; }
};

async function checkAuthSession() { try { const data = await (await fetch("/api/auth/me")).json(); currentUser = data.user; updateNavAuthUI(); } catch { currentUser = null; updateNavAuthUI(); } }

function updateNavAuthUI() {
  const container = document.getElementById("authNavContainer");
  if (!container) return;
  if (currentUser) {
    const isPro = currentUser.is_pro; const badge = isPro ? "PRO" : "FREE"; const badgeColor = isPro ? "var(--brand-emerald)" : "var(--brand-purple)";
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.3s var(--ease-float);" id="userProfileBtn" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
        <img src="${currentUser.avatar_url || 'https://via.placeholder.com/32'}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--surface-border);" />
        <span style="font-size: 0.85rem; color: #fff; font-weight: 600;">${currentUser.name ? currentUser.name.split(' ')[0] : 'User'}</span>
        <span style="font-size: 0.65rem; padding: 2px 8px; border-radius: 9999px; background: var(--surface-subtle); color: ${badgeColor}; border: 1px solid var(--surface-border); font-family: var(--font-mono); font-weight: 700;">${badge}</span>
      </div>
      <div id="userDropdown" style="display: none; position: absolute; right: 0; top: 48px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 12px; z-index: 10000; box-shadow: var(--shadow-float); min-width: 220px; animation: floatUpFade 0.3s var(--ease-float);">
        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 12px; word-break: break-all; font-family: var(--font-mono); padding: 0 8px;">${currentUser.email}</div>
        <a href="/dashboard.html" style="display: block; font-size: 0.85rem; color: #fff; text-decoration: none; margin-bottom: 8px; padding: 8px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--surface-border); transition: all 0.2s;" onmouseover="this.style.background='var(--surface-border)'" onmouseout="this.style.background='var(--surface-subtle)'">Command Center</a>
        <a href="/history" style="display: block; font-size: 0.85rem; color: #fff; text-decoration: none; margin-bottom: 12px; padding: 8px 12px; background: transparent; border-radius: var(--radius-sm); text-align: center; border: 1px solid transparent; transition: all 0.2s;" onmouseover="this.style.background='var(--surface-subtle)'" onmouseout="this.style.background='transparent'">Audit History</a>
        <hr style="border: none; border-top: 1px solid var(--surface-border); margin-bottom: 8px;" />
        <button id="logoutBtn" style="background: transparent; border: none; color: var(--brand-rose); font-size: 0.85rem; font-weight: 600; cursor: pointer; padding: 8px 12px; width: 100%; text-align: left; border-radius: var(--radius-sm); transition: background 0.2s;" onmouseover="this.style.background='rgba(251,113,133,0.1)'" onmouseout="this.style.background='transparent'">Sign Out</button>
      </div>`;
      
    document.getElementById("userProfileBtn").onclick = (e) => { 
      e.stopPropagation(); 
      const dd = document.getElementById("userDropdown"); 
      dd.style.display = dd.style.display === "none" ? "block" : "none"; 
    };
    
    document.getElementById("userDropdown").onclick = (e) => { e.stopPropagation(); };
    
    if (!window.navListenerAttached) {
      document.addEventListener("click", () => { 
        const dd = document.getElementById("userDropdown"); 
        if (dd) dd.style.display = "none"; 
      });
      window.navListenerAttached = true;
    }
    
    document.getElementById("logoutBtn").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }); currentUser = null; location.reload(); };
  } else {
    container.innerHTML = `<button id="navSignInBtn" class="cta-button" style="padding: 8px 24px; font-size: 0.85rem;" type="button">Sign In</button>`;
    document.getElementById("navSignInBtn").onclick = showSignInModal;
  }
}

function showSignInModal() {
  if (document.getElementById("authModal")) document.getElementById("authModal").remove();
  const modalHtml = `<div id="authModal" style="position:fixed; inset:0; background:rgba(10, 14, 23, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; animation: floatUpFade 0.3s var(--ease-float);"><div class="card" style="max-width:400px; width:100%; text-align:center; padding:40px 32px;"><h3 style="color:#fff; font-size:1.35rem; font-weight:700; margin-bottom:12px;">Authentication Required</h3><p style="color:var(--text-secondary); font-size:0.9rem; line-height:1.6; margin-bottom:32px;">Log in with Google to synchronize your enterprise audits, remediation plans, and custom telemetry monitors.</p><div id="googleBtnContainer" style="display:flex; justify-content:center; margin-bottom:24px;"></div><button id="closeAuthModal" type="button" style="background:transparent; border:none; color:var(--text-tertiary); font-weight:600; cursor:pointer; font-size:0.85rem; padding: 8px 16px; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-tertiary)'">Cancel</button></div></div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml); document.getElementById("closeAuthModal").onclick = () => document.getElementById("authModal").remove();
  if (window.google) { window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: async (res) => { try { const data = await (await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: res.credential }) })).json(); if (data.success) { currentUser = data.user; document.getElementById("authModal")?.remove(); updateNavAuthUI(); location.reload(); } else alert("Authentication failed: " + data.error); } catch (err) { alert("Network error during authentication."); } } }); window.google.accounts.id.renderButton(document.getElementById("googleBtnContainer"), { theme: "filled_black", size: "large", width: 280, shape: "pill" }); }
}

window.launchRazorpayCheckout = function(featureName, onSuccess) {
  if (!currentUser) return showSignInModal();
  if (document.getElementById("paywallModal")) document.getElementById("paywallModal").remove();
  if (typeof window.Razorpay === "undefined") return alert("Payment system initializing. Please try again.");
  document.body.insertAdjacentHTML("beforeend", `<div id="paywallModal" style="position:fixed; inset:0; background:rgba(10, 14, 23, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; animation: floatUpFade 0.3s var(--ease-float);"><div class="card" style="max-width:480px; width:100%; border:1px solid var(--surface-border); text-align:center; padding:40px 32px;"><span style="font-family: var(--font-mono); font-weight: 700; color: var(--brand-emerald); font-size: 0.8rem; letter-spacing: 0.05em; display: block; margin-bottom: 16px;">[ PRO TIER REQUIRED ]</span><h3 style="color:#fff; font-size:1.5rem; font-weight:800; margin-bottom:12px; letter-spacing: -0.02em;">Upgrade Required</h3><p style="color:var(--text-secondary); font-size:0.95rem; line-height:1.6; margin-bottom:32px;"><strong>${featureName}</strong> is restricted. Upgrade to provision unlimited daily scans, automated infrastructure monitoring, and advanced remediation planning.</p><button id="paywallCheckoutBtn" class="cta-button" style="margin-bottom:16px; font-weight:700; background: #fff; color: #000; border: none;">Authorize Upgrade (₹499)</button><button id="paywallCloseBtn" type="button" style="background:transparent; border:none; color:var(--text-tertiary); font-weight:600; cursor:pointer; font-size:0.85rem; padding:8px 16px; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-tertiary)'">Dismiss</button></div></div>`);
  document.getElementById("paywallCloseBtn").onclick = () => document.getElementById("paywallModal").remove();
  document.getElementById("paywallCheckoutBtn").onclick = async () => {
    const btn = document.getElementById("paywallCheckoutBtn"); btn.disabled = true; btn.textContent = "Provisioning Order...";
    try {
      const order = await (await fetch("/api/create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })).json();
      if (order.error) throw new Error(order.error);
      const rzp = new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency, name: "SiteScanner Pro", order_id: order.orderId, handler: async function (response) { btn.textContent = "Verifying Transaction..."; try { const verifyData = await (await fetch("/api/verify-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature }) })).json(); if (verifyData.success) { currentUser.is_pro = true; document.getElementById("paywallModal")?.remove(); updateNavAuthUI(); if (onSuccess) onSuccess(); } else { alert("Transaction Failed"); btn.disabled = false; btn.textContent = "Authorize Upgrade (₹499)"; } } catch { alert("Network Error"); btn.disabled = false; btn.textContent = "Authorize Upgrade (₹499)"; } }, prefill: { name: currentUser.name || "Administrator", email: currentUser.email || "" }, theme: { color: "#ffffff" } });
      rzp.open();
    } catch (err) { btn.disabled = false; btn.textContent = "System Error: " + err.message; }
  };
}

window.showDnsVerificationModal = async function(hostname, onSuccess) {
  if (document.getElementById("dnsModal")) document.getElementById("dnsModal").remove();
  let tokenData;
  try {
    const res = await fetch("/api/verification/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname }) });
    tokenData = await res.json(); if (tokenData.isVerified) return onSuccess();
  } catch (err) { return alert("Authorization payload failed to generate."); }

  const modalHtml = `
    <div id="dnsModal" style="position:fixed; inset:0; background:rgba(10, 14, 23, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; overflow-y: auto; animation: floatUpFade 0.3s var(--ease-float);">
      <div class="card" style="max-width:600px; width:100%; border:1px solid var(--surface-border); text-align:left; padding:40px; margin-top: auto; margin-bottom: auto;">
        <h3 style="color:#fff; font-size:1.4rem; font-weight:700; margin-bottom:12px; letter-spacing: -0.02em;">Domain Authorization Required</h3>
        <p style="color:var(--text-secondary); font-size:0.95rem; line-height:1.6; margin-bottom:24px;">To execute dynamic application security testing (DAST), cryptographic proof of ownership for <strong>${hostname}</strong> is required. Deploy one of the following verification records.</p>
        
        <div style="background: var(--surface-subtle); padding: 20px; border-radius: var(--radius-md); border: 1px solid var(--surface-border); margin-bottom: 16px;">
          <strong style="color: #fff; font-size: 0.95rem; margin-bottom: 12px; display: block; font-family: var(--font-mono);">[ METHOD_01: DNS TXT RECORD ]</strong>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Type</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px;">TXT</div></div>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Host / Name</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px;">@ <span style="color:var(--text-tertiary); font-size:0.8rem;">(or ${hostname})</span></div></div>
          <div><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">Value / Content</span><div style="background: rgba(255,255,255,0.05); color:var(--text-primary); padding: 12px; border-radius: var(--radius-sm); font-family:var(--font-mono); font-size:0.9rem; margin-top:6px; word-break: break-all; border: 1px solid rgba(255,255,255,0.1);">${tokenData.token}</div></div>
        </div>

        <div style="background: var(--surface-subtle); padding: 20px; border-radius: var(--radius-md); border: 1px solid var(--surface-border); margin-bottom: 32px;">
          <strong style="color: #fff; font-size: 0.95rem; margin-bottom: 12px; display: block; font-family: var(--font-mono);">[ METHOD_02: HTTP STATIC FILE ]</strong>
          <div style="margin-bottom: 12px;"><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">File Path</span><div style="color:#fff; font-family:var(--font-mono); margin-top:2px; word-break: break-all;">https://${hostname}/.well-known/sitescanner-verification.txt</div></div>
          <div><span style="font-size:0.75rem; color:var(--text-tertiary); text-transform:uppercase; font-weight:bold;">File Content</span><div style="background: rgba(255,255,255,0.05); color:var(--text-primary); padding: 12px; border-radius: var(--radius-sm); font-family:var(--font-mono); font-size:0.9rem; margin-top:6px; word-break: break-all; border: 1px solid rgba(255,255,255,0.1);">${tokenData.token}</div></div>
        </div>

        <div style="display:flex; gap: 16px;">
          <button id="verifyDnsBtn" class="cta-button" style="background:#fff; color:#000; border:none; flex:1;">Execute Verification</button>
          <button id="closeDnsModalBtn" type="button" class="cta-button" style="background:transparent; border-color:var(--surface-border); flex:1;">Cancel Deployment</button>
        </div>
        <div id="dnsErrorMsg" style="color: var(--brand-rose); font-family: var(--font-mono); font-size: 0.85rem; margin-top: 16px; text-align: center; display: none;"></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHtml); document.getElementById("closeDnsModalBtn").onclick = () => document.getElementById("dnsModal").remove();
  document.getElementById("verifyDnsBtn").onclick = async () => {
    const btn = document.getElementById("verifyDnsBtn"); const errMsg = document.getElementById("dnsErrorMsg");
    btn.disabled = true; btn.textContent = "Querying Infrastructure..."; errMsg.style.display = "none";
    try {
      const checkData = await (await fetch("/api/verification/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname }) })).json();
      if (checkData.success) { document.getElementById("dnsModal").remove(); onSuccess(); } else { errMsg.textContent = `[ERROR] ${checkData.error}`; errMsg.style.display = "block"; btn.disabled = false; btn.textContent = "Execute Verification"; }
    } catch { errMsg.textContent = "[ERROR] Network timeout connecting to infrastructure."; errMsg.style.display = "block"; btn.disabled = false; btn.textContent = "Execute Verification"; }
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
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-rose); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: CRITICAL ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">${isMalware ? 'Infrastructure flagged by Google Safe Browsing. Malware or social engineering present.' : 'Severe vulnerabilities detected. Immediate infrastructure remediation required.'}</span></div></div>`;
  } else if (score < 75) {
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-amber); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: WARNING ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">Infrastructure is operational but lacks strict security enforcement policies.</span></div></div>`;
  } else {
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-emerald); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: SECURE ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">No critical exploits detected. Perimeter security policies are strictly enforced.</span></div></div>`;
  }

  let html = quickStatusHtml + `<div class="card hero-grade-card"><div class="hero-grade-left"><div class="grade-ring"><svg viewBox="0 0 96 96" width="90" height="90" xmlns="http://www.w3.org/2000/svg"><circle class="grade-ring-bg" cx="48" cy="48" r="40"></circle><circle class="grade-ring-fg" cx="48" cy="48" r="40" stroke="${gradeHex}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><div class="grade-ring-letter" style="color:${gradeHex};">${grade}</div></div><div><div class="hero-score-title" style="display:flex; align-items:center; gap:12px;"><span>${hostname}</span>${isPro ? '<span style="font-size:0.65rem; background:rgba(255,255,255,0.05); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1); padding:4px 10px; border-radius:9999px; font-family:var(--font-mono); font-weight:700;">PRO_UNLOCKED</span>' : ""}</div><div style="margin-top: 8px; font-size: 1rem; color: var(--text-secondary);"><span style="font-weight: 600;">Overall Security Score:</span> <strong style="color: ${gradeHex}; font-size: 1.25rem; margin-left: 6px;">${score}</strong> <span style="font-size: 0.85rem; opacity: 0.6;">/ 100</span></div></div></div><div class="summary-badges"><span class="summary-pill pill-critical" style="cursor:pointer;" id="filter-critical">${critical} Critical</span><span class="summary-pill pill-warning" style="cursor:pointer;" id="filter-warning">${warning} Warnings</span><span class="summary-pill pill-passed" style="cursor:pointer;" id="filter-passed">${passed} Passed</span></div></div>`;

  if (raw.activeDastStatus) {
    html += `<div class="card result-card" data-severity="passed" style="border-color: var(--surface-border); background: var(--surface-subtle); margin-bottom: 24px;"><strong style="color:#fff; font-size:1.05rem; display:block; margin-bottom:16px;">Active DAST Engine</strong><div class="result-item"><span>Execution Status</span><span class="status-badge" style="background:var(--surface); border: 1px solid var(--surface-border); color:var(--brand-emerald);">${raw.activeDastStatus}</span></div></div>`;
    if (raw.activeDastReport && raw.activeDastReport.site && raw.activeDastReport.site.length > 0) {
      const alerts = raw.activeDastReport.site[0].alerts || [];
      if (alerts.length === 0) {
        html += `<div class="card result-card" data-severity="passed" style="border-left: 4px solid var(--brand-emerald); margin-bottom: 32px;"><strong style="color:var(--text-primary); display:block; font-size: 1.05rem;">Zero Runtime Vulnerabilities Detected</strong><p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 6px;">Active exploitation payload execution returned clear.</p></div>`;
      } else {
        html += `<h4 style="margin: 40px 0 20px; font-size: 1.2rem; font-weight: 700; color: #fff; letter-spacing: -0.02em;">Dynamic Analysis Output</h4>`;
        alerts.forEach(alert => {
          let riskColor = "var(--text-secondary)";
          let riskBg = "var(--surface-subtle)";
          let riskText = "INFO";
          let sev = "passed";
          if (alert.riskcode === "3") { riskColor = "var(--brand-rose)"; riskBg = "rgba(251, 113, 133, 0.1)"; riskText = "HIGH_RISK"; sev = "critical"; }
          else if (alert.riskcode === "2") { riskColor = "var(--brand-amber)"; riskBg = "rgba(251, 191, 36, 0.1)"; riskText = "MED_RISK"; sev = "warning"; }
          else if (alert.riskcode === "1") { riskColor = "var(--brand-cyan)"; riskBg = "rgba(56, 189, 248, 0.1)"; riskText = "LOW_RISK"; sev = "warning"; }

          const cleanDesc = alert.desc.replace(/<[^>]+>/g, '').substring(0, 180) + '...';
          const cleanSol = alert.solution.replace(/<[^>]+>/g, '').substring(0, 220) + '...';

          html += `<div class="card result-card" data-severity="${sev}" style="border-left: 4px solid ${riskColor}; margin-bottom: 16px; padding: 24px;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;"><strong style="color: #fff; font-size: 1.05rem;">${alert.name}</strong><span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; background: ${riskBg}; color: ${riskColor}; letter-spacing: 0.05em;">[${riskText}]</span></div><div style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px;">${cleanDesc}</div><div style="background: var(--surface-subtle); padding: 16px 20px; border-radius: var(--radius-md); font-size: 0.9rem; border: 1px solid var(--surface-border);"><strong style="color: #fff; font-family: var(--font-mono); display: block; margin-bottom: 8px; font-size: 0.8rem; letter-spacing: 0.05em;">REQUIREMENT_RESOLUTION</strong><span style="color: var(--text-secondary); line-height: 1.6; display: block;">${cleanSol}</span></div></div>`;
        });
      }
    }
  }

  const tlsSev = !raw.tls?.valid ? "critical" : (raw.tls.daysUntilExpiry < 30 ? "warning" : "passed");
  html += `<div class="card result-card" data-severity="${tlsSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">SSL/TLS Transport Encryption</strong>`;
  if (raw.tls?.valid) { const days = raw.tls.daysUntilExpiry; html += `<div class="result-item"><span>Certificate Validity</span><span class="status-badge ${days < 14 ? "status-bad" : days < 30 ? "status-warn" : "status-ok"}">${days} Days Remaining</span></div><div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono); color: var(--text-secondary);">${raw.tls.issuer}</span></div>`; } else html += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid / Insecure</span></div>`;
  html += `</div>`;

  const hasMissingHeaders = (raw.headers?.missing || []).length > 0;
  html += `<div class="card result-card" data-severity="${hasMissingHeaders ? "critical" : "passed"}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">HTTP Hardening Headers</strong>`;
  (raw.headers?.missing || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${h}</span><span class="status-badge status-bad">Missing</span></div>`);
  (raw.headers?.present || []).forEach(h => html += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`);
  html += `</div>`;

  const hasExposed = (raw.exposedFiles || []).length > 0;
  html += `<div class="card result-card" data-severity="${hasExposed ? "critical" : "passed"}" style="position: relative; overflow: hidden;"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Public File Leakage</strong>`;
  if (isGuest && hasExposed) html += `<div style="filter: blur(6px); pointer-events: none; opacity: 0.6;"><div class="result-item"><span style="font-family:var(--font-mono);">/.env</span><span class="status-badge status-bad">Exposed</span></div></div><div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10;"><button onclick="showSignInModal()" class="cta-button" style="background: var(--surface); border: 1px solid var(--surface-border); color: #fff; padding: 10px 24px; max-width: 200px;">Sign In to View</button></div>`;
  else if (!raw.exposedFiles || raw.exposedFiles.length === 0) html += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  else raw.exposedFiles.forEach(f => html += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${f.path}</span><span class="status-badge status-bad">Exposed</span></div>`);
  html += `</div>`;

  const emailSev = (!raw.emailAuth?.isSharedHost && (!raw.emailAuth?.spf || !raw.emailAuth?.dmarc)) ? "warning" : "passed";
  html += `<div class="card result-card" data-severity="${emailSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Email Spoofing Protection</strong>`;
  if (raw.emailAuth?.isSharedHost) {
      html += `<div class="result-item"><span>SPF / DMARC</span><span class="status-badge status-ok">Exempt (Shared Host)</span></div>`;
  } else {
      html += `<div class="result-item"><span>SPF Record</span><span class="status-badge ${raw.emailAuth?.spf ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.spf ? 'Verified' : 'Missing'}</span></div>`;
      html += `<div class="result-item"><span>DMARC Record</span><span class="status-badge ${raw.emailAuth?.dmarc ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.dmarc ? 'Verified' : 'Missing'}</span></div>`;
  }
  html += `</div>`;

  if (raw.cookies?.hasCookies) {
      const cookieSev = badCookies.length > 0 ? "warning" : "passed";
      html += `<div class="card result-card" data-severity="${cookieSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Session & Cookie Security</strong>`;
      if (badCookies.length === 0) {
           html += `<div class="result-item"><span>Cookie Attributes</span><span class="status-badge status-ok">Secure</span></div>`;
      } else {
           badCookies.forEach(c => html += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${c.name}</span><span class="status-badge status-warn">Insecure Flags</span></div>`);
      }
      html += `</div>`;
  }

  const corsSev = raw.cors?.dangerousCombo ? "critical" : (raw.cors?.wildcardOpen ? "warning" : "passed");
  html += `<div class="card result-card" data-severity="${corsSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Cross-Origin Resource Sharing (CORS)</strong>`;
  if (raw.cors?.dangerousCombo) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-bad">Dangerous</span></div>`;
  else if (raw.cors?.wildcardOpen) html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-warn">Wildcard Open</span></div>`;
  else html += `<div class="result-item"><span>Configuration</span><span class="status-badge status-ok">Strict</span></div>`;
  html += `</div>`;

  if (isGuest) html += `<div class="card" style="text-align: center; border: 1px solid var(--surface-border); background: var(--surface-subtle); padding: 48px 32px; margin-top: 32px;"><h3 style="color: #fff; margin-bottom: 12px; font-weight: 700;">Infrastructure Management</h3><p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px;">Authenticate to export reports and establish automated telemetry.</p><button onclick="showSignInModal()" class="cta-button" style="background: #fff; color: #000; border: none; max-width: 250px; margin: 0 auto;">Sign In</button></div>`;
  else html += `<div class="action-grid" style="grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 32px;"><button id="exportPdfBtn" class="cta-button" type="button" style="background: transparent;">Export PDF Report</button><button id="explainBtn" class="cta-button" type="button" style="background: #fff; color: #000; border: none;">Generate Action Plan</button><button id="monitorBtn" class="cta-button" type="button" style="background: transparent;">Configure Alerts</button></div><div id="monitorFeedback" style="display:none; margin-top: 12px;"></div><div id="reportContainer" style="margin-top: 24px;"></div>`;
  
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
              btn.textContent = "Telemetry Active";
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
      btn.textContent = "Compiling PDF...";
      try { 
        const hasAi = document.querySelector('.ai-card') ? '?ai=true' : '';
        const blob = await (await fetch(`/api/download-pdf/${encodeURIComponent(hostname)}${hasAi}`)).blob(); 
        const url = window.URL.createObjectURL(blob); 
        const a = document.createElement("a"); 
        a.href = url; 
        a.download = `SiteScanner_Audit_${hostname}.pdf`; 
        document.body.appendChild(a); 
        a.click(); 
        a.remove(); 
        window.URL.revokeObjectURL(url); 
      } catch { alert("PDF Export Error"); } 
      finally { btn.disabled = false; btn.textContent = "Export PDF Report"; }
    });
    
    document.getElementById("explainBtn")?.addEventListener("click", async () => {
      const explainBtn = document.getElementById("explainBtn");
      explainBtn.disabled = true;
      explainBtn.innerHTML = '<span style="display:inline-block; animation: pulse 1.5s infinite;">Processing...</span>';

      const container = document.getElementById("reportContainer"); 
      
      container.style.opacity = "0";
      container.style.transform = "translateY(-15px)";
      container.style.transition = "all 0.4s var(--ease-float)";
      
      container.innerHTML = '<div class="card" style="text-align:center; padding:40px; color:var(--text-secondary); font-family: var(--font-mono); font-size: 0.9rem;">Compiling standard rule-based output...</div>';
      
      setTimeout(() => {
        container.style.opacity = "1";
        container.style.transform = "translateY(0)";
      }, 50);
      
      try {
        const resData = await (await fetch("/api/explain", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ raw, hostname, mode: 'standard' }) 
        })).json();
        
        const parseMD = (text) => window.marked ? marked.parse(text) : text;

        let reportsHtml = `<div class="card" style="animation: floatUpFade 0.6s var(--ease-float);"><strong style="display:block; font-size:1.15rem; font-weight:700; margin-bottom:16px; color:#fff;">Standard Security Report</strong><div class="report">${parseMD(resData.ruleBasedReport)}</div></div>`;
        
        reportsHtml += `
          <div id="aiReportContainer" style="animation: floatUpFade 0.7s var(--ease-float);">
            <div class="card" style="text-align: center; border: 1px solid var(--surface-border); padding: 48px 32px; background: var(--surface-subtle); margin-top: 24px;">
              <strong style="color: #fff; font-size: 1.15rem; display: block; margin-bottom: 12px;">Advanced AppSec Analysis</strong>
              <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto;">Execute a deep contextual review of infrastructure telemetry using generative security models.</p>
              <button id="generateAiBtn" class="cta-button" style="max-width: 280px; margin: 0 auto; background: #fff; color: #000; border: none;">Execute Advanced Analysis</button>
            </div>
          </div>
        `;

        container.style.opacity = "0";
        setTimeout(() => {
          container.innerHTML = reportsHtml;
          explainBtn.innerHTML = 'Action Plan Deployed';
          explainBtn.style.background = 'transparent';
          explainBtn.style.color = 'var(--text-secondary)';
          explainBtn.style.border = '1px solid var(--surface-border)';
          container.style.opacity = "1";
          
          document.getElementById("generateAiBtn")?.addEventListener("click", async () => {
            const aiContainer = document.getElementById("aiReportContainer");
            
            aiContainer.style.opacity = "0";
            aiContainer.style.transform = "translateY(-15px)";
            aiContainer.style.transition = "all 0.4s var(--ease-float)";
            
            setTimeout(() => {
              aiContainer.innerHTML = '<div class="card" style="text-align:center; padding:64px 32px; border: 1px solid var(--surface-border); background: var(--surface-subtle);"><h3 style="color:#fff; margin-bottom:12px; animation: pulse 1.5s infinite; font-size: 1.2rem;">Executing Analysis Engine...</h3><p style="color:var(--text-tertiary); font-size:0.95rem; font-family: var(--font-mono);">Parsing infrastructure and runtime telemetry payloads.</p></div>';
              aiContainer.style.opacity = "1";
              aiContainer.style.transform = "translateY(0)";
            }, 400);

            try {
              const aiRes = await (await fetch("/api/explain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ raw, hostname, mode: 'ai' })
              })).json();

              let aiHtml = '';
              if (aiRes.aiReport) {
                aiHtml = `
                  <div class="card ai-card" style="animation: floatUpFade 0.6s var(--ease-float); margin-top: 24px;">
                    <div class="ai-header"><div class="ai-header-title" style="color: #fff;"><span>System Remediation Blueprint</span></div></div>
                    <div class="report">${parseMD(aiRes.aiReport)}</div>
                  </div>
                  <div class="action-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 24px; animation: floatUpFade 0.8s var(--ease-float);">
                    <button onclick="document.getElementById('exportPdfBtn').click()" class="cta-button pdf-export-btn" type="button" style="background: transparent;">Export Output to PDF</button>
                    <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})" class="cta-button" type="button" style="background: var(--surface-subtle);">Return to Top</button>
                  </div>
                `;
              } else if (aiRes.aiError) {
                if (currentUser && currentUser.is_pro) {
                   aiHtml = `<div class="card ai-error" style="border-left: 4px solid var(--brand-rose); padding: 32px; margin-top: 24px;"><strong style="color: var(--text-primary); font-size: 1.1rem; display: block; margin-bottom: 8px;">Analysis Engine Fault</strong><p style="color: var(--text-secondary); font-size: 0.95rem;">${aiRes.aiError}</p></div>`;
                } else {
                   aiHtml = `<div class="card ai-error" style="border: 1px solid var(--surface-border); background: var(--surface-subtle); padding: 48px 32px; text-align: center; margin-top: 24px;"><strong style="color: #fff; font-size: 1.2rem; display: block; margin-bottom: 12px;">Advanced Analysis Locked</strong><p style="color: var(--text-secondary); margin-bottom: 24px; max-width: 400px; margin-left: auto; margin-right: auto;">Pro authorization is required to access the generative security engine.</p><button onclick="window.launchRazorpayCheckout('Advanced AppSec Analysis', () => window.location.reload())" class="cta-button" style="background: #fff; color: #000; border: none; max-width: 250px; margin: 0 auto;">Authorize Upgrade</button></div>`;
                }
              }
              
              setTimeout(() => {
                aiContainer.style.opacity = "0";
                setTimeout(() => {
                  aiContainer.innerHTML = aiHtml;
                  aiContainer.style.opacity = "1";
                }, 400);
              }, 600); 
              
            } catch (err) {
               aiContainer.innerHTML = `<div class="card ai-error" style="margin-top: 24px;">System Error: ${err.message}</div>`;
            }
          });
        }, 400);

      } catch (err) { 
        container.innerHTML = `<div class="card" style="margin-top: 24px;">Execution fault: ${err.message}</div>`; 
        explainBtn.disabled = false;
        explainBtn.innerHTML = 'Generate Action Plan';
      }
    });

    document.getElementById("monitorBtn")?.addEventListener("click", async () => {
      if (!currentUser.is_pro) return window.launchRazorpayCheckout("Automated Monitoring", () => window.location.reload());
      const btn = document.getElementById("monitorBtn"); 
      
      if (isMonitoring) {
        if (document.getElementById("disableModal")) document.getElementById("disableModal").remove();
        const modalHtml = `
          <div id="disableModal" style="position:fixed; inset:0; background:rgba(10, 14, 23, 0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; animation: floatUpFade 0.3s var(--ease-float);">
            <div class="card" style="max-width:440px; width:100%; border:1px solid var(--surface-border); text-align:center; padding:40px 32px;">
              <h3 style="color:#fff; font-size:1.35rem; font-weight:700; margin-bottom:12px; letter-spacing: -0.02em;">Terminate Telemetry?</h3>
              <p style="color:var(--text-secondary); font-size:0.95rem; line-height:1.6; margin-bottom:32px;">Terminating alerts initiates a strict 24-hour system cooldown for this target domain. Do you wish to proceed?</p>
              <div style="display:flex; gap: 16px;">
                <button id="confirmDisableBtn" class="cta-button" style="background:var(--brand-rose); border-color:var(--brand-rose); flex:1;">Terminate</button>
                <button id="cancelDisableBtn" class="cta-button" style="background:transparent; border-color:var(--surface-border); flex:1;">Cancel</button>
              </div>
            </div>
          </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modalHtml);
        
        document.getElementById("cancelDisableBtn").onclick = () => document.getElementById("disableModal").remove();
        
        document.getElementById("confirmDisableBtn").onclick = async () => {
           document.getElementById("disableModal").remove();
           btn.disabled = true;
           btn.textContent = "Terminating...";
           try {
             const res = await fetch("/api/monitors/toggle-domain", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, isActive: false }) });
             const data = await res.json();
             if (data.error) throw new Error(data.error);
             isMonitoring = false;
             btn.textContent = "Configure Alerts"; 
             btn.style.borderColor = "var(--surface-border)";
             btn.style.color = "#fff";
           } catch (err) { alert(err.message); btn.textContent = "Telemetry Active"; }
           btn.disabled = false;
        };
      } else {
        btn.disabled = true;
        btn.textContent = "Provisioning...";
        try {
          const res = await fetch("/api/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname, interval: "weekly", threshold: 75 }) });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          isMonitoring = true;
          btn.textContent = "Telemetry Active"; 
          btn.style.borderColor = "var(--brand-emerald)";
          btn.style.color = "var(--brand-emerald)";
        } catch (err) { alert(err.message); btn.textContent = "Configure Alerts"; }
        btn.disabled = false;
      }
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
  const title = isActive ? 'Deploying Active Payloads' : 'Executing Perimeter Scan';

  container.innerHTML = `
    <div class="card" style="padding: 64px 32px; text-align: center; border-color: var(--surface-border); background: var(--surface-subtle); position: relative; overflow: hidden; animation: floatUpFade 0.5s var(--ease-float) forwards;">
      <h3 style="color: #fff; font-size: 1.3rem; font-weight: 700; margin-bottom: 32px; letter-spacing: -0.02em;">${title}</h3>
      <div style="width: 100%; max-width: 400px; height: 4px; background: var(--surface); margin: 0 auto; border-radius: 9999px; overflow: hidden; border: 1px solid var(--surface-border);">
        <div id="scanProgressBar" style="width: 0%; height: 100%; background: ${color}; transition: width 0.4s var(--ease-float);"></div>
      </div>
      <div id="scanProgressText" style="margin-top: 20px; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 600; color: #fff;">0%</div>
      <div id="scanProgressLog" style="margin-top: 16px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-tertiary); min-height: 20px; transition: opacity 0.2s; text-transform: uppercase; letter-spacing: 0.05em;">[ INITIALIZING PROTOCOL ]</div>
    </div>
  `;

  let progress = 0;
  const logs = isActive 
    ? ["[ BYPASSING WAF CONSTRAINTS ]", "[ INJECTING REFLECTION PAYLOADS ]", "[ EVALUATING SQLI VECTORS ]", "[ ANALYZING CORS BOUNDARIES ]", "[ MAPPING SURFACE AREA ]", "[ COMPILING THREAT INTELLIGENCE ]"]
    : ["[ RESOLVING TLS INFRASTRUCTURE ]", "[ EVALUATING DNS PARAMETERS ]", "[ PARSING HTTP HEADERS ]", "[ SCANNING SOURCE REPOSITORIES ]", "[ ANALYZING SESSION MECHANICS ]", "[ FINALIZING OUTPUT BUFFER ]"];
  
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