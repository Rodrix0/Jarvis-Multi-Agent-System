/**
 * snapshotService.js
 * 
 * Servicio Universal de Snapshots Transaccionales para JARVIS.
 * 
 * Arquitectura:
 * - Dual Provider: Git Snapshot Provider (para repositorios) y Manifest Backup Provider (para carpetas ordinarias).
 * - Rollback atómico de archivos modificados, borrados y creados.
 * - Transactor (`wrapTransaction`): snapshot -> acción -> auto-rollback en fallo.
 * - Registro persistente con catálogo y auto-pruning de capturas antiguas.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gitIntegrationService } = require('./gitIntegrationService');

const SNAPSHOT_BASE_DIR = path.join(__dirname, '..', '..', 'data', 'snapshots');
const REGISTRY_FILE = path.join(SNAPSHOT_BASE_DIR, 'snapshot_registry.json');

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'temp', 'library', 'obj', 'build', 'bin',
    'venv', '.venv', '__pycache__', 'dist', '.vs', '.idea'
]);

class SnapshotService {
    constructor() {
        this.baseDir = SNAPSHOT_BASE_DIR;
        this.registryFile = REGISTRY_FILE;
        this._ensureDirectories();
    }

    _ensureDirectories() {
        try {
            fs.mkdirSync(this.baseDir, { recursive: true });
            if (!fs.existsSync(this.registryFile)) {
                fs.writeFileSync(this.registryFile, JSON.stringify([], null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[SnapshotService] Error inicializando directorios:', e.message);
        }
    }

    _loadRegistry() {
        try {
            if (!fs.existsSync(this.registryFile)) return [];
            const data = fs.readFileSync(this.registryFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    _saveRegistry(registry) {
        try {
            fs.writeFileSync(this.registryFile, JSON.stringify(registry, null, 2), 'utf8');
        } catch (e) {
            console.error('[SnapshotService] Error guardando registro:', e.message);
        }
    }

    _computeHash(filePath) {
        try {
            const buf = fs.readFileSync(filePath);
            return crypto.createHash('sha256').update(buf).digest('hex');
        } catch {
            return null;
        }
    }

    _scanDirectory(dirPath, rootDir = dirPath) {
        const results = [];
        if (!fs.existsSync(dirPath)) return results;

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const lowerName = entry.name.toLowerCase();

            if (entry.isDirectory()) {
                if (EXCLUDED_DIRS.has(lowerName)) continue;
                results.push(...this._scanDirectory(fullPath, rootDir));
            } else if (entry.isFile()) {
                const stat = fs.statSync(fullPath);
                // Ignorar archivos enormes (> 25MB) para snapshots rápidos
                if (stat.size <= 25 * 1024 * 1024) {
                    const relativePath = path.relative(rootDir, fullPath);
                    results.push({
                        fullPath,
                        relativePath,
                        size: stat.size,
                        mtimeMs: stat.mtimeMs
                    });
                }
            }
        }
        return results;
    }

    /**
     * Crea un snapshot de un proyecto o carpeta.
     */
    async createSnapshot(projectPath, label = 'pre-action-snapshot') {
        const resolvedPath = path.resolve(projectPath || process.cwd());
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Ruta de proyecto inexistente: ${resolvedPath}`);
        }

        const isGit = gitIntegrationService.isGitRepo(resolvedPath);
        const snapshotId = `snp_${isGit ? 'git' : 'man'}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const snapshotDir = path.join(this.baseDir, snapshotId);
        fs.mkdirSync(snapshotDir, { recursive: true });

        let snapshotData = {
            id: snapshotId,
            projectPath: resolvedPath,
            provider: isGit ? 'git' : 'manifest',
            label,
            createdAt: new Date().toISOString(),
            status: 'ACTIVE'
        };

        if (isGit) {
            // PROVEEDOR GIT
            let stashRef = null;
            try {
                // Generar stash commit sin tocar el working tree
                stashRef = gitIntegrationService._runGit('stash create', resolvedPath) || null;
            } catch {}

            const headCommit = gitIntegrationService._runGit('rev-parse HEAD', resolvedPath);
            const currentBranch = gitIntegrationService.getCurrentBranch(resolvedPath);
            const status = gitIntegrationService.getStatus(resolvedPath);

            // Guardar copia de seguridad física de archivos no rastreados (untracked)
            const untrackedStorage = path.join(snapshotDir, 'untracked');
            fs.mkdirSync(untrackedStorage, { recursive: true });
            for (const relFile of status.untracked) {
                const srcPath = path.join(resolvedPath, relFile);
                const destPath = path.join(untrackedStorage, relFile);
                if (fs.existsSync(srcPath)) {
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.copyFileSync(srcPath, destPath);
                }
            }

            snapshotData.git = {
                branch: currentBranch,
                headCommit,
                stashRef,
                untracked: status.untracked
            };
            snapshotData.filesCount = status.totalChanges;
        } else {
            // PROVEEDOR MANIFEST BACKUP
            const storageDir = path.join(snapshotDir, 'storage');
            fs.mkdirSync(storageDir, { recursive: true });

            const files = this._scanDirectory(resolvedPath);
            const manifest = {};

            for (const file of files) {
                const hash = this._computeHash(file.fullPath);
                manifest[file.relativePath] = {
                    hash,
                    size: file.size,
                    mtimeMs: file.mtimeMs
                };

                const backupTarget = path.join(storageDir, file.relativePath);
                fs.mkdirSync(path.dirname(backupTarget), { recursive: true });
                fs.copyFileSync(file.fullPath, backupTarget);
            }

            fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
            snapshotData.filesCount = files.length;
        }

        // Registrar snapshot
        const registry = this._loadRegistry();
        registry.unshift(snapshotData);
        this._saveRegistry(registry);

        // Auditoría
        try {
            const structuredLogger = require('../diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: 'INFO',
                module: 'snapshotService',
                action: 'snapshot_created',
                result: 'success',
                metadata: {
                    snapshotId,
                    provider: snapshotData.provider,
                    projectPath: resolvedPath,
                    label
                }
            });
        } catch {}

        return snapshotData;
    }

    /**
     * Restaura un snapshot específico aplicando un rollback atómico.
     */
    async restoreSnapshot(snapshotId) {
        const registry = this._loadRegistry();
        const index = registry.findIndex(s => s.id === snapshotId);
        if (index === -1) {
            throw new Error(`Snapshot ${snapshotId} no encontrado en el catálogo.`);
        }

        const snapshot = registry[index];
        const snapshotDir = path.join(this.baseDir, snapshotId);
        const projectPath = snapshot.projectPath;

        if (!fs.existsSync(projectPath)) {
            throw new Error(`La ruta del proyecto ya no existe: ${projectPath}`);
        }

        let restoredCount = 0;
        let removedCount = 0;

        if (snapshot.provider === 'git') {
            // ROLLBACK GIT
            const gitInfo = snapshot.git;
            if (gitInfo.stashRef) {
                // Restaurar árbol de trabajo usando stash
                gitIntegrationService._runGit('checkout -- .', projectPath);
                gitIntegrationService._runGit('clean -fd', projectPath);
                gitIntegrationService._runGit(`stash apply ${gitInfo.stashRef}`, projectPath);
            } else {
                // Estado limpio al momento del snapshot
                gitIntegrationService._runGit('checkout -- .', projectPath);
                gitIntegrationService._runGit('clean -fd', projectPath);
            }

            // Restaurar untracked si los había
            const untrackedStorage = path.join(snapshotDir, 'untracked');
            if (fs.existsSync(untrackedStorage)) {
                for (const relFile of gitInfo.untracked || []) {
                    const src = path.join(untrackedStorage, relFile);
                    const dest = path.join(projectPath, relFile);
                    if (fs.existsSync(src)) {
                        fs.mkdirSync(path.dirname(dest), { recursive: true });
                        fs.copyFileSync(src, dest);
                    }
                }
            }
            restoredCount = snapshot.filesCount || 1;
        } else {
            // ROLLBACK MANIFEST
            const manifestPath = path.join(snapshotDir, 'manifest.json');
            const storageDir = path.join(snapshotDir, 'storage');

            if (!fs.existsSync(manifestPath)) {
                throw new Error(`Manifiesto de snapshot dañado o ausente: ${manifestPath}`);
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // 1. Restaurar todos los archivos registrados en el manifiesto
            for (const [relPath] of Object.entries(manifest)) {
                const backupFile = path.join(storageDir, relPath);
                const targetFile = path.join(projectPath, relPath);

                if (fs.existsSync(backupFile)) {
                    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
                    fs.copyFileSync(backupFile, targetFile);
                    restoredCount++;
                }
            }

            // 2. Eliminar archivos nuevos creados después del snapshot
            const currentFiles = this._scanDirectory(projectPath);
            for (const file of currentFiles) {
                if (!manifest[file.relativePath]) {
                    try {
                        fs.unlinkSync(file.fullPath);
                        removedCount++;
                    } catch {}
                }
            }
        }

        // Actualizar estado en catálogo
        snapshot.status = 'ROLLED_BACK';
        snapshot.rolledBackAt = new Date().toISOString();
        registry[index] = snapshot;
        this._saveRegistry(registry);

        return {
            ok: true,
            snapshotId,
            provider: snapshot.provider,
            projectPath,
            restoredCount,
            removedCount,
            message: `Rollback aplicado con éxito desde snapshot ${snapshotId}.`
        };
    }

    /**
     * Envoltorio transaccional: ejecuta una acción y aplica rollback automático si falla.
     */
    async wrapTransaction({ projectPath, label, actionFn, autoRollbackOnError = true }) {
        const snapshot = await this.createSnapshot(projectPath, label);
        try {
            const result = await actionFn(snapshot);
            if (result && result.ok === false && autoRollbackOnError) {
                const rollbackRes = await this.restoreSnapshot(snapshot.id);
                return {
                    ok: false,
                    rolledBack: true,
                    actionResult: result,
                    rollback: rollbackRes,
                    error: result.error || 'La acción no tuvo éxito; rollback preventivo aplicado.'
                };
            }

            // Marcar como COMMITTED
            const registry = this._loadRegistry();
            const idx = registry.findIndex(s => s.id === snapshot.id);
            if (idx !== -1) {
                registry[idx].status = 'COMMITTED';
                this._saveRegistry(registry);
            }

            return {
                ok: true,
                snapshotId: snapshot.id,
                result
            };
        } catch (err) {
            if (autoRollbackOnError) {
                const rollbackRes = await this.restoreSnapshot(snapshot.id);
                return {
                    ok: false,
                    rolledBack: true,
                    rollback: rollbackRes,
                    error: err.message
                };
            }
            throw err;
        }
    }

    /**
     * Lista los snapshots existentes.
     */
    listSnapshots(projectPath = null) {
        const registry = this._loadRegistry();
        if (!projectPath) return registry;
        const target = path.resolve(projectPath);
        return registry.filter(s => path.resolve(s.projectPath) === target);
    }

    /**
     * Limpia snapshots antiguos según política de retención.
     */
    pruneOldSnapshots(maxAgeHours = 48, maxPerProject = 20) {
        const registry = this._loadRegistry();
        const now = Date.now();
        const maxAgeMs = maxAgeHours * 3600 * 1000;

        const byProject = new Map();
        for (const snap of registry) {
            const list = byProject.get(snap.projectPath) || [];
            list.push(snap);
            byProject.set(snap.projectPath, list);
        }

        const kept = [];
        let prunedCount = 0;

        for (const [, projectSnaps] of byProject.entries()) {
            projectSnaps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            for (let i = 0; i < projectSnaps.length; i++) {
                const snap = projectSnaps[i];
                const age = now - new Date(snap.createdAt).getTime();
                const exceedsAge = maxAgeHours > 0 && age > maxAgeMs;
                const exceedsCount = maxPerProject > 0 && i >= maxPerProject;

                if (exceedsCount || exceedsAge) {
                    // Eliminar directorio de snapshot
                    try {
                        const snapDir = path.join(this.baseDir, snap.id);
                        if (fs.existsSync(snapDir)) {
                            fs.rmSync(snapDir, { recursive: true, force: true });
                        }
                    } catch {}
                    prunedCount++;
                } else {
                    kept.push(snap);
                }
            }
        }

        this._saveRegistry(kept);
        return { prunedCount, remainingCount: kept.length };
    }
}

const snapshotService = new SnapshotService();

module.exports = {
    SnapshotService,
    snapshotService
};
