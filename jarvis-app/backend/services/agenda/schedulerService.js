const databaseService = require('../persistence/databaseService');
const notificationService = require('../core/notificationService');
const { localDate } = require('./reminderParser');
class SchedulerService {
    constructor({ db = databaseService.db, notifications = notificationService, start = true } = {}) {
        this.db = db; this.notifications = notifications; this.pollInterval = null;
        if (start) {
            this.startupTimer = setTimeout(() => this.checkDueReminders(), 3000);
            this.startupTimer.unref();
            this.startScheduler();
        }
    }
    checkMissedEventsOnStartup() { return this.checkDueReminders(); }
    startScheduler() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => this.checkDueReminders(), 1000);
        this.pollInterval.unref();
    }
    checkDueReminders(now = new Date()) {
        const today = localDate(now);
        const time = now.toTimeString().slice(0, 5);
        try {
            const due = this.db.prepare(
                "SELECT * FROM agenda WHERE status = 'pending' AND ((target_date IS NULL AND target_time <= ?) OR target_date < ? OR (target_date = ? AND target_time <= ?))"
            ).all(time, today, today, time);
            for (const item of due) {
                if (item.recurrence === 'daily' && item.last_triggered && localDate(new Date(item.last_triggered)) === today) continue;
                this.notifications.notify({ title: 'Recordatorio', message: item.title, priority: 'HIGH', channels: ['HUD', 'TOAST', 'TTS'] });
                if (item.recurrence === 'daily') {
                    const next = new Date(now); next.setDate(next.getDate() + 1);
                    this.db.prepare('UPDATE agenda SET last_triggered = ?, target_date = ? WHERE id = ?').run(now.toISOString(), localDate(next), item.id);
                } else {
                    this.db.prepare("UPDATE agenda SET status = 'completed', last_triggered = ? WHERE id = ?").run(now.toISOString(), item.id);
                }
            }
        } catch (error) { console.error('[Scheduler] Error:', error.message); }
    }
}
module.exports = new SchedulerService();
module.exports.SchedulerService = SchedulerService;
