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

    findLatestScreenshot() {
        const desktop = path.join(os.homedir(), 'Desktop');
        if (!fs.existsSync(desktop)) return null;

        const files = fs.readdirSync(desktop)
            .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f) || /captura|screenshot/i.test(f))
            .map(f => {
                const full = path.join(desktop, f);
                try {
                    return { full, name: f, mtime: fs.statSync(full).mtimeMs };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime);

        return files.length > 0 ? files[0].full : null;
    }

    resolveTargetFile(targetPath) {
        if (!targetPath) return null;
        const clean = String(targetPath).trim();

        // 1. Caso especial: última captura o foto
        if (/^(?:la\s+)?(?:ultima\s+|última\s+)?(?:captura|screenshot|foto|pantallazo)(?:\s+de\s+pantalla)?$/i.test(clean) || clean === 'last_screenshot') {
            const latest = this.findLatestScreenshot();
            if (latest) return latest;
        }

        // 2. Ruta exacta o absoluta existente
        if (fs.existsSync(clean)) return path.resolve(clean);

        // 3. Búsqueda en carpetas estándar del usuario
        const candidateDirs = [
            path.join(os.homedir(), 'Desktop'),
            path.join(os.homedir(), 'Downloads'),
            path.join(os.homedir(), 'Documents'),
            path.join(os.homedir(), 'Pictures'),
            process.cwd()
        ];

        for (const dir of candidateDirs) {
            if (!fs.existsSync(dir)) continue;
            // Coincidencia exacta
            const exact = path.join(dir, clean);
            if (fs.existsSync(exact)) return exact;

            // Búsqueda con extensiones comunes si no tiene
            if (!path.extname(clean)) {
                for (const ext of ['.txt', '.png', '.jpg', '.jpeg', '.docx', '.pdf', '.xlsx']) {
                    const withExt = path.join(dir, clean + ext);
                    if (fs.existsSync(withExt)) return withExt;
                }
            }

            // Búsqueda por coincidencia parcial insensible a mayúsculas
            try {
                const entries = fs.readdirSync(dir);
                const match = entries.find(e => e.toLowerCase() === clean.toLowerCase() || e.toLowerCase().startsWith(clean.toLowerCase()));
                if (match) return path.join(dir, match);
            } catch (e) {}
        }

        return null;
    }

    moveToTrash(targetPath) {
        const resolvedPath = this.resolveTargetFile(targetPath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return { ok: false, code: 'ERR_FILE_NOT_FOUND', message: `No se encontró el archivo "${targetPath}" en tu Escritorio ni en tus carpetas personales.` };
        }

        const id = `trash-${crypto.randomUUID().slice(0, 8)}`;
        const baseName = path.basename(resolvedPath);
        const trashFileName = `${id}_${baseName}`;
        const trashPath = path.join(TRASH_DIR, trashFileName);
        const stats = fs.statSync(resolvedPath);
        const deletedAt = new Date().toISOString();

        // Mover físicamente a ~/.jarvis_trash/
        fs.renameSync(resolvedPath, trashPath);

        // Registrar en SQLite
        try {
            databaseService.db.prepare(`
                INSERT INTO trash_manifest (id, original_path, trash_path, deleted_at, file_size, status)
                VALUES (?, ?, ?, ?, ?, 'in_trash')
            `).run(id, resolvedPath, trashPath, deletedAt, stats.size);
        } catch (err) {
            console.error('[TrashService] Error guardando manifiesto:', err.message);
            fs.renameSync(trashPath, resolvedPath);
            return { ok: false, message: 'No se pudo registrar la papelera. El archivo se conservó en su ubicación original.' };
        }

        console.log(`[TrashService] 🗑️ Archivo movido a papelera segura: ${baseName} (${resolvedPath})`);
        return {
            ok: true,
            trashId: id,
            originalPath: resolvedPath,
            trashPath,
            message: `El archivo ${baseName} fue eliminado y movido a la papelera segura de Jarvis (se puede deshacer o recuperar en 7 días).`
        };
    }

    restoreFromTrash(identifier, conflictResolution = 'RENAME') {
        const row = databaseService.db.prepare(`
            SELECT * FROM trash_manifest 
            WHERE (id = ? OR original_path LIKE ?) AND status = 'in_trash'
            ORDER BY deleted_at DESC LIMIT 1
        `).get(identifier, `%${identifier}%`);

        if (!row) {
            return { ok: false, code: 'ERR_NOT_IN_TRASH', message: `No se encontró "${identifier}" en la papelera de Jarvis.` };
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
                let suffix = 2;
                while (fs.existsSync(destination)) destination = path.join(parsed.dir, `${parsed.name} (restaurado ${suffix++})${parsed.ext}`);
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
