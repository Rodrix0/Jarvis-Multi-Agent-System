const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class JarvisEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100);
        this.databaseService = null;
        this.criticalEvents = new Set([
            'EXECUTION_FAILED',
            'SECURITY_ALERT',
            'EMERGENCY_STOP',
            'DATABASE_CORRUPTION',
            'SKILL_INSTALLED',
            'CIRCUIT_BREAKER_TRIPPED',
            'HEALTH_WARNING'
        ]);
    }

    setDatabaseService(dbService) {
        this.databaseService = dbService;
    }

    publish(eventName, payload = {}) {
        const timestamp = new Date().toISOString();
        const eventData = {
            eventName,
            timestamp,
            ...payload
        };

        // 1. Emitir inmediatamente en memoria a todos los suscriptores (0ms)
        this.emit(eventName, eventData);
        this.emit('*', eventData);

        // 2. Persistir en SQLite si es un evento crítico
        if (this.criticalEvents.has(eventName) && this.databaseService) {
            try {
                this.databaseService.recordCriticalEvent(eventName, eventData);
            } catch (err) {
                console.error(`[EventBus] Error persistiendo evento crítico ${eventName}:`, err.message);
            }
        }

        return eventData;
    }

    subscribe(eventName, handler) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }

    subscribeOnce(eventName, handler) {
        this.once(eventName, handler);
    }
}

const eventBus = new JarvisEventBus();
module.exports = eventBus;
