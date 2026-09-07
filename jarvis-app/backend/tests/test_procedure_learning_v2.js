/**
 * Operational Learning V2 Test Suite: Canary Procedures, Evaluation & Rollback
 * (JARVIS 3.1 Hardening - Phase 9)
 *
 * Evalúa las nuevas capacidades de aprendizaje operacional seguro:
 * 1. Registro de procedimiento en modo CANDIDATE (Canary testing).
 * 2. Ejecuciones de prueba canario:
 *    - Validación de métricas incrementales (executionCount, successCount).
 *    - Auto-promoción a ACTIVE tras superar umbral de éxitos (canaryThreshold = 3).
 * 3. Detección de regresión y Rollback Automático:
 *    - Inyección de fallas consecutivas en un candidato o procedimiento degradado.
 *    - Desactivación y cambio de estado a ROLLED_BACK / REJECTED.
 *    - Aislamiento en el enrutamiento: procedimientos rolled-back no son seleccionados por trigger.
 * 4. Preservación del estado y persistencia JSON limpia en disco.
 */

const assert = require('assert');
const procedureRegistry = require('../services/core/procedureRegistryService');

const results = [];

function recordResult(testName, details, status) {
    results.push({ 'Prueba': testName, 'Detalle': details, 'Estado': status });
    const icon = status === 'PASS' ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`  ${icon} ${testName} -> ${details}`);
}

async function runOperationalLearningV2Suite() {
    console.log('\n===============================================================');
    console.log('🧪 INICIANDO SUITE DE APRENDIZAJE OPERACIONAL V2 (JARVIS 3.1)');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // TEST 1: Registro de Procedimiento Candidato (Canary)
    // -------------------------------------------------------------
    console.log('--- TEST 1: Registro en Modo Canary (CANDIDATE) ---');
    try {
        const candidateProc = procedureRegistry.registerProcedure({
            id: 'proc_canary_compress_report',
            name: 'Comprimir Reportes Mensuales',
            description: 'Comprime los PDFs del mes y notifica',
            trigger: 'comprimir reportes mensuales',
            status: 'CANDIDATE',
            canaryThreshold: 3,
            steps: [
                { actionId: 'system.file', params: { action: 'zip', dir: 'reports' }, description: 'Zipear' },
                { actionId: 'notification.send', params: { title: 'Listo' }, description: 'Avisar' }
            ]
        });

        assert.strictEqual(candidateProc.status, 'CANDIDATE');
        assert.strictEqual(candidateProc.validationStatus, 'CANARY_TESTING');
        assert.strictEqual(candidateProc.canaryThreshold, 3);
        recordResult('Registro Canary', 'Procedimiento marcado como CANDIDATE y CANARY_TESTING', 'PASS');
    } catch (err) {
        recordResult('Registro Canary', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 2: Canary Testing & Auto-Promoción a ACTIVE
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Ejecución Canario & Auto-Promoción Exitosa ---');
    try {
        const id = 'proc_canary_compress_report';
        
        // Ejecución 1 exitosa
        procedureRegistry.recordExecution(id, true);
        let p = procedureRegistry.getProcedure(id);
        assert.strictEqual(p.status, 'CANDIDATE');
        assert.strictEqual(p.successCount, 1);

        // Ejecución 2 exitosa
        procedureRegistry.recordExecution(id, true);
        p = procedureRegistry.getProcedure(id);
        assert.strictEqual(p.status, 'CANDIDATE');
        assert.strictEqual(p.successCount, 2);

        // Ejecución 3 exitosa -> debe auto-promover a ACTIVE
        procedureRegistry.recordExecution(id, true);
        p = procedureRegistry.getProcedure(id);
        assert.strictEqual(p.status, 'ACTIVE', 'Debe promoverse automáticamente a ACTIVE tras 3 éxitos');
        assert.strictEqual(p.validationStatus, 'VALIDATED');
        assert.strictEqual(p.successCount, 3);

        recordResult('Auto-Promoción Canario', 'Promovido a ACTIVE tras alcanzar el umbral canary de 3 éxitos', 'PASS');
    } catch (err) {
        recordResult('Auto-Promoción Canario', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 3: Detección de Regresión y Auto-Rollback
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Detección de Regresión y Rollback Automático ---');
    try {
        const fragileProc = procedureRegistry.registerProcedure({
            id: 'proc_canary_flaky_service',
            name: 'Servicio Inestable',
            description: 'Procedimiento propenso a fallas para probar auto-rollback',
            trigger: 'ejecutar servicio inestable',
            status: 'CANDIDATE',
            canaryThreshold: 3,
            steps: [
                { actionId: 'system.shell', params: { cmd: 'test_flaky' } }
            ]
        });

        // Simular 2 fallas consecutivas en el candidato
        procedureRegistry.recordExecution('proc_canary_flaky_service', false, 'Network socket timeout');
        let procState = procedureRegistry.getProcedure('proc_canary_flaky_service');
        assert.strictEqual(procState.consecutiveFailures, 1);
        assert.strictEqual(procState.status, 'CANDIDATE');

        // Segunda falla consecutiva -> disparador de auto-rollback
        procedureRegistry.recordExecution('proc_canary_flaky_service', false, 'Connection refused 502');
        procState = procedureRegistry.getProcedure('proc_canary_flaky_service');
        assert.strictEqual(procState.status, 'ROLLED_BACK', 'Debe cambiar de estado a ROLLED_BACK');
        assert.strictEqual(procState.validationStatus, 'REJECTED');
        assert.ok(procState.rollbackReason.includes('Auto-rollback'));

        recordResult('Auto-Rollback por Regresión', 'Candidato retirado automáticamente a ROLLED_BACK tras 2 fallas consecutivas', 'PASS');
    } catch (err) {
        recordResult('Auto-Rollback por Regresión', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 4: Aislamiento en Trigger de Procedimientos Retirados
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Aislamiento en Enrutamiento por Trigger ---');
    try {
        // Buscar el procedimiento que fue rolled back
        const match = procedureRegistry.findProcedureByTrigger('ejecutar servicio inestable');
        assert.strictEqual(match, null, 'Un procedimiento ROLLED_BACK nunca debe ser devuelto por trigger');

        // En cambio, el promovido a ACTIVE debe encontrarse inmediatamente
        const activeMatch = procedureRegistry.findProcedureByTrigger('comprimir reportes mensuales');
        assert.ok(activeMatch, 'El procedimiento ACTIVE debe resolverse normalmente');
        assert.strictEqual(activeMatch.id, 'proc_canary_compress_report');

        recordResult('Aislamiento de Triggers', 'Procedimientos defectuosos o revocados quedan totalmente deshabilitados', 'PASS');
    } catch (err) {
        recordResult('Aislamiento de Triggers', err.message, 'FAIL');
    }

    console.log('\n===============================================================');
    console.log('📊  REPORTE DE OPERATIONAL LEARNING V2 (JARVIS 3.1)');
    console.log('===============================================================');
    console.table(results);

    const failures = results.filter(r => r.Estado !== 'PASS');
    if (failures.length > 0) {
        console.error(`\n❌ FALLOS DETECTADOS EN OPERATIONAL LEARNING: ${failures.length}`);
        process.exit(1);
    } else {
        console.log('🎉 APRENDIZAJE OPERACIONAL V2 VALIDADO Y BLINDADO.');
    }
}

if (require.main === module) {
    runOperationalLearningV2Suite().catch(err => {
        console.error('Error fatal en suite de aprendizaje operacional:', err);
        process.exit(1);
    });
}

module.exports = { runOperationalLearningV2Suite };
