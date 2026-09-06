const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

class SkillManager {
    registerSkill({
        name,
        version = '1.0.0',
        permissions = [],
        networkAccess = false,
        fsAccess = 'none', // 'none', 'downloads_only', 'full'
        requiredLevel = 'L4',
        entrypoint,
        trustLevel = 'local-generated' // 'trusted', 'local-generated', 'untrusted'
    }) {
        const id = `skill-${crypto.randomUUID().slice(0, 8)}`;
        const hash = crypto.createHash('sha256').update(`${name}@${version}:${entrypoint}`).digest('hex');

        try {
            databaseService.db.prepare(`
                INSERT INTO skills_manifest (id, name, version, permissions_json, network_access, fs_access, required_level, entrypoint, hash, trust_level, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled')
            `).run(id, name, version, JSON.stringify(permissions), networkAccess ? 1 : 0, fsAccess, requiredLevel, entrypoint, hash, trustLevel);

            return { ok: true, skillId: id, name, version, trustLevel };
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    listSkills() {
        return databaseService.db.prepare("SELECT * FROM skills_manifest WHERE status = 'enabled'").all();
    }

    rollbackSkill(skillId) {
        databaseService.db.prepare("UPDATE skills_manifest SET status = 'disabled' WHERE id = ?").run(skillId);
        return { ok: true, message: `Habilidad ${skillId} deshabilitada por rollback.` };
    }

    getSkill(idOrName) {
        return databaseService.db.prepare("SELECT * FROM skills_manifest WHERE (id = ? OR name = ?) AND status = 'enabled' ORDER BY rowid DESC LIMIT 1").get(idOrName, idOrName);
    }
}

const skillManager = new SkillManager();
module.exports = skillManager;
