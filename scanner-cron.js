// scanner-cron.js
import cron from "node-cron";
import { db, getUserProfile, saveLatestScan, recordScan, updateMonitorScore } from "./history-store.js";
import { calculateScore, scoreToGrade } from "./report-generator.js";
import { sendAlertEmail } from "./email-service.js";

export function initCronJobs(runScanPipeline) {
  // Run every 15 minutes to sweep active monitors
  cron.schedule("*/15 * * * *", async () => {
    console.log("[Cron] Sweeping active monitors...");
    try {
      const res = await db.execute(`SELECT * FROM monitors WHERE is_active = 1`);
      const monitors = res.rows;
      
      for (const monitor of monitors) {
        try {
           const user = await getUserProfile(monitor.user_id);
           if (!user || !user.is_pro) continue;

           // Run the deep background scan
           const raw = await runScanPipeline(monitor.hostname);
           const { score } = calculateScore(raw, monitor.hostname);
           const grade = scoreToGrade(score);
           
           // Silently record it to their scan history
           const { previous, history } = await recordScan(monitor.hostname, score, grade, monitor.user_id);
           await saveLatestScan(monitor.hostname, { hostname: monitor.hostname, scannedAt: new Date().toISOString(), raw, score, grade, previousScan: previous, history });
           
           // State Engine: Compare the new score against the last recorded score
           const oldScore = monitor.last_score;
           
           // If they have an old score, and the new score is different, trigger the alert!
           if (oldScore !== null && score !== oldScore) {
              await sendAlertEmail(user.email, monitor.hostname, oldScore, score, "change");
           }
           
           // Update the database with the new baseline score
           await updateMonitorScore(monitor.user_id, monitor.hostname, score);

        } catch (err) {
           console.error(`[Cron] Error scanning ${monitor.hostname}:`, err);
        }
      }
    } catch (err) {
      console.error("[Cron] Database sweep failed:", err);
    }
  });
}