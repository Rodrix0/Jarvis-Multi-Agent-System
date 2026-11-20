/**
 * Barge-in Service for Jarvis (Ítem 23)
 * Coordina la interrupción de voz en tiempo real cuando el usuario habla mientras Jarvis sintetiza audio.
 *
 * Capacidades:
 *  - Detección y manejo de eventos de interrupción (keyword, acústica por VAD, API manual).
 *  - Corte inmediato de TTS (< 50ms) a través de ttsService.
 *  - Supresión y descarte de eco contaminado de altavoces.
 *  - Transición fluida a estado de escucha activa (wakeWordService).
 *  - Emisión de eventos WebSockets para cancelar visualizadores y ondas de audio en el frontend.
 *  - Registro de métricas de telemetría (milisegundos cortados, eventos procesados, causas).
 */

const EventEmitter = require('events');

const BARGE_IN_REASONS = {
    KEYWORD: 'keyword',               // Usuario dijo una palabra clave ("pará", "detente", "silencio", "stop", etc.)
    ACOUSTIC_VAD: 'acoustic_vad',     // Usuario empezó a hablar sobre el audio (VAD + energía)
    DIRECT_COMMAND: 'direct_command', // Usuario emitió una nueva orden directa
    MANUAL_STOP: 'manual_stop',       // Interrupción disparada por botón UI o llamada REST
    SYSTEM_ABORT: 'system_abort'      // Parada de emergencia o cambio de estado del sistema
};

const KEYWORD_INTERRUPT_PATTERNS = [
    /\b(?:para|pará|parate|detente|detene|frena|frená)\b/i,
    /\b(?:callate|cállate|silencio|silenciate|mute|mutear)\b/i,
    /\b(?:stop|basta|espera|esperá|cortala|corta)\b/i,
    /\b(?:jarvis\s+(?:para|pará|detente|callate|stop|silencio))\b/i,
    /\b(?:no\s+(?:espera|esperá|para|pará))\b/i
];

class BargeInService extends EventEmitter {
    constructor(options = {}) {
        super();
        this.ttsService = options.ttsService || null;
        this.wakeWordService = options.wakeWordService || null;
        this.io = options.io || null;

        // Estado del habla de Jarvis
        this.currentSpeech = null; // { id, text, startTime, approxDurationMs }
        this.isSpeaking = false;

        // Métricas de telemetría
        this.metrics = {
            totalSpeechSessions: 0,
            totalBargeIns: 0,
            interruptionsByReason: {
                [BARGE_IN_REASONS.KEYWORD]: 0,
                [BARGE_IN_REASONS.ACOUSTIC_VAD]: 0,
                [BARGE_IN_REASONS.DIRECT_COMMAND]: 0,
                [BARGE_IN_REASONS.MANUAL_STOP]: 0,
                [BARGE_IN_REASONS.SYSTEM_ABORT]: 0
            },
            totalSavedSpeechMs: 0,
            lastBargeIn: null
        };
    }

    /**
     * Vincula dependencias en tiempo de ejecución (si no se pasaron en el constructor).
     */
    init({ ttsService, wakeWordService, io } = {}) {
        if (ttsService) this.ttsService = ttsService;
        if (wakeWordService) this.wakeWordService = wakeWordService;
        if (io) this.io = io;
    }

    /**
     * Notifica el inicio de una alocución por parte de Jarvis.
     * @param {string} text Texto a sintetizar
     * @param {object} options Metadatos opcionales
     * @returns {string} ID único de la sesión de habla
     */
    notifySpeechStarted(text, options = {}) {
        const id = options.id || `speech_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const cleanText = String(text || '').trim();
        
        // Estimación aproximada: ~150 palabras por minuto (~2.5 palabras por segundo o ~15 caracteres por segundo)
        const estimatedDurationMs = Math.max(1200, Math.round((cleanText.length / 14) * 1000));

        this.currentSpeech = {
            id,
            text: cleanText,
            startTime: Date.now(),
            estimatedDurationMs,
            voice: options.voice || 'default'
        };
        this.isSpeaking = true;
        this.metrics.totalSpeechSessions++;

        this.emit('speech_started', this.currentSpeech);
        return id;
    }

    /**
     * Notifica el fin natural de la alocución de Jarvis (sin interrupción).
     * @param {string} id ID de la sesión
     */
    notifySpeechEnded(id) {
        if (this.currentSpeech && (!id || this.currentSpeech.id === id)) {
            const completedSpeech = { ...this.currentSpeech, endTime: Date.now() };
            this.currentSpeech = null;
            this.isSpeaking = false;
            this.emit('speech_ended', completedSpeech);
        }
    }

    /**
     * Evalúa si un texto coincide con una intención de interrupción por palabra clave.
     * @param {string} text
     * @returns {boolean}
     */
    isInterruptKeyword(text) {
        if (!text) return false;
        const normalized = String(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();

        // Chequear patrones con y sin tildes
        const rawText = String(text).toLowerCase().trim();
        return KEYWORD_INTERRUPT_PATTERNS.some(p => p.test(rawText) || p.test(normalized));
    }

    /**
     * Ejecuta el corte inmediato de habla (Barge-in).
     *
     * @param {string} reason Razón de la interrupción (BARGE_IN_REASONS)
     * @param {object} metadata Información adicional (texto detectado, confianza, timestamp)
     * @returns {object} Detalle del corte ejecutado
     */
    interrupt(reason = BARGE_IN_REASONS.KEYWORD, metadata = {}) {
        const interruptTimestamp = Date.now();
        const activeSpeech = this.currentSpeech;
        let savedMs = 0;
        let elapsedMs = 0;

        // 1. Detener el proceso físico de TTS (< 50ms)
        let ttsStopped = false;
        if (this.ttsService && typeof this.ttsService.stop === 'function') {
            try {
                ttsStopped = this.ttsService.stop();
            } catch (err) {
                console.error('[BargeInService] Error al detener ttsService:', err);
            }
        }

        // 2. Calcular métricas de tiempo ahorrado si estaba hablando
        if (activeSpeech) {
            elapsedMs = interruptTimestamp - activeSpeech.startTime;
            savedMs = Math.max(0, activeSpeech.estimatedDurationMs - elapsedMs);
            this.metrics.totalSavedSpeechMs += savedMs;
        }

        // 3. Actualizar estado
        this.currentSpeech = null;
        this.isSpeaking = false;
        this.metrics.totalBargeIns++;
        if (this.metrics.interruptionsByReason[reason] !== undefined) {
            this.metrics.interruptionsByReason[reason]++;
        } else {
            this.metrics.interruptionsByReason[BARGE_IN_REASONS.SYSTEM_ABORT]++;
        }

        const bargeInEvent = {
            id: `barge_${interruptTimestamp}`,
            timestamp: interruptTimestamp,
            reason,
            metadata,
            activeSpeechCut: !!activeSpeech,
            ttsStopped,
            elapsedMs,
            savedMs
        };

        this.metrics.lastBargeIn = bargeInEvent;

        // 4. Notificar vía WebSockets al Frontend para silenciar animaciones u ondas
        if (this.io) {
            try {
                this.io.emit('jarvis:barge_in', {
                    reason,
                    timestamp: interruptTimestamp,
                    metadata
                });
            } catch (wsErr) {
                console.warn('[BargeInService] Error notificando WebSockets:', wsErr.message);
            }
        }

        // 5. Notificar a wakeWordService para mantener activo el canal de escucha
        // Si el usuario interrumpió, no queremos que Jarvis se duerma, sino que reciba la nueva orden
        if (this.wakeWordService && typeof this.wakeWordService.forceListening === 'function') {
            this.wakeWordService.forceListening();
        }

        // 6. Emitir evento interno de Node
        this.emit('barge_in', bargeInEvent);

        return {
            interrupted: true,
            reason,
            savedMs,
            ttsStopped
        };
    }

    /**
     * Devuelve el estado actual de reproducción y capacidad de interrupción.
     */
    getStatus() {
        return {
            isSpeaking: this.isSpeaking,
            currentSpeech: this.currentSpeech ? {
                id: this.currentSpeech.id,
                elapsedMs: Date.now() - this.currentSpeech.startTime,
                estimatedDurationMs: this.currentSpeech.estimatedDurationMs,
                textSnippet: this.currentSpeech.text.substring(0, 50)
            } : null,
            totalBargeIns: this.metrics.totalBargeIns,
            lastBargeIn: this.metrics.lastBargeIn
        };
    }

    /**
     * Obtiene métricas de rendimiento y ahorro del sistema.
     */
    getMetrics() {
        return {
            ...this.metrics,
            isSpeaking: this.isSpeaking,
            savedSpeechSeconds: Math.round(this.metrics.totalSavedSpeechMs / 1000)
        };
    }

    /**
     * Reinicia las métricas para pruebas unitarias.
     */
    resetMetrics() {
        this.metrics = {
            totalSpeechSessions: 0,
            totalBargeIns: 0,
            interruptionsByReason: {
                [BARGE_IN_REASONS.KEYWORD]: 0,
                [BARGE_IN_REASONS.ACOUSTIC_VAD]: 0,
                [BARGE_IN_REASONS.DIRECT_COMMAND]: 0,
                [BARGE_IN_REASONS.MANUAL_STOP]: 0,
                [BARGE_IN_REASONS.SYSTEM_ABORT]: 0
            },
            totalSavedSpeechMs: 0,
            lastBargeIn: null
        };
    }

    /**
     * Formatea una respuesta de salida en canales diferenciados (Voz/TTS, Pantalla, Auditoría).
     */
    formatResponse(rawText, metadata = {}) {
        const multiChannelFormatter = require('./ai/multiChannelFormatter');
        return multiChannelFormatter.formatAll(rawText, metadata);
    }
}

const bargeInService = new BargeInService();
module.exports = bargeInService;
module.exports.BargeInService = BargeInService;
module.exports.BARGE_IN_REASONS = BARGE_IN_REASONS;
