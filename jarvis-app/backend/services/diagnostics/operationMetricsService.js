/**
 * Operation Metrics & Profiling Service for Jarvis (Ítem 32)
 * Telemetría granular por etapas (intent_detection, memory_search, llm_ttft, llm_generation, tool_execution).
 * Registra success/failure rates, reintentos, errores de tools, tokens y VRAM en SQLite.
 * Provee un motor de auto-diagnóstico de cuellos de botella ("La memoria está provocando 300 ms").
 */

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const databaseService = require('../persistence/databaseService');

class TraceCollector {
    constructor(operationType = 'turn', metadata = {}, metricsService = null) {
        this.id = `op_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        this.traceId = metadata.traceId || `trace_${crypto.randomUUID()}`;
        this.operationType = operationType;
        this.metadata = { ...metadata };
        this.metricsService = metricsService;

        this.stages = {
            intent_detection_ms: 0,
            memory_search_ms: 0,
            llm_ttft_ms: 0,
            llm_generation_ms: 0,
            tool_execution_ms: 0
        };

        this.tokens = { prompt: 0, completion: 0, total: 0 };
        this.vramUsedMb = 0;
        this.retries = 0;
        this.toolErrors = 0;
        this.modelName = null;
        this.status = 'SUCCESS';
        this.errorMessage = null;

        this.startTime = performance.now();
        this.createdAt = new Date().toISOString();
        this.isFinished = false;
    }

    /**
     * Registra manualmente la duración de una etapa específica en milisegundos.
     */
    recordStage(stageName, durationMs) {
        const key = stageName.endsWith('_ms') ? stageName : `${stageName}_ms`;
        this.stages[key] = Math.round(Number(durationMs) || 0);
        return this;
    }

    /**
     * Mide automáticamente el tiempo de ejecución de una función síncrona o asíncrona.
     */
    async timeStage(stageName, fn) {
        const t0 = performance.now();
        try {
            const result = await fn();
            const elapsed = Math.round(performance.now() - t0);
            this.recordStage(stageName, elapsed);
            return result;
        } catch (err) {
            const elapsed = Math.round(performance.now() - t0);
            this.recordStage(stageName, elapsed);
            throw err;
        }
    }

    setTokens({ prompt = 0, completion = 0, total = null } = {}) {
        this.tokens.prompt = Number(prompt) || 0;
        this.tokens.completion = Number(completion) || 0;
        this.tokens.total = total !== null ? Number(total) : (this.tokens.prompt + this.tokens.completion);
        return this;
    }

    setVram(vramMb) {
        this.vramUsedMb = parseFloat(vramMb) || 0;
        return this;
    }

    recordRetry() {
        this.retries++;
        return this;
    }

    recordToolError(err = null) {
        this.toolErrors++;
        if (err && !this.errorMessage) {
            this.errorMessage = typeof err === 'string' ? err : err.message;
        }
        return this;
    }

    setModel(name) {
        if (name) this.modelName = name;
        return this;
    }

    /**
     * Finaliza la traza, calcula el tiempo total y la persiste en SQLite.
     */
    finish({ status = null, error = null, modelName = null, metadata = {} } = {}) {
        if (this.isFinished) return this.toObject();
        this.isFinished = true;

        if (status) this.status = status;
        if (error) {
            this.status = 'FAILED';
            this.errorMessage = typeof error === 'string' ? error : error.message;
        }
        if (modelName) this.modelName = modelName;
        Object.assign(this.metadata, metadata);

        const totalDuration = Math.round(performance.now() - this.startTime);

        const metricRecord = {
            id: this.id,
            trace_id: this.traceId,
            operation_type: this.operationType,
            status: this.status,
            intent_detection_ms: this.stages.intent_detection_ms,
            memory_search_ms: this.stages.memory_search_ms,
            llm_ttft_ms: this.stages.llm_ttft_ms,
            llm_generation_ms: this.stages.llm_generation_ms,
            tool_execution_ms: this.stages.tool_execution_ms,
            total_duration_ms: totalDuration,
            tokens_prompt: this.tokens.prompt,
            tokens_completion: this.tokens.completion,
            tokens_total: this.tokens.total,
            vram_used_mb: this.vramUsedMb,
            retries: this.retries,
            tool_errors: this.toolErrors,
            error_message: this.errorMessage,
            model_name: this.modelName,
            metadata: this.metadata,
            created_at: this.createdAt
        };

        // Persistir en SQLite
        try {
            databaseService.saveOperationMetric(metricRecord);
        } catch (dbErr) {
            console.error('[OperationMetrics] Error guardando métrica en BD:', dbErr.message);
        }

        // Notificar al servicio central
        if (this.metricsService) {
            this.metricsService._notifyTraceFinished(metricRecord);
        }

        return metricRecord;
    }

    toObject() {
        return {
            id: this.id,
            traceId: this.traceId,
            operationType: this.operationType,
            status: this.status,
            stages: { ...this.stages },
            tokens: { ...this.tokens },
            vramUsedMb: this.vramUsedMb,
            retries: this.retries,
            toolErrors: this.toolErrors,
            errorMessage: this.errorMessage,
            modelName: this.modelName,
            metadata: this.metadata,
            createdAt: this.createdAt
        };
    }
}

class OperationMetricsService {
    constructor() {
        this.recentTraces = [];
        this.maxMemoryTraces = 100;
        this.thresholds = {
            memorySearchWarningMs: 150,
            llmGenerationWarningMs: 2000,
            intentDetectionWarningMs: 80,
            toolExecutionWarningMs: 500,
            errorRateWarningPercent: 8
        };
    }

    /**
     * Inicia una nueva traza para un turno o llamada de herramienta.
     */
    startTrace(operationType = 'turn', metadata = {}) {
        return new TraceCollector(operationType, metadata, this);
    }

    _notifyTraceFinished(record) {
        this.recentTraces.unshift(record);
        if (this.recentTraces.length > this.maxMemoryTraces) {
            this.recentTraces.pop();
        }
    }

    /**
     * Guarda directamente un registro de métricas completo.
     */
    recordDirectMetric(metricData) {
        const id = metricData.id || `op_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const record = {
            id,
            trace_id: metricData.trace_id || id,
            operation_type: metricData.operation_type || 'direct',
            status: metricData.status || 'SUCCESS',
            intent_detection_ms: Number(metricData.intent_detection_ms) || 0,
            memory_search_ms: Number(metricData.memory_search_ms) || 0,
            llm_ttft_ms: Number(metricData.llm_ttft_ms) || 0,
            llm_generation_ms: Number(metricData.llm_generation_ms) || 0,
            tool_execution_ms: Number(metricData.tool_execution_ms) || 0,
            total_duration_ms: Number(metricData.total_duration_ms) || 0,
            tokens_prompt: Number(metricData.tokens_prompt) || 0,
            tokens_completion: Number(metricData.tokens_completion) || 0,
            tokens_total: Number(metricData.tokens_total) || 0,
            vram_used_mb: Number(metricData.vram_used_mb) || 0,
            retries: Number(metricData.retries) || 0,
            tool_errors: Number(metricData.tool_errors) || 0,
            error_message: metricData.error_message || null,
            model_name: metricData.model_name || null,
            metadata: metricData.metadata || {},
            created_at: metricData.created_at || new Date().toISOString()
        };

        databaseService.saveOperationMetric(record);
        this._notifyTraceFinished(record);
        return record;
    }

    /**
     * Consulta el resumen estadístico de métricas en SQLite.
     */
    getSummary(timeframeHours = 24) {
        return databaseService.getMetricsSummary(timeframeHours);
    }

    /**
     * Obtiene trazas recientes desde SQLite.
     */
    getRecentTraces(limit = 20, filter = {}) {
        return databaseService.getOperationMetrics({ limit, ...filter });
    }

    /**
     * Motor de Auto-Diagnóstico de Cuellos de Botella.
     * Analiza las etapas y genera diagnósticos comprensibles en lenguaje natural.
     * Ej: "La memoria está provocando 300 ms.", "Este modelo tarda demasiado."
     */
    diagnoseBottlenecks(summaryOrTraces = null) {
        const summary = summaryOrTraces?.stagesAvgMs
            ? summaryOrTraces
            : this.getSummary(24);

        const findings = [];
        const stages = summary.stagesAvgMs || {};

        // 1. Diagnóstico de Memoria
        if (stages.memory_search > this.thresholds.memorySearchWarningMs) {
            findings.push({
                component: 'memory',
                severity: 'WARNING',
                durationMs: stages.memory_search,
                message: `La memoria está provocando ${stages.memory_search} ms (umbral recomendado: <${this.thresholds.memorySearchWarningMs} ms).`
            });
        }

        // 2. Diagnóstico de Generación LLM
        if (stages.llm_generation > this.thresholds.llmGenerationWarningMs) {
            findings.push({
                component: 'llm_generation',
                severity: 'WARNING',
                durationMs: stages.llm_generation,
                message: `El modelo de IA está tardando ${(stages.llm_generation / 1000).toFixed(1)} s en generar respuestas (umbral recomendado: <${(this.thresholds.llmGenerationWarningMs / 1000).toFixed(1)} s).`
            });
        }

        // 3. Diagnóstico de TTFT (Time to First Token)
        if (stages.llm_ttft > 800) {
            findings.push({
                component: 'llm_ttft',
                severity: 'WARNING',
                durationMs: stages.llm_ttft,
                message: `Tiempo de respuesta inicial del LLM elevado (${stages.llm_ttft} ms hasta el primer token).`
            });
        }

        // 4. Diagnóstico de Detección de Intención
        if (stages.intent_detection > this.thresholds.intentDetectionWarningMs) {
            findings.push({
                component: 'intent_detection',
                severity: 'WARNING',
                durationMs: stages.intent_detection,
                message: `La detección de intención está lenta (${stages.intent_detection} ms).`
            });
        }

        // 5. Diagnóstico de Herramientas
        if (stages.tool_execution > this.thresholds.toolExecutionWarningMs) {
            findings.push({
                component: 'tool_execution',
                severity: 'INFO',
                durationMs: stages.tool_execution,
                message: `La ejecución de herramientas promedia ${stages.tool_execution} ms.`
            });
        }

        // 6. Diagnóstico de Tasa de Fallos y Errores
        if (summary.failureRate > this.thresholds.errorRateWarningPercent) {
            findings.push({
                component: 'reliability',
                severity: 'CRITICAL',
                failureRate: summary.failureRate,
                message: `Tasa de fallos elevada (${summary.failureRate}% de operaciones con error).`
            });
        }

        // 7. Diagnóstico de Fallos en Herramientas
        if (summary.totalToolErrors > 0 && summary.totalOperations > 0) {
            const toolErrorRate = (summary.totalToolErrors / summary.totalOperations) * 100;
            if (toolErrorRate > 10) {
                findings.push({
                    component: 'tool_errors',
                    severity: 'WARNING',
                    toolErrors: summary.totalToolErrors,
                    message: `Se registraron ${summary.totalToolErrors} errores en herramientas (${toolErrorRate.toFixed(1)}% de las operaciones).`
                });
            }
        }

        // Estado general
        const isHealthy = findings.filter(f => f.severity === 'WARNING' || f.severity === 'CRITICAL').length === 0;

        return {
            healthy: isHealthy,
            status: isHealthy ? 'OPTIMAL' : 'BOTTLENECKS_DETECTED',
            totalOperationsEvaluated: summary.totalOperations,
            findings,
            primaryBottleneck: findings.length > 0 ? findings[0].message : 'Sin cuellos de botella detectados.',
            summaryText: isHealthy
                ? 'Rendimiento óptimo: todas las etapas operan dentro de los umbrales recomendados.'
                : findings.map(f => f.message).join(' ')
        };
    }
}

const operationMetricsService = new OperationMetricsService();
module.exports = operationMetricsService;
