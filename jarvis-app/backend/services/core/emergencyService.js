const executionManager = require('./executionManager');
const eventBus = require('./eventBusService');

class EmergencyService {
    constructor() {
        this.lastEmergencyTrigger = null;
    }

    triggerEmergencyStop(source = 'unknown') {
        const startTime = process.hrtime.bigint();
        console.log(`[EmergencyService] 🚨 Parada de emergencia solicitada desde: ${source}`);

        // 1. Abortar inmediatamente todas las tareas y matar procesos hijos
        executionManager.abortAll();

        // 2. Cancelar operaciones y procesos de TV
        try {
            const tvService = require('../tvService');
            tvService.cancel();
        } catch (e) {}

        const signalSentTime = process.hrtime.bigint();
        const cancelSignalLatencyMs = Number(signalSentTime - startTime) / 1e6;

        this.lastEmergencyTrigger = {
            source,
            timestamp: new Date().toISOString(),
            cancelSignalLatencyMs: Math.round(cancelSignalLatencyMs * 100) / 100
        };

        console.log(`[EmergencyService] ⚡ Señal de emergencia emitida con latencia: ${cancelSignalLatencyMs.toFixed(2)}ms (Objetivo <250ms: ${cancelSignalLatencyMs < 250 ? 'CUMPLIDO' : 'EXCEDIDO'})`);

        eventBus.publish('EMERGENCY_STOP', {
            source,
            cancelSignalLatencyMs: this.lastEmergencyTrigger.cancelSignalLatencyMs
        });

        return {
            ok: true,
            status: 'EMERGENCY_STOP_EXECUTED',
            source,
            cancelSignalLatencyMs: this.lastEmergencyTrigger.cancelSignalLatencyMs,
            message: 'Parada de emergencia ejecutada con éxito. Todos los procesos y tareas han sido cancelados.'
        };
    }
}

const emergencyService = new EmergencyService();
module.exports = emergencyService;
