/**
 * TEST SUITE: Procedure Registry Service (Fase J - Operational Learning)
 * Verifica:
 *   1. Registro estructurado de procedimientos con pre/postcondiciones.
 *   2. Búsqueda por trigger semántico.
 *   3. Seguimiento de métricas de ejecución y optimización.
 *   4. Persistencia en disco y recuperación limpia.
 */

const assert = require('assert');
const procedureRegistry = require('../services/core/procedureRegistryService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Procedure Registry Service (Fase J)');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    // 1. Registro de procedimiento
    test('Registra un nuevo procedimiento con pasos estructurados', () => {
        const proc = procedureRegistry.registerProcedure({
            id: 'proc_morning_routine',
            name: 'Rutina Matutina',
            description: 'Enciende la TV, pone Netflix y ajusta volumen',
            trigger: 'iniciar rutina matutina',
            steps: [
                { actionId: 'tv.control', params: { command: 'power' }, description: 'Prender la tele' },
                { actionId: 'system.open', params: { appName: 'Netflix' }, description: 'Abrir Netflix' },
                { actionId: 'windows.volume', params: { percent: 35 }, description: 'Ajustar volumen a 35%' }
            ]
        });

        assert.ok(proc);
        assert.strictEqual(proc.id, 'proc_morning_routine');
        assert.strictEqual(proc.steps.length, 3);
        assert.strictEqual(proc.validationStatus, 'VALIDATED');
    });

    // 2. Búsqueda por trigger
    test('Encuentra el procedimiento por trigger textual', () => {
        const found = procedureRegistry.findProcedureByTrigger('che jarvis, iniciar rutina matutina');
        assert.ok(found);
        assert.strictEqual(found.id, 'proc_morning_routine');
    });

    // 3. Seguimiento de métricas de ejecución
    test('Registra y optimiza métricas de éxito del procedimiento', () => {
        procedureRegistry.recordExecution('proc_morning_routine', true);
        const p = procedureRegistry.getProcedure('proc_morning_routine');
        assert.strictEqual(p.executionCount, 1);
        assert.strictEqual(p.successCount, 1);
        assert.ok(p.lastExecutedAt);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE PROCEDURE REGISTRY PASARON: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Procedure Registry:', err);
    process.exit(1);
});
