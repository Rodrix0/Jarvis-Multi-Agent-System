const path = require('path');

const CRITICAL_PROCESS_DENYLIST = new Set([
    'explorer.exe',
    'lsass.exe',
    'csrss.exe',
    'services.exe',
    'wininit.exe',
    'smss.exe',
    'svchost.exe',
    'dwm.exe',
    'antivirus.exe',
    'msmpeng.exe',
    'securityhealthservice.exe'
]);

const CRITICAL_PATH_PREFIXES = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata\\microsoft'
];

const BACKEND_DATA_DIR = path.resolve(__dirname, '..', '..', 'data').toLowerCase();

class SecurityPolicyService {
    getActionLevel(actionId) {
        // Mapeo L0 a L4
        if (actionId.startsWith('query.') || actionId.startsWith('system.get-') || actionId === 'information.dollar' || actionId === 'agenda.list') {
            return 'L0';
        }
        if (actionId.startsWith('audio.') || actionId.startsWith('display.') || actionId === 'system.open' || actionId === 'system.media-search' || actionId === 'clipboard.write') {
            return 'L1';
        }
        if (actionId === 'process.close' || actionId.startsWith('file.move') || actionId.startsWith('file.copy') || actionId.startsWith('file.rename') || actionId.startsWith('communication.')) {
            return 'L2';
        }
        if (actionId === 'process.kill' || actionId === 'file.delete' || actionId.startsWith('power.') || actionId === 'memory.purge') {
            return 'L3';
        }
        if (actionId.startsWith('sandbox.') || actionId.startsWith('skill.install')) {
            return 'L4';
        }
        return 'L1'; // Default seguro
    }

    validateProcessKill(processName) {
        const clean = String(processName || '').toLowerCase().trim();
        if (CRITICAL_PROCESS_DENYLIST.has(clean) || clean.includes('jarvis') || clean.includes('node.exe')) {
            return {
                allowed: false,
                code: 'ERR_PROCESS_PROTECTED',
                reason: `El proceso ${processName} es crítico para el sistema o la operación de Jarvis y está protegido por seguridad.`
            };
        }
        return { allowed: true };
    }

    validatePathAccess(targetPath, isDestructive = false) {
        if (!targetPath) return { allowed: true };
        const resolved = path.resolve(targetPath).toLowerCase();

        // 1. Proteger base de datos y archivos internos de Jarvis
        if (resolved.startsWith(BACKEND_DATA_DIR) && isDestructive) {
            return {
                allowed: false,
                code: 'ERR_PATH_PROTECTED',
                reason: 'No se permite modificar o eliminar la base de datos ni archivos internos de Jarvis.'
            };
        }

        // 2. Proteger directorios del sistema Windows
        for (const prefix of CRITICAL_PATH_PREFIXES) {
            if (resolved.startsWith(prefix) && isDestructive) {
                return {
                    allowed: false,
                    code: 'ERR_PATH_SYSTEM_PROTECTED',
                    reason: `La ruta ${targetPath} pertenece a directorios protegidos de Windows y no puede ser modificada.`
                };
            }
        }

        return { allowed: true };
    }
}

const securityPolicyService = new SecurityPolicyService();
module.exports = securityPolicyService;
