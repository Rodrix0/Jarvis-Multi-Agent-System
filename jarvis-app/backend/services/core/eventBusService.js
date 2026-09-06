/**
 * Event Bus Service for Jarvis (Ítem 26)
 * Hub central de publicación y suscripción de eventos asíncronos y proactivos (PC -> JARVIS).
 * Soporta eventos del sistema de alta prioridad, persistencia en base de datos,
 * historial circular en memoria y enfriamiento de eventos repetitivos (throttling).
 */

const EventEmitter = require('events');

const SYSTEM_EVENTS = {
    DOWNLOAD_COMPLETED: 'DOWNLOAD_COMPLETED',
    APP_CRASH: 'APP_CRASH',
    FILE_CHANGED: 'FILE_CHANGED',
    CPU_HIGH: 'CPU_HIGH',
    BATTERY_LOW: 'BATTERY_LOW',
    TV_ON: 'TV_ON',
    TASK_FINISHED: 'TASK_FINISHED',
    TASK_CANCELLED: 'TASK_CANCELLED',
    REMINDER_DUE: 'REMINDER_DUE',
    EMERGENCY_STOP: 'EMERGENCY_STOP',
    SECURITY_ALERT: 'SECURITY_ALERT',
    PROCESS_STARTED: 'PROCESS_STARTED',
    PROCESS_TERMINATED: 'PROCESS_TERMINATED',
    DEVICE_CHANGED: 'DEVICE_CHANGED',
    AUTOMATION_TRIGGERED: 'AUTOMATION_TRIGGERED',
    HA_STATE_CHANGED: 'HA_STATE_CHANGED'
};

class JarvisEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100);
        this.databaseService = null;
        this.historyLimit = 200;
        this.eventHistory = [];
        this.throttleTimestamps = new Map(); // eventKey -> timestamp

        this.criticalEvents = new Set([
            'EXECUTION_FAILED',
            SYSTEM_EVENTS.SECURITY_ALERT,
            SYSTEM_EVENTS.EMERGENCY_STOP,
            'DATABASE_CORRUPTION',
            'SKILL_INSTALLED',
            'CIRCUIT_BREAKER_TRIPPED',
            'HEALTH_WARNING',
            SYSTEM_EVENTS.BATTERY_LOW,
            SYSTEM_EVENTS.APP_CRASH
        ]);
    }

    setDatabaseService(dbService) {
        this.databaseService = dbService;
    }

    /**
     * Publica un evento en el bus para todos los suscriptores y sockets.
     * @param {string} eventName Nombre del evento
     * @param {object} payload Datos asociados
     * @returns {object} El evento emitido
     */
    publish(eventName, payload = {}) {
        const timestamp = new Date().toISOString();
        const eventData = {
            eventName,
            timestamp,
            ...payload
        };

        // 1. Guardar en historial en memoria
        this.eventHistory.push(eventData);
        if (this.eventHistory.length > this.historyLimit) {
            this.eventHistory.shift();
        }

        // 2. Emitir inmediatamente en memoria a todos los suscriptores
        this.emit(eventName, eventData);
        this.emit('*', eventData);

        // 3. Persistir en SQLite si es un evento crítico
        if (this.criticalEvents.has(eventName) && this.databaseService) {
            try {
                this.databaseService.recordCriticalEvent(eventName, eventData);
            } catch (err) {
                console.error(`[EventBus] Error persistiendo evento crítico ${eventName}:`, err.message);
            }
        }

        return eventData;
    }

    /**
     * Publica un evento garantizando un tiempo mínimo de enfriamiento (cooldown) para evitar spam.
     * @param {string} eventName
     * @param {object} payload
     * @param {number} cooldownMs Tiempo mínimo en ms entre emisiones
     * @param {string} [throttleKey] Clave personalizada de agrupamiento
     * @returns {object|null} El evento emitido o null si fue throttled
     */
    publishThrottled(eventName, payload = {}, cooldownMs = 5000, throttleKey = null) {
        const key = throttleKey || eventName;
        const now = Date.now();
        const last = this.throttleTimestamps.get(key) || 0;

        if (now - last < cooldownMs) {
            return null; // En período de enfriamiento
        }

        this.throttleTimestamps.set(key, now);
        return this.publish(eventName, { ...payload, throttled: true });
    }

    /**
     * Suscribe un manejador a un evento específico.
     */
    subscribe(eventName, handler) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }

    /**
     * Suscribe un manejador para una sola ejecución.
     */
    subscribeOnce(eventName, handler) {
        this.once(eventName, handler);
    }

    /**
     * Obtiene el historial de eventos recientes en memoria.
     * @param {number} limit
     * @param {string} [filterEvent]
     * @returns {Array}
     */
    getHistory(limit = 50, filterEvent = null) {
        let list = this.eventHistory;
        if (filterEvent) {
            list = list.filter(e => e.eventName === filterEvent);
        }
        return list.slice(-limit).reverse();
    }

    /**
     * Limpia el historial y timestamps para pruebas unitarias.
     */
    clearHistory() {
        this.eventHistory = [];
        this.throttleTimestamps.clear();
    }
}

const eventBus = new JarvisEventBus();
module.exports = eventBus;
module.exports.JarvisEventBus = JarvisEventBus;
module.exports.SYSTEM_EVENTS = SYSTEM_EVENTS;
