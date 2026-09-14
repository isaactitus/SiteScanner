// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  let scanMode = 'full';

  const tabFull = document.getElementById('tabFull');
  const tabActive = document.getElementById('tabActive');
  const publicFeedOption = document.getElementById('publicFeedOption');
  const scanForm = document.getElementById('scanForm');
  const targetUrlInput = document.getElementById('targetUrl');
  const submitScanBtn = document.getElementById('submitScanBtn');
  const resultsEl = document.getElementById('results');

  function updateTabs(activeBtn) {
    [tabFull, tabActive].forEach(b => b && b.classList.remove('active'));
    activeBtn.classList.add('active');
    
    if (scanMode === 'active') {
      submitScanBtn.textContent = 'Launch Active Exploits';
      submitScanBtn.style.background = 'var(--brand-emerald)'; 
      submitScanBtn.style.color = '#fff';
      if(publicFeedOption) publicFeedOption.style.display = 'none';
    } else {
      submitScanBtn.textContent = 'Run Standard Audit';
      submitScanBtn.style.background = '#fff'; 
      submitScanBtn.style.color = '#090d16';
      if(publicFeedOption) publicFeedOption.style.display = 'inline-flex';
    }
  }

  tabFull?.addEventListener('click', () => { scanMode = 'full'; updateTabs(tabFull); });
  tabActive?.addEventListener('click', () => { scanMode = 'active'; updateTabs(tabActive); });

  function normalizeTarget(input) { 
    let clean = input.trim(); 
    if (!clean) return ''; 
    return clean.replace(/^(https?:\/\/)+/i, '').replace(/\/+$/, ''); 
  }
  
  if (window.loadRecentFeed) window.loadRecentFeed();

  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawDomain = normalizeTarget(targetUrlInput.value);
    const confirmed = document.getElementById('ownershipConfirmed').checked;

    if (!rawDomain) return;

    if (scanMode === 'active') {
      if (!currentUser || !currentUser.is_pro) return window.launchRazorpayCheckout("Active DAST Scanning", () => window.location.reload());
      return window.showDnsVerificationModal(rawDomain, async () => {
        submitScanBtn.disabled = true; 
        
        // Trigger the new beautiful loading animation!
        if (window.showLoadingState) window.showLoadingState(resultsEl, 'active');

        try {
          const res = await fetch("/api/scan-active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: rawDomain }) });
          const data = await res.json();
          clearInterval(window.activeLoadingInterval); // Stop the animation
          if (data.error) throw new Error(data.error);
          if (typeof renderResults === "function") renderResults(data, 'results'); 
          else window.location.href = `/report/${encodeURIComponent(rawDomain)}`;
        } catch (err) { 
          clearInterval(window.activeLoadingInterval);
          resultsEl.innerHTML = `<div class="card" style="border-color:var(--brand-rose);">${err.message}</div>`; 
        } finally { 
          submitScanBtn.disabled = false; 
          submitScanBtn.textContent = 'Launch Active Exploits'; 
        }
      });
    }

    submitScanBtn.disabled = true; 
    
    // Trigger the new beautiful loading animation!
    if (window.showLoadingState) window.showLoadingState(resultsEl, 'full');
    
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: rawDomain, ownershipConfirmed: confirmed, listPublicly: document.getElementById('listPublicly')?.checked }) });
      const data = await res.json(); 
      clearInterval(window.activeLoadingInterval); // Stop the animation
      if (data.error) throw new Error(data.error);
      if (typeof renderResults === "function") { 
        renderResults(data, 'results'); 
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