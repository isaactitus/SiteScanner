document.addEventListener('DOMContentLoaded', () => {
  let scanMode = 'quick'; // 'quick' | 'full'

  const tabQuick = document.getElementById('tabQuick');
  const tabFull = document.getElementById('tabFull');
  const publicFeedOption = document.getElementById('publicFeedOption');
  const scanForm = document.getElementById('scanForm');
  const targetUrlInput = document.getElementById('targetUrl');
  const submitScanBtn = document.getElementById('submitScanBtn');
  const quickCheckResult = document.getElementById('quickCheckResult');
  const resultsEl = document.getElementById('results');
  const recentListEl = document.getElementById('recentList');

  // Tab switching
  tabQuick.addEventListener('click', () => {
    scanMode = 'quick';
    tabQuick.classList.add('active');
    tabFull.classList.remove('active');
    publicFeedOption.style.display = 'none';
    submitScanBtn.textContent = 'Check Target';
  });

  tabFull.addEventListener('click', () => {
    scanMode = 'full';
    tabFull.classList.add('active');
    tabQuick.classList.remove('active');
    publicFeedOption.style.display = 'inline-flex';
    submitScanBtn.textContent = 'Run Deep Scan';
  });

  function normalizeTarget(input) {
    let clean = input.trim();
    if (!clean) return '';
    clean = clean.replace(/^(https?:\/\/)+/i, '');
    return clean.replace(/\/+$/, '');
  }

  // Load Turso Recent Scans
  async function loadRecentFeed() {
    try {
      const res = await fetch('/api/recent');
      const items = await res.json();
      if (!items || items.length === 0) {
        recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">No recent scans</span>';
        return;
      }
      recentListEl.innerHTML = items.map(item => {
        const gradeColor = item.score >= 75 ? 'var(--brand-emerald)' : item.score >= 40 ? 'var(--brand-amber)' : 'var(--brand-rose)';
        return `
          <a href="/report/${encodeURIComponent(item.hostname)}" class="feed-chip">
            <span>${item.hostname}</span>
            <span class="feed-chip-grade" style="color:${gradeColor}">${item.grade} (${item.score})</span>
          </a>
        `;
      }).join('');
    } catch {
      recentListEl.innerHTML = '<span style="color:var(--text-tertiary); font-size:0.8rem;">Feed offline</span>';
    }
  }
  loadRecentFeed();

  // Scan Submission
  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawDomain = normalizeTarget(targetUrlInput.value);
    const confirmed = document.getElementById('ownershipConfirmed').checked;
    const listPublicly = document.getElementById('listPublicly').checked;

    if (!rawDomain) return;

    submitScanBtn.disabled = true;
    submitScanBtn.textContent = 'Analyzing...';
    quickCheckResult.style.display = 'none';
    resultsEl.innerHTML = '';

    if (scanMode === 'quick') {
      try {
        const res = await fetch('/api/quickcheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawDomain, ownershipConfirmed: confirmed })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const bannerBg = data.status === 'safe' 
          ? 'rgba(16, 185, 129, 0.15)' 
          : data.status === 'warning' 
          ? 'rgba(245, 158, 11, 0.15)' 
          : 'rgba(244, 63, 94, 0.15)';
        const bannerBorder = data.status === 'safe' 
          ? 'var(--brand-emerald)' 
          : data.status === 'warning' 
          ? 'var(--brand-amber)' 
          : 'var(--brand-rose)';
        const bannerText = data.status === 'safe'
          ? '✓ Clean — Domain is safe to browse'
          : data.status === 'warning'
          ? '⚠️ Safe to browse, but needs developer attention'
          : '🚨 Critical security alerts detected';

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
      // Deep SSE Scan
      resultsEl.innerHTML = `
        <div class="card" id="streamProgress">
          <strong style="display:block; margin-bottom: 12px;">Running Comprehensive Suite...</strong>
          <div id="progressLog" style="display:flex; flex-direction:column; gap:6px; font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary);"></div>
        </div>
      `;

      const progressLog = document.getElementById('progressLog');
      const params = new URLSearchParams({
        url: rawDomain,
        confirmed: confirmed.toString(),
        listPublicly: listPublicly.toString()
      });

      const sse = new EventSource(`/api/scan-stream?${params.toString()}`);

      sse.addEventListener('progress', (e) => {
        const item = JSON.parse(e.data);
        const icon = item.status === 'done' ? '✓' : '✗';
        const color = item.status === 'done' ? 'var(--brand-emerald)' : 'var(--brand-rose)';
        progressLog.insertAdjacentHTML('beforeend', `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color:${color}; font-weight:bold;">${icon}</span>
            <span>${item.label}</span>
          </div>
        `);
      });

      sse.addEventListener('done', (e) => {
        sse.close();
        submitScanBtn.disabled = false;
        submitScanBtn.textContent = 'Run Deep Scan';
        const scanResult = JSON.parse(e.data);
        renderResults(scanResult, 'results');
        loadRecentFeed();
      });

      sse.addEventListener('error_msg', (e) => {
        sse.close();
        submitScanBtn.disabled = false;
        submitScanBtn.textContent = 'Run Deep Scan';
        const errorData = JSON.parse(e.data);
        resultsEl.innerHTML = `<div class="card" style="border-color:var(--brand-rose);">${errorData.error}</div>`;
      });

      sse.onerror = () => {
        sse.close();
        submitScanBtn.disabled = false;
        submitScanBtn.textContent = 'Run Deep Scan';
      };
    }
  });
});