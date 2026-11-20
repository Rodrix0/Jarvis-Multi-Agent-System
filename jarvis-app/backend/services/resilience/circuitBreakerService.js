/**
 * circuitBreakerService.js
 * 
 * Ítem 35: Circuit Breakers (Estándar Hystrix / Resilience4j para JARVIS)
 * 
 * Implementa el patrón Circuit Breaker con máquina de estados tripartita:
 * - CLOSED: Operación normal, monitoreo activo de fallos.
 * - OPEN: Al alcanzar 5 fallos consecutivos (ej. Spotify), se abre y rechaza
 *         llamadas de inmediato en <1ms (Fast-Fail) evitando saturar el sistema.
 * - HALF-OPEN: Tras 2 minutos de enfriamiento (cooldownPeriodMs: 120,000ms),
 *              permite una llamada canario. Si tiene éxito, se cierra. Si falla,
 *              vuelve a OPEN por otro período de enfriamiento.
 * 
 * Integrado con ActionKernelService, StructuredLogger y Dashboard.
 */

class CircuitBreakerOpenError extends Error {
    constructor(breakerName, remainingSeconds) {
        super(`El circuito para '${breakerName}' está ABIERTO (OPEN) por fallas consecutivas. Tiempo restante de enfriamiento: ${remainingSeconds}s.`);
        this.name = 'CircuitBreakerOpenError';
        this.code = 'CIRCUIT_BREAKER_OPEN';
        this.breakerName = breakerName;
        this.remainingSeconds = remainingSeconds;
    }
}

class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = Number(options.failureThreshold) || 5;
        this.cooldownPeriodMs = Number(options.cooldownPeriodMs) || 120000; // 2 minutos por defecto
        this.successThreshold = Number(options.successThreshold) || 1;

        this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF-OPEN'
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.lastFailureTime = null;
        this.lastStateChange = new Date().toISOString();
        this.totalCalls = 0;
        this.rejectedCalls = 0;
    }

    /**
     * Evalúa reactivamente el estado actual respetando la ventana de cooldown
     */
    getState() {
        if (this.state === 'OPEN') {
            const now = Date.now();
            const elapsed = now - (this.lastFailureTime || 0);
            if (elapsed >= this.cooldownPeriodMs) {
                this.transitionTo('HALF-OPEN', 'Tiempo de enfriamiento (2 min) expirado. Entrando a prueba canario.');
            }
        }
        return this.state;
    }

    isOpen() {
        return this.getState() === 'OPEN';
    }

    isHalfOpen() {
        return this.getState() === 'HALF-OPEN';
    }

    isClosed() {
        return this.getState() === 'CLOSED';
    }

    getRemainingCooldownMs() {
        if (this.state !== 'OPEN') return 0;
        const elapsed = Date.now() - (this.lastFailureTime || 0);
        return Math.max(0, this.cooldownPeriodMs - elapsed);
    }

    getRemainingCooldownSeconds() {
        return Math.ceil(this.getRemainingCooldownMs() / 1000);
    }

    transitionTo(newState, reason = '') {
        const oldState = this.state;
        if (oldState === newState) return;

        this.state = newState;
        this.lastStateChange = new Date().toISOString();

        console.log(`[CircuitBreaker] ⚡ '${this.name}' cambió de ${oldState} -> ${newState}. Motivo: ${reason}`);

        // Auditoría estructurada
        try {
            const structuredLogger = require('../diagnostics/structuredLoggerService');
            structuredLogger.log({
                level: newState === 'OPEN' ? 'WARN' : 'INFO',
                module: 'circuitBreaker',
                action: 'state_transition',
                result: newState === 'OPEN' ? 'warning' : 'success',
                duration: 0,
                error: newState === 'OPEN' ? { code: 'circuit_opened', message: reason } : null,
                metadata: {
                    breaker: this.name,
                    from: oldState,
                    to: newState,
                    consecutiveFailures: this.consecutiveFailures,
                    cooldownSeconds: Math.round(this.cooldownPeriodMs / 1000)
                }
            });
        } catch (e) {}
    }

    recordSuccess() {
        this.totalCalls++;
        const currentState = this.getState();

        if (currentState === 'HALF-OPEN') {
            this.consecutiveSuccesses++;
            if (this.consecutiveSuccesses >= this.successThreshold) {
                this.consecutiveFailures = 0;
                this.consecutiveSuccesses = 0;
                this.transitionTo('CLOSED', 'Llamada canario exitosa en HALF-OPEN. Servicio recuperado.');
            }
        } else if (currentState === 'CLOSED') {
            this.consecutiveFailures = 0;
        }
    }

    recordFailure(err = null) {
        this.totalCalls++;
        this.lastFailureTime = Date.now();
        const currentState = this.getState();

        if (currentState === 'HALF-OPEN') {
            // Si la llamada canario falla, reabrir de inmediato
            this.consecutiveFailures++;
            this.consecutiveSuccesses = 0;
            this.transitionTo('OPEN', `Falla en llamada canario: ${err?.message || 'Error en prueba'}. Nuevo cooldown de 2 min.`);
        } else if (currentState === 'CLOSED') {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.failureThreshold) {
                this.transitionTo('OPEN', `Alcanzado umbral de ${this.failureThreshold} fallos consecutivos. Circuito abierto por 2 min.`);
            }
        }
    }

    /**
     * Ejecuta una función protegida por este Circuit Breaker
     */
    async execute(asyncFn, fallbackFn = null) {
        const currentState = this.getState();

        if (currentState === 'OPEN') {
            this.rejectedCalls++;
            const remainingSec = this.getRemainingCooldownSeconds();
            const openError = new CircuitBreakerOpenError(this.name, remainingSec);

            if (typeof fallbackFn === 'function') {
                return await fallbackFn(openError);
            }
            throw openError;
        }

        try {
            const result = await asyncFn();
            this.recordSuccess();
            return result;
        } catch (err) {
            this.recordFailure(err);
            if (typeof fallbackFn === 'function') {
                return await fallbackFn(err);
            }
            throw err;
        }
    }

    reset() {
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.lastFailureTime = null;
        this.transitionTo('CLOSED', 'Reinicio manual forzado.');
    }

    getStatus() {
        return {
            name: this.name,
            state: this.getState(),
            consecutiveFailures: this.consecutiveFailures,
            failureThreshold: this.failureThreshold,
            cooldownPeriodMs: this.cooldownPeriodMs,
            remainingCooldownSeconds: this.getRemainingCooldownSeconds(),
            totalCalls: this.totalCalls,
            rejectedCalls: this.rejectedCalls,
            lastStateChange: this.lastStateChange
        };
    }
}

class CircuitBreakerManager {
    constructor() {
        this.breakers = new Map();
        this.initDefaultBreakers();
    }

    initDefaultBreakers() {
        // Breaker específico de Spotify (Ítem 35: 5 fallos -> 2 minutos)
        this.getBreaker('spotify', { failureThreshold: 5, cooldownPeriodMs: 120000 });
        this.getBreaker('broadlink', { failureThreshold: 5, cooldownPeriodMs: 120000 });
        this.getBreaker('ollama', { failureThreshold: 5, cooldownPeriodMs: 120000 });
        this.getBreaker('weather', { failureThreshold: 4, cooldownPeriodMs: 60000 });
        this.getBreaker('searxng', { failureThreshold: 4, cooldownPeriodMs: 60000 });
    }

    getBreaker(name, options = {}) {
        const id = String(name || 'default').toLowerCase().trim();
        if (!this.breakers.has(id)) {
            this.breakers.set(id, new CircuitBreaker(id, options));
        }
        return this.breakers.get(id);
    }

    mapActionToResource(actionId) {
        if (!actionId) return 'general';
        const act = String(actionId).toLowerCase();

        if (act.includes('spotify') || act.includes('music') || act.includes('song')) {
            return 'spotify';
        }
        if (act.includes('tv') || act.includes('broadlink') || act.includes('volume') || act.includes('power')) {
            return 'broadlink';
        }
        if (act.includes('ollama') || act.includes('ai') || act.includes('llm')) {
            return 'ollama';
        }
        if (act.includes('weather') || act.includes('clima')) {
            return 'weather';
        }
        if (act.includes('search') || act.includes('web') || act.includes('google')) {
            return 'searxng';
        }
        return act;
    }

    getAllBreakers() {
        return Array.from(this.breakers.values());
    }

    getStatus() {
        const result = {};
        for (const [id, breaker] of this.breakers.entries()) {
            result[id] = breaker.getStatus();
        }
        return result;
    }

    resetBreaker(name) {
        const breaker = this.breakers.get(String(name).toLowerCase());
        if (breaker) {
            breaker.reset();
            return true;
        }
        return false;
    }
}

const circuitBreakerManager = new CircuitBreakerManager();
module.exports = {
    CircuitBreaker,
    CircuitBreakerOpenError,
    circuitBreakerManager
};
