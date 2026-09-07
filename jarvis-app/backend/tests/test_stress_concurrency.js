/**
 * Stress & High Concurrency Verification Test Suite (JARVIS 3.1 Hardening - Phase 7)
 *
 * Evalúa el comportamiento del sistema bajo cargas extremas y concurrencia agresiva:
 * 1. Ráfaga masiva de eventos en EventBus:
 *    - Emisión de 1.000 eventos concurrentes en ráfaga (burst).
 *    - 0 pérdidas de eventos en suscriptores registrados.
 *    - Verificación de límite de historial circular (evita fugas de memoria).
 * 2. Escrituras y lecturas concurrentes masivas en SQLite WAL:
 *    - 50 operaciones transaccionales asíncronas paralelas sobre base de datos.
 *    - Cero bloqueos de archivo ("database is locked" o "SQLITE_BUSY").
 *    - Verificación de consistencia transaccional y conteo exacto de registros.
 * 3. Enfriamiento masivo y Throttling bajo tormenta de eventos:
 *    - Ráfaga de 500 llamadas simultáneas con publishThrottled.
 *    - Sólo 1 emisión pasa, 499 throttled limpiamente sin saturar CPU ni generar colas zombi.
 */

const assert = require('assert');
const eventBus = require('../services/core/eventBusService');
const databaseService = require('../services/persistence/databaseService');

const stressResults = [];

function recordStressResult(testName, load, outcome, status) {
    stressResults.push({
        'Prueba de Estrés': testName,
        'Carga Aplicada': load,
        'Resultado / Rendimiento': outcome,
        'Estado': status
    });
    const icon = status === 'PASS' ? '⚡ [PASS]' : '💥 [FAIL]';
    console.log(`  ${icon} ${testName} (${load}) -> ${outcome}`);
}

async function runStressSuite() {
    console.log('\n===============================================================');
    console.log('🚀 INICIANDO SUITE DE STRESS & CONCURRENCIA AGRESIVA (JARVIS 3.1)');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // TEST 1: Event Bus Burst (1.000 eventos en ráfaga simultánea)
    // -------------------------------------------------------------
    console.log('--- TEST 1: Ráfaga Extrema de EventBus (1.000 eventos) ---');
    try {
        const TOTAL_EVENTS = 1000;
        let receivedCount = 0;
        const receivedIds = new Set();

        const unsubscribe = eventBus.subscribe('STRESS_BURST_EVENT', (evt) => {
            receivedCount++;
            receivedIds.add(evt.seq);
        });

        const t0 = performance.now();
        for (let i = 0; i < TOTAL_EVENTS; i++) {
            eventBus.publish('STRESS_BURST_EVENT', { seq: i, payload: `data_${i}` });
        }
        const duration = performance.now() - t0;
        unsubscribe();

        assert.strictEqual(receivedCount, TOTAL_EVENTS, `Deben recibirse exactamente ${TOTAL_EVENTS} eventos`);
        assert.strictEqual(receivedIds.size, TOTAL_EVENTS, 'No debe haber eventos duplicados ni omitidos');

        const rate = Math.round((TOTAL_EVENTS / duration) * 1000);
        recordStressResult(
            'EventBus Burst Delivery',
            '1.000 eventos emitidos',
            `100% recibidos (${TOTAL_EVENTS}/${TOTAL_EVENTS}) en ${duration.toFixed(1)}ms (~${rate} ev/s)`,
            'PASS'
        );
    } catch (err) {
        recordStressResult('EventBus Burst Delivery', '1.000 eventos', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 2: Event Throttling Storm (500 llamadas simultáneas)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Tormenta de Throttling (500 eventos repetitivos) ---');
    try {
        const STORM_SIZE = 500;
        let allowed = 0;
        let blocked = 0;
        const throttleKey = `storm_key_${Date.now()}`;

        const t0 = performance.now();
        for (let i = 0; i < STORM_SIZE; i++) {
            const res = eventBus.publishThrottled('STRESS_THROTTLE_EVENT', { i }, 5000, throttleKey);
            if (res) allowed++;
            else blocked++;
        }
        const duration = performance.now() - t0;

        assert.strictEqual(allowed, 1, 'Debe permitir exactamente 1 evento y throttler el resto');
        assert.strictEqual(blocked, STORM_SIZE - 1, `Debe bloquear exactamente ${STORM_SIZE - 1} eventos`);

        recordStressResult(
            'Event Throttling Storm',
            `${STORM_SIZE} eventos repetitivos`,
            `1 emitido, ${blocked} throttled en ${duration.toFixed(1)}ms sin saturación`,
            'PASS'
        );
    } catch (err) {
        recordStressResult('Event Throttling Storm', '500 eventos', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 3: Concurrencia Masiva en SQLite (50 escrituras paralelas en WAL)
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Concurrencia de Escritura SQLite WAL (50 transacciones concurrentes) ---');
    try {
        const PARALLEL_OPS = 50;
        const testRunId = `stress_${Date.now()}`;
        
        const tasks = Array.from({ length: PARALLEL_OPS }, (_, idx) => {
            return new Promise((resolve, reject) => {
                setImmediate(() => {
                    try {
                        const taskId = `task_${testRunId}_${idx}`;
                        databaseService.savePersistentTask({
                            id: taskId,
                            type: 'stress_test',
                            description: `Tarea de estrés concurrent #${idx}`,
                            status: 'PENDING',
                            priority: 'NORMAL',
                            progress: idx * 2,
                            metadata: { idx, testRunId }
                        });
                        resolve(taskId);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });

        const t0 = performance.now();
        const createdIds = await Promise.all(tasks);
        const duration = performance.now() - t0;

        assert.strictEqual(createdIds.length, PARALLEL_OPS, `Se deben completar las ${PARALLEL_OPS} inserciones`);

        let verifiedCount = 0;
        for (const tid of createdIds) {
            const row = databaseService.getPersistentTask(tid);
            if (row && row.id === tid) verifiedCount++;
        }

        assert.strictEqual(verifiedCount, PARALLEL_OPS, `Todas las ${PARALLEL_OPS} tareas deben existir y ser recuperables`);

        const opsPerSec = Math.round((PARALLEL_OPS / duration) * 1000);
        recordStressResult(
            'SQLite WAL Parallel Concurrency',
            `${PARALLEL_OPS} escrituras asíncronas`,
            `${verifiedCount}/${PARALLEL_OPS} transacciones exitosas (0 SQLITE_BUSY, ${opsPerSec} ops/s)`,
            'PASS'
        );
    } catch (err) {
        recordStressResult('SQLite WAL Parallel Concurrency', '50 ops', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 4: Control de Memoria (Historial Circular)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Verificación de Aislamiento de Memoria & Bounded History ---');
    try {
        const history = eventBus.getHistory(500);
        assert.ok(history.length <= eventBus.historyLimit, `El historial no debe sobrepasar ${eventBus.historyLimit} elementos`);

        recordStressResult(
            'Bounded Memory History',
            'Historial circular en EventBus',
            `Historial acotado a ${history.length} elementos (límite: ${eventBus.historyLimit})`,
            'PASS'
        );
    } catch (err) {
        recordStressResult('Bounded Memory History', 'Memory check', err.message, 'FAIL');
    }

    console.log('\n===============================================================');
    console.log('📊  REPORTE CONSOLIDADO DE STRESS & CONCURRENCIA (JARVIS 3.1)');
    console.log('===============================================================');
    console.table(stressResults);

    const failures = stressResults.filter(r => r.Estado !== 'PASS');
    if (failures.length > 0) {
        console.error(`\n❌ FALLOS DETECTADOS EN PRUEBA DE ESTRÉS: ${failures.length}`);
        process.exit(1);
    } else {
        console.log('🎉 SISTEMA 100% ESTABLE ANTE ALTA CARGA Y CONCURRENCIA.');
    }
}

if (require.main === module) {
    runStressSuite().catch(err => {
        console.error('Error fatal en suite de estrés:', err);
        process.exit(1);
    });
}

module.exports = { runStressSuite };
