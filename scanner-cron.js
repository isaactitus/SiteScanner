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
           const oldScore = monitor.last_score;
           
           let previous = null;
           let historyLog = [];

           // --- DELTA LOGGING ARCHITECTURE ---
           // Only record to the Audit History if it's the very first scan OR if the score fluctuated
           if (oldScore === null || score !== oldScore) {
              const recordResult = await recordScan(monitor.hostname, score, grade, monitor.user_id);
              previous = recordResult.previous;
              historyLog = recordResult.history;
              
              // Trigger email alert for the change
              if (oldScore !== null) {
                 await sendAlertEmail(user.email, monitor.hostname, oldScore, score, "change");
              }
           }

           // Always save the latest raw data so the Command Center dashboard stays fresh
           await saveLatestScan(monitor.hostname, { 
             hostname: monitor.hostname, 
             scannedAt: new Date().toISOString(), 
             raw, 
             score, 
             grade, 
             previousScan: previous, 
             history: historyLog 
           });
           
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