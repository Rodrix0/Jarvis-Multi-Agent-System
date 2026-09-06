/**
 * Proactive Monitor Service for Jarvis (Ítem 26)
 * Vigila el estado de la PC en segundo plano y emite eventos proactivos (PC -> JARVIS)
 * al Event Bus cuando detecta situaciones que requieren atención:
 *  - Batería baja (< 20% en descarga)
 *  - Consumo excesivo de CPU sostenido (> 85%)
 *  - Archivos nuevos o modificados en carpetas clave
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const eventBus = require('./eventBusService');
const { SYSTEM_EVENTS } = require('./eventBusService');
const windowsControl = require('../windowsControlService');

class ProactiveMonitorService {
    constructor() {
        this.batteryTimer = null;
        this.cpuTimer = null;
        this.fileWatcher = null;
        this.isRunning = false;

        // Configuración de umbrales
        this.batteryThreshold = 20; // %
        this.cpuThreshold = 85;     // %
        this.batteryCooldownMs = 10 * 60 * 1000; // 10 minutos
        this.cpuCooldownMs = 5 * 60 * 1000;      // 5 minutos

        // Monitoreo de procesos (Ítem 27)
        this.processTimer = null;
        this.processWatchlist = new Set(); // Nombres de procesos normalizados en minúsculas (ej: 'leagueclient.exe')
        this.knownRunningProcesses = new Set();
        this.processCooldownMs = 3000;
        this.lastProcessEventTimestamps = new Map();
    }

    /**
     * Inicia los monitores de fondo de la PC.
     */
    start({ batteryIntervalMs = 60000, cpuIntervalMs = 30000, processIntervalMs = 5000, watchDownloads = true } = {}) {
        if (this.isRunning) return;
        this.isRunning = true;

        // 1. Monitor periódico de Batería
        this.batteryTimer = setInterval(() => {
            this.checkBattery().catch(() => {});
        }, batteryIntervalMs);

        // 2. Monitor periódico de CPU
        this.cpuTimer = setInterval(() => {
            this.checkCpu().catch(() => {});
        }, cpuIntervalMs);

        // 3. Monitor periódico de procesos en watchlist
        this.processTimer = setInterval(() => {
            this.checkMonitoredProcesses().catch(() => {});
        }, processIntervalMs);

        // 4. Monitor de archivos en Descargas de Jarvis
        if (watchDownloads) {
            this.setupDownloadWatcher();
        }

        console.log('[ProactiveMonitor] 👁️ Monitores proactivos de PC iniciados.');
    }

    /**
     * Detiene los temporizadores y watchers.
     */
    stop() {
        if (this.batteryTimer) {
            clearInterval(this.batteryTimer);
            this.batteryTimer = null;
        }
        if (this.cpuTimer) {
            clearInterval(this.cpuTimer);
            this.cpuTimer = null;
        }
        if (this.processTimer) {
            clearInterval(this.processTimer);
            this.processTimer = null;
        }
        if (this.fileWatcher) {
            try { this.fileWatcher.close(); } catch (e) {}
            this.fileWatcher = null;
        }
        this.isRunning = false;
        console.log('[ProactiveMonitor] 🛑 Monitores proactivos detenidos.');
    }

    /**
     * Agrega un proceso a la lista de vigilancia para detectar inicio y cierre.
     */
    watchProcess(processName) {
        if (!processName) return;
        const clean = String(processName).toLowerCase().trim().replace(/['"]/g, '');
        const norm = clean.endsWith('.exe') ? clean : `${clean}.exe`;
        this.processWatchlist.add(norm);
    }

    /**
     * Quita un proceso de la lista de vigilancia.
     */
    unwatchProcess(processName) {
        if (!processName) return;
        const clean = String(processName).toLowerCase().trim().replace(/['"]/g, '');
        const norm = clean.endsWith('.exe') ? clean : `${clean}.exe`;
        this.processWatchlist.delete(norm);
        this.knownRunningProcesses.delete(norm);
    }

    /**
     * Comprueba procesos monitoreados y emite PROCESS_STARTED / PROCESS_TERMINATED.
     */
    async checkMonitoredProcesses() {
        if (!this.processWatchlist || this.processWatchlist.size === 0) return [];

        const events = [];
        const currentRunning = new Set();
        
        try {
            const filterArgs = Array.from(this.processWatchlist).map(p => `/FI "IMAGENAME eq ${p}"`).join(' ');
            const { execSync } = require('child_process');
            const output = execSync(`tasklist.exe /FO CSV /NH ${filterArgs}`, { timeout: 4000, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
            
            for (const watched of this.processWatchlist) {
                if (output.toLowerCase().includes(`"${watched}"`) || output.toLowerCase().includes(`"${watched.replace('.exe', '')}"`)) {
                    currentRunning.add(watched);
                }
            }
        } catch (err) {
            // Manejo silencioso ante fallos del comando externo
        }

        const now = Date.now();

        // 1. Procesos finalizados (estaban en ejecución y ahora no)
        for (const proc of this.knownRunningProcesses) {
            if (!currentRunning.has(proc)) {
                const last = this.lastProcessEventTimestamps.get(`TERM_${proc}`) || 0;
                if (now - last >= this.processCooldownMs) {
                    this.lastProcessEventTimestamps.set(`TERM_${proc}`, now);
                    const ev = eventBus.publish(SYSTEM_EVENTS.PROCESS_TERMINATED, {
                        processName: proc,
                        appName: proc.replace(/\.exe$/i, ''),
                        timestamp: new Date().toISOString(),
                        message: `El proceso ${proc} ha finalizado.`
                    });
                    events.push(ev);
                }
            }
        }

        // 2. Procesos iniciados (no estaban y ahora están)
        for (const proc of currentRunning) {
            if (!this.knownRunningProcesses.has(proc)) {
                const last = this.lastProcessEventTimestamps.get(`START_${proc}`) || 0;
                if (now - last >= this.processCooldownMs) {
                    this.lastProcessEventTimestamps.set(`START_${proc}`, now);
                    const ev = eventBus.publish(SYSTEM_EVENTS.PROCESS_STARTED, {
                        processName: proc,
                        appName: proc.replace(/\.exe$/i, ''),
                        timestamp: new Date().toISOString(),
                        message: `El proceso ${proc} ha iniciado.`
                    });
                    events.push(ev);
                }
            }
        }

        this.knownRunningProcesses = currentRunning;
        return events;
    }

    /**
     * Comprueba el estado actual de la batería e informa si está baja.
     */
    async checkBattery() {
        try {
            const status = await windowsControl.power.getBatteryStatus();
            if (!status || !status.hasBattery) return null;

            const percent = Number(status.percent);
            const isDischarging = !status.charging;

            if (isDischarging && percent <= this.batteryThreshold) {
                const event = eventBus.publishThrottled(
                    SYSTEM_EVENTS.BATTERY_LOW,
                    {
                        percent,
                        charging: false,
                        critical: percent <= 10,
                        message: `Batería baja al ${percent}%. Te recomiendo conectar el cargador.`
                    },
                    percent <= 10 ? 3 * 60 * 1000 : this.batteryCooldownMs,
                    'BATTERY_LOW_COOLDOWN'
                );
                return event;
            }
        } catch (err) {
            console.warn('[ProactiveMonitor] Error consultando batería:', err.message);
        }
        return null;
    }

    /**
     * Comprueba el consumo de CPU y emite alerta si supera el umbral.
     */
    async checkCpu() {
        try {
            const overview = await windowsControl.metrics.getSystemOverview();
            if (!overview || overview.cpuUsage === undefined) return null;

            const usage = Number(overview.cpuUsage);
            if (usage >= this.cpuThreshold) {
                // Obtener los principales consumidores de recursos
                let topConsumers = [];
                try {
                    const consumers = await windowsControl.process.getTopResourceConsumers();
                    if (consumers && Array.isArray(consumers.topProcesses)) {
                        topConsumers = consumers.topProcesses.slice(0, 3);
                    }
                } catch (e) {}

                const topName = topConsumers[0] ? topConsumers[0].name : 'Proceso de Windows';
                const event = eventBus.publishThrottled(
                    SYSTEM_EVENTS.CPU_HIGH,
                    {
                        cpuUsage: usage,
                        topConsumers,
                        message: `Consumo alto de CPU (${usage}%). Proceso principal: ${topName}.`
                    },
                    this.cpuCooldownMs,
                    'CPU_HIGH_COOLDOWN'
                );
                return event;
            }
        } catch (err) {
            console.warn('[ProactiveMonitor] Error consultando CPU:', err.message);
        }
        return null;
    }

    /**
     * Configura vigilancia en la carpeta de descargas de Jarvis.
     */
    setupDownloadWatcher() {
        const downloadsDir = path.join(os.homedir(), 'Downloads', 'Jarvis_Downloads');
        if (!fs.existsSync(downloadsDir)) {
            try { fs.mkdirSync(downloadsDir, { recursive: true }); } catch (e) {}
        }

        let debounceTimeout = null;
        try {
            this.fileWatcher = fs.watch(downloadsDir, (eventType, filename) => {
                if (!filename || filename.endsWith('.tmp') || filename.endsWith('.part')) return;

                if (debounceTimeout) clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    eventBus.publish(SYSTEM_EVENTS.FILE_CHANGED, {
                        directory: downloadsDir,
                        filename,
                        eventType,
                        message: `Archivo detectado en Descargas: ${filename}`
                    });
                }, 600);
            });
        } catch (err) {
            console.warn('[ProactiveMonitor] No se pudo inicializar watcher en Descargas:', err.message);
        }
    }

    /**
     * Ejecuta una comprobación inmediata de todos los monitores.
     */
    async checkNow() {
        const [battery, cpu] = await Promise.all([
            this.checkBattery(),
            this.checkCpu()
        ]);
        return { battery, cpu };
    }
}

const proactiveMonitorService = new ProactiveMonitorService();
module.exports = proactiveMonitorService;
module.exports.ProactiveMonitorService = ProactiveMonitorService;
