// public/render.js
let currentUser = null;
const GOOGLE_CLIENT_ID = "850082538445-h6ehbqqta1ebegfrdretko5plf5eaqme.apps.googleusercontent.com";

/* ============================================================
   TOP SITE HEADER BAR
   ============================================================ */
window.initSiteHeader = function() {
  if (document.getElementById('site-header')) return; // guard

  const header = document.createElement('header');
  header.id = 'site-header';
  header.setAttribute('aria-label', 'Site header');
  header.innerHTML = `
    <!-- Brand -->
    <a href="/" class="site-header-brand" aria-label="SiteScanner home">
      <div class="site-header-brand-icon">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7"/>
          <line x1="16.5" y1="16.5" x2="22" y2="22"/>
          <line x1="11" y1="7" x2="11" y2="15"/>
          <line x1="7" y1="11" x2="15" y2="11"/>
        </svg>
      </div>
      <span class="site-header-brand-name"><span>Site</span>Scanner</span>
    </a>

    <!-- Live stats & Controls (right) -->
    <div style="display:flex; align-items:center;">
      <div class="site-header-stats" id="header-auth-stats">
        <!-- Populated by updateHeaderAuthUI -->
      </div>
      
      <!-- Theme Toggle -->
      <button id="theme-toggle-btn" aria-label="Toggle theme" style="background:transparent; border:none; color:var(--text-tertiary); cursor:pointer; padding:8px; display:flex; align-items:center; justify-content:center; border-radius:50%; margin-left:16px; transition:color 0.2s, background 0.2s;">
      </button>
    </div>
  `;

  document.body.prepend(header);

  // Set up theme toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  const updateThemeIcon = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    themeBtn.innerHTML = isLight 
      ? '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  };
  updateThemeIcon();
  
  themeBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    if (newTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
    }
    updateThemeIcon();
  });

  if (window.updateHeaderAuthUI) window.updateHeaderAuthUI();
};

window.updateHeaderAuthUI = async function() {
  const statsContainer = document.getElementById('header-auth-stats');
  if (!statsContainer) return;

  let todayCount = 0;
  try {
    const res = await fetch('/api/recent');
    if (res.ok) {
      const items = await res.json();
      const todayStr = new Date().toISOString().slice(0, 10);
      todayCount = Array.isArray(items)
        ? items.filter(i => i.scanned_at && i.scanned_at.slice(0, 10) === todayStr).length
        : items.length || 0;
    }
  } catch (e) {}

  const isPro = currentUser && currentUser.is_pro;
  
  if (isPro) {
    statsContainer.innerHTML = `
      <div class="site-header-stat">
        <div class="header-live-dot"></div>
        <span style="color:var(--brand-emerald); font-weight:bold;">PRO TIER</span>
      </div>
      <div class="site-header-divider"></div>
      <div class="site-header-stat">
        <span>Scans Today</span>
        <strong style="color:var(--text-primary);">${todayCount}</strong>
      </div>
    `;
  } else {
    const scansLeft = Math.max(0, 5 - todayCount);
    statsContainer.innerHTML = `
      <div class="site-header-stat" style="color:var(--brand-amber);">
        <span>Scans Left</span>
        <strong style="color:var(--text-primary);">${scansLeft} / 5</strong>
      </div>
      <div class="site-header-divider"></div>
      <button onclick="window.launchRazorpayCheckout('Pro Plan')" style="background:var(--brand-emerald); color:#000; border:none; padding:4px 12px; border-radius:4px; font-family:var(--font-mono); font-size:0.65rem; font-weight:bold; cursor:pointer; text-transform:uppercase; transition:opacity 0.2s;">
        Upgrade to Pro
      </button>
    `;
  }
};

/* ============================================================
   VERTICAL NAV DOCK
   ============================================================ */
window.initNavDock = function() {
  if (document.getElementById('nav-dock')) return; // Guard: only once

  const path = window.location.pathname;

  // Determine active item by pathname
  const isHome      = path === '/' || path === '/index.html';
  const isDashboard = path.startsWith('/dashboard');
  const isHistory   = path.startsWith('/history');

  function activeClass(key) {
    if (key === 'home' && isHome)           return 'dock-active-home';
    if (key === 'dashboard' && isDashboard) return 'dock-active';
    if (key === 'history' && isHistory)     return 'dock-active';
    return '';
  }

  // SVG icon strings (Lucide-style, inline)
  const icons = {
    home: `<svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/></svg>`,
    dashboard: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    alerts: `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    usage: `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    history: `<svg viewBox="0 0 24 24"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 3v5h5"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    about: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  const dock = document.createElement('nav');
  dock.id = 'nav-dock';
  dock.setAttribute('aria-label', 'Main navigation dock');
  dock.innerHTML = `
    <div id="dock-auth-slot" class="dock-item" data-tip="Account" aria-label="Account" style="overflow:hidden;">
      <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </div>
    <div class="dock-sep"></div>
    <a href="/"          class="dock-item ${activeClass('home')}"      data-tip="Home"           aria-label="Home">${icons.home}</a>
    <a href="/dashboard.html" class="dock-item ${activeClass('dashboard')}" data-tip="Command Center" aria-label="Command Center">${icons.dashboard}</a>
    <div class="dock-sep"></div>
    <button class="dock-item" id="dock-alerts"   data-tip="Alerts"   aria-label="Alerts">${icons.alerts}</button>
    <button class="dock-item" id="dock-usage"    data-tip="Usage"    aria-label="Usage">${icons.usage}</button>
    <div class="dock-sep"></div>
    <a href="/history"   class="dock-item ${activeClass('history')}"   data-tip="History"        aria-label="History">${icons.history}</a>
    <button class="dock-item" id="dock-settings" data-tip="Settings" aria-label="Settings">${icons.settings}</button>
    <button class="dock-item" id="dock-about"    data-tip="About"    aria-label="About">${icons.about}</button>
  `;
  document.body.appendChild(dock);

  // Wire auth slot — updateNavAuthUI will populate it after auth resolves
  updateDockAuth();

  // ── Modal helper ──────────────────────────────────────────
  function openDockModal(html) {
    closeDockModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'dock-modal-backdrop';
    backdrop.id = 'dock-modal-backdrop';
    backdrop.innerHTML = `<div class="dock-modal">${html}<button class="dock-modal-close" aria-label="Close">✕</button></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('.dock-modal-close').onclick = closeDockModal;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeDockModal(); });
  }
  function closeDockModal() {
    document.getElementById('dock-modal-backdrop')?.remove();
  }

  // ── Alerts modal ─────────────────────────────────────────
  document.getElementById('dock-alerts').onclick = () => openDockModal(`
    <span class="dock-modal-label">[ ALERT CONFIG ]</span>
    <h3>Monitor Alerts</h3>
    <p>Automated infrastructure alerts trigger when a monitored domain's security score drops below a configured threshold or a critical check fails.</p>
    <div class="dock-modal-row"><span class="dock-modal-key">Threshold</span><span class="dock-modal-val">Score &lt; 50</span></div>
    <div class="dock-modal-row"><span class="dock-modal-key">Delivery</span><span class="dock-modal-val">Email on change</span></div>
    <div class="dock-modal-row"><span class="dock-modal-key">Status</span><span class="dock-modal-val" style="color:var(--brand-emerald)">Active</span></div>
    <div style="margin-top:24px;">
      <a href="/dashboard.html" style="display:inline-block; font-size:0.85rem; font-weight:600; color:var(--brand-cyan); text-decoration:none; font-family:var(--font-mono);">Manage in Command Center →</a>
    </div>
  `);

  // ── Usage modal ──────────────────────────────────────────
  document.getElementById('dock-usage').onclick = async () => {
    const user = currentUser;
    const tier  = user?.is_pro ? 'PRO' : 'FREE';
    const limit = user?.is_pro ? 'Unlimited' : '5 / day';
    openDockModal(`
      <span class="dock-modal-label">[ PLAN USAGE ]</span>
      <h3>Scan Allocation</h3>
      <p>Current usage metrics for your account tier. Upgrade to Pro for unlimited daily scans and advanced DAST.</p>
      <div class="dock-modal-row"><span class="dock-modal-key">Tier</span><span class="dock-modal-val" style="color:${user?.is_pro ? 'var(--brand-emerald)' : 'var(--brand-purple)'}">${tier}</span></div>
      <div class="dock-modal-row"><span class="dock-modal-key">Daily Scans</span><span class="dock-modal-val">${limit}</span></div>
      <div class="dock-modal-row"><span class="dock-modal-key">Active DAST</span><span class="dock-modal-val">${user?.is_pro ? 'Enabled' : 'Pro Only'}</span></div>
      ${!user?.is_pro ? `<div style="margin-top:24px;"><button onclick="window.launchRazorpayCheckout('Pro Plan')" style="background:transparent;border:1px solid var(--brand-emerald);color:var(--brand-emerald);font-family:var(--font-mono);font-size:0.8rem;padding:8px 20px;border-radius:9999px;cursor:pointer;letter-spacing:0.05em;">UPGRADE TO PRO →</button></div>` : ''}
    `);
  };

  // ── Settings modal ───────────────────────────────────────
  document.getElementById('dock-settings').onclick = () => {
    const user = currentUser;
    if (!user) return showSignInModal();
    openDockModal(`
      <span class="dock-modal-label">[ ACCOUNT ]</span>
      <h3>Settings</h3>
      <div class="dock-modal-row"><span class="dock-modal-key">Name</span><span class="dock-modal-val">${user.name || '—'}</span></div>
      <div class="dock-modal-row"><span class="dock-modal-key">Email</span><span class="dock-modal-val" style="font-size:0.8rem">${user.email || '—'}</span></div>
      <div class="dock-modal-row"><span class="dock-modal-key">Plan</span><span class="dock-modal-val" style="color:${user.is_pro ? 'var(--brand-emerald)' : 'var(--brand-purple)'}">${user.is_pro ? 'PRO' : 'FREE'}</span></div>
      <div style="margin-top:28px; display:flex; gap:12px; flex-wrap:wrap;">
        <a href="/dashboard.html" style="font-size:0.82rem;font-weight:600;color:var(--brand-cyan);text-decoration:none;font-family:var(--font-mono);">Command Center →</a>
        <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.reload())" style="background:transparent;border:none;color:var(--brand-rose);font-family:var(--font-mono);font-size:0.82rem;font-weight:600;cursor:pointer;padding:0;">Sign Out</button>
      </div>
    `);
  };

  // ── About modal ──────────────────────────────────────────
  document.getElementById('dock-about').onclick = () => openDockModal(`
    <span class="dock-modal-label">[ SYSTEM INFO ]</span>
    <h3>SiteScanner</h3>
    <p>Passive and active security auditing for web infrastructure. Evaluates HTTP posture, TLS configuration, email authentication, exposed files, and security policy compliance.</p>
    <div class="dock-modal-row"><span class="dock-modal-key">Engine</span><span class="dock-modal-val">v2.4.1</span></div>
    <div class="dock-modal-row"><span class="dock-modal-key">Runtime</span><span class="dock-modal-val">Node.js · Edge</span></div>
    <div class="dock-modal-row"><span class="dock-modal-key">Checks</span><span class="dock-modal-val">12 passive · 6 active</span></div>
    <div class="dock-modal-row"><span class="dock-modal-key">Data retention</span><span class="dock-modal-val">90 days</span></div>
  `);
};

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

function updateDockAuth() {
  const slot = document.getElementById('dock-auth-slot');
  if (!slot) return;

  if (currentUser) {
    const isPro = currentUser.is_pro;
    const badgeColor = isPro ? 'var(--brand-emerald)' : 'var(--brand-purple)';
    const avatarSrc = currentUser.avatar_url || '';

    // Show avatar image or fallback initials
    if (avatarSrc) {
      slot.innerHTML = `<img src="${avatarSrc}" alt="Avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid ${badgeColor};display:block;" />`;
    } else {
      const initial = (currentUser.name || 'U')[0].toUpperCase();
      slot.innerHTML = `<span style="width:30px;height:30px;border-radius:50%;background:var(--surface-subtle);border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:#fff;">${initial}</span>`;
    }
    slot.style.background = `rgba(${isPro ? '52,211,153' : '129,140,248'},0.1)`;
    slot.setAttribute('data-tip', currentUser.name ? currentUser.name.split(' ')[0] : 'Account');

    slot.onclick = (e) => {
      e.stopPropagation();
      // Reuse the dock settings modal
      const existingBackdrop = document.getElementById('dock-modal-backdrop');
      if (existingBackdrop) { existingBackdrop.remove(); return; }
      const backdrop = document.createElement('div');
      backdrop.className = 'dock-modal-backdrop';
      backdrop.id = 'dock-modal-backdrop';
      backdrop.innerHTML = `
        <div class="dock-modal">
          <button class="dock-modal-close" aria-label="Close">✕</button>
          <span class="dock-modal-label">[ ACCOUNT ]</span>
          <h3>${currentUser.name || 'User'}</h3>
          <div class="dock-modal-row"><span class="dock-modal-key">Email</span><span class="dock-modal-val" style="font-size:0.78rem">${currentUser.email || '—'}</span></div>
          <div class="dock-modal-row"><span class="dock-modal-key">Plan</span><span class="dock-modal-val" style="color:${badgeColor}">${isPro ? 'PRO' : 'FREE'}</span></div>
          <div style="margin-top:28px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
            <a href="/dashboard.html" style="font-size:0.82rem;font-weight:600;color:var(--brand-cyan);text-decoration:none;font-family:var(--font-mono);">Command Center →</a>
            <button id="dockLogoutBtn" style="background:transparent;border:none;color:var(--brand-rose);font-family:var(--font-mono);font-size:0.82rem;font-weight:600;cursor:pointer;padding:0;">Sign Out</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      backdrop.querySelector('.dock-modal-close').onclick = () => backdrop.remove();
      backdrop.addEventListener('click', ev => { if (ev.target === backdrop) backdrop.remove(); });
      document.getElementById('dockLogoutBtn').onclick = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        currentUser = null;
        location.reload();
      };
    };
  } else {
    // Not signed in — ghost user icon, click to sign in
    slot.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    slot.style.background = '';
    slot.setAttribute('data-tip', 'Sign In');
    slot.onclick = () => showSignInModal();
  }
}

function updateNavAuthUI() {
  // Legacy: kept for any legacy callers (e.g. after payment success).
  // Now delegates entirely to the dock slot.
  updateDockAuth();
  if (window.updateHeaderAuthUI) window.updateHeaderAuthUI();
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

// ─────────────────────────────────────────────────────────────────────────────
// SHARED INTEL SIDEBAR RENDERER
// Returns the HTML string for Site Profile + Detected Stack cards.
// Also callable standalone from index.html to show cached scan data.
// ─────────────────────────────────────────────────────────────────────────────
window.renderIntelCards = function(data) {
  const { raw, hostname, score, grade, previousScan } = data;

  const issuer   = raw.tls?.issuer || 'Unknown';
  const expiry   = raw.tls?.daysUntilExpiry ? `${raw.tls.daysUntilExpiry} days` : 'Invalid';
  const serverHeader = raw.headers?.server || 'Hidden';

  const stack = [];
  const srvLower  = serverHeader.toLowerCase();
  const poweredBy = (raw.headers?.['x-powered-by'] || '').toLowerCase();
  if (srvLower.includes('cloudflare'))  stack.push('Cloudflare');
  if (srvLower.includes('nginx'))       stack.push('Nginx');
  if (srvLower.includes('apache'))      stack.push('Apache');
  if (raw.headers?.['x-vercel-id'])     stack.push('Vercel Edge');
  if (poweredBy.includes('next'))       stack.push('Next.js');
  if (poweredBy.includes('php'))        stack.push('PHP');
  if (poweredBy.includes('express'))    stack.push('Express');
  if (raw.headers?.['via']?.toLowerCase().includes('aws')) stack.push('AWS CloudFront');
  if (stack.length === 0) stack.push('Standard HTTP');

  const stackHtml = stack.map(tech =>
    `<span style="font-family:var(--font-sans);font-size:0.85rem;color:var(--text-primary);background:var(--bg);border:1px solid var(--surface-border);padding:6px 12px;border-radius:8px;font-weight:500;">${tech}</span>`
  ).join('');

  const gradeColor = score >= 75 ? 'var(--brand-emerald)' : score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)';
  const prevScoreHtml = previousScan
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding-top:24px;border-top:1px dashed var(--surface-border);"><span style="color:var(--text-tertiary);font-size:0.9rem;">Last audit</span><div style="font-weight:700;font-size:1.25rem;color:#fff;"><span style="color:${previousScan.score>=75?'var(--brand-emerald)':previousScan.score>=40?'var(--brand-amber)':'var(--brand-rose)'};margin-right:8px;font-size:1.6rem;">${previousScan.grade}</span>${previousScan.score}<span style="font-size:0.9rem;color:var(--text-tertiary);">/100</span></div></div>`
    : `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding-top:24px;border-top:1px dashed var(--surface-border);"><span style="color:var(--text-tertiary);font-size:0.9rem;">Last audit</span><span style="font-family:var(--font-mono);font-size:0.85rem;color:var(--text-secondary);">No prior data</span></div>`;

  return `
    <!-- Site Profile -->
    <div class="card" style="padding:32px 24px;box-shadow:0 10px 30px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-tertiary);letter-spacing:0.08em;">SITE PROFILE</span>
        <div style="display:flex;align-items:center;gap:6px;color:var(--brand-emerald);font-weight:700;font-size:0.75rem;font-family:var(--font-mono);">
          <span style="width:6px;height:6px;border-radius:50%;background:var(--brand-emerald);box-shadow:0 0 8px var(--brand-emerald);"></span> LIVE
        </div>
      </div>
      <a href="/report/${encodeURIComponent(hostname)}" style="text-decoration:none;">
        <h3 style="font-size:1.8rem;color:#fff;margin-bottom:8px;word-break:break-all;transition:color 0.2s;" onmouseover="this.style.color='var(--brand-cyan)'" onmouseout="this.style.color='#fff'">${hostname}</h3>
      </a>
      <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-tertiary);letter-spacing:0.05em;margin-bottom:28px;">
        <a href="/report/${encodeURIComponent(hostname)}" style="color:var(--brand-cyan);text-decoration:none;">View full report →</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;font-size:0.95rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:12px;">
          <span style="color:var(--text-tertiary);">Hosting</span>
          <span style="color:#fff;font-family:var(--font-mono);font-size:0.9rem;">${raw.emailAuth?.isSharedHost ? 'PaaS / Edge' : 'Dedicated'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:12px;">
          <span style="color:var(--text-tertiary);">TLS issuer</span>
          <span style="color:#fff;font-family:var(--font-mono);font-size:0.9rem;">${issuer.length > 15 ? issuer.substring(0,14)+'...' : issuer}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:12px;">
          <span style="color:var(--text-tertiary);">Expires in</span>
          <span style="color:#fff;font-family:var(--font-mono);font-size:0.9rem;">${expiry}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:var(--text-tertiary);">Server</span>
          <span style="color:#fff;font-family:var(--font-mono);font-size:0.9rem;">${serverHeader.length > 15 ? serverHeader.substring(0,14)+'...' : serverHeader}</span>
        </div>
      </div>
    </div>

    <!-- Detected Stack -->
    <div class="card" style="padding:32px 24px;box-shadow:0 10px 30px rgba(0,0,0,0.2);margin-top:20px;">
      <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-tertiary);letter-spacing:0.08em;display:block;margin-bottom:24px;">DETECTED STACK</span>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">${stackHtml}</div>
      ${prevScoreHtml}
    </div>
  `;
};

function renderResults(data, targetId = "results") {
  const resultsEl = document.getElementById(targetId); if (!resultsEl) return;
  const { raw, hostname, score, grade, previousScan } = data;

  // ── Persist to localStorage so homepage can display intel cards ──
  try {
    localStorage.setItem('lastScannedData', JSON.stringify({ raw, hostname, score, grade, previousScan }));
  } catch(e) { /* storage quota or private mode — silently skip */ }

  const isGuest = !currentUser;
  const isPro = currentUser && currentUser.is_pro;
  
  const gradeHex = score >= 75 ? "var(--brand-emerald)" : score >= 40 ? "var(--brand-amber)" : "var(--brand-rose)";
  const circumference = 2 * Math.PI * 40; 
  const offset = circumference - (score / 100) * circumference;

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

  // -------------------------------------------------------------
  // INTELLIGENCE SIDEBAR PARSING (DETECTED STACK & PROFILE)
  // -------------------------------------------------------------
  const issuer = raw.tls?.issuer || "Unknown";
  const expiry = raw.tls?.daysUntilExpiry ? `${raw.tls.daysUntilExpiry} days` : "Invalid";
  const serverHeader = raw.headers?.server || "Hidden";
  
  const stack = [];
  const srvLower = serverHeader.toLowerCase();
  const poweredBy = (raw.headers?.['x-powered-by'] || "").toLowerCase();
  
  if (srvLower.includes('cloudflare')) stack.push('Cloudflare');
  if (srvLower.includes('nginx')) stack.push('Nginx');
  if (srvLower.includes('apache')) stack.push('Apache');
  if (raw.headers?.['x-vercel-id']) stack.push('Vercel Edge');
  if (poweredBy.includes('next')) stack.push('Next.js');
  if (poweredBy.includes('php')) stack.push('PHP');
  if (poweredBy.includes('express')) stack.push('Express');
  if (raw.headers?.['via']?.toLowerCase().includes('aws')) stack.push('AWS CloudFront');
  if (stack.length === 0) stack.push('Standard HTTP');

  const stackHtml = stack.map(tech => `<span style="font-family: var(--font-sans); font-size: 0.85rem; color: var(--text-primary); background: var(--bg); border: 1px solid var(--surface-border); padding: 6px 12px; border-radius: 8px; font-weight: 500;">${tech}</span>`).join('');

  const prevScoreHtml = previousScan 
    ? `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 32px; padding-top: 24px; border-top: 1px dashed var(--surface-border);"><span style="color: var(--text-tertiary); font-size: 0.9rem;">Last audit</span><div style="font-family: var(--font-serif); font-weight: 700; font-size: 1.25rem; color: #fff;"><span style="color: ${previousScan.score >= 75 ? 'var(--brand-emerald)' : previousScan.score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)'}; margin-right: 8px; font-size: 1.6rem;">${previousScan.grade}</span>${previousScan.score}<span style="font-size:0.9rem; color:var(--text-tertiary);">/100</span></div></div>`
    : `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 32px; padding-top: 24px; border-top: 1px dashed var(--surface-border);"><span style="color: var(--text-tertiary); font-size: 0.9rem;">Last audit</span><span style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-secondary);">No prior data</span></div>`;

  const sidebarHtml = `
    <!-- Box 1: Site Profile -->
    <div class="card" style="padding: 32px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 0.08em;">SITE PROFILE</span>
        <div style="display: flex; align-items: center; gap: 6px; color: var(--brand-emerald); font-weight: 700; font-size: 0.75rem; font-family: var(--font-mono);"><span style="width: 6px; height: 6px; border-radius: 50%; background: var(--brand-emerald); box-shadow: 0 0 8px var(--brand-emerald);"></span> LIVE</div>
      </div>
      <h3 style="font-family: var(--font-serif); font-size: 1.8rem; color: #fff; margin-bottom: 32px; word-break: break-all;">${hostname}</h3>
      
      <div style="display: flex; flex-direction: column; gap: 16px; font-size: 0.95rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 12px;">
          <span style="color: var(--text-tertiary);">Hosting</span>
          <span style="color: #fff; font-family: var(--font-mono); font-size: 0.9rem;">${raw.emailAuth?.isSharedHost ? 'PaaS / Edge' : 'Dedicated'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 12px;">
          <span style="color: var(--text-tertiary);">TLS issuer</span>
          <span style="color: #fff; font-family: var(--font-mono); font-size: 0.9rem;">${issuer.length > 15 ? issuer.substring(0,14)+'...' : issuer}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 12px;">
          <span style="color: var(--text-tertiary);">Expires in</span>
          <span style="color: #fff; font-family: var(--font-mono); font-size: 0.9rem;">${expiry}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--text-tertiary);">Server</span>
          <span style="color: #fff; font-family: var(--font-mono); font-size: 0.9rem;">${serverHeader.length > 15 ? serverHeader.substring(0,14)+'...' : serverHeader}</span>
        </div>
      </div>
    </div>

    <!-- Box 2: Detected Stack -->
    <div class="card" style="padding: 32px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 0.08em; display: block; margin-bottom: 24px;">DETECTED STACK</span>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        ${stackHtml}
      </div>
      ${prevScoreHtml}
    </div>
  `;

  // -------------------------------------------------------------
  // MAIN REPORT AREA
  // -------------------------------------------------------------
  let quickStatusHtml = '';
  const isMalware = raw.malware?.checked && raw.malware?.flagged;
  
  if (isMalware || score < 40 || !raw.tls?.valid) {
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-rose); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: CRITICAL ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">${isMalware ? 'Infrastructure flagged by Google Safe Browsing. Malware or social engineering present.' : 'Severe vulnerabilities detected. Immediate infrastructure remediation required.'}</span></div></div>`;
  } else if (score < 75) {
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-amber); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: WARNING ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">Infrastructure is operational but lacks strict security enforcement policies.</span></div></div>`;
  } else {
    quickStatusHtml = `<div class="card" style="border-left: 4px solid var(--brand-emerald); padding: 20px 32px; margin-bottom: 24px; display: flex; align-items: center; gap: 20px;"><div><strong style="color: #fff; font-family: var(--font-mono); display: block; font-size: 1rem; margin-bottom: 4px;">[ SYSTEM STATE: SECURE ]</strong><span style="color: var(--text-secondary); font-size: 0.95rem;">No critical exploits detected. Perimeter security policies are strictly enforced.</span></div></div>`;
  }

  let mainHtml = quickStatusHtml + `<div class="card hero-grade-card"><div class="hero-grade-left"><div class="grade-ring"><svg viewBox="0 0 96 96" width="90" height="90" xmlns="http://www.w3.org/2000/svg"><circle class="grade-ring-bg" cx="48" cy="48" r="40"></circle><circle class="grade-ring-fg" cx="48" cy="48" r="40" stroke="${gradeHex}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><div class="grade-ring-letter" style="color:${gradeHex};">${grade}</div></div><div><div class="hero-score-title" style="display:flex; align-items:center; gap:12px;"><span>Security Rating</span>${isPro ? '<span style="font-size:0.65rem; background:rgba(255,255,255,0.05); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1); padding:4px 10px; border-radius:9999px; font-family:var(--font-mono); font-weight:700;">PRO_UNLOCKED</span>' : ""}</div><div style="margin-top: 8px; font-size: 1rem; color: var(--text-secondary);"><span style="font-weight: 600;">Overall Security Score:</span> <strong style="color: ${gradeHex}; font-size: 1.25rem; margin-left: 6px;">${score}</strong> <span style="font-size: 0.85rem; opacity: 0.6;">/ 100</span></div></div></div><div class="summary-badges"><span class="summary-pill pill-critical" style="cursor:pointer;" id="filter-critical">${critical} Critical</span><span class="summary-pill pill-warning" style="cursor:pointer;" id="filter-warning">${warning} Warnings</span><span class="summary-pill pill-passed" style="cursor:pointer;" id="filter-passed">${passed} Passed</span></div></div>`;

  if (raw.activeDastStatus) {
    mainHtml += `<div class="card result-card" data-severity="passed" style="border-color: var(--surface-border); background: var(--surface-subtle); margin-bottom: 24px;"><strong style="color:#fff; font-size:1.05rem; display:block; margin-bottom:16px;">Active DAST Engine</strong><div class="result-item"><span>Execution Status</span><span class="status-badge" style="background:var(--surface); border: 1px solid var(--surface-border); color:var(--brand-emerald);">${raw.activeDastStatus}</span></div></div>`;
    if (raw.activeDastReport && raw.activeDastReport.site && raw.activeDastReport.site.length > 0) {
      const alerts = raw.activeDastReport.site[0].alerts || [];
      if (alerts.length === 0) {
        mainHtml += `<div class="card result-card" data-severity="passed" style="border-left: 4px solid var(--brand-emerald); margin-bottom: 32px;"><strong style="color:var(--text-primary); display:block; font-size: 1.05rem;">Zero Runtime Vulnerabilities Detected</strong><p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 6px;">Active exploitation payload execution returned clear.</p></div>`;
      } else {
        mainHtml += `<h4 style="margin: 40px 0 20px; font-size: 1.2rem; font-weight: 700; color: #fff; letter-spacing: -0.02em;">Dynamic Analysis Output</h4>`;
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

          mainHtml += `<div class="card result-card" data-severity="${sev}" style="border-left: 4px solid ${riskColor}; margin-bottom: 16px; padding: 24px;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;"><strong style="color: #fff; font-size: 1.05rem;">${alert.name}</strong><span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; background: ${riskBg}; color: ${riskColor}; letter-spacing: 0.05em;">[${riskText}]</span></div><div style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px;">${cleanDesc}</div><div style="background: var(--surface-subtle); padding: 16px 20px; border-radius: var(--radius-md); font-size: 0.9rem; border: 1px solid var(--surface-border);"><strong style="color: #fff; font-family: var(--font-mono); display: block; margin-bottom: 8px; font-size: 0.8rem; letter-spacing: 0.05em;">REQUIREMENT_RESOLUTION</strong><span style="color: var(--text-secondary); line-height: 1.6; display: block;">${cleanSol}</span></div></div>`;
        });
      }
    }
  }

  const tlsSev = !raw.tls?.valid ? "critical" : (raw.tls.daysUntilExpiry < 30 ? "warning" : "passed");
  mainHtml += `<div class="card result-card" data-severity="${tlsSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">SSL/TLS Transport Encryption</strong>`;
  if (raw.tls?.valid) { const days = raw.tls.daysUntilExpiry; mainHtml += `<div class="result-item"><span>Certificate Validity</span><span class="status-badge ${days < 14 ? "status-bad" : days < 30 ? "status-warn" : "status-ok"}">${days} Days Remaining</span></div><div class="result-item"><span>Certificate Authority</span><span style="font-family:var(--font-mono); color: var(--text-secondary);">${raw.tls.issuer}</span></div>`; } else mainHtml += `<div class="result-item"><span>Status</span><span class="status-badge status-bad">Invalid / Insecure</span></div>`;
  mainHtml += `</div>`;

  const hasMissingHeaders = (raw.headers?.missing || []).length > 0;
  mainHtml += `<div class="card result-card" data-severity="${hasMissingHeaders ? "critical" : "passed"}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">HTTP Hardening Headers</strong>`;
  (raw.headers?.missing || []).forEach(h => mainHtml += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${h}</span><span class="status-badge status-bad">Missing</span></div>`);
  (raw.headers?.present || []).forEach(h => mainHtml += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${h}</span><span class="status-badge status-ok">Enforced</span></div>`);
  mainHtml += `</div>`;

  const hasExposed = (raw.exposedFiles || []).length > 0;
  mainHtml += `<div class="card result-card" data-severity="${hasExposed ? "critical" : "passed"}" style="position: relative; overflow: hidden;"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Public File Leakage</strong>`;
  if (isGuest && hasExposed) mainHtml += `<div style="filter: blur(6px); pointer-events: none; opacity: 0.6;"><div class="result-item"><span style="font-family:var(--font-mono);">/.env</span><span class="status-badge status-bad">Exposed</span></div></div><div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10;"><button onclick="showSignInModal()" class="cta-button" style="background: var(--surface); border: 1px solid var(--surface-border); color: #fff; padding: 10px 24px; max-width: 200px;">Sign In to View</button></div>`;
  else if (!raw.exposedFiles || raw.exposedFiles.length === 0) mainHtml += `<div class="result-item"><span>Sensitive Source Paths</span><span class="status-badge status-ok">Secured</span></div>`;
  else raw.exposedFiles.forEach(f => mainHtml += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${f.path}</span><span class="status-badge status-bad">Exposed</span></div>`);
  mainHtml += `</div>`;

  const emailSev = (!raw.emailAuth?.isSharedHost && (!raw.emailAuth?.spf || !raw.emailAuth?.dmarc)) ? "warning" : "passed";
  mainHtml += `<div class="card result-card" data-severity="${emailSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Email Spoofing Protection</strong>`;
  if (raw.emailAuth?.isSharedHost) {
      mainHtml += `<div class="result-item"><span>SPF / DMARC</span><span class="status-badge status-ok">Exempt (Shared Host)</span></div>`;
  } else {
      mainHtml += `<div class="result-item"><span>SPF Record</span><span class="status-badge ${raw.emailAuth?.spf ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.spf ? 'Verified' : 'Missing'}</span></div>`;
      mainHtml += `<div class="result-item"><span>DMARC Record</span><span class="status-badge ${raw.emailAuth?.dmarc ? 'status-ok' : 'status-warn'}">${raw.emailAuth?.dmarc ? 'Verified' : 'Missing'}</span></div>`;
  }
  mainHtml += `</div>`;

  if (raw.cookies?.hasCookies) {
      const cookieSev = badCookies.length > 0 ? "warning" : "passed";
      mainHtml += `<div class="card result-card" data-severity="${cookieSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Session & Cookie Security</strong>`;
      if (badCookies.length === 0) {
           mainHtml += `<div class="result-item"><span>Cookie Attributes</span><span class="status-badge status-ok">Secure</span></div>`;
      } else {
           badCookies.forEach(c => mainHtml += `<div class="result-item"><span style="font-family:var(--font-mono); color: var(--text-secondary);">${c.name}</span><span class="status-badge status-warn">Insecure Flags</span></div>`);
      }
      mainHtml += `</div>`;
  }

  const corsSev = raw.cors?.dangerousCombo ? "critical" : (raw.cors?.wildcardOpen ? "warning" : "passed");
  mainHtml += `<div class="card result-card" data-severity="${corsSev}"><strong style="font-size:1.05rem; display:block; margin-bottom:12px; color: #fff;">Cross-Origin Resource Sharing (CORS)</strong>`;
  if (raw.cors?.dangerousCombo) mainHtml += `<div class="result-item"><span>Configuration</span><span class="status-badge status-bad">Dangerous</span></div>`;
  else if (raw.cors?.wildcardOpen) mainHtml += `<div class="result-item"><span>Configuration</span><span class="status-badge status-warn">Wildcard Open</span></div>`;
  else mainHtml += `<div class="result-item"><span>Configuration</span><span class="status-badge status-ok">Strict</span></div>`;
  mainHtml += `</div>`;

  if (isGuest) mainHtml += `<div class="card" style="text-align: center; border: 1px solid var(--surface-border); background: var(--surface-subtle); padding: 48px 32px; margin-top: 32px;"><h3 style="color: #fff; margin-bottom: 12px; font-weight: 700;">Infrastructure Management</h3><p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 24px;">Authenticate to export reports and establish automated telemetry.</p><button onclick="showSignInModal()" class="cta-button" style="background: #fff; color: #000; border: none; max-width: 250px; margin: 0 auto;">Sign In</button></div>`;
  else mainHtml += `<div class="action-grid" style="grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 32px;"><button id="exportPdfBtn" class="cta-button" type="button" style="background: transparent;">Export PDF Report</button><button id="explainBtn" class="cta-button" type="button" style="background: #fff; color: #000; border: none;">Generate Action Plan</button><button id="monitorBtn" class="cta-button" type="button" style="background: transparent;">Configure Alerts</button></div><div id="monitorFeedback" style="display:none; margin-top: 12px;"></div><div id="reportContainer" style="margin-top: 24px;"></div>`;
  
  // Assemble final layout — single column, sidebar cards live on homepage only
  resultsEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${mainHtml}
    </div>
  `;

  // Attach Event Listeners
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
  const typeText = isActive ? 'ACTIVE DAST' : 'STANDARD AUDIT';

  // Inject a quick CSS spinner animation if it doesn't exist
  if (!document.getElementById('spinner-style')) {
    document.head.insertAdjacentHTML('beforeend', '<style id="spinner-style">@keyframes spin { 100% { transform: rotate(360deg); } }</style>');
  }

  container.innerHTML = `

    <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 24px; animation: floatUpFade 0.6s var(--ease-float) forwards; opacity: 0; animation-delay: 0.1s;">
      
      <!-- Left Pane: Checklist & Progress -->
      <div class="card" style="padding: 40px; border-color: var(--surface-border);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 0.05em; text-transform: uppercase;">[ RUNNING ${typeText} ]</span>
          <button style="background: transparent; border: 1px solid var(--surface-border); color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.7rem; padding: 4px 12px; border-radius: var(--radius-sm); cursor: pointer; letter-spacing: 0.05em; transition: color 0.2s, border-color 0.2s;" onmouseover="this.style.color='#fff';this.style.borderColor='var(--surface-border)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.borderColor='var(--surface-border)'" onclick="window.location.reload()">CANCEL</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; margin-bottom: 24px;">
          <h2 id="loadingHeadline" style="font-size: 2.2rem; font-weight: 700; color: #fff; letter-spacing: -0.02em;">Initializing engine</h2>
          <span id="loadingPercent" style="font-family: var(--font-mono); font-size: 2.5rem; color: ${color}; font-weight: 800; letter-spacing: -0.05em;">0%</span>
        </div>
        <div style="width: 100%; height: 4px; background: var(--bg); border: 1px solid var(--surface-border); border-radius: 9999px; margin-bottom: 40px; overflow: hidden;">
          <div id="scanProgressBar" style="height: 100%; width: 0%; background: ${color}; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;" id="checklistGrid">
           <!-- Dynamically Populated -->
        </div>
      </div>
      
      <!-- Right Pane: Live Terminal Log -->
      <div class="card" style="padding: 24px; display: flex; flex-direction: column; border-color: var(--surface-border); background: var(--bg);">
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 0.05em; margin-bottom: 16px;">LIVE LOG</span>
        <div id="liveLogConsole" style="flex: 1; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); line-height: 1.8; overflow-y: auto; max-height: 280px; display: flex; flex-direction: column; gap: 4px;">
          <div style="color: var(--text-tertiary);">${new Date().toLocaleTimeString('en-GB')} [SYSTEM] Engine spinning up...</div>
        </div>
      </div>

    </div>
  `;

  let progress = 0;
  let step = 0;
  const bar = document.getElementById("scanProgressBar");
  const percent = document.getElementById("loadingPercent");
  const logConsole = document.getElementById("liveLogConsole");
  const headline = document.getElementById("loadingHeadline");
  const checklistGrid = document.getElementById("checklistGrid");

  // Define scan stages based on audit type
  const auditSteps = isActive ? [
    { log: "resolving edge routing parameters", head: "Target Acquisition", checkId: "c1", checkName: "Target Acquisition" },
    { log: "bypassing standard WAF heuristics", head: "WAF Evasion", checkId: "c2", checkName: "WAF Evasion" },
    { log: "injecting reflection payload tests", head: "XSS Vulnerability", checkId: "c3", checkName: "XSS Analysis" },
    { log: "evaluating sql boundary vectors", head: "SQLi Probing", checkId: "c4", checkName: "SQLi Probing" },
    { log: "mapping sensitive endpoint exposure", head: "Endpoint Mapping", checkId: "c5", checkName: "Endpoint Mapping" },
    { log: "compiling contextual threat intelligence", head: "Generating Intelligence", checkId: "c6", checkName: "Threat Intelligence" }
  ] : [
    { log: "resolve target domain routing", head: "Resolving DNS", checkId: "c1", checkName: "DNS Resolution" },
    { log: "tls handshake ok · verifying cipher", head: "Analysing certificates", checkId: "c2", checkName: "TLS Certificate" },
    { log: "dns txt spf=true dmarc=true", head: "Verifying email auth", checkId: "c3", checkName: "Email Authentication" },
    { log: "probe /.env /.git → 404", head: "Scanning file paths", checkId: "c4", checkName: "Exposed Files" },
    { log: "GET / → 200 · reading headers", head: "Analysing headers", checkId: "c5", checkName: "HTTP Headers" },
    { log: "csp enforced · xss protection valid", head: "Compiling Report", checkId: "c6", checkName: "Policy Verification" }
  ];

  // Initialize Checklist UI
  checklistGrid.innerHTML = auditSteps.map(s => `
    <div id="${s.checkId}" style="display: flex; align-items: center; gap: 12px; color: var(--text-tertiary); font-size: 0.9rem;">
      <span class="icon" style="font-family: var(--font-mono);">○</span> <span class="text">${s.checkName}</span>
    </div>
  `).join('');

  function updateChecklist(currentIndex) {
    auditSteps.forEach((s, i) => {
      const el = document.getElementById(s.checkId);
      if (!el) return;
      if (i < currentIndex) {
        el.style.color = 'var(--text-secondary)';
        el.querySelector('.icon').innerHTML = `<span style="color: ${color};">✓</span>`;
        el.querySelector('.text').style.fontWeight = 'normal';
      } else if (i === currentIndex) {
        el.style.color = '#fff';
        el.querySelector('.icon').innerHTML = `<span style="display:inline-block; animation:spin 1.5s linear infinite; color: ${color}; font-size: 1.2rem; line-height: 1;">⟳</span>`;
        el.querySelector('.text').style.fontWeight = '600';
      }
    });
  }

  updateChecklist(0);

  window.activeLoadingInterval = setInterval(() => {
      const increment = (99 - progress) * 0.04; 
      progress += Math.max(increment, 0.2);
      if (progress >= 99) progress = 99;
      
      if (bar) bar.style.width = `${progress}%`;
      if (percent) percent.textContent = `${Math.floor(progress)}%`;

      const expectedStep = Math.floor((progress / 100) * auditSteps.length);
      if (expectedStep > step && step < auditSteps.length) {
        const time = new Date().toLocaleTimeString('en-GB');
        const logEntry = auditSteps[step];
        
        if (logConsole) {
          const div = document.createElement('div');
          div.innerHTML = `<span style="color:var(--text-tertiary)">${time}</span> <span style="color:${color}">${logEntry.log}</span>`;
          logConsole.appendChild(div);
          logConsole.scrollTop = logConsole.scrollHeight;
        }
        
        if (headline) headline.textContent = logEntry.head;
        
        step++;
        updateChecklist(step);
      }
  }, 200);
};