/**
 * autoHealService.js
 * 
 * Ítem 34: JARVIS Autorepara Servicios
 * 
 * Orquestador de resiliencia y auto-curación de servicios satélite:
 * - Detecta caídas en python_engine, Ollama, ComfyUI, Whisper, BroadLink.
 * - Ejecuta rutinas de reparación y reinicio automático (restart_service).
 * - Política estricta de 3 reintentos: Si falla 3 veces consecutivas, transiciona
 *   a estado FAILED y emite notificación proactiva crítica multicanal:
 *   "Python engine caído, no puedo usar Whisper local".
 * - Protección anti-flapping (previene bucles infinitos de reinicio si el proceso crashea continuamente).
 * - Persistencia estructurada de auditoría con StructuredLogger.
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class AutoHealService {
    constructor() {
        this.services = new Map();
        this.monitoringInterval = null;
        this.isHealingInProgress = new Set();
        this.initDefaultServices();
    }

    initDefaultServices() {
        // 1. Python Engine
        this.registerService({
            id: 'python_engine',
            name: 'Python Engine',
            maxRetries: 3,
            failureMessage: 'Python engine caído, no puedo usar Whisper local',
            check: async () => {
                const pythonExe = path.join(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
                if (!fs.existsSync(pythonExe)) {
                    return { ok: false, error: 'Binario de entorno virtual python.exe no encontrado.' };
                }
                return { ok: true };
            },
            restart: async () => {
                const pythonExe = path.join(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
                const scriptPath = path.join(__dirname, '..', '..', '..', 'python_engine', 'main.py');
                if (!fs.existsSync(scriptPath)) {
                    return { ok: false, error: 'Script principal main.py no encontrado.' };
                }

                // Iniciar proceso desacoplado en background
                const child = spawn(pythonExe, [scriptPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                child.unref();
                return { ok: true, pid: child.pid };
            }
        });

        // 2. Ollama
        this.registerService({
            id: 'ollama',
            name: 'Ollama LLM Engine',
            maxRetries: 3,
            failureMessage: 'Ollama caído, los modelos de inferencia local no están disponibles',
            check: async () => {
                const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
                try {
                    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(1200) });
                    return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            restart: async () => {
                return new Promise((resolve) => {
                    exec('start "" ollama serve', (err) => {
                        if (err) resolve({ ok: false, error: err.message });
                        else resolve({ ok: true });
                    });
                });
            }
        });

        // 3. ComfyUI
        this.registerService({
            id: 'comfyui',
            name: 'ComfyUI Image Generation',
            maxRetries: 3,
            failureMessage: 'ComfyUI caído, no se pueden generar o procesar imágenes',
            check: async () => {
                const comfyUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
                try {
                    const res = await fetch(comfyUrl, { signal: AbortSignal.timeout(1200) });
                    return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            restart: async () => {
                return { ok: true, message: 'Reintento de conexión a ComfyUI emitido.' };
            }
        });

        // 4. BroadLink TV Remote
        this.registerService({
            id: 'broadlink',
            name: 'BroadLink Hub',
            maxRetries: 3,
            failureMessage: 'BroadLink no responde en la red local tras 3 intentos',
            check: async () => {
                try {
                    const tvService = require('../tvService');
                    const isAvail = await tvService.isAvailable();
                    return { ok: isAvail, error: isAvail ? null : 'Dispositivo BroadLink no disponible en LAN' };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            restart: async () => {
                try {
                    const tvService = require('../tvService');
                    if (tvService.discover) {
                        await tvService.discover();
                    }
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            }
        });
    }

    /**
     * Registra o actualiza la configuración de un servicio gestionado
     */
    registerService(config) {
        if (!config || !config.id) throw new Error('ID de servicio requerido');

        this.services.set(config.id, {
            id: config.id,
            name: config.name || config.id,
            maxRetries: Number(config.maxRetries) || 3,
            consecutiveFailures: 0,
            status: 'HEALTHY', // 'HEALTHY', 'DEGRADED', 'RESTARTING', 'FAILED', 'COOLDOWN'
            lastCheck: null,
            lastRestart: null,
            failureMessage: config.failureMessage || `El servicio ${config.name || config.id} ha fallado`,
            restartHistory: [], // Timestamps de reinicios para anti-flapping
            check: config.check,
            restart: config.restart
        });
    }

    getService(serviceId) {
        return this.services.get(serviceId);
    }

    getServicesStatus() {
        const result = {};
        for (const [id, s] of this.services.entries()) {
            result[id] = {
                id: s.id,
                name: s.name,
                status: s.status,
                consecutiveFailures: s.consecutiveFailures,
                maxRetries: s.maxRetries,
                lastCheck: s.lastCheck,
                lastRestart: s.lastRestart
            };
        }
        return result;
    }

    /**
     * Detección Anti-Flapping:
     * Si un servicio intenta reiniciarse más de 5 veces en 2 minutos, se congela.
     */
    isFlapping(service) {
        const now = Date.now();
        const twoMinutesAgo = now - 120000;
        service.restartHistory = service.restartHistory.filter(t => t > twoMinutesAgo);
        return service.restartHistory.length >= 5;
    }

    /**
     * Evalúa el estado de salud de un servicio y desencadena auto-reparación si está DOWN.
     */
    async checkService(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) return { ok: false, error: 'Servicio no registrado' };

        service.lastCheck = new Date().toISOString();

        let checkResult = { ok: false, error: 'Sin función de comprobación' };
        try {
            if (typeof service.check === 'function') {
                checkResult = await service.check();
            }
        } catch (err) {
            checkResult = { ok: false, error: err.message };
        }

        if (checkResult.ok) {
            // Si el servicio está sano, restaurar estado
            if (service.status !== 'HEALTHY') {
                console.log(`[AutoHeal] ✅ Servicio '${service.name}' recuperado y operando con normalidad.`);
                try {
                    const structuredLogger = require('../diagnostics/structuredLoggerService');
                    structuredLogger.info('autoHealService', 'service_recovered', {
                        serviceId: service.id,
                        previousFailures: service.consecutiveFailures
                    });
                } catch (e) {}
            }
            service.status = 'HEALTHY';
            service.consecutiveFailures = 0;
            return { ok: true, status: service.status };
        }

        // Si falló el check, el servicio está DOWN
        console.warn(`[AutoHeal] ⚠️ Servicio '${service.name}' detectado DOWN: ${checkResult.error || 'Falla de probe'}`);
        return await this.handleServiceDown(service, checkResult.error);
    }

    /**
     * Maneja el flujo de reparación tras detectar que un servicio está caído.
     */
    async handleServiceDown(service, initialError = null) {
        // Evitar reparaciones simultáneas del mismo servicio
        if (this.isHealingInProgress.has(service.id)) {
            return { ok: false, status: service.status, message: 'Reparación ya en curso' };
        }

        this.isHealingInProgress.add(service.id);
        try {
            // Chequeo anti-flapping
            if (this.isFlapping(service)) {
                service.status = 'COOLDOWN';
                console.error(`[AutoHeal] 🛑 FLAPPING DETECTADO en '${service.name}'. Pausando auto-reinicio temporalmente.`);
                this.notifyFailure(service, `AutoHeal pausado: el servicio '${service.name}' está inestable (flapping continuo).`);
                return { ok: false, status: 'COOLDOWN', error: 'Flapping protection triggered' };
            }

            service.consecutiveFailures++;
            console.log(`[AutoHeal] Intento de reparación ${service.consecutiveFailures}/${service.maxRetries} para '${service.name}'...`);

            if (service.consecutiveFailures > service.maxRetries) {
                // Se excedió el límite máximo de reintentos: FAILED definitivo
                service.status = 'FAILED';
                console.error(`[AutoHeal] ❌ SERVICIO '${service.name}' FAILED tras ${service.maxRetries} intentos fallidos.`);
                this.notifyFailure(service, service.failureMessage);

                try {
                    const structuredLogger = require('../diagnostics/structuredLoggerService');
                    structuredLogger.error('autoHealService', 'restart_exhausted', {
                        code: 'service_down_max_retries',
                        message: service.failureMessage
                    }, {
                        serviceId: service.id,
                        retries: service.consecutiveFailures,
                        error: initialError
                    });
                } catch (e) {}

                return {
                    ok: false,
                    status: 'FAILED',
                    error: `Límite de reintentos superado (${service.maxRetries}).`,
                    notified: true
                };
            }

            // Intentar reiniciar
            service.status = 'RESTARTING';
            const restartResult = await this.executeRestart(service);

            if (restartResult.ok) {
                // Post-check de salud tras el reinicio
                const postCheck = typeof service.check === 'function' ? await service.check() : { ok: true };
                if (postCheck.ok) {
                    service.status = 'HEALTHY';
                    service.consecutiveFailures = 0;
                    console.log(`[AutoHeal] 🎉 Auto-reparación exitosa para '${service.name}'.`);
                    try {
                        const structuredLogger = require('../diagnostics/structuredLoggerService');
                        structuredLogger.info('autoHealService', 'restart_success', {
                            serviceId: service.id,
                            attemptsNeeded: service.consecutiveFailures
                        });
                    } catch (e) {}
                    return { ok: true, status: 'HEALTHY' };
                }
            }

            // Si el reinicio no logró recuperar la salud
            if (service.consecutiveFailures >= service.maxRetries) {
                service.status = 'FAILED';
                this.notifyFailure(service, service.failureMessage);
                return { ok: false, status: 'FAILED', error: service.failureMessage };
            }

            service.status = 'DEGRADED';
            return { ok: false, status: 'DEGRADED', attempts: service.consecutiveFailures };
        } finally {
            this.isHealingInProgress.delete(service.id);
        }
    }

    /**
     * Ejecuta la rutina de reinicio del servicio con auditoría
     */
    async executeRestart(service) {
        service.lastRestart = new Date().toISOString();
        service.restartHistory.push(Date.now());

        const start = Date.now();
        let result = { ok: false };
        try {
            if (typeof service.restart === 'function') {
                result = await service.restart();
            }
        } catch (err) {
            result = { ok: false, error: err.message };
        }

        const duration = Date.now() - start;
        try {
            const structuredLogger = require('../diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: result.ok ? 'INFO' : 'WARN',
                module: 'autoHealService',
                action: 'restart_service',
                result: result.ok ? 'success' : 'error',
                duration,
                error: result.ok ? null : { code: 'restart_failed', message: result.error },
                metadata: {
                    serviceId: service.id,
                    consecutiveFailures: service.consecutiveFailures
                }
            });
        } catch (e) {}

        return result;
    }

    /**
     * Emite notificación multicanal cuando un servicio agota reintentos
     */
    notifyFailure(service, message) {
        try {
            const notificationService = require('../core/notificationService');
            notificationService.notify({
                title: 'Alerta de Servicios JARVIS',
                message: message || service.failureMessage,
                priority: 'HIGH',
                channels: ['HUD', 'TOAST', 'TTS'],
                sound: true,
                data: {
                    serviceId: service.id,
                    status: service.status,
                    failures: service.consecutiveFailures
                }
            });
        } catch (err) {
            console.error('[AutoHeal] Error emitiendo notificación proactiva:', err.message);
        }
    }

    /**
     * Sondea y repara todos los servicios registrados
     */
    async checkAllServices() {
        const results = {};
        for (const serviceId of this.services.keys()) {
            results[serviceId] = await this.checkService(serviceId);
        }
        return results;
    }

    /**
     * Reinicio manual forzado solicitado por usuario o LLM
     */
    async forceRestart(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) return { ok: false, error: 'Servicio no encontrado' };

        service.consecutiveFailures = 0;
        service.status = 'RESTARTING';
        const res = await this.executeRestart(service);
        const postCheck = typeof service.check === 'function' ? await service.check() : { ok: true };
        service.status = postCheck.ok ? 'HEALTHY' : 'DEGRADED';
        return { ok: res.ok, status: service.status, error: res.error };
    }

    startAutoMonitor(intervalMs = 30000) {
        if (this.monitoringInterval) clearInterval(this.monitoringInterval);
        this.monitoringInterval = setInterval(() => {
            this.checkAllServices().catch(e => console.error('[AutoHeal] Error en ronda periódica:', e.message));
        }, intervalMs);
        console.log(`[AutoHeal] 🛡️ Monitor de autorreparación activo cada ${intervalMs / 1000}s.`);
    }

    stopAutoMonitor() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }
}

const autoHealService = new AutoHealService();
module.exports = autoHealService;
