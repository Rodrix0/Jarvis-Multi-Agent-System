/**
 * Advanced Sandbox Service for Jarvis (Ítem 13)
 * Separa la ejecución entre habilidades confiables (Trusted) y no confiables (New/Untrusted).
 *
 * Flujo:
 *   Trusted Skill    ──▶ Ejecución directa / proceso nativo optimizado
 *   New/Untrusted    ──▶ Sandbox Aislado (Entorno Sanitizado, Espacio Efímero,
 *                        Guarda en Runtime, Timeout Estricto, Destrucción post-ejecución)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const skillPermissionService = require('./skillPermissionService');

const SANDBOX_BASE_DIR = path.resolve(__dirname, '..', '..', 'data', 'sandbox_runs');

class SandboxService {
    constructor() {
        this.baseDir = SANDBOX_BASE_DIR;
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }

        // Resolución del ejecutable de Python (entorno virtual de Jarvis o fallback del sistema)
        this.pythonExec = process.env.JARVIS_PYTHON_EXE || (fs.existsSync(path.resolve(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe'))
            ? path.resolve(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe')
            : 'python');
    }

    /**
     * Enrutador central según el nivel de confianza de la habilidad.
     */
    async executeSkill({
        name = 'unnamed_skill',
        code,
        language = 'python',
        trustLevel = 'untrusted', // 'trusted', 'new', 'untrusted'
        permissions = {},
        args = [],
        timeoutMs = 5000
    }) {
        if (!code || typeof code !== 'string') {
            return {
                ok: false,
                status: 'ERROR',
                error: 'Código inválido o vacío para ejecutar en sandbox'
            };
        }

        const isTrusted = trustLevel === 'trusted';

        if (isTrusted) {
            return this.executeTrustedSkill({ name, code, language, args, timeoutMs });
        } else {
            return this.executeSandboxedSkill({ name, code, language, permissions, args, timeoutMs });
        }
    }

    /**
     * Ejecución para habilidades certificadas / confiables (Baja sobrecarga).
     */
    async executeTrustedSkill({ name, code, language = 'python', args = [], timeoutMs = 10000 }) {
        const startTime = Date.now();
        const runId = `trusted_${crypto.randomUUID().slice(0, 8)}`;
        const isPython = language !== 'javascript';
        const fileName = `${runId}.${isPython ? 'py' : 'js'}`;
        const filePath = path.join(this.baseDir, fileName);

        try {
            fs.writeFileSync(filePath, code, 'utf8');

            const executable = isPython ? this.pythonExec : process.execPath;
            const res = await this._spawnWithTimeout(executable, [filePath, ...args], {
                cwd: this.baseDir,
                env: process.env, // Trusted tiene acceso controlado al entorno de Jarvis
                timeoutMs
            });

            const durationMs = Date.now() - startTime;

            return {
                ok: res.ok,
                tier: 'trusted',
                name,
                status: res.timedOut ? 'TIMEOUT' : (res.ok ? 'SUCCESS' : 'FAILED'),
                output: res.output,
                error: res.error,
                exitCode: res.exitCode,
                executionTimeMs: durationMs
            };
        } finally {
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (_) {}
        }
    }

    /**
     * Ejecución en Sandbox Aislado para Habilidades Nuevas o No Confiables (Ítem 13).
     * Aplica:
     *   1. Espacio de trabajo temporal efímero por ejecución.
     *   2. Sanitización total de variables de entorno (sin API keys ni secretos).
     *   3. Inyección de la guarda de seguridad en tiempo de ejecución (Ítem 12).
     *   4. Timeout estricto y terminación forzosa del árbol de procesos.
     *   5. Limpieza y autodestrucción del directorio efímero post-ejecución.
     */
    async executeSandboxedSkill({
        name,
        code,
        language = 'python',
        permissions = {},
        args = [],
        timeoutMs = 4000
    }) {
        const startTime = Date.now();
        const runId = `sb_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
        const ephemeralDir = path.join(this.baseDir, runId);
        fs.mkdirSync(ephemeralDir, { recursive: true });

        const isPython = language !== 'javascript';
        const scriptName = `main.${isPython ? 'py' : 'js'}`;
        const scriptPath = path.join(ephemeralDir, scriptName);

        try {
            // 1. Verificación estática previa de permisos
            const staticCheck = skillPermissionService.verifyCodePermissions(code, permissions, language);
            if (!staticCheck.allowed) {
                return {
                    ok: false,
                    tier: 'sandboxed',
                    name,
                    status: 'PERMISSION_DENIED_STATIC',
                    error: `Permiso denegado por análisis estático: ${staticCheck.violations.map(v => v.reason).join('; ')}`,
                    violations: staticCheck.violations,
                    executionTimeMs: Date.now() - startTime
                };
            }

            // 2. Inyección de la Guarda de Runtime (PoLP Jail)
            const guardedCode = skillPermissionService.wrapCodeWithGuard(code, permissions, language);
            fs.writeFileSync(scriptPath, guardedCode, 'utf8');

            // 3. Entorno Sanitizado (Zero Leak de Credenciales)
            const cleanEnv = {
                PATH: process.env.PATH,
                SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
                TEMP: ephemeralDir,
                TMP: ephemeralDir,
                PYTHONUNBUFFERED: '1',
                // Forzamos explícitamente la ausencia de secretos
                NODE_ENV: 'sandbox'
            };

            const executable = isPython ? this.pythonExec : process.execPath;

            // 4. Ejecución Aislada con Monitoreo de Recursos
            const res = await this._spawnWithTimeout(executable, [scriptPath, ...args], {
                cwd: ephemeralDir,
                env: cleanEnv,
                timeoutMs
            });

            const durationMs = Date.now() - startTime;

            let status = 'SUCCESS';
            if (res.timedOut) {
                status = 'TIMEOUT';
            } else if (!res.ok) {
                if (res.error && res.error.includes('PermissionError')) {
                    status = 'PERMISSION_DENIED_RUNTIME';
                } else {
                    status = 'FAILED';
                }
            }

            return {
                ok: res.ok,
                tier: 'sandboxed',
                name,
                status,
                output: res.output,
                error: res.error,
                exitCode: res.exitCode,
                executionTimeMs: durationMs,
                ephemeralRunId: runId
            };
        } finally {
            // 5. Destrucción segura del espacio de trabajo efímero
            this._cleanupEphemeralDir(ephemeralDir);
        }
    }

    /**
     * Lanza el subproceso con timeout estricto y terminación forzosa.
     */
    _spawnWithTimeout(executable, args, options) {
        return new Promise((resolve) => {
            const timeoutMs = options.timeoutMs || 4000;
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let childKilled = false;

            const child = spawn(executable, args, {
                cwd: options.cwd,
                env: options.env,
                windowsHide: true
            });

            const timer = setTimeout(() => {
                timedOut = true;
                childKilled = true;
                this._forceKillProcess(child.pid);
            }, timeoutMs);

            if (child.stdout) {
                child.stdout.on('data', (d) => { stdout += d.toString(); });
            }
            if (child.stderr) {
                child.stderr.on('data', (d) => { stderr += d.toString(); });
            }

            child.on('close', (codeExit) => {
                clearTimeout(timer);

                if (timedOut) {
                    return resolve({
                        ok: false,
                        timedOut: true,
                        exitCode: -1,
                        output: stdout.trim(),
                        error: `Tiempo límite de sandbox excedido (${timeoutMs}ms). Proceso abortado por seguridad.`
                    });
                }

                resolve({
                    ok: codeExit === 0,
                    timedOut: false,
                    exitCode: codeExit,
                    output: stdout.trim(),
                    error: stderr.trim()
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    ok: false,
                    timedOut: false,
                    exitCode: -1,
                    output: stdout.trim(),
                    error: `Error iniciando proceso en sandbox: ${err.message}`
                });
            });
        });
    }

    /**
     * Mata un proceso y todos sus subprocesos hijos en Windows para evitar procesos colgados.
     */
    _forceKillProcess(pid) {
        if (!pid) return;
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${pid} /T /F`, () => {});
            } else {
                process.kill(pid, 'SIGKILL');
            }
        } catch (_) {}
    }

    /**
     * Elimina el directorio efímero de forma recursiva.
     */
    _cleanupEphemeralDir(targetDir) {
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
        } catch (_) {}
    }
}

const sandboxService = new SandboxService();
module.exports = sandboxService;
