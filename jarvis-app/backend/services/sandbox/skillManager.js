const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class SkillManager {
    constructor() {
        this._ensureSchema();
    }

    _ensureSchema() {
        const columns = [
            "ALTER TABLE skills_manifest ADD COLUMN test_results_json TEXT",
            "ALTER TABLE skills_manifest ADD COLUMN created_at TEXT",
            "ALTER TABLE skills_manifest ADD COLUMN updated_at TEXT",
            "ALTER TABLE skills_manifest ADD COLUMN tests_summary TEXT",
            "ALTER TABLE skills_manifest ADD COLUMN errors_count INTEGER DEFAULT 0",
            "ALTER TABLE skills_manifest ADD COLUMN code_snapshot TEXT",
            "ALTER TABLE skills_manifest ADD COLUMN is_active INTEGER DEFAULT 1"
        ];
        for (const sql of columns) {
            try {
                databaseService.db.exec(sql);
            } catch (_) {}
        }
    }

    registerSkill({
        name,
        version = '1.0.0',
        permissions = [],
        networkAccess = false,
        fsAccess = 'none', // 'none', 'downloads_only', 'full'
        requiredLevel = 'L4',
        entrypoint,
        trustLevel = 'local-generated', // 'trusted', 'local-generated', 'untrusted', 'verified-tested'
        testResults = null,
        status = 'enabled',
        createdAt = null,
        updatedAt = null,
        testsSummary = null,
        errorsCount = 0,
        codeSnapshot = null,
        isActive = 1
    }) {
        const id = `skill-${crypto.randomUUID().slice(0, 8)}`;
        const hash = crypto.createHash('sha256').update(`${name}@${version}:${entrypoint}`).digest('hex');
        const now = new Date().toISOString();
        const created = createdAt || now;
        const updated = updatedAt || now;

        try {
            // Si la nueva versión se activa, desactivar las versiones previas de esta misma habilidad
            if (isActive === 1) {
                databaseService.db.prepare("UPDATE skills_manifest SET is_active = 0 WHERE name = ?").run(name);
            }

            databaseService.db.prepare(`
                INSERT INTO skills_manifest (
                    id, name, version, permissions_json, network_access, fs_access,
                    required_level, entrypoint, hash, trust_level, status, test_results_json,
                    created_at, updated_at, tests_summary, errors_count, code_snapshot, is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id, name, version, JSON.stringify(permissions), networkAccess ? 1 : 0, fsAccess,
                requiredLevel, entrypoint, hash, trustLevel, status, testResults ? JSON.stringify(testResults) : null,
                created, updated, testsSummary, errorsCount, codeSnapshot, isActive
            );

            return { ok: true, skillId: id, name, version, trustLevel, status, isActive };
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    listSkills() {
        return databaseService.db.prepare("SELECT * FROM skills_manifest WHERE status = 'enabled' AND (is_active = 1 OR is_active IS NULL)").all();
    }

    rollbackSkill(skillId) {
        databaseService.db.prepare("UPDATE skills_manifest SET status = 'disabled', is_active = 0 WHERE id = ?").run(skillId);
        return { ok: true, message: `Habilidad ${skillId} deshabilitada por rollback.` };
    }

    getSkill(idOrName) {
        return databaseService.db.prepare(`
            SELECT * FROM skills_manifest 
            WHERE (id = ? OR (name = ? AND (is_active = 1 OR is_active IS NULL))) 
              AND status = 'enabled' 
            ORDER BY rowid DESC LIMIT 1
        `).get(idOrName, idOrName);
    }

    getSkillByVersion(name, version) {
        return databaseService.db.prepare(`
            SELECT * FROM skills_manifest 
            WHERE name = ? AND version = ? 
            ORDER BY rowid DESC LIMIT 1
        `).get(name, version);
    }

    getAllVersions(name) {
        return databaseService.db.prepare(`
            SELECT * FROM skills_manifest 
            WHERE name = ? 
            ORDER BY rowid DESC
        `).all(name);
    }
}

const skillManager = new SkillManager();
module.exports = skillManager;
