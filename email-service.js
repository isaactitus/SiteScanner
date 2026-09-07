// email-service.js
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendAuditAlert({ to, hostname, currentScore, previousScore, issues }) {
  if (!resend) {
    console.warn("[EmailService] RESEND_API_KEY is not configured. Skipping alert.");
    return null;
  }

  const scoreDiff = currentScore - (previousScore ?? currentScore);
  const diffDisplay = scoreDiff > 0 ? `+${scoreDiff} pts` : `${scoreDiff} pts`;
  const fromEmail = process.env.RESEND_FROM_EMAIL || "SiteScanner <alerts@yourdomain.com>";
  const appUrl = process.env.APP_URL || "https://sitescanner.onrender.com";

  return await resend.emails.send({
    from: fromEmail,
    to,
    subject: `[Alert] Security Audit Report for ${hostname} (Grade: ${currentScore}/100)`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0284c7; margin-top: 0; font-size: 20px;">SiteScanner Automated Audit</h2>
        <p style="font-size: 15px; color: #475569;">Target domain: <strong>${hostname}</strong></p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
          <p style="font-size: 18px; margin: 0 0 6px; font-weight: 700;">
            Current Score: ${currentScore}/100 
            <span style="font-size: 14px; color: ${scoreDiff < 0 ? '#ef4444' : '#10b981'}; font-weight: 600;">(${diffDisplay})</span>
          </p>
          ${
            currentScore < 70
              ? `<p style="color: #ef4444; font-size: 14px; margin: 0; font-weight: 600;">⚠️ Security score is below your designated health threshold.</p>`
              : `<p style="color: #10b981; font-size: 14px; margin: 0; font-weight: 600;">✓ Baseline health checks are passing.</p>`
          }
        </div>

        <h3 style="font-size: 15px; margin-top: 24px; color: #0f172a;">Key Audit Findings:</h3>
        <ul style="line-height: 1.6; color: #334155; font-size: 14px; padding-left: 20px;">
          ${(issues && issues.length > 0 ? issues : ["Review full report for detailed breakdown."])
            .map((issue) => `<li>${issue}</li>`)
            .join("")}
        </ul>

        <div style="margin-top: 28px;">
          <a href="${appUrl}/report/${encodeURIComponent(hostname)}" 
             style="background: #0f172a; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">
            View Detailed Audit
          </a>
        </div>
      </div>
    `,
  });
}