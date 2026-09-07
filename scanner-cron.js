// scanner-cron.js
import cron from "node-cron";
import { db, recordScan, saveLatestScan } from "./history-store.js";
import { calculateScore, scoreToGrade } from "./report-generator.js";
import { sendAuditAlert } from "./email-service.js";

export function initCronJobs(runScanPipeline) {
  // Dispatches every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    const now = Date.now();

    try {
      const { rows: dueMonitors } = await db.execute({
        sql: `SELECT m.*, u.email 
              FROM monitors m 
              JOIN users u ON m.user_id = u.id 
              WHERE m.is_active = 1 AND m.next_run_at <= ? 
              LIMIT 5`,
        args: [now],
      });

      if (!dueMonitors || dueMonitors.length === 0) return;

      for (const monitor of dueMonitors) {
        try {
          const raw = await runScanPipeline(monitor.hostname);
          const { score } = calculateScore(raw, monitor.hostname);
          const grade = scoreToGrade(score);

          const { previous, history } = await recordScan(monitor.hostname, score, grade);
          await saveLatestScan(monitor.hostname, {
            hostname: monitor.hostname,
            scannedAt: new Date().toISOString(),
            raw,
            score,
            grade,
            previousScan: previous,
            history,
          });

          const droppedBelow = score < monitor.alert_threshold;
          const regressed = monitor.last_score !== null && (monitor.last_score - score >= 10);

          if (droppedBelow || regressed) {
            const issues = [];
            if (!raw.tls?.valid) issues.push("SSL Certificate is invalid or unreachable.");
            if (raw.exposedFiles?.length > 0) issues.push(`${raw.exposedFiles.length} sensitive file(s) exposed publicly.`);
            if (raw.headers?.missing?.length > 0) issues.push(`Missing core headers: ${raw.headers.missing.join(", ")}`);
            if (raw.cors?.dangerousCombo) issues.push("Dangerous CORS configuration detected.");

            await sendAuditAlert({
              to: monitor.email,
              hostname: monitor.hostname,
              currentScore: score,
              previousScore: monitor.last_score,
              issues,
            });
          }

          const intervalMs = monitor.check_interval === "daily"
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;

          await db.execute({
            sql: `UPDATE monitors 
                  SET last_score = ?, next_run_at = ?, is_active = 1 
                  WHERE id = ?`,
            args: [score, now + intervalMs, monitor.id],
          });
        } catch (scanErr) {
          console.error(`[Cron] Execution error for ${monitor.hostname}:`, scanErr.message);
        }
      }
    } catch (err) {
      console.error("[Cron] Polling tick error:", err.message);
    }
  });
}