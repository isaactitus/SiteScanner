// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  let scanMode = 'quick'; // 'quick' | 'full' | 'active'

  const tabQuick = document.getElementById('tabQuick');
  const tabFull = document.getElementById('tabFull');
  const tabActive = document.getElementById('tabActive'); // NEW
  const publicFeedOption = document.getElementById('publicFeedOption');
  const scanForm = document.getElementById('scanForm');
  const targetUrlInput = document.getElementById('targetUrl');
  const submitScanBtn = document.getElementById('submitScanBtn');
  const quickCheckResult = document.getElementById('quickCheckResult');
  const resultsEl = document.getElementById('results');
  const recentListEl = document.getElementById('recentList');

  function updateTabs(activeBtn) {
    [tabQuick, tabFull, tabActive].forEach(b => b && b.classList.remove('active'));
    activeBtn.classList.add('active');
    
    if (scanMode === 'active') {
      submitScanBtn.textContent = 'Launch Active Exploits';
      submitScanBtn.style.background = 'var(--brand-emerald)';
      submitScanBtn.style.color = '#fff';
      publicFeedOption.style.display = 'none';
    } else {
      submitScanBtn.textContent = scanMode === 'full' ? 'Run Deep Scan' : 'Check Target';
      submitScanBtn.style.background = '#fff';
      submitScanBtn.style.color = '#090d16';
      publicFeedOption.style.display = scanMode === 'full' ? 'inline-flex' : 'none';
    }
  }

  // Tab switching
  tabQuick?.addEventListener('click', () => { scanMode = 'quick'; updateTabs(tabQuick); });
  tabFull?.addEventListener('click', () => { scanMode = 'full'; updateTabs(tabFull); });
  tabActive?.addEventListener('click', () => { scanMode = 'active'; updateTabs(tabActive); });

  function normalizeTarget(input) {
    let clean = input.trim();
    if (!clean) return '';
    clean = clean.replace(/^(https?:\/\/)+/i, '');
    return clean.replace(/\/+$/, '');
  }

  // Load Turso Recent Scans
  if (window.loadRecentFeed) window.loadRecentFeed();

  // Scan Submission
  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawDomain = normalizeTarget(targetUrlInput.value);
    const confirmed = document.getElementById('ownershipConfirmed').checked;
    const listPublicly = document.getElementById('listPublicly')?.checked || false;

    if (!rawDomain) return;

    // 1. ACTIVE SCAN LOGIC (DNS Gate)
    if (scanMode === 'active') {
      if (!currentUser || !currentUser.is_pro) {
        return window.launchRazorpayCheckout("Active DAST Scanning", () => window.location.reload());
      }
      
      return window.showDnsVerificationModal(rawDomain, async () => {
        submitScanBtn.disabled = true; submitScanBtn.textContent = 'Injecting Payloads...';
        quickCheckResult.style.display = 'none';
        resultsEl.innerHTML = '<div class="card" style="text-align: center; padding: 48px;"><div style="margin-bottom: 16px; display: inline-block; width: 24px; height: 24px; border: 2px solid var(--brand-emerald); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div><strong style="color:var(--brand-emerald); display: block;">DNS Verified. Launching Active Vulnerability Exploits...</strong></div>';
        
        try {
          const res = await fetch("/api/scan-active", { 
            method: "POST", headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ url: rawDomain }) 
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          
          if (typeof renderResults === "function") {
            renderResults(data, 'results');
          } else {
            // Forward to report page since we are on index
            window.location.href = `/report/${encodeURIComponent(rawDomain)}`;
          }
        } catch (err) {
          resultsEl.innerHTML = `<div class="card" style="border-color:var(--brand-rose);">${err.message}</div>`;
        } finally { 
          submitScanBtn.disabled = false; submitScanBtn.textContent = 'Launch Active Exploits'; 
        }
      });
    }

    // Standard pre-flight UI reset
    submitScanBtn.disabled = true;
    submitScanBtn.textContent = 'Analyzing...';
    quickCheckResult.style.display = 'none';
    resultsEl.innerHTML = '';

    // 2. QUICK CHECK LOGIC
    if (scanMode === 'quick') {
      try {
        const res = await fetch('/api/quickcheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawDomain, ownershipConfirmed: confirmed })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const bannerBg = data.status === 'safe' ? 'rgba(16, 185, 129, 0.15)' : data.status === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(244, 63, 94, 0.15)';
        const bannerBorder = data.status === 'safe' ? 'var(--brand-emerald)' : data.status === 'warning' ? 'var(--brand-amber)' : 'var(--brand-rose)';
        const bannerText = data.status === 'safe' ? '✓ Clean — Domain is safe to browse' : data.status === 'warning' ? '⚠️ Safe to browse, but needs developer attention' : '🚨 Critical security alerts detected';

        quickCheckResult.innerHTML = `
          <div class="card" style="background:${bannerBg}; border-color:${bannerBorder};">
            <strong style="display:block; margin-bottom: 8px; font-size: 1.05rem;">${bannerText}</strong>
            <ul style="margin-left: 20px; font-size: 0.9rem; color: var(--text-secondary);">
              ${(data.reasons || []).map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        `;
        quickCheckResult.style.display = 'block';
      } catch (err) {
        quickCheckResult.innerHTML = `<div class="card" style="border-color:var(--brand-rose);">${err.message}</div>`;
        quickCheckResult.style.display = 'block';
      } finally {
        submitScanBtn.disabled = false;
        submitScanBtn.textContent = 'Check Target';
      }
    } else {
      // 3. FULL SCAN LOGIC (Standard POST, migrating off SSE for cleaner API structure)
      resultsEl.innerHTML = '<div class="card" style="text-align: center; padding: 48px; color: var(--text-secondary);">Running comprehensive test suite...</div>';
      try {
        const res = await fetch("/api/scan", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: rawDomain, ownershipConfirmed: confirmed, listPublicly: listPublicly })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (typeof renderResults === "function") {
          renderResults(data, 'results');
          if (window.loadRecentFeed) window.loadRecentFeed();
        } else {
          window.location.href = `/report/${encodeURIComponent(rawDomain)}`;
        }
      } catch (err) {
        resultsEl.innerHTML = `<div class="card" style="border-color: var(--brand-rose); color: var(--brand-rose);">Scan Error: ${err.message}</div>`;
      } finally {
        submitScanBtn.disabled = false;
        submitScanBtn.textContent = 'Run Deep Scan';
      }
    }
  });
});