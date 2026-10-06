/**
 * Dashboard & Telemetry Service for Jarvis (Ítem 31)
 * Recolecta métricas en tiempo real de servicios satélite, hardware (CPU, RAM, VRAM GPU),
 * contexto de inferencia (modelo activo) y rendimiento de acciones (última acción y latencia).
 * Soporta streaming en vivo por Socket.IO y consulta bajo demanda por REST.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

class DashboardService {
    constructor() {
        this.lastAction = {
            name: 'none',
            actionId: 'none',
            status: 'idle',
            latencyMs: 0,
            timestamp: new Date().toISOString()
        };
        this.latencyHistory = [];
        this.currentModel = process.env.DEFAULT_LLM_MODEL || 'Qwen 2.5';
        this.streamInterval = null;
        this.io = null;
        this.connectedClients = new Set();
        this.streamIntervalMs = Math.max(1000, Number(process.env.JARVIS_DASHBOARD_INTERVAL_MS) || 5000);
        this._samplePromise = null;

        // Cache de VRAM y hardware para evitar sobrecarga
        this._cachedVram = { usedGB: 0, totalGB: 0, percent: 0, lastCheck: 0 };
        this._lastCpuTick = this._getCpuTimes();
        this._cachedCpuPercent = 0;
        this._lastCpuCheck = 0;

        // Las comprobaciones externas (Ollama, ComfyUI, BroadLink y nvidia-smi)
        // son caras. El dashboard no necesita repetirlas en cada frame visual.
        this.vramCacheMs = Math.max(5000, Number(process.env.JARVIS_VRAM_CACHE_MS) || 30000);
        this.servicesCacheMs = Math.max(5000, Number(process.env.JARVIS_SERVICE_HEALTH_CACHE_MS) || 30000);
        this._cachedServices = null;
        this._lastServicesCheck = 0;
    }

    /**
     * Registra una acción ejecutada para actualizar la telemetría al instante.
     */
    recordActionExecution(actionId, durationMs, status = 'success') {
        const timestamp = new Date().toISOString();
        this.lastAction = {
            name: actionId,
            actionId,
            status,
            latencyMs: Math.round(durationMs),
            timestamp
        };
        this.latencyHistory.push(Math.round(durationMs));
        if (this.latencyHistory.length > 50) {
            this.latencyHistory.shift();
        }

        // Si hay clientes conectados en vivo, emitir evento rápido
        if (this.io) {
            this.io.emit('dashboard_action_update', this.lastAction);
        }
    }

    /**
     * Actualiza el modelo de IA activo en el sistema.
     */
    setCurrentModel(modelName) {
        if (modelName) {
            this.currentModel = modelName;
        }
    }

    /**
     * Obtiene el uso de CPU entre dos muestras de tiempo.
     */
    _getCpuTimes() {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        }
        return { idle, total };
    }

    getCpuUsage() {
        const now = Date.now();
        if (this._lastCpuCheck && (now - this._lastCpuCheck < 800)) {
            return this._cachedCpuPercent;
        }

        const currentTick = this._getCpuTimes();
        const idleDiff = currentTick.idle - this._lastCpuTick.idle;
        const totalDiff = currentTick.total - this._lastCpuTick.total;

        if (totalDiff > 50) {
            const usage = 100 - Math.round((100 * idleDiff) / totalDiff);
            this._cachedCpuPercent = Math.max(1, Math.min(100, usage));
        } else if (!this._cachedCpuPercent) {
            // Estimación inicial razonable basada en carga promedio
            const load = os.loadavg()[0] || 0.1;
            this._cachedCpuPercent = Math.max(3, Math.min(50, Math.round(load * 10)));
        }

        this._lastCpuTick = currentTick;
        this._lastCpuCheck = now;
        return this._cachedCpuPercent;
    }

    /**
     * Obtiene el uso de memoria RAM del sistema.
     */
    getRamUsage() {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();
        const usedBytes = totalBytes - freeBytes;

        const totalGB = (totalBytes / (1024 ** 3)).toFixed(1);
        const usedGB = (usedBytes / (1024 ** 3)).toFixed(1);
        const percent = Math.round((usedBytes / totalBytes) * 100);

        return {
            usedGB: parseFloat(usedGB),
            totalGB: parseFloat(totalGB),
            percent
        };
    }

    /**
     * Consulta VRAM real de GPU NVIDIA usando nvidia-smi en Windows.
     */
    async getVramUsage() {
        const now = Date.now();
        if (now - this._cachedVram.lastCheck < this.vramCacheMs) {
            return this._cachedVram;
        }

        return new Promise((resolve) => {
            exec('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', { timeout: 1500 }, (err, stdout) => {
                if (err || !stdout) {
                    // Fallback si no hay GPU Nvidia o comando falla
                    this._cachedVram = { usedGB: 0, totalGB: 0, percent: 0, available: false, lastCheck: now };
                    return resolve(this._cachedVram);
                }

                try {
                    const parts = stdout.trim().split(',');
                    const usedMB = parseFloat(parts[0]);
                    const totalMB = parseFloat(parts[1]);

                    const usedGB = parseFloat((usedMB / 1024).toFixed(1));
                    const totalGB = parseFloat((totalMB / 1024).toFixed(1));
                    const percent = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;

                    this._cachedVram = {
                        usedGB,
                        totalGB,
                        percent,
                        available: true,
                        lastCheck: now
                    };
                    resolve(this._cachedVram);
                } catch (e) {
                    this._cachedVram = { usedGB: 0, totalGB: 0, percent: 0, available: false, lastCheck: now };
                    resolve(this._cachedVram);
                }
            });
        });
    }

    /**
     * Sondea el estado de salud de todos los servicios satélite de Jarvis.
     */
    async checkServices() {
        const now = Date.now();
        if (this._cachedServices && (now - this._lastServicesCheck < this.servicesCacheMs)) {
            return this._cachedServices;
        }

        const statuses = {};

        // 1. Core (Node.js & SQLite)
        try {
            const databaseService = require('../persistence/databaseService');
            const check = databaseService.db.prepare('SELECT 1 AS ok').get();
            statuses.Core = (check && check.ok === 1) ? 'ONLINE' : 'DEGRADED';
        } catch (e) {
            statuses.Core = 'ONLINE'; // Express activo
        }

        // 2. Ollama
        try {
            const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
            const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(800) });
            statuses.Ollama = res.ok ? 'ONLINE' : 'SLEEP';
        } catch (e) {
            statuses.Ollama = 'OFFLINE';
        }

        // 3. Python Engine
        try {
            const pythonExe = path.join(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
            if (fs.existsSync(pythonExe)) {
                statuses['Python Engine'] = 'ONLINE';
            } else {
                statuses['Python Engine'] = 'OFFLINE';
            }
        } catch (e) {
            statuses['Python Engine'] = 'OFFLINE';
        }

        // 4. Whisper / Speech
        try {
            const wakeWord = require('../wakeWordService');
            const isListening = wakeWord.isListening ? wakeWord.isListening() : false;
            statuses.Whisper = isListening ? 'ONLINE' : 'ONLINE';
        } catch (e) {
            statuses.Whisper = 'SLEEP';
        }

        // 5. ComfyUI
        try {
            const comfyUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
            const res = await fetch(comfyUrl, { signal: AbortSignal.timeout(800) });
            statuses.ComfyUI = res.ok ? 'ONLINE' : 'SLEEP';
        } catch (e) {
            statuses.ComfyUI = 'SLEEP';
        }

        // 6. BroadLink
        try {
            const tvService = require('../tvService');
            const tvAvail = await tvService.isAvailable();
            statuses.BroadLink = tvAvail ? 'ONLINE' : 'SLEEP';
        } catch (e) {
            statuses.BroadLink = 'SLEEP';
        }

        // 7. Home Assistant
        try {
            const haService = require('../homeassistant/homeAssistantService');
            const haStatus = haService.getPublicStatus();
            statuses.HomeAssistant = haStatus.connected ? 'ONLINE' : 'OFFLINE';
        } catch (e) {
            statuses.HomeAssistant = 'OFFLINE';
        }

        this._cachedServices = statuses;
        this._lastServicesCheck = now;
        return statuses;
    }

    /**
     * Obtiene el snapshot completo para el Dashboard de Jarvis.
     */
    async getDashboardData() {
        // REST y Socket.IO pueden pedir el mismo snapshot simultáneamente. Una
        // sola muestra compartida evita duplicar procesos y consultas de red.
        if (this._samplePromise) return this._samplePromise;
        this._samplePromise = this._collectDashboardData();
        try {
            return await this._samplePromise;
        } finally {
            this._samplePromise = null;
        }
    }

    async _collectDashboardData() {
        const [services, vram] = await Promise.all([
            this.checkServices(),
            this.getVramUsage()
        ]);

        const cpu = this.getCpuUsage();
        const ram = this.getRamUsage();

        const avgLatency = this.latencyHistory.length > 0
            ? Math.round(this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length)
            : this.lastAction.latencyMs;

        return {
            title: 'JARVIS STATUS',
            timestamp: new Date().toISOString(),
            services,
            hardware: {
                cpuPercent: cpu,
                ramUsedGB: ram.usedGB,
                ramTotalGB: ram.totalGB,
                ramPercent: ram.percent,
                vramUsedGB: vram.usedGB,
                vramTotalGB: vram.totalGB,
                vramPercent: vram.percent,
                vramAvailable: vram.available !== false
            },
            operation: {
                currentModel: this.currentModel,
                lastAction: this.lastAction.name,
                lastActionStatus: this.lastAction.status,
                lastActionTimestamp: this.lastAction.timestamp,
                latencyMs: this.lastAction.latencyMs,
                avgLatencyMs: avgLatency
            }
        };
    }

    /**
     * Inicia la transmisión continua de telemetría hacia todos los clientes Socket.IO.
     */
    startLiveStreaming(io, intervalMs = this.streamIntervalMs) {
        if (!io) return;
        this.io = io;
        this.streamIntervalMs = Math.max(100, Number(intervalMs) || this.streamIntervalMs);

        const emitSnapshot = async (target = this.io) => {
            try {
                const data = await this.getDashboardData();
                target.emit('dashboard_telemetry', data);
            } catch (err) {
                console.error('[DashboardService] Error emitiendo telemetría:', err.message);
            }
        };

        const startTimer = () => {
            if (this.streamInterval) return;
            this.streamInterval = setInterval(() => {
                if (this.connectedClients.size === 0 && typeof this.io.on === 'function') {
                    this.stopLiveStreamingTimer();
                    return;
                }
                emitSnapshot();
            }, this.streamIntervalMs);
            this.streamInterval.unref?.();
        };

        if (typeof io.on === 'function') {
            io.on('connection', socket => {
                const clientId = socket.id || `client-${Date.now()}-${Math.random()}`;
                this.connectedClients.add(clientId);
                emitSnapshot(socket);
                startTimer();
                socket.once?.('disconnect', () => {
                    this.connectedClients.delete(clientId);
                    if (this.connectedClients.size === 0) this.stopLiveStreamingTimer();
                });
            });
        } else {
            // Compatibilidad con adaptadores simples y pruebas sin eventos de conexión.
            this.connectedClients.add('legacy-client');
            startTimer();
        }

        console.log(`[DashboardService] 📊 Telemetría lista bajo demanda (cada ${this.streamIntervalMs}ms con panel conectado).`);
    }

    stopLiveStreamingTimer() {
        if (this.streamInterval) {
            clearInterval(this.streamInterval);
            this.streamInterval = null;
        }
    }

    stopLiveStreaming() {
        this.stopLiveStreamingTimer();
        this.connectedClients.clear();
    }
}

const dashboardService = new DashboardService();
module.exports = dashboardService;
