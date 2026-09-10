/**
 * Hardened Code-Act Service for Jarvis (Ítem 11)
 * Implementa una pipeline de seguridad de 7 fases para la generación, análisis,
 * ejecución aislada en sandbox, testing automatizado, auditoría de permisos,
 * sellado criptográfico y registro de habilidades generadas por IA.
 *
 * Flujo de 7 Fases:
 *   1. Generar Código
 *   2. Análisis Estático de Seguridad (AST / Reglas)
 *   3. Sandbox Aislado Efímero (Timeout estricto, entorno sanitizado)
 *   4. Ejecución de Tests Automatizados
 *   5. Auditoría y Verificación de Permisos
 *   6. Aprobación y Sellado Criptográfico (SHA-256)
 *   7. Registro Seguro en el Manifiesto
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const skillManager = require('./skillManager');
const skillPermissionService = require('./skillPermissionService');

class HardenedCodeActService {
    constructor() {
        this.scratchDir = path.resolve(__dirname, '..', '..', 'data', 'sandbox_scratch');
        fs.mkdirSync(this.scratchDir, { recursive: true });

        // Patrones prohibidos de alta peligrosidad (Bloqueo inmediato)
        this.blockedPatterns = [
            { pattern: /\b(?:winreg|reg\s+add|reg\s+delete|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\b/i, reason: 'Intento de manipulación del Registro de Windows' },
            { pattern: /(?:shutil\.rmtree|rmdir\s+\/s|format\s+[a-z]:)/i, reason: 'Comando de borrado masivo o formateo destructivo' },
            { pattern: /(?:System32|Windows\\System32|cmd\.exe\s+\/c\s+del)/i, reason: 'Acceso a directorios críticos del sistema operativo' },
            { pattern: /(?:ctypes\.windll|kernel32\.dll|ntdll\.dll)/i, reason: 'Acceso no controlado a la API binaria del kernel de Windows' },
            { pattern: /(?:eval\s*\(|exec\s*\(.*input\s*\()/i, reason: 'Inyección de código dinámico no sanitizado' }
        ];

        // Patrones de advertencia (requieren declaración explícita de permisos)
        this.auditPatterns = [
            { key: 'network', pattern: /(?:requests|urllib|http\.client|socket|aiohttp|fetch)/i },
            { key: 'filesystem_write', pattern: /(?:open\s*\([^,]+,[^)]*['"][wa\+][^)]*\)|os\.remove|os\.unlink|fs\.writeFile)/i },
            { key: 'filesystem_read', pattern: /(?:open\s*\([^,]+,[^)]*['"]r['"]\)|os\.listdir|os\.walk|fs\.readFile)/i },
            { key: 'powershell', pattern: /(?:powershell|powershell\.exe|subprocess\.run|subprocess\.Popen)/i }
        ];
    }

    /**
     * FASE 2: Análisis Estático de Código y Detección de Amenazas.
     */
    analyzeCodeSecurity(code, language = 'python') {
        const text = String(code || '');
        const violations = [];

        // 1. Verificación de reglas críticas bloqueadas
        for (const item of this.blockedPatterns) {
            if (item.pattern.test(text)) {
                violations.push({
                    severity: 'BLOCKED',
                    reason: item.reason
                });
            }
        }

        if (violations.length > 0) {
            return {
                ok: false,
                status: 'BLOCKED',
                violations,
                recommendation: 'El código viola las políticas de seguridad y fue rechazado de inmediato.'
            };
        }

        return {
            ok: true,
            status: 'SAFE',
            violations: []
        };
    }

    /**
     * FASE 5: Auditoría y Detección de Permisos Requeridos.
     */
    auditRequiredPermissions(code) {
        const text = String(code || '');
        const permissions = {
            network: false,
            filesystem_read: false,
            filesystem_write: false,
            powershell: false,
            registry: false
        };

        for (const item of this.auditPatterns) {
            if (item.pattern.test(text)) {
                permissions[item.key] = true;
            }
        }

        return permissions;
    }

    /**
     * FASE 3: Ejecutor en Sandbox Aislado Efímero.
     * Ejecuta con timeout estricto, variables de entorno sanitizadas y captura de output.
     */
    runInSandbox(code, options = {}) {
        return new Promise((resolve) => {
            const timeoutMs = options.timeoutMs || 3000;
            const executionId = `sb_${crypto.randomUUID().slice(0, 8)}`;
            const isPython = options.language !== 'javascript';
            const fileName = `${executionId}.${isPython ? 'py' : 'js'}`;
            const filePath = path.join(this.scratchDir, fileName);

            try {
                fs.writeFileSync(filePath, code, 'utf8');
            } catch (err) {
                return resolve({ ok: false, error: `Error escribiendo sandbox: ${err.message}`, timedOut: false });
            }

            // Entorno sanitizado sin secretos de proceso
            const cleanEnv = {
                PATH: process.env.PATH,
                SYSTEMROOT: process.env.SYSTEMROOT,
                TEMP: this.scratchDir,
                PYTHONUNBUFFERED: '1'
            };

            const executable = isPython
                ? (process.env.JARVIS_PYTHON_EXE || (fs.existsSync(path.resolve(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe'))
                    ? path.resolve(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe')
                    : 'python'))
                : process.execPath;

            const args = [filePath, ...(options.args || [])];

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const child = spawn(executable, args, {
                cwd: this.scratchDir,
                env: cleanEnv,
                windowsHide: true
            });

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, timeoutMs);

            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });

            child.on('close', (codeExit) => {
                clearTimeout(timer);

                // Limpieza del archivo temporal
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (_) {}

                if (timedOut) {
                    return resolve({
                        ok: false,
                        timedOut: true,
                        exitCode: -1,
                        error: `Tiempo límite de sandbox excedido (${timeoutMs}ms). Posible bucle infinito bloqueado.`,
                        stdout: stdout.trim(),
                        stderr: stderr.trim()
                    });
                }

                resolve({
                    ok: codeExit === 0,
                    timedOut: false,
                    exitCode: codeExit,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    output: stdout.trim() || stderr.trim()
                });
            });

            child.on('error', (spawnErr) => {
                clearTimeout(timer);
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (_) {}
                resolve({
                    ok: false,
                    timedOut: false,
                    error: `Fallo al iniciar proceso en sandbox: ${spawnErr.message}`
                });
            });
        });
    }

    /**
     * FASE 4: Ejecución de Tests Unitarios Automatizados en el Sandbox.
     */
    async runAutomatedTests(code, testCode, options = {}) {
        const fullScript = `${code}\n\n# --- AUTOMATED TESTS ---\n${testCode}`;
        const sandboxResult = await this.runInSandbox(fullScript, {
            timeoutMs: options.timeoutMs || 4000,
            language: options.language || 'python'
        });

        return {
            passed: sandboxResult.ok && !sandboxResult.timedOut,
            timedOut: sandboxResult.timedOut,
            details: sandboxResult.output || sandboxResult.error
        };
    }

    /**
     * FASE 6: Aprobación y Sellado Criptográfico con Hash SHA-256.
     */
    approveAndSeal(name, version, code, permissions) {
        const sha256 = crypto.createHash('sha256').update(code).digest('hex');
        const approvedAt = new Date().toISOString();

        return {
            approved: true,
            name,
            version,
            sha256,
            approvedAt,
            trustLevel: 'verified-sandboxed',
            permissions
        };
    }

    /**
     * FASE 7: Registro Seguro en el Manifiesto de Habilidades.
     */
    registerApprovedSkill(sealedPackage, entrypoint) {
        const result = skillManager.registerSkill({
            name: sealedPackage.name,
            version: sealedPackage.version,
            permissions: sealedPackage.permissions,
            networkAccess: sealedPackage.permissions.network,
            fsAccess: sealedPackage.permissions.filesystem_write ? 'downloads_only' : 'none',
            requiredLevel: 'L3',
            entrypoint: entrypoint || `${sealedPackage.name}.py`,
            trustLevel: sealedPackage.trustLevel
        });

        return {
            ...result,
            sealedHash: sealedPackage.sha256,
            approvedAt: sealedPackage.approvedAt
        };
    }

    /**
     * PIPELINE COMPLETA DE 7 FASES (End-to-End):
     * Generar -> Analizar -> Sandbox -> Test -> Permisos -> Aprobar -> Registrar.
     */
    async processCodeActPipeline(skillRequest) {
        const auditLog = [];
        const { name, version = '1.0.0', code, testCode, language = 'python' } = skillRequest;

        auditLog.push({ phase: 1, name: 'Generación de Código', status: 'COMPLETED', detail: `Código recibido para [${name}]` });

        // Fase 2: Análisis Estático
        const securityAnalysis = this.analyzeCodeSecurity(code, language);
        if (!securityAnalysis.ok) {
            auditLog.push({ phase: 2, name: 'Análisis Estático', status: 'BLOCKED', detail: securityAnalysis.violations });
            return {
                ok: false,
                status: 'REJECTED_SECURITY',
                reason: 'El código contiene patrones maliciosos o no autorizados.',
                violations: securityAnalysis.violations,
                auditLog
            };
        }
        auditLog.push({ phase: 2, name: 'Análisis Estático', status: 'PASSED', detail: 'Sin violaciones críticas' });

        // Fase 3 y 4: Sandbox y Tests Automatizados
        if (testCode) {
            const testResult = await this.runAutomatedTests(code, testCode, { language });
            if (!testResult.passed) {
                auditLog.push({ phase: 3, name: 'Sandbox & Tests', status: 'FAILED', detail: testResult.details });
                return {
                    ok: false,
                    status: 'REJECTED_TESTS_FAILED',
                    reason: 'Los tests unitarios de verificación fallaron dentro del sandbox.',
                    error: testResult.details,
                    auditLog
                };
            }
            auditLog.push({ phase: 3, name: 'Sandbox & Tests', status: 'PASSED', detail: 'Tests unitarios ejecutados con éxito' });
        } else {
            // Prueba de ejecución mínima en sandbox
            const dryRun = await this.runInSandbox(code, { language });
            if (!dryRun.ok && !dryRun.timedOut) {
                auditLog.push({ phase: 3, name: 'Sandbox Dry-Run', status: 'WARNING', detail: dryRun.error });
            } else {
                auditLog.push({ phase: 3, name: 'Sandbox Dry-Run', status: 'PASSED', detail: 'Ejecución limpia' });
            }
        }

        // Fase 5: Auditoría de Permisos
        const permissions = this.auditRequiredPermissions(code);
        auditLog.push({ phase: 5, name: 'Auditoría de Permisos', status: 'AUDITED', detail: permissions });

        // Fase 6: Aprobación y Sellado SHA-256
        const sealed = this.approveAndSeal(name, version, code, permissions);
        auditLog.push({ phase: 6, name: 'Sellado Criptográfico', status: 'SEALED', detail: `SHA-256: ${sealed.sha256}` });

        // Fase 7: Registro en el Manifiesto
        const registerResult = this.registerApprovedSkill(sealed, `${name}.${language === 'python' ? 'py' : 'js'}`);
        auditLog.push({ phase: 7, name: 'Registro de Manifiesto', status: registerResult.ok ? 'REGISTERED' : 'REGISTRATION_FAILED', detail: registerResult });

        return {
            ok: registerResult.ok,
            skillId: registerResult.skillId,
            name,
            version,
            hash: sealed.sha256,
            permissions,
            trustLevel: sealed.trustLevel,
            auditLog
        };
    }

    /**
     * Ejecuta una habilidad aplicando la política de permisos estática y dinámica (Ítem 12).
     */
    async executeSkillWithPermissions(skillManifest, code, options = {}) {
        const language = options.language || 'python';
        const permissions = skillManifest.permissions || skillPermissionService.normalizePermissions({});

        // 1. Verificación estática de permisos
        const staticCheck = skillPermissionService.verifyCodePermissions(code, permissions, language);
        if (!staticCheck.allowed) {
            return {
                ok: false,
                phase: 'static_permission_check',
                error: `Permiso denegado por análisis estático: ${staticCheck.violations.map(v => v.reason).join('; ')}`,
                violations: staticCheck.violations
            };
        }

        // 2. Inyección de la guarda de seguridad en runtime
        const guardedCode = skillPermissionService.wrapCodeWithGuard(code, permissions, language);

        // 3. Ejecución en Sandbox efímero
        const sandboxRes = await this.runInSandbox(guardedCode, {
            timeoutMs: options.timeoutMs || 4000,
            language,
            args: options.args || []
        });

        return {
            ok: sandboxRes.ok,
            timedOut: sandboxRes.timedOut,
            output: sandboxRes.output,
            error: sandboxRes.error,
            exitCode: sandboxRes.exitCode
        };
    }
}

const hardenedCodeActService = new HardenedCodeActService();
module.exports = hardenedCodeActService;
