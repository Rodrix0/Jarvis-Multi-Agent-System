const eventBus = require('./eventBusService');
const databaseService = require('../persistence/databaseService');

class WatchdogService {
    constructor() {
        this.serviceFailures = new Map(); // serviceName -> Array<timestamp>
        this.circuitBreakers = new Map();  // serviceName -> { state: 'CLOSED'|'OPEN', trippedAt: number }
        this.isSafeMode = false;
        
        this.initCrashRecovery();
    }

    recordServiceFailure(serviceName, error = null) {
        const now = Date.now();
        if (!this.serviceFailures.has(serviceName)) {
            this.serviceFailures.set(serviceName, []);
        }

        const timestamps = this.serviceFailures.get(serviceName);
        timestamps.push(now);

        // Filtrar fallos de más de 5 minutos
        const recentFailures = timestamps.filter(t => now - t <= 5 * 60 * 1000);
        this.serviceFailures.set(serviceName, recentFailures);

        if (recentFailures.length >= 3) {
            this.tripCircuitBreaker(serviceName, error);
        }
    }

    tripCircuitBreaker(serviceName, error) {
        this.circuitBreakers.set(serviceName, {
            state: 'OPEN',
            trippedAt: Date.now(),
            reason: error ? String(error) : '3 fallos consecutivos en 5 minutos'
        });

        console.warn(`[Watchdog] ⚡ Circuit Breaker ABIERTO para el servicio: ${serviceName}. Servicio degradado temporalmente.`);
        eventBus.publish('CIRCUIT_BREAKER_TRIPPED', {
            service: serviceName,
            reason: this.circuitBreakers.get(serviceName).reason
        });
    }

    isCircuitOpen(serviceName) {
        const cb = this.circuitBreakers.get(serviceName);
        if (!cb) return false;
        if (cb.state === 'OPEN') {
            // Auto-recuperación tras 5 minutos
            if (Date.now() - cb.trippedAt > 5 * 60 * 1000) {
                console.log(`[Watchdog] 🔄 Intentando restablecer Circuit Breaker para ${serviceName}...`);
                this.circuitBreakers.delete(serviceName);
                this.serviceFailures.set(serviceName, []);
                return false;
            }
            return true;
        }
        return false;
    }

    triggerSafeMode(reason) {
        this.isSafeMode = true;
        console.error(`[Watchdog] 🚨 MODO SEGURO (SAFE MODE) ACTIVADO: ${reason}`);
        eventBus.publish('SAFE_MODE_ACTIVATED', { reason });
    }

    initCrashRecovery() {
        try {
            // Buscar tareas que quedaron en estado RUNNING cuando el proceso cerró
            const runningTasks = databaseService.db.prepare(`
                SELECT id, action_id, level, started_at, metadata_json 
                FROM executions 
                WHERE status = 'RUNNING'
            `).all();

            if (runningTasks.length > 0) {
                console.log(`[Watchdog] 🔄 Crash Recovery: Encontradas ${runningTasks.length} tareas interrumpidas.`);
                for (const task of runningTasks) {
                    databaseService.db.prepare(`
                        UPDATE executions 
                        SET status = 'INTERRUPTED', error = 'Interrumpido por reinicio o crash abrupto del sistema.' 
                        WHERE id = ?
                    `).run(task.id);
                }
            }
        } catch (err) {
            console.error('[Watchdog] Error en Crash Recovery:', err.message);
            this.triggerSafeMode('Fallo al inicializar base de datos SQLite.');
        }
    }
}

const watchdogService = new WatchdogService();
module.exports = watchdogService;
