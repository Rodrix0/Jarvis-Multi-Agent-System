const databaseService = require('../persistence/databaseService');

class MemoryConflictResolver {
    resolveConflict(newKey, newValue, newSource = 'explicit_user_statement') {
        const existing = databaseService.db.prepare(`
            SELECT * FROM memory 
            WHERE key = ? AND status = 'ACTIVE'
        `).all(newKey);

        if (!existing || existing.length === 0) return { conflict: false };

        for (const row of existing) {
            // Si la nueva memoria es explícita del usuario, sustituye (SUPERSEDED) a inferencias previas
            if (newSource === 'explicit_user_statement' || row.source === 'inferred_pattern') {
                databaseService.db.prepare(`
                    UPDATE memory SET status = 'SUPERSEDED' WHERE id = ?
                `).run(row.id);
                console.log(`[MemoryConflict] 🔄 Recuerdo ID ${row.id} (${row.key}) superado por nueva afirmación del usuario.`);
            }
        }

        return { conflict: true, resolved: true };
    }
}

const memoryConflictResolver = new MemoryConflictResolver();
module.exports = memoryConflictResolver;
