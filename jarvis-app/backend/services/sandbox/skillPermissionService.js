/**
 * Skill Permission Service for Jarvis (Ítem 12)
 * Implementa control de acceso y aislamiento granular por habilidad bajo el principio
 * de menor privilegio (PoLP - Principle of Least Privilege).
 *
 * Características:
 *  - Esquema canónico de permisos: network, filesystem_read, filesystem_write,
 *    powershell, registry, process_spawn, env_read.
 *  - Ámbitos restringidos para el sistema de archivos: 'none', 'scratch_only', 'downloads_only'.
 *  - Verificación estática de código (AST/Patrones) previa a ejecución.
 *  - Guarda de seguridad en tiempo de ejecución (Runtime Interceptor/Jail) inyectada en Python y Node.js.
 *  - Confinamiento estricto contra Directory Traversal (../) y protección de rutas críticas del OS.
 */

const path = require('path');
const os = require('os');

const CRITICAL_SYSTEM_PATHS = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata\\microsoft'
];

class SkillPermissionService {
    constructor() {
        this.scratchDir = path.resolve(__dirname, '..', '..', 'data', 'sandbox_scratch');
        this.downloadsDir = path.resolve(os.homedir(), 'Downloads');
    }

    /**
     * Normaliza los permisos declarados hacia el esquema canónico.
     */
    normalizePermissions(declared = {}) {
        const perms = {
            network: Boolean(declared.network),
            powershell: Boolean(declared.powershell),
            registry: Boolean(declared.registry),
            process_spawn: Boolean(declared.process_spawn || declared.powershell),
            env_read: Boolean(declared.env_read)
        };

        // Normalización de filesystem_read
        if (declared.filesystem_read === true || declared.filesystem_read === 'full') {
            perms.filesystem_read = 'full';
        } else if (declared.filesystem_read === 'downloads' || declared.filesystem_read === 'downloads_only') {
            perms.filesystem_read = 'downloads_only';
        } else if (declared.filesystem_read === 'scratch' || declared.filesystem_read === 'scratch_only') {
            perms.filesystem_read = 'scratch_only';
        } else if (Array.isArray(declared.filesystem_read)) {
            perms.filesystem_read = declared.filesystem_read.map(p => path.resolve(p));
        } else {
            perms.filesystem_read = 'none';
        }

        // Normalización de filesystem_write
        if (declared.filesystem_write === true || declared.filesystem_write === 'full') {
            perms.filesystem_write = 'full';
        } else if (declared.filesystem_write === 'downloads' || declared.filesystem_write === 'downloads_only') {
            perms.filesystem_write = 'downloads_only';
        } else if (declared.filesystem_write === 'scratch' || declared.filesystem_write === 'scratch_only') {
            perms.filesystem_write = 'scratch_only';
        } else if (Array.isArray(declared.filesystem_write)) {
            perms.filesystem_write = declared.filesystem_write.map(p => path.resolve(p));
        } else {
            perms.filesystem_write = 'none';
        }

        return perms;
    }

    /**
     * Valida si una ruta objetivo está permitida para lectura o escritura según el ámbito concedido.
     */
    isPathPermitted(targetPath, mode = 'read', permissionScope = 'none') {
        if (!targetPath) return false;
        const resolved = path.resolve(targetPath).toLowerCase();

        // Bloqueo inviolable de rutas críticas del sistema en modo escritura
        if (mode === 'write') {
            for (const crit of CRITICAL_SYSTEM_PATHS) {
                if (resolved.startsWith(crit.toLowerCase())) {
                    return false;
                }
            }
        }

        if (permissionScope === 'full') {
            return true;
        }

        const scratch = this.scratchDir.toLowerCase();
        const downloads = this.downloadsDir.toLowerCase();

        if (permissionScope === 'scratch_only') {
            return resolved.startsWith(scratch);
        }

        if (permissionScope === 'downloads_only') {
            return resolved.startsWith(downloads) || resolved.startsWith(scratch);
        }

        if (Array.isArray(permissionScope)) {
            return permissionScope.some(allowed => resolved.startsWith(allowed.toLowerCase()));
        }

        return false;
    }

    /**
     * FASE ESTÁTICA: Escaneo del código contra los permisos otorgados.
     */
    verifyCodePermissions(code, rawPermissions = {}, language = 'python') {
        const perms = this.normalizePermissions(rawPermissions);
        const text = String(code || '');
        const violations = [];

        // 1. Verificación de RED
        if (!perms.network) {
            const networkPatterns = [
                /(?:import\s+(?:requests|urllib|socket|http\.client|aiohttp|ftplib|smtplib))/i,
                /(?:from\s+(?:requests|urllib|socket|http\.client|aiohttp|ftplib|smtplib))/i,
                /(?:require\s*\(\s*['"](?:http|https|net|dgram|axios|node-fetch)['"]\s*\))/i,
                /(?:fetch\s*\(|axios\.(?:get|post)|http\.request)/i
            ];
            for (const p of networkPatterns) {
                if (p.test(text)) {
                    violations.push({
                        permission: 'network',
                        reason: 'Intento de acceso a red o socket cuando network=false.'
                    });
                    break;
                }
            }
        }

        // 2. Verificación de POWERSHELL / SUBPROCESOS
        if (!perms.powershell && !perms.process_spawn) {
            const procPatterns = [
                /(?:subprocess\.(?:run|Popen|call|check_output))/i,
                /(?:os\.(?:system|popen|spawn))/i,
                /(?:powershell(?:\.exe)?|cmd(?:\.exe)?)/i,
                /(?:child_process\.(?:exec|spawn|fork|execFile))/i
            ];
            for (const p of procPatterns) {
                if (p.test(text)) {
                    violations.push({
                        permission: 'powershell',
                        reason: 'Intento de invocación de subprocesos o shell cuando powershell=false.'
                    });
                    break;
                }
            }
        }

        // 3. Verificación de REGISTRO DE WINDOWS
        if (!perms.registry) {
            const regPatterns = [
                /(?:winreg|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|reg\.exe\s+)/i
            ];
            for (const p of regPatterns) {
                if (p.test(text)) {
                    violations.push({
                        permission: 'registry',
                        reason: 'Intento de acceso al Registro de Windows cuando registry=false.'
                    });
                    break;
                }
            }
        }

        // 4. Verificación de ESCRITURA EN DISCO (si es 'none')
        if (perms.filesystem_write === 'none') {
            const writePatterns = [
                /(?:open\s*\([^,]+,[^)]*['"][wa\+x][^)]*\))/i,
                /(?:os\.(?:remove|unlink|rmdir|mkdir|makedirs))/i,
                /(?:shutil\.(?:rmtree|copy|move))/i,
                /(?:fs\.(?:writeFile|unlink|rmdir|mkdir))/i
            ];
            for (const p of writePatterns) {
                if (p.test(text)) {
                    violations.push({
                        permission: 'filesystem_write',
                        reason: 'Intento de modificación o escritura en disco cuando filesystem_write=none.'
                    });
                    break;
                }
            }
        }

        if (violations.length > 0) {
            return {
                allowed: false,
                violations,
                recommendation: 'La habilidad solicitó acciones no autorizadas en sus permisos declarados.'
            };
        }

        return {
            allowed: true,
            violations: []
        };
    }

    /**
     * Genera el preámbulo de seguridad en tiempo de ejecución para Python (Runtime Interceptor).
     * Se inyecta antes del código de usuario en el sandbox.
     */
    generatePythonRuntimeGuard(rawPermissions = {}) {
        const perms = this.normalizePermissions(rawPermissions);
        const scratchNormalized = this.scratchDir.replace(/\\/g, '\\\\');
        const downloadsNormalized = this.downloadsDir.replace(/\\/g, '\\\\');

        return `
# ====================================================================
# JARVIS HARDENED SKILL RUNTIME GUARD (PoLP Jail)
# ====================================================================
import sys
import os

_ALLOW_NETWORK = ${perms.network ? 'True' : 'False'}
_ALLOW_POWERSHELL = ${perms.powershell ? 'True' : 'False'}
_ALLOW_REGISTRY = ${perms.registry ? 'True' : 'False'}
_FS_WRITE_MODE = "${perms.filesystem_write}"
_FS_READ_MODE = "${perms.filesystem_read}"
_SCRATCH_DIR = os.path.normpath(r"${scratchNormalized}").lower()
_DOWNLOADS_DIR = os.path.normpath(r"${downloadsNormalized}").lower()

_CRITICAL_PREFIXES = [
    r"c:\\windows",
    r"c:\\program files",
    r"c:\\program files (x86)",
    r"c:\\programdata\\microsoft"
]

# 1. Bloqueo de Red en Runtime
if not _ALLOW_NETWORK:
    def _blocked_network(*args, **kwargs):
        raise PermissionError("Acceso denegado: La habilidad no tiene permiso de red (network=False).")
    try:
        import socket
        socket.socket = _blocked_network
        socket.create_connection = _blocked_network
    except Exception:
        pass

# 2. Bloqueo de Subprocesos y PowerShell en Runtime
if not _ALLOW_POWERSHELL:
    def _blocked_subproc(*args, **kwargs):
        raise PermissionError("Acceso denegado: La habilidad no tiene permiso para invocar comandos o subprocesos (powershell=False).")
    try:
        import subprocess
        subprocess.Popen = _blocked_subproc
        subprocess.run = _blocked_subproc
        subprocess.call = _blocked_subproc
        subprocess.check_output = _blocked_subproc
        os.system = _blocked_subproc
        os.popen = _blocked_subproc
    except Exception:
        pass

# 3. Interceptación y Confinamiento de Sistema de Archivos
_orig_open = open
_orig_remove = getattr(os, 'remove', None)
_orig_unlink = getattr(os, 'unlink', None)

def _is_path_allowed_for_write(target):
    if not target:
        return False
    norm = os.path.abspath(target).lower()
    for crit in _CRITICAL_PREFIXES:
        if norm.startswith(crit):
            return False
    if _FS_WRITE_MODE == "full":
        return True
    if _FS_WRITE_MODE == "scratch_only":
        return norm.startswith(_SCRATCH_DIR)
    if _FS_WRITE_MODE == "downloads_only":
        return norm.startswith(_DOWNLOADS_DIR) or norm.startswith(_SCRATCH_DIR)
    return False

def _guarded_open(file, mode='r', *args, **kwargs):
    mode_str = str(mode).lower()
    is_write = any(ch in mode_str for ch in ['w', 'a', '+', 'x'])
    target = str(file) if not isinstance(file, int) else None
    
    if target:
        if is_write:
            if not _is_path_allowed_for_write(target):
                raise PermissionError(f"Acceso denegado: Escritura no autorizada en ruta '{target}' (filesystem_write={_FS_WRITE_MODE}).")
        else:
            norm = os.path.abspath(target).lower()
            for crit in _CRITICAL_PREFIXES:
                if norm.startswith(crit) and not norm.startswith(_SCRATCH_DIR):
                    raise PermissionError(f"Acceso denegado: Lectura de rutas del sistema bloqueada '{target}'.")

    return _orig_open(file, mode, *args, **kwargs)

import builtins
builtins.open = _guarded_open

if _orig_remove:
    def _guarded_remove(path, *args, **kwargs):
        if not _is_path_allowed_for_write(path):
            raise PermissionError(f"Acceso denegado: Eliminacion no autorizada de '{path}'.")
        return _orig_remove(path, *args, **kwargs)
    os.remove = _guarded_remove
    if _orig_unlink:
        os.unlink = _guarded_remove

# ====================================================================
# FIN DEL PREAMBULO DE SEGURIDAD
# ====================================================================
`;
    }

    /**
     * Genera el preámbulo de seguridad en tiempo de ejecución para JavaScript/Node.js.
     */
    generateJavaScriptRuntimeGuard(rawPermissions = {}) {
        const perms = this.normalizePermissions(rawPermissions);
        const scratchNormalized = this.scratchDir.replace(/\\/g, '\\\\');
        const downloadsNormalized = this.downloadsDir.replace(/\\/g, '\\\\');

        return `
// ====================================================================
// JARVIS HARDENED SKILL JAVASCRIPT RUNTIME GUARD (PoLP Jail)
// ====================================================================
const _ALLOW_NETWORK = ${perms.network ? 'true' : 'false'};
const _ALLOW_POWERSHELL = ${perms.powershell ? 'true' : 'false'};
const _ALLOW_REGISTRY = ${perms.registry ? 'true' : 'false'};
const _FS_WRITE_MODE = "${perms.filesystem_write}";
const _FS_READ_MODE = "${perms.filesystem_read}";
const _SCRATCH_DIR = "${scratchNormalized}".toLowerCase();
const _DOWNLOADS_DIR = "${downloadsNormalized}".toLowerCase();

const _CRITICAL_PREFIXES = [
    "c:\\\\windows",
    "c:\\\\program files",
    "c:\\\\program files (x86)",
    "c:\\\\programdata\\\\microsoft"
];

// 1. Interceptar require para módulos prohibidos
const _Module = require('module');
const _origRequire = _Module.prototype.require;

_Module.prototype.require = function(id) {
    if (!_ALLOW_NETWORK && ['http', 'https', 'net', 'dgram', 'tls', 'dns', 'axios', 'node-fetch', 'undici'].includes(id)) {
        throw new Error(\`Acceso denegado: Modulo de red '\${id}' bloqueado (network=false).\`);
    }
    if (!_ALLOW_POWERSHELL && ['child_process', 'cluster'].includes(id)) {
        throw new Error(\`Acceso denegado: Modulo de procesos '\${id}' bloqueado (powershell=false).\`);
    }
    return _origRequire.apply(this, arguments);
};

// 2. Interceptar fetch global
if (typeof globalThis.fetch === 'function' && !_ALLOW_NETWORK) {
    globalThis.fetch = function() {
        return Promise.reject(new Error("Acceso denegado: Red global bloqueada (network=false)."));
    };
}

// 3. Interceptar fs para control de escritura y path traversal
const _fs = require('fs');
const _path = require('path');

function _isPathAllowedForWrite(target) {
    if (!target) return false;
    const norm = _path.resolve(String(target)).toLowerCase();
    for (const crit of _CRITICAL_PREFIXES) {
        if (norm.startsWith(crit)) return false;
    }
    if (_FS_WRITE_MODE === "full") return true;
    if (_FS_WRITE_MODE === "scratch_only") return norm.startsWith(_SCRATCH_DIR);
    if (_FS_WRITE_MODE === "downloads_only") return norm.startsWith(_DOWNLOADS_DIR) || norm.startsWith(_SCRATCH_DIR);
    return false;
}

const _origWriteFileSync = _fs.writeFileSync;
_fs.writeFileSync = function(file, data, options) {
    if (!_isPathAllowedForWrite(file)) {
        throw new Error(\`Acceso denegado: Escritura no autorizada en '\${file}' (filesystem_write=\${_FS_WRITE_MODE}).\`);
    }
    return _origWriteFileSync.apply(this, arguments);
};

const _origWriteFile = _fs.writeFile;
_fs.writeFile = function(file, data, ...rest) {
    if (!_isPathAllowedForWrite(file)) {
        const cb = rest[rest.length - 1];
        if (typeof cb === 'function') return cb(new Error(\`Acceso denegado: Escritura no autorizada en '\${file}'.\`));
        throw new Error(\`Acceso denegado: Escritura no autorizada en '\${file}'.\`);
    }
    return _origWriteFile.apply(this, arguments);
};
// ====================================================================
`;
    }

    /**
     * Prepara el código final protegido con el preámbulo de seguridad.
     */
    wrapCodeWithGuard(code, permissions = {}, language = 'python') {
        if (language === 'python') {
            const preamble = this.generatePythonRuntimeGuard(permissions);
            return `${preamble}\n${code}`;
        }
        if (language === 'javascript' || language === 'node') {
            const preamble = this.generateJavaScriptRuntimeGuard(permissions);
            return `${preamble}\n${code}`;
        }
        return code;
    }
}

const skillPermissionService = new SkillPermissionService();
module.exports = skillPermissionService;
