/**
 * Suite de Pruebas Automatizadas - Ítem 32: Métricas por Operación
 * Verifica recolección de etapas (intent, memory, ttft, generation, tool),
 * persistencia transaccional en SQLite (Migración v10), cálculo de tasas de éxito/fallo,
 * reintentos, tokens, VRAM, y motor de auto-diagnóstico de cuellos de botella.
 */

const assert = require('assert');
const operationMetricsService = require('../services/diagnostics/operationMetricsService');
const databaseService = require('../services/persistence/databaseService');
const jarvisActionService = require('../services/jarvisActionService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runTests() {
    console.log('===============================================================');
    console.log('⏱️  INICIANDO SUITE DE PRUEBAS: ÍTEM 32 - MÉTRICAS POR OPERACIÓN');
    console.log('===============================================================\n');

    // 1. Creación de traza y registro manual de etapas
    test('1. TraceCollector registra duraciones individuales por etapa', () => {
        const trace = operationMetricsService.startTrace('test_turn', { testCase: 1 });
        trace.recordStage('intent_detection', 8);
        trace.recordStage('memory_search', 14);
        trace.recordStage('llm_ttft', 410);
        trace.recordStage('llm_generation', 1200);
        trace.recordStage('tool_execution', 90);

        const obj = trace.toObject();
        assert.strictEqual(obj.stages.intent_detection_ms, 8);
        assert.strictEqual(obj.stages.memory_search_ms, 14);
        assert.strictEqual(obj.stages.llm_ttft_ms, 410);
        assert.strictEqual(obj.stages.llm_generation_ms, 1200);
        assert.strictEqual(obj.stages.tool_execution_ms, 90);
    });

    // 2. Cronometrado automático con timeStage
    await testAsync('2. timeStage mide automáticamente la latencia de funciones asíncronas', async () => {
        const trace = operationMetricsService.startTrace('test_timer');
        const res = await trace.timeStage('intent_detection', async () => {
            await new Promise(r => setTimeout(r, 25));
            return 'resolved_intent';
        });

        assert.strictEqual(res, 'resolved_intent');
        const obj = trace.toObject();
        assert.ok(obj.stages.intent_detection_ms >= 20, `Debe haber medido al menos 20ms, fue: ${obj.stages.intent_detection_ms}`);
    });

    // 3. Registro de tokens, VRAM, reintentos y errores de herramientas
    test('3. Registro de tokens, VRAM, retries y tool errors', () => {
        const trace = operationMetricsService.startTrace('resource_test');
        trace.setTokens({ prompt: 150, completion: 80 });
        trace.setVram(5324.5);
        trace.recordRetry();
        trace.recordRetry();
        trace.recordToolError(new Error('window_not_found'));

        const obj = trace.toObject();
        assert.strictEqual(obj.tokens.prompt, 150);
        assert.strictEqual(obj.tokens.completion, 80);
        assert.strictEqual(obj.tokens.total, 230);
        assert.strictEqual(obj.vramUsedMb, 5324.5);
        assert.strictEqual(obj.retries, 2);
        assert.strictEqual(obj.toolErrors, 1);
        assert.strictEqual(obj.errorMessage, 'window_not_found');
    });

    // 4. Persistencia en SQLite al llamar a finish()
    await testAsync('4. finish() persiste la traza en la tabla operation_metrics de SQLite', async () => {
        const trace = operationMetricsService.startTrace('persistence_test', { tag: 'db_verify' });
        trace.recordStage('intent_detection', 12);
        trace.recordStage('memory_search', 18);
        trace.recordStage('llm_generation', 850);
        trace.setModel('qwen2.5:3b');
        const record = trace.finish({ status: 'SUCCESS' });

        assert.ok(record.id);
        assert.strictEqual(record.status, 'SUCCESS');
        assert.strictEqual(record.model_name, 'qwen2.5:3b');
        assert.ok(record.total_duration_ms >= 0);

        // Verificar lectura directa desde la base de datos
        const row = databaseService.db.prepare('SELECT * FROM operation_metrics WHERE id = ?').get(record.id);
        assert.ok(row, 'La fila debe existir en SQLite');
        assert.strictEqual(row.intent_detection_ms, 12);
        assert.strictEqual(row.memory_search_ms, 18);
        assert.strictEqual(row.llm_generation_ms, 850);
        assert.strictEqual(row.model_name, 'qwen2.5:3b');
    });

    // 5. getRecentTraces() recupera trazas persistidas
    test('5. getRecentTraces() recupera registros con metadatos deserializados', () => {
        const traces = operationMetricsService.getRecentTraces(5);
        assert.ok(Array.isArray(traces));
        assert.ok(traces.length > 0);
        const latest = traces[0];
        assert.ok(latest.id);
        assert.strictEqual(typeof latest.metadata, 'object');
    });

    // 6. Resumen agregado y cálculo de Success/Failure Rate
    test('6. getSummary() calcula totales y promedios por etapa', () => {
        // Insertar un registro exitoso y uno fallido controlados
        operationMetricsService.recordDirectMetric({
            operation_type: 'controlled_test',
            status: 'SUCCESS',
            intent_detection_ms: 10,
            memory_search_ms: 20,
            llm_generation_ms: 1000,
            tokens_total: 100,
            retries: 0,
            tool_errors: 0
        });

        operationMetricsService.recordDirectMetric({
            operation_type: 'controlled_test',
            status: 'FAILED',
            intent_detection_ms: 15,
            memory_search_ms: 25,
            llm_generation_ms: 1200,
            tokens_total: 50,
            retries: 1,
            tool_errors: 1,
            error_message: 'Service timeout'
        });

        const summary = operationMetricsService.getSummary(1);
        assert.ok(summary.totalOperations >= 2);
        assert.ok(summary.successfulOperations >= 1);
        assert.ok(summary.failedOperations >= 1);
        assert.ok(summary.successRate > 0 && summary.successRate <= 100);
        assert.ok(summary.failureRate >= 0 && summary.failureRate <= 100);
        assert.ok(summary.stagesAvgMs.intent_detection > 0);
        assert.ok(summary.stagesAvgMs.memory_search > 0);
    });

    // 7. Auto-Diagnóstico: Detección de anomalía en memoria ("La memoria está provocando 320 ms")
    test('7. diagnoseBottlenecks detecta cuello de botella en búsqueda de memoria', () => {
        const mockSummary = {
            totalOperations: 10,
            successRate: 100,
            failureRate: 0,
            totalToolErrors: 0,
            stagesAvgMs: {
                intent_detection: 12,
                memory_search: 320, // Provocando 320ms (> 150ms)
                llm_ttft: 400,
                llm_generation: 1100,
                tool_execution: 80
            }
        };

        const diag = operationMetricsService.diagnoseBottlenecks(mockSummary);
        assert.strictEqual(diag.healthy, false);
        assert.strictEqual(diag.status, 'BOTTLENECKS_DETECTED');
        assert.ok(diag.primaryBottleneck.includes('La memoria está provocando 320 ms'));
    });

    // 8. Auto-Diagnóstico: Detección de lentitud de modelo LLM ("El modelo está tardando demasiado")
    test('8. diagnoseBottlenecks detecta generación excesiva en modelo LLM', () => {
        const mockSummary = {
            totalOperations: 10,
            successRate: 100,
            failureRate: 0,
            totalToolErrors: 0,
            stagesAvgMs: {
                intent_detection: 10,
                memory_search: 25,
                llm_ttft: 350,
                llm_generation: 3400, // Tardando 3.4s (> 2.0s)
                tool_execution: 50
            }
        };

        const diag = operationMetricsService.diagnoseBottlenecks(mockSummary);
        assert.strictEqual(diag.healthy, false);
        assert.ok(diag.primaryBottleneck.includes('El modelo de IA está tardando 3.4 s'));
    });

    // 9. Auto-Diagnóstico: Estado óptimo cuando todo está bajo los umbrales
    test('9. diagnoseBottlenecks reporta estado óptimo si las etapas son rápidas', () => {
        const mockSummary = {
            totalOperations: 20,
            successRate: 100,
            failureRate: 0,
            totalToolErrors: 0,
            stagesAvgMs: {
                intent_detection: 8,
                memory_search: 14,
                llm_ttft: 410,
                llm_generation: 1200,
                tool_execution: 90
            }
        };

        const diag = operationMetricsService.diagnoseBottlenecks(mockSummary);
        assert.strictEqual(diag.healthy, true);
        assert.strictEqual(diag.status, 'OPTIMAL');
        assert.ok(diag.summaryText.includes('Rendimiento óptimo'));
    });

    // 10. Integración con el pipeline de ejecución de Jarvis (ActionService.process)
    await testAsync('10. jarvisActionService.process() instrumenta automáticamente la traza completa', async () => {
        const initialCount = databaseService.db.prepare('SELECT COUNT(*) as c FROM operation_metrics').get().c;

        // Ejecutar un turno real en el pipeline
        await jarvisActionService.process('listar dispositivos inteligentes');

        const finalCount = databaseService.db.prepare('SELECT COUNT(*) as c FROM operation_metrics').get().c;
        assert.strictEqual(finalCount, initialCount + 1, 'Debió registrarse una nueva traza de la operación');

        // Consultar la última traza creada
        const recent = operationMetricsService.getRecentTraces(1)[0];
        assert.strictEqual(recent.operation_type, 'turn');
        assert.strictEqual(recent.status, 'SUCCESS');
        assert.ok(recent.total_duration_ms > 0);
        assert.strictEqual(recent.metadata.actionId, 'ha.list-devices');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 32 PASARON EXITOSAMENTE.');
    } else {
        console.error('❌ HUBO FALLOS EN LA SUITE DE MÉTRICAS POR OPERACIÓN.');
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en suite:', err);
    process.exit(1);
});
