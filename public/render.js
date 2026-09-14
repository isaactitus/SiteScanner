// ==========================================
// DYNAMIC LOADING ANIMATION STATE
// ==========================================
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
      // Math trick: Constantly slow down as it gets closer to 99, never reaching 100
      const increment = (99 - progress) * 0.05; 
      progress += Math.max(increment, 0.1);
      if (progress >= 99.9) progress = 99.9;
      
      if (bar) bar.style.width = `${progress}%`;
      if (text) text.textContent = `${Math.floor(progress)}%`;

      // Randomly rotate the log text to look like active terminal output
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