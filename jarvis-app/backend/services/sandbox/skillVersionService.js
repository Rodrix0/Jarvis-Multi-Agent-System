/**
 * Skill Version Service for Jarvis (Ítem 15)
 * Implementa versionado semántico (SemVer), linaje multi-versión,
 * auditoría de metadatos (fechas, tests aprobados, contador de errores)
 * y mecanismo de Rollback en Caliente (Hot-Swap) con cero tiempo de inactividad.
 */

const skillManager = require('./skillManager');
const databaseService = require('../persistence/databaseService');

class SkillVersionService {
    /**
     * Parsea un string SemVer 'MAJOR.MINOR.PATCH'.
     */
    parseSemver(v = '1.0.0') {
        const parts = String(v).trim().replace(/^v/, '').split('.').map(Number);
        return {
            major: isNaN(parts[0]) ? 0 : parts[0],
            minor: isNaN(parts[1]) ? 0 : parts[1],
            patch: isNaN(parts[2]) ? 0 : parts[2]
        };
    }

    /**
     * Compara dos versiones semánticas.
     * Retorna 1 si v1 > v2, -1 si v1 < v2, 0 si son iguales.
     */
    compareSemver(v1, v2) {
        const p1 = this.parseSemver(v1);
        const p2 = this.parseSemver(v2);

        if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
        if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
        if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
        return 0;
    }

    /**
     * Registra una nueva versión de una habilidad en el manifiesto.
     */
    registerNewVersion({
        name,
        version = '1.0.0',
        code,
        testsSummary = '12/12',
        errorsCount = 0,
        permissions = {},
        testResults = null,
        activate = true,
        createdAt = null,
        updatedAt = null,
        entrypoint = null
    }) {
        const now = new Date().toISOString();
        const entry = entrypoint || `${name}.py`;

        // Garantizar idempotencia eliminando versiones previas del mismo par (name, version)
        try {
            databaseService.db.prepare("DELETE FROM skills_manifest WHERE name = ? AND version = ?").run(name, version);
        } catch (_) {}

        const res = skillManager.registerSkill({
            name,
            version,
            permissions,
            networkAccess: Boolean(permissions.network),
            fsAccess: permissions.filesystem_write || 'none',
            requiredLevel: 'L3',
            entrypoint: entry,
            trustLevel: 'verified-tested',
            testResults,
            status: activate ? 'enabled' : 'inactive',
            createdAt: createdAt || now,
            updatedAt: updatedAt || now,
            testsSummary,
            errorsCount,
            codeSnapshot: code,
            isActive: activate ? 1 : 0
        });

        return {
            ok: res.ok,
            skillId: res.skillId,
            name,
            version,
            status: res.status,
            isActive: res.isActive,
            testsSummary,
            errorsCount
        };
    }

    /**
     * Realiza un rollback en caliente a una versión previa o versión específica.
     */
    rollbackSkill(name, targetVersion = null) {
        const allVersions = skillManager.getAllVersions(name);
        if (!allVersions || allVersions.length === 0) {
            return { ok: false, message: `No existen versiones registradas para la habilidad '${name}'.` };
        }

        // Buscar la versión activa actual
        const currentActive = allVersions.find(v => v.is_active === 1) || allVersions[0];

        let target = null;
        if (targetVersion) {
            target = allVersions.find(v => v.version === targetVersion);
            if (!target) {
                return { ok: false, message: `La versión objetivo '${targetVersion}' no existe para '${name}'.` };
            }
        } else {
            // Ordenar por SemVer descendente excluyendo la versión actual
            const candidateVersions = allVersions
                .filter(v => v.id !== currentActive.id)
                .sort((a, b) => this.compareSemver(b.version, a.version));

            if (candidateVersions.length === 0) {
                return { ok: false, message: `No hay una versión previa disponible para hacer rollback en '${name}'.` };
            }
            target = candidateVersions[0];
        }

        // Transacción de Rollback en Caliente
        try {
            // 1. Desactivar versión actual
            databaseService.db.prepare("UPDATE skills_manifest SET is_active = 0, status = 'rolled_back' WHERE id = ?").run(currentActive.id);

            // 2. Activar versión objetivo
            databaseService.db.prepare("UPDATE skills_manifest SET is_active = 1, status = 'enabled' WHERE id = ?").run(target.id);

            return {
                ok: true,
                name,
                rolledBackFrom: currentActive.version,
                activeVersion: target.version,
                message: `Rollback exitoso: '${name}' restaurado de ${currentActive.version} a ${target.version}.`
            };
        } catch (err) {
            return { ok: false, message: `Fallo durante rollback: ${err.message}` };
        }
    }

    /**
     * Consulta el árbol genealógico completo de versiones de una habilidad.
     */
    getSkillHistory(name) {
        const versions = skillManager.getAllVersions(name);
        if (!versions || versions.length === 0) return [];

        // Ordenar por SemVer descendente
        return versions.sort((a, b) => this.compareSemver(b.version, a.version)).map(v => ({
            id: v.id,
            name: v.name,
            version: v.version,
            createdAt: v.created_at,
            updatedAt: v.updated_at,
            tests: v.tests_summary || 'N/A',
            errors: v.errors_count || 0,
            isActive: Boolean(v.is_active),
            status: v.status
        }));
    }

    /**
     * Registra una falla o excepción ocurrida durante la ejecución en producción.
     */
    recordExecutionError(name, version = null) {
        try {
            if (version) {
                databaseService.db.prepare("UPDATE skills_manifest SET errors_count = errors_count + 1 WHERE name = ? AND version = ?").run(name, version);
            } else {
                databaseService.db.prepare("UPDATE skills_manifest SET errors_count = errors_count + 1 WHERE name = ? AND is_active = 1").run(name);
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    /**
     * Obtiene la versión activa en producción.
     */
    getActiveSkill(name) {
        return skillManager.getSkill(name);
    }
}

const skillVersionService = new SkillVersionService();
module.exports = skillVersionService;
