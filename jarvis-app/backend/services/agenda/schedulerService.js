const databaseService = require('../persistence/databaseService');
const notificationService = require('../core/notificationService');

class SchedulerService {
    constructor() {
        this.pollInterval = null;
        this.checkMissedEventsOnStartup();
        this.startScheduler();
    }

    checkMissedEventsOnStartup() {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const nowTime = new Date().toTimeString().slice(0, 5);

            // Buscar recordatorios pendientes con hora anterior a la actual
            const missed = databaseService.db.prepare(`
                SELECT * FROM agenda 
                WHERE status = 'pending' 
                AND (target_date < ? OR (target_date = ? AND target_time < ?))
            `).all(today, today, nowTime);

            if (missed && missed.length > 0) {
                const count = missed.length;
                console.log(`[Scheduler] ⏰ Se encontraron ${count} recordatorio(s) vencido(s) mientras Jarvis estaba apagado.`);
                setTimeout(() => {
                    notificationService.notify({
                        title: 'Recordatorios Pendientes',
                        message: `Mientras estuve apagado quedaron pendientes ${count} recordatorio(s): ${missed.map(m => m.title).join(', ')}.`,
                        priority: 'HIGH'
                    });
                }, 3000);
            }
        } catch (e) {
            console.error('[Scheduler] Error comprobando eventos vencidos:', e.message);
        }
    }

    startScheduler() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => this.checkDueReminders(), 30000); // Cada 30 segundos
    }

    checkDueReminders() {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

        try {
            const due = databaseService.db.prepare(`
                SELECT * FROM agenda 
                WHERE status = 'pending' 
                AND (target_date IS NULL OR target_date <= ?)
                AND target_time = ?
            `).all(today, currentTime);

            for (const item of due) {
                console.log(`[Scheduler] 🔔 Disparando recordatorio: "${item.title}"`);
                notificationService.notify({
                    title: 'Recordatorio',
                    message: item.title,
                    priority: 'HIGH',
                    channels: ['HUD', 'TOAST', 'TTS']
                });

                if (item.recurrence === 'daily') {
                    // Mantener pendiente para mañana
                    databaseService.db.prepare(`
                        UPDATE agenda SET last_triggered = ? WHERE id = ?
                    `).run(new Date().toISOString(), item.id);
                } else {
                    databaseService.db.prepare(`
                        UPDATE agenda SET status = 'completed', last_triggered = ? WHERE id = ?
                    `).run(new Date().toISOString(), item.id);
                }
            }
        } catch (e) {
            console.error('[Scheduler] Error en ciclo de recordatorios:', e.message);
        }
    }
}

const schedulerService = new SchedulerService();
module.exports = schedulerService;
