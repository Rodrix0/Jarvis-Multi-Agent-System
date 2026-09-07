const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class MemoryConflictResolver {
    resolveConflict(newKey, newValue, newSource = 'explicit_user_statement', newMemoryId = null) {
        const existing = databaseService.db.prepare(`
            SELECT * FROM memory 
            WHERE key = ? AND status = 'ACTIVE'
        `).all(newKey);

        if (!existing || existing.length === 0) return { conflict: false };

        const now = new Date().toISOString();

        for (const row of existing) {
            // Guardar trazabilidad histórica en memory_conflict_history
            const historyId = `hist_${crypto.randomUUID().slice(0, 8)}`;
            try {
                databaseService.db.prepare(`
                    INSERT INTO memory_conflict_history 
                    (id, memory_key, previous_value, new_value, valid_from, valid_until, superseded_by, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(historyId, newKey, row.value, newValue, row.created_at, now, newMemoryId || 'superseded', newSource, now);
            } catch (histErr) {
                console.warn('[MemoryConflict] Error guardando historial:', histErr.message);
            }

            // Si la nueva memoria es explícita del usuario, sustituye (SUPERSEDED) a inferencias previas o valores anteriores
            databaseService.db.prepare(`
                UPDATE memory SET status = 'SUPERSEDED' WHERE id = ?
            `).run(row.id);
            console.log(`[MemoryConflict] 🔄 Recuerdo ID ${row.id} (${row.key}) superado por nueva afirmación del usuario con historial registrado.`);
        }

        return { conflict: true, resolved: true };
    }

    /**
     * Consulta el valor histórico anterior de una clave (Sección 13: "¿qué prefería antes?").
     */
    getHistoricalValue(key) {
        if (!key) return null;
        try {
            const row = databaseService.db.prepare(`
                SELECT * FROM memory_conflict_history
                WHERE memory_key = ?
                ORDER BY valid_until DESC LIMIT 1
            `).get(key);
            return row || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Consulta todo el historial de cambios de una clave.
     */
    getFullHistory(key) {
        if (!key) return [];
        try {
            return databaseService.db.prepare(`
                SELECT * FROM memory_conflict_history
                WHERE memory_key = ?
                ORDER BY valid_until DESC
            `).all(key);
        } catch (_) {
            return [];
        }
    }
}

const memoryConflictResolver = new MemoryConflictResolver();
module.exports = memoryConflictResolver;
