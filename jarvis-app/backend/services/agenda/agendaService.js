const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class AgendaService {
    addReminder({ title, targetDate = null, targetTime, recurrence = 'none' }) {
        const id = `rem-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        databaseService.db.prepare(`
            INSERT INTO agenda (id, title, target_date, target_time, recurrence, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `).run(id, title, targetDate, targetTime, recurrence, now);

        return {
            ok: true,
            id,
            title,
            targetDate,
            targetTime,
            recurrence,
            message: `Recordatorio guardado: "${title}" para las ${targetTime}${targetDate ? ' del ' + targetDate : ''}.`
        };
    }

    listReminders(status = 'pending') {
        const rows = databaseService.db.prepare(`
            SELECT * FROM agenda WHERE status = ? ORDER BY target_date ASC, target_time ASC
        `).all(status);

        return rows;
    }

    deleteReminder(id) {
        const res = databaseService.db.prepare('DELETE FROM agenda WHERE id = ?').run(id);
        return { ok: res.changes > 0, message: res.changes > 0 ? 'Recordatorio eliminado.' : 'No se encontró el recordatorio.' };
    }
}

const agendaService = new AgendaService();
module.exports = agendaService;
