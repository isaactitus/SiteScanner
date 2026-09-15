// email-service.js
import fetch from "node-fetch";

export async function sendAlertEmail(toEmail, hostname, oldScore, newScore, eventType) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || "SiteScanner Alerts <onboarding@resend.dev>";
  
  if (!apiKey) {
    console.error("No Resend API key found.");
    return;
  }

  let subject = "";
  let headline = "";
  let message = "";
  let color = "#10b981"; // emerald

  // Determine email context based on the event
  if (eventType === "activated") {
    subject = `✅ Monitoring Activated: ${hostname}`;
    headline = `Threat Monitoring Active`;
    message = `You have successfully armed the active security monitor for <b>${hostname}</b>. We have established your baseline score, and will notify you immediately if your security posture fluctuates.`;
    color = "#8b5cf6"; // purple
  } else if (newScore < oldScore) {
    subject = `🚨 ALERT: Security Score Dropped for ${hostname}`;
    headline = `Security Degradation Detected`;
    message = `The security score for <b>${hostname}</b> has dropped from ${oldScore} to ${newScore}. A new vulnerability or misconfiguration was detected. Immediate attention is recommended.`;
    color = "#f43f5e"; // rose
  } else if (newScore > oldScore) {
    subject = `📈 UPGRADE: Security Score Improved for ${hostname}`;
    headline = `Security Posture Improved`;
    message = `Great news! The security score for <b>${hostname}</b> has increased from ${oldScore} to ${newScore}. Your recent remediations were successful.`;
    color = "#10b981"; // emerald
  } else {
    return; // No change, no email needed
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #04070f; color: #fff; padding: 32px; border-radius: 12px; border: 1px solid #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: ${color}; margin-top: 0; font-size: 24px;">${headline}</h2>
      </div>
      <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6;">${message}</p>
      
      <div style="background-color: #0f172a; padding: 32px; border-radius: 8px; margin: 32px 0; border: 1px solid #1e293b; text-align: center;">
        <div style="font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; font-weight: 700;">Current Audit Score</div>
        <div style="font-size: 56px; font-weight: 800; color: ${color};">${newScore} <span style="font-size: 24px; color: #475569;">/ 100</span></div>
      </div>
      
      <div style="text-align: center;">
        <a href="https://sitescanner-0z29.onrender.com/report/${hostname}" style="display: inline-block; background-color: ${color}; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; font-size: 15px;">View Detailed Blueprint</a>
      </div>
      
      <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; font-weight: 600;">
        Powered by LIBI Security • SiteScanner Engine 2.0
      </div>
    </div>
  `;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: toEmail, subject: subject, html: html })
    });
    console.log(`[Email] Successfully dispatched alert to ${toEmail} for ${hostname}`);
  } catch (err) {
    console.error("[Email] Failed to dispatch alert:", err);
  }
}