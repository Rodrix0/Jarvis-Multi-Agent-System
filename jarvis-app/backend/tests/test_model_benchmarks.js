/**
 * Model Benchmarks & Hardware Profiling Test Suite (JARVIS 3.1 Hardening - Phase 8)
 *
 * Evalúa las métricas de rendimiento y adherencia a contratos de los modelos:
 * 1. Detección dinámica y fallback inteligente (getAvailableModels).
 * 2. Medición / Perfilado de métricas clave:
 *    - TTFT (Time To First Token) en ms.
 *    - Tokens / segundo (Throughput de inferencia).
 *    - Adherencia a esquemas estructurados (JSON Schema compliance).
 *    - Estimación de huella de VRAM para prevenir Out-Of-Memory.
 * 3. Almacenamiento auditable de benchmarks en SQLite (operation_metrics).
 * 4. Integración con ResourceLockManager para control de concurrencia VRAM.
 */

const assert = require('assert');
const modelRouterService = require('../services/ai/modelRouterService');
const structuredOutputService = require('../services/ai/structuredOutputService');
const databaseService = require('../services/persistence/databaseService');
const resourceLockManager = require('../services/core/resourceLockManager');

const benchmarkResults = [];

function recordBenchmarkResult(modelName, metricSummary, compliance, status) {
    benchmarkResults.push({
        'Modelo': modelName,
        'Métricas de Inferencia': metricSummary,
        'Adherencia a Esquema': compliance,
        'Estado': status
    });
    const icon = status === 'OPTIMAL' ? '⭐ [OPTIMAL]' : '⚡ [ACCEPTABLE]';
    console.log(`  ${icon} ${modelName} -> ${metricSummary} | Schema: ${compliance}`);
}

async function runModelBenchmarksSuite() {
    console.log('\n===============================================================');
    console.log('🔬 INICIANDO SUITE DE BENCHMARKS DE MODELOS & VRAM (JARVIS 3.1)');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // TEST 1: Descubrimiento Dinámico de Modelos
    // -------------------------------------------------------------
    console.log('--- TEST 1: Descubrimiento Dinámico de Modelos y Taxonomía ---');
    const available = await modelRouterService.getAvailableModels();
    assert.ok(Array.isArray(available) && available.length > 0, 'Debe descubrir al menos un modelo o fallbacks');
    console.log(`  📦 Modelos accesibles / registrados: ${available.join(', ')}`);

    // -------------------------------------------------------------
    // TEST 2: Perfilado de Modelos por Capacidad y Benchmarks
    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // TEST 2: Perfilado Real de Modelos con Multi-Muestras y Telemetría VRAM
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Ejecución de Benchmarks Reales de Rendimiento (TTFT, TPS, VRAM Real) ---');
    
    // Modelos a evaluar representativos de cada rango de tamaño
    const targetModels = [
        'qwen2.5:3b',
        'hermes3:latest',
        'qwen2.5-coder:7b'
    ];

    for (const modelName of targetModels) {
        const t0 = performance.now();
        // Ejecutar 2 muestras reales por modelo
        const profile = await modelRouterService.benchmarkModel(modelName, { force: true, real: true, runs: 2, live: true });
        const benchDuration = performance.now() - t0;

        assert.ok(profile, `Debe generar perfil para ${modelName}`);
        assert.ok(profile.ttftMs >= 0, 'TTFT debe ser un número válido >= 0');
        assert.ok(profile.tokensPerSecond > 0, 'Tokens/s debe ser > 0');
        assert.ok(profile.schemaCompliance >= 0.8, 'Cumplimiento de esquema debe ser >= 80%');

        const vramDisplay = profile.vramRealUsedMb !== null
            ? `VRAM Real: ${profile.vramRealUsedMb}MB`
            : `VRAM Est: ${profile.vramEstimateMb}MB`;

        // Registrar métrica en la base de datos (operation_metrics)
        const metricId = `metric_bench_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        databaseService.saveOperationMetric({
            id: metricId,
            trace_id: `trace_bench_${modelName.replace(/[:.]/g, '_')}`,
            operation_type: 'model_benchmark',
            status: 'SUCCESS',
            llm_ttft_ms: profile.ttftMs,
            llm_generation_ms: Math.round(1000 / Math.max(1, profile.tokensPerSecond)),
            total_duration_ms: Math.round(benchDuration),
            tokens_total: 50,
            vram_used_mb: profile.vramRealUsedMb || profile.vramEstimateMb,
            model_name: modelName,
            metadata_json: JSON.stringify({
                schemaCompliance: profile.schemaCompliance,
                tokensPerSecond: profile.tokensPerSecond,
                isRealExecution: profile.isRealExecution,
                samplesCount: profile.samplesCount
            })
        });

        const status = profile.schemaCompliance >= 0.9 && profile.tokensPerSecond >= 20 ? 'OPTIMAL' : 'ACCEPTABLE';
        recordBenchmarkResult(
            modelName,
            `TTFT: ${profile.ttftMs}ms (P95: ${profile.ttftP95Ms}ms) | TPS: ${profile.tokensPerSecond} t/s | ${vramDisplay}`,
            `${(profile.schemaCompliance * 100).toFixed(0)}%`,
            status
        );
    }

    // -------------------------------------------------------------
    // TEST 2B: Ranking Separado por Categoría Canónica
    // -------------------------------------------------------------
    console.log('\n--- TEST 2B: Ranking y Compatibilidad por Categoría Canónica ---');
    const rankings = await modelRouterService.benchmarkAllModelsByCategory(targetModels, { runs: 1, live: true });
    
    assert.ok(rankings.FAST_INTENT, 'Debe incluir categoría FAST_INTENT');
    assert.ok(rankings.GENERAL_CHAT, 'Debe incluir categoría GENERAL_CHAT');
    assert.ok(rankings.CODING_FAST, 'Debe incluir categoría CODING_FAST');
    assert.ok(rankings.CODING_DEEP, 'Debe incluir categoría CODING_DEEP');
    assert.ok(rankings.REASONING, 'Debe incluir categoría REASONING');
    assert.ok(rankings.MEMORY_EXTRACTION, 'Debe incluir categoría MEMORY_EXTRACTION');
    assert.ok(rankings.VISION, 'Debe incluir categoría VISION');

    // Comprobar que en VISION los modelos de texto quedan NOT_AVAILABLE
    const textModelVision = rankings.VISION.find(m => m.model === 'qwen2.5:3b');
    assert.ok(textModelVision, 'qwen2.5:3b debe figurar en VISION');
    assert.strictEqual(textModelVision.status, 'NOT_AVAILABLE', 'qwen2.5:3b no soporta visión -> NOT_AVAILABLE');
    console.log('  🛡️ Incompatibilidad detectada correctamente: qwen2.5:3b -> VISION = NOT_AVAILABLE');

    // Imprimir resumen de líderes por categoría
    console.log('\n  🏆 Líderes por Categoría:');
    for (const [cat, items] of Object.entries(rankings)) {
        const top = items.find(i => i.status === 'EVALUATED');
        if (top) {
            console.log(`     - [${cat}]: ${top.model} (${top.tokensPerSecond} t/s, TTFT: ${top.ttftMs}ms)`);
        } else {
            console.log(`     - [${cat}]: Sin modelo compatible instalado (NOT_AVAILABLE)`);
        }
    }

    // -------------------------------------------------------------
    // TEST 3: Verificación de Adherencia Estricta con StructuredOutputService
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Verificación de Contratos y Esquemas con Auto-Reparación ---');
    const sampleIntent = {
        intent: 'device.control',
        target: 'living_room_tv',
        confidence: 0.95,
        risk: 'LOW',
        parameters: { action: 'power_on' }
    };
    const validIntent = structuredOutputService.validate(sampleIntent, 'Intent');
    assert.strictEqual(validIntent.ok, true, 'Intent estructurado válido debe pasar sin reparaciones');
    console.log('  🛡️ Validación de esquema Intent: 100% válido.');

    // Caso inválido para comprobar rechazo y detección de schema failure
    const invalidIntent = {
        intent: 'invalid.action',
        risk: 'NON_EXISTENT_RISK' // fuera del enum
    };
    const invalidRes = structuredOutputService.validate(invalidIntent, 'Intent');
    assert.strictEqual(invalidRes.ok, false, 'Valor inválido de esquema debe ser detectado inmediatamente');
    console.log('  🛡️ Detección de desviación de esquema: detectado y bloqueado correctamente.');

    // -------------------------------------------------------------
    // TEST 4: Coordinación de Locks de VRAM (Prevención de OOM)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Prevención de OOM y Coordinación de Locks de VRAM ---');
    const lockA = modelRouterService.acquireInferenceLock('bench_exec_1', 'qwen2.5:3b', 5000);
    assert.strictEqual(lockA.acquired, true, 'El primer lock de inferencia VRAM debe ser concedido');

    // Intentar segundo lock con la misma key exclusiva debe ser regulado o bloqueado
    const lockB = modelRouterService.acquireInferenceLock('bench_exec_2', 'qwen2.5-coder:7b', 5000);
    assert.strictEqual(lockB.acquired, false, 'El lock concurrente debe ser retenido para prevenir sobrecarga de VRAM');
    console.log(`  🛡️ Concurrencia de VRAM prevenida: ${lockB.reason}`);

    // Liberar lock A
    lockA.release();
    const lockC = modelRouterService.acquireInferenceLock('bench_exec_3', 'qwen2.5-coder:7b', 5000);
    assert.strictEqual(lockC.acquired, true, 'Tras liberar el lock, la nueva inferencia debe ser admitida');
    lockC.release();
    console.log('  🛡️ Ciclo completo de retención y liberación de VRAM validado.');

    console.log('\n===============================================================');
    console.log('📊  REPORTE CONSOLIDADO DE BENCHMARKS DE MODELOS (JARVIS 3.1)');
    console.log('===============================================================');
    console.table(benchmarkResults);
    console.log('🎉 SUITE DE BENCHMARKS Y ADHERENCIA A ESQUEMAS COMPLETADA CON ÉXITO.');
}

if (require.main === module) {
    runModelBenchmarksSuite().catch(err => {
        console.error('Error fatal en suite de benchmarks:', err);
        process.exit(1);
    });
}

module.exports = { runModelBenchmarksSuite };
