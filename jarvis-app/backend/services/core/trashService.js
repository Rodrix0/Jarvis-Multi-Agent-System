const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

const TRASH_DIR = path.join(os.homedir(), '.jarvis_trash');
const RETENTION_DAYS = 7;

class TrashService {
    constructor() {
        if (!fs.existsSync(TRASH_DIR)) {
            fs.mkdirSync(TRASH_DIR, { recursive: true });
        }
        this.cleanupOldFiles();
    }

    moveToTrash(targetPath) {
        if (!fs.existsSync(targetPath)) {
            return { ok: false, code: 'ERR_FILE_NOT_FOUND', message: `El archivo ${targetPath} no existe.` };
        }

        const id = `trash-${crypto.randomUUID().slice(0, 8)}`;
        const baseName = path.basename(targetPath);
        const trashFileName = `${id}_${baseName}`;
        const trashPath = path.join(TRASH_DIR, trashFileName);
        const stats = fs.statSync(targetPath);
        const deletedAt = new Date().toISOString();

        // Mover físicamente a ~/.jarvis_trash/
        fs.renameSync(targetPath, trashPath);

        // Registrar en SQLite
        try {
            databaseService.db.prepare(`
                INSERT INTO trash_manifest (id, original_path, trash_path, deleted_at, file_size, status)
                VALUES (?, ?, ?, ?, ?, 'in_trash')
            `).run(id, targetPath, trashPath, deletedAt, stats.size);
        } catch (err) {
            console.error('[TrashService] Error guardando manifiesto:', err.message);
        }

        console.log(`[TrashService] 🗑️ Archivo movido a papelera segura: ${baseName} (${targetPath})`);
        return {
            ok: true,
            trashId: id,
            originalPath: targetPath,
            trashPath,
            message: `El archivo ${baseName} fue movido a la papelera segura de Jarvis (retención de 7 días).`
        };
    }

    restoreFromTrash(identifier, conflictResolution = 'RENAME') { // 'REPLACE', 'RENAME', 'CANCEL'
        // Buscar por id o por nombre de archivo original
        const row = databaseService.db.prepare(`
            SELECT * FROM trash_manifest 
            WHERE (id = ? OR original_path LIKE ?) AND status = 'in_trash'
            ORDER BY deleted_at DESC LIMIT 1
        `).get(identifier, `%${identifier}%`);

        if (!row) {
            return { ok: false, code: 'ERR_NOT_IN_TRASH', message: `No se encontró ${identifier} en la papelera de Jarvis.` };
        }

        if (!fs.existsSync(row.trash_path)) {
            return { ok: false, code: 'ERR_TRASH_FILE_MISSING', message: 'El archivo ya no está disponible en la papelera.' };
        }

        let destination = row.original_path;
        if (fs.existsSync(destination)) {
            if (conflictResolution === 'CANCEL') {
                return { ok: false, code: 'ERR_RESTORE_CANCELLED', message: 'Restauración cancelada por conflicto de nombre.' };
            }
            if (conflictResolution === 'RENAME') {
                const parsed = path.parse(destination);
                destination = path.join(parsed.dir, `${parsed.name} (restaurado)${parsed.ext}`);
            }
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(row.trash_path, destination);

        databaseService.db.prepare(`
            UPDATE trash_manifest SET status = 'restored' WHERE id = ?
        `).run(row.id);

        console.log(`[TrashService] ♻️ Archivo restaurado: ${destination}`);
        return {
            ok: true,
            restoredPath: destination,
            message: `Archivo restaurado con éxito en: ${destination}`
        };
    }

    listTrash() {
        return databaseService.db.prepare(`
            SELECT id, original_path, deleted_at, file_size 
            FROM trash_manifest 
            WHERE status = 'in_trash' 
            ORDER BY deleted_at DESC
        `).all();
    }

    cleanupOldFiles() {
        const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
        try {
            const rows = databaseService.db.prepare(`
                SELECT id, trash_path, deleted_at 
                FROM trash_manifest 
                WHERE status = 'in_trash'
            `).all();

            for (const row of rows) {
                if (new Date(row.deleted_at).getTime() < cutoff) {
                    if (fs.existsSync(row.trash_path)) {
                        fs.unlinkSync(row.trash_path);
                    }
                    databaseService.db.prepare(`
                        UPDATE trash_manifest SET status = 'purged' WHERE id = ?
                    `).run(row.id);
                }
            }
        } catch (e) {}
    }
}

const trashService = new TrashService();
module.exports = trashService;
