// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  let scanMode = 'full';

  const cardStandard = document.getElementById('cardStandard');
  const cardActive = document.getElementById('cardActive');
  const publicFeedOption = document.getElementById('publicFeedOption');
  const scanForm = document.getElementById('scanForm');
  const targetUrlInput = document.getElementById('targetUrl');
  const submitScanBtn = document.getElementById('submitScanBtn');
  const resultsEl = document.getElementById('results');

  function updateTabs() {
    if (scanMode === 'active') {
      cardActive?.classList.add('active');
      cardStandard?.classList.remove('active');
      submitScanBtn.textContent = 'Deploy Active DAST';
      submitScanBtn.style.background = 'var(--brand-emerald)';
      submitScanBtn.style.color = '#000';
      if (publicFeedOption) publicFeedOption.style.display = 'none';
    } else {
      cardStandard?.classList.add('active');
      cardActive?.classList.remove('active');
      submitScanBtn.textContent = 'Run Standard Audit';
      submitScanBtn.style.background = 'var(--text-hero)';
      submitScanBtn.style.color = 'var(--bg-inverse)';
      if (publicFeedOption) publicFeedOption.style.display = 'inline-flex';
    }
  }

  cardStandard?.addEventListener('click', () => { scanMode = 'full'; updateTabs(); });
  cardActive?.addEventListener('click', () => { scanMode = 'active'; updateTabs(); });

  function normalizeTarget(input) {
    let clean = input.trim();
    if (!clean) return '';
    return clean.replace(/^(https?:\/\/)+/i, '').replace(/\/+$/, '');
  }

  if (window.loadRecentFeed) window.loadRecentFeed();

  function incrementDailyScanCount() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const cur = parseInt(localStorage.getItem('sitescanner_scan_count_' + todayStr) || '0', 10);
    localStorage.setItem('sitescanner_scan_count_' + todayStr, cur + 1);
    if (window.updateHeaderAuthUI) window.updateHeaderAuthUI();
  }

  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawDomain = normalizeTarget(targetUrlInput.value);
    const confirmed = document.getElementById('ownershipConfirmed').checked;

    if (!rawDomain) return;

    const defaults = document.getElementById('homepage-defaults');
    const heading = document.querySelector('h2');
    if (defaults) defaults.style.display = 'none';
    if (heading) heading.style.display = 'none';

    // Route to DAST Endpoint
    if (scanMode === 'active') {
      if (!currentUser || !currentUser.is_pro) return window.launchRazorpayCheckout("Active DAST Scanning", () => window.location.reload());
      return window.showDnsVerificationModal(rawDomain, async () => {
        submitScanBtn.disabled = true;

        if (window.showLoadingState) window.showLoadingState(resultsEl, 'active');

        try {
          const res = await fetch("/api/scan-active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: rawDomain }) });
          const data = await res.json();
          clearInterval(window.activeLoadingInterval);
          if (data.error) throw new Error(data.error);

          incrementDailyScanCount();

          if (typeof renderResults === "function") {
            renderResults(data, 'results');
            if (window._refreshIntelPanel) window._refreshIntelPanel();
          } else {
            window.location.href = `/report/${encodeURIComponent(rawDomain)}`;
          }
        } catch (err) {
          clearInterval(window.activeLoadingInterval);
          resultsEl.innerHTML = `<div class="card" style="border-color:var(--brand-rose); color:var(--brand-rose);">${err.message}</div>`;
        } finally {
          submitScanBtn.disabled = false;
          submitScanBtn.textContent = 'Deploy Active DAST';
        }
      });
    }

    // Route to Standard Endpoint
    submitScanBtn.disabled = true;
    if (window.showLoadingState) window.showLoadingState(resultsEl, 'full');

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: rawDomain,
          ownershipConfirmed: confirmed,
          listPublicly: document.getElementById('listPublicly')?.checked
        })
      });
      const data = await res.json();
      clearInterval(window.activeLoadingInterval);
      if (data.error) throw new Error(data.error);

      incrementDailyScanCount();

      if (typeof renderResults === "function") {
        renderResults(data, 'results');
        if (window._refreshIntelPanel) window._refreshIntelPanel();
        if (window.loadRecentFeed) window.loadRecentFeed();
      } else {
        window.location.href = `/report/${encodeURIComponent(rawDomain)}`;
      }
    } catch (err) {
      clearInterval(window.activeLoadingInterval);
      resultsEl.innerHTML = `<div class="card" style="border-color: var(--brand-rose); color: var(--brand-rose);">Scan Error: ${err.message}</div>`;
    } finally {
      submitScanBtn.disabled = false;
      submitScanBtn.textContent = 'Run Standard Audit';
    }
  });
});