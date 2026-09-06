/**
 * structuredLoggerService.js
 * 
 * Ítem 33: Sistema de Logs Estructurados y Motor Forense de Diagnóstico Autónomo para JARVIS.
 * 
 * Proporciona:
 * - Esquema canónico estricto de observabilidad (id, timestamp, level, module, action, result, duration, error, metadata).
 * - Persistencia dual de alta velocidad:
 *    1. Archivos rotativos diarios .jsonl en data/logs/
 *    2. Tabla indexada SQLite (structured_logs) para búsquedas instantáneas y agregaciones.
 * - Wrapper cronometrador asíncrono `time(module, action, fn, metadata)`.
 * - Motor de análisis forense para auto-diagnóstico en lenguaje natural.
 */

const fs = require('fs');
const path = require('path');
const databaseService = require('../persistence/databaseService');

class StructuredLoggerService {
    constructor() {
        this.logsDir = path.join(__dirname, '../../data/logs');
        this.ensureLogDir();
    }

    ensureLogDir() {
        try {
            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
            }
        } catch (err) {
            console.error('[StructuredLogger] Error creando directorio de logs:', err.message);
        }
    }

    getDailyLogFilePath(date = new Date()) {
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logsDir, `jarvis_structured_${dateStr}.jsonl`);
    }

    /**
     * Sanitiza credenciales o datos sensibles de metadata y errores
     */
    sanitize(obj, depth = 0) {
        if (!obj || depth > 4) return obj;
        if (typeof obj !== 'object') return obj;

        const SENSITIVE_KEYS = /token|password|secret|key|authorization|cookie|pass|credential/i;
        const sanitized = Array.isArray(obj) ? [] : {};

        for (const [k, v] of Object.entries(obj)) {
            if (SENSITIVE_KEYS.test(k)) {
                sanitized[k] = '***REDACTED***';
            } else if (v && typeof v === 'object') {
                sanitized[k] = this.sanitize(v, depth + 1);
            } else {
                sanitized[k] = v;
            }
        }
        return sanitized;
    }

    /**
     * Registro base de entrada estructurada
     */
    log({
        id,
        level = 'INFO',
        module = 'core',
        action = 'execute',
        result = 'success',
        duration = 0,
        error = null,
        metadata = {}
    } = {}) {
        const logId = id || `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const timestamp = new Date().toISOString();

        let parsedError = null;
        if (error) {
            if (typeof error === 'string') {
                parsedError = { code: 'generic_error', message: error };
            } else if (error instanceof Error || (typeof error === 'object')) {
                parsedError = {
                    code: error.code || error.name || 'error',
                    message: error.message || String(error),
                    stack: error.stack || null
                };
            }
        }

        const entry = {
            id: logId,
            timestamp,
            level: level.toUpperCase(),
            module,
            action,
            result,
            duration: Math.max(0, Math.round(duration)),
            error: parsedError,
            metadata: this.sanitize(metadata)
        };

        // 1. Escritura en archivo JSONL diario (asíncrona y no bloqueante)
        this.writeToJsonl(entry);

        // 2. Persistencia en base de datos SQLite
        try {
            databaseService.saveStructuredLog(entry);
        } catch (dbErr) {
            console.error('[StructuredLogger] Error persistiendo en SQLite:', dbErr.message);
        }

        return entry;
    }

    writeToJsonl(entry) {
        try {
            const filePath = this.getDailyLogFilePath();
            const line = JSON.stringify(entry) + '\n';
            fs.appendFile(filePath, line, (err) => {
                if (err) {
                    console.error('[StructuredLogger] Error escribiendo a JSONL:', err.message);
                }
            });
        } catch (err) {
            console.error('[StructuredLogger] Error en writeToJsonl:', err.message);
        }
    }

    info(module, action, metadata = {}, duration = 0) {
        return this.log({
            level: 'INFO',
            module,
            action,
            result: 'success',
            duration,
            metadata
        });
    }

    warn(module, action, errorOrMsg, metadata = {}, duration = 0) {
        return this.log({
            level: 'WARN',
            module,
            action,
            result: 'warning',
            duration,
            error: errorOrMsg,
            metadata
        });
    }

    error(module, action, error, metadata = {}, duration = 0) {
        return this.log({
            level: 'ERROR',
            module,
            action,
            result: 'error',
            duration,
            error,
            metadata
        });
    }

    /**
     * Ejecuta una función síncrona o asíncrona, cronometra su duración,
     * captura errores, registra el log estructurado automáticamente y re-lanza el error.
     */
    async time(module, action, fn, metadata = {}) {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.log({
                level: 'INFO',
                module,
                action,
                result: 'success',
                duration,
                metadata
            });
            return result;
        } catch (err) {
            const duration = Date.now() - start;
            this.log({
                level: 'ERROR',
                module,
                action,
                result: 'error',
                duration,
                error: err,
                metadata
            });
            throw err;
        }
    }

    /**
     * Consulta registros estructurados desde SQLite
     */
    query(filter = {}) {
        return databaseService.queryStructuredLogs(filter);
    }

    /**
     * Motor Forense: sintetiza patrones de error en explicaciones comprensibles y accionables
     */
    diagnose(timeframeHours = 24) {
        const errorSummaries = databaseService.getStructuredErrorsSummary(timeframeHours);
        const diagnosticReports = [];
        const recommendations = [];

        if (!errorSummaries || errorSummaries.length === 0) {
            return {
                timeframeHours,
                totalDistinctErrors: 0,
                status: 'HEALTHY',
                diagnosticReports: ['Todos los sistemas y módulos han operado sin errores registrados en este período.'],
                recommendations: ['El sistema opera con normalidad. Ninguna acción requerida.']
            };
        }

        for (const item of errorSummaries) {
            const { module, action, error_code, count, avg_duration, last_seen } = item;
            let explanation = `En las últimas ${timeframeHours}h, '${module}' falló ${count} veces en la acción '${action}' con código '${error_code}' (duración promedio: ${Math.round(avg_duration)} ms).`;
            let rec = `Revisar configuración de ${module}.`;

            // Diagnósticos contextuales por módulo
            if (module.toLowerCase().includes('spotify')) {
                if (error_code === 'window_not_found' || error_code === 'process_not_found') {
                    explanation += ' Causa probable: La aplicación de Spotify no está iniciada o minimizada en segundo plano.';
                    rec = 'Asegurarse de que Spotify esté instalado y abierto antes de enviar comandos multimedia.';
                } else if (error_code === 'track_not_found') {
                    explanation += ' Causa probable: La búsqueda de la pista musical no devolvió coincidencias válidas.';
                    rec = 'Verificar ortografía del artista o canción solicitada.';
                }
            } else if (module.toLowerCase().includes('broadlink') || module.toLowerCase().includes('tv')) {
                explanation += ' Causa probable: El módulo BroadLink perdió conexión WiFi local o la TV no respondió al haz infrarrojo.';
                rec = 'Comprobar que el emisor BroadLink RM4 esté alimentado y en la misma subred que JARVIS.';
            } else if (module.toLowerCase().includes('database') || module.toLowerCase().includes('sqlite')) {
                explanation += ' Causa probable: Bloqueo de concurrencia o archivo de base de datos ocupado por otro proceso.';
                rec = 'Verificar que ningún proceso externo mantenga un bloqueo exclusivo sobre jarvis.db.';
            } else if (module.toLowerCase().includes('whisper') || module.toLowerCase().includes('audio')) {
                explanation += ' Causa probable: Error en el dispositivo de captura de audio o puerto de streaming de voz.';
                rec = 'Comprobar que el micrófono por defecto esté conectado y habilitado en Windows.';
            } else if (module.toLowerCase().includes('ollama') || module.toLowerCase().includes('llm')) {
                explanation += ' Causa probable: Ollama no está respondiendo en el puerto 11434 o agotó el tiempo de inferencia.';
                rec = 'Verificar que el servicio de Ollama esté activo ejecutando `ollama list`.';
            }

            diagnosticReports.push(explanation);
            if (!recommendations.includes(rec)) {
                recommendations.push(rec);
            }
        }

        return {
            timeframeHours,
            totalDistinctErrors: errorSummaries.length,
            status: 'DEGRADED',
            breakdown: errorSummaries,
            diagnosticReports,
            recommendations
        };
    }
}

const structuredLoggerService = new StructuredLoggerService();
module.exports = structuredLoggerService;
