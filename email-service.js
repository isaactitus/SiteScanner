// email-service.js
import fetch from "node-fetch";

export async function sendAlertEmail(toEmail, hostname, oldScore, newScore, eventType) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || "SiteScanner Alerts <onboarding@resend.dev>";
  
  if (!apiKey) { console.error("No Resend API key found."); return; }

  let subject = "";
  let headline = "";
  let message = "";
  let color = "#10b981"; 
  let scoreBlock = "";

  if (eventType === "activated") {
    subject = `Monitor Enabled: ${hostname}`;
    headline = `Telemetry Active`;
    message = `Automated security monitoring has been enabled for <b>${hostname}</b>. A baseline score has been established. You will receive notifications if the security posture fluctuates.`;
    color = "#8b5cf6"; 
  } else if (eventType === "deactivated") {
    subject = `Monitor Disabled: ${hostname}`;
    headline = `Telemetry Disabled`;
    message = `Automated security monitoring has been disabled for <b>${hostname}</b>. <br><br><i>Note: A 24-hour system cooldown is in effect before this monitor can be re-enabled.</i>`;
    color = "#64748b"; 
  } else if (newScore < oldScore) {
    subject = `Alert: Score Degradation for ${hostname}`;
    headline = `Security Degradation Detected`;
    message = `The security score for <b>${hostname}</b> has dropped from ${oldScore} to ${newScore}. A new vulnerability or infrastructure misconfiguration has been detected. Review the dashboard to view the remediation blueprint.`;
    color = "#f43f5e"; 
  } else if (newScore > oldScore) {
    subject = `Notice: Score Improvement for ${hostname}`;
    headline = `Security Posture Improved`;
    message = `The security score for <b>${hostname}</b> has increased from ${oldScore} to ${newScore}. Recent remediations have been successfully verified.`;
    color = "#10b981"; 
  } else { return; }

  if (newScore !== null) {
    scoreBlock = `
      <div style="background-color: #0f172a; padding: 32px; border-radius: 8px; margin: 32px 0; border: 1px solid #1e293b; text-align: center;">
        <div style="font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; font-weight: 700;">Current Audit Score</div>
        <div style="font-size: 56px; font-weight: 800; color: ${color};">${newScore} <span style="font-size: 24px; color: #475569;">/ 100</span></div>
      </div>
    `;
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #04070f; color: #fff; padding: 32px; border-radius: 12px; border: 1px solid #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;"><h2 style="color: ${color}; margin-top: 0; font-size: 24px;">${headline}</h2></div>
      <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6;">${message}</p>
      ${scoreBlock}
      <div style="text-align: center; margin-top: 32px;">
        <a href="${process.env.APP_BASE_URL || 'https://sitescanner-0z29.onrender.com'}/report/${hostname}" style="display: inline-block; background-color: ${color}; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; font-size: 15px;">View Dashboard</a>
      </div>
      <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; font-weight: 600;">Powered by LIBI Security • SiteScanner Engine 2.0</div>
    </div>
  `;

  try {
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: fromEmail, to: toEmail, subject: subject, html: html }) });
  } catch (err) { console.error("[Email] Failed to dispatch alert:", err); }
}