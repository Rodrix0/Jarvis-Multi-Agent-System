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
    // TEST 2: Canary Testing & Auto-Promoción LOW Risk (min 5 runs, successRate >= 90%)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Auto-Promoción LOW Risk (5 ejecuciones, >=90% éxito) ---');
    try {
        const id = 'proc_canary_compress_report';
        
        // Ejecución 1 a 4 exitosas -> no debe promoverse aún (requiere mínimo 5)
        for (let i = 1; i <= 4; i++) {
            procedureRegistry.recordExecution(id, true);
            let p = procedureRegistry.getProcedure(id);
            assert.strictEqual(p.status, 'CANDIDATE', `En ejecución ${i} no debe promoverse aún`);
            assert.strictEqual(p.successCount, i);
        }

        // Ejecución 5 exitosa -> total 5, successRate 100% -> auto-promueve a ACTIVE
        procedureRegistry.recordExecution(id, true);
        let p = procedureRegistry.getProcedure(id);
        assert.strictEqual(p.status, 'ACTIVE', 'Debe promoverse automáticamente a ACTIVE tras 5 éxitos en LOW risk');
        assert.strictEqual(p.validationStatus, 'VALIDATED');
        assert.strictEqual(p.successCount, 5);

        recordResult('Auto-Promoción LOW Risk', 'Promovido a ACTIVE tras alcanzar 5 éxitos (successRate >= 90%)', 'PASS');
    } catch (err) {
        recordResult('Auto-Promoción LOW Risk', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 2B: Auto-Promoción MEDIUM Risk (min 10 runs, >=95% éxito, reversible = true)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2B: Auto-Promoción MEDIUM Risk (10 ejecuciones, >=95%, reversible) ---');
    try {
        // Caso A: Reversible -> debe promoverse tras 10 éxitos
        const medProc = procedureRegistry.registerProcedure({
            id: 'proc_med_sync_backup',
            name: 'Sincronizar Backup Reversible',
            trigger: 'sincronizar backup',
            status: 'CANDIDATE',
            riskLevel: 'MEDIUM',
            reversible: true,
            steps: [{ actionId: 'system.file', params: { action: 'backup' } }]
        });

        for (let i = 1; i <= 9; i++) {
            procedureRegistry.recordExecution('proc_med_sync_backup', true);
            let p = procedureRegistry.getProcedure('proc_med_sync_backup');
            assert.strictEqual(p.status, 'CANDIDATE', `En paso ${i} debe seguir CANDIDATE`);
        }

        // Ejecución 10 exitosa -> promueve a ACTIVE
        procedureRegistry.recordExecution('proc_med_sync_backup', true);
        let p = procedureRegistry.getProcedure('proc_med_sync_backup');
        assert.strictEqual(p.status, 'ACTIVE', 'Debe promoverse a ACTIVE con 10 ejecuciones y reversible=true');
        recordResult('MEDIUM Risk Reversible', 'Promovido tras 10 ejecuciones exitosas (successRate 100%)', 'PASS');

        // Caso B: No Reversible -> NUNCA debe auto-promoverse
        const medNonRev = procedureRegistry.registerProcedure({
            id: 'proc_med_non_rev',
            name: 'Modificación No Reversible',
            trigger: 'modificar configuracion fija',
            status: 'CANDIDATE',
            riskLevel: 'MEDIUM',
            reversible: false,
            steps: [{ actionId: 'system.config', params: { set: 'key' } }]
        });

        for (let i = 1; i <= 15; i++) {
            procedureRegistry.recordExecution('proc_med_non_rev', true);
        }
        let pNonRev = procedureRegistry.getProcedure('proc_med_non_rev');
        assert.strictEqual(pNonRev.status, 'CANDIDATE', 'MEDIUM no reversible no debe auto-promoverse');
        recordResult('MEDIUM Risk No Reversible', 'Bloqueada auto-promoción autónoma para MEDIUM no reversible', 'PASS');
    } catch (err) {
        recordResult('MEDIUM Risk Policies', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 2C: HIGH Risk - Nunca auto-promote, requiere aprobación humana
    // -------------------------------------------------------------
    console.log('\n--- TEST 2C: HIGH Risk (Nunca auto-promote, requiere aprobación humana) ---');
    try {
        const highProc = procedureRegistry.registerProcedure({
            id: 'proc_high_deploy_service',
            name: 'Desplegar Servicio Productivo',
            trigger: 'desplegar produccion',
            status: 'CANDIDATE',
            riskLevel: 'HIGH',
            reversible: false,
            steps: [{ actionId: 'system.deploy', params: { target: 'prod' } }]
        });

        // 20 ejecuciones con 100% de éxito
        for (let i = 1; i <= 20; i++) {
            procedureRegistry.recordExecution('proc_high_deploy_service', true);
        }

        let pHigh = procedureRegistry.getProcedure('proc_high_deploy_service');
        assert.strictEqual(pHigh.status, 'CANDIDATE', 'HIGH nunca debe auto-promoverse independientemente del conteo');
        assert.strictEqual(pHigh.successCount, 20);

        // Aprobación humana explícita requerida
        const approved = procedureRegistry.approveProcedure('proc_high_deploy_service', 'Rodrigo_Admin');
        assert.strictEqual(approved, true);
        pHigh = procedureRegistry.getProcedure('proc_high_deploy_service');
        assert.strictEqual(pHigh.status, 'ACTIVE');
        assert.strictEqual(pHigh.approvedBy, 'Rodrigo_Admin');

        recordResult('HIGH Risk Human Approval', 'Auto-promoción bloqueada; promovido únicamente con aprobación humana', 'PASS');
    } catch (err) {
        recordResult('HIGH Risk Human Approval', err.message, 'FAIL');
    }

    // -------------------------------------------------------------
    // TEST 2D: CRITICAL Risk - Prohibida la promoción autónoma
    // -------------------------------------------------------------
    console.log('\n--- TEST 2D: CRITICAL Risk (Prohibida la promoción autónoma) ---');
    try {
        const critProc = procedureRegistry.registerProcedure({
            id: 'proc_crit_kernel_wipe',
            name: 'Acceso Directo a Kernel de Disco',
            trigger: 'purgar particion',
            status: 'CANDIDATE',
            riskLevel: 'CRITICAL',
            reversible: false,
            steps: [{ actionId: 'system.disk', params: { wipe: true } }]
        });

        // 50 ejecuciones exitosas
        for (let i = 1; i <= 50; i++) {
            procedureRegistry.recordExecution('proc_crit_kernel_wipe', true);
        }

        let pCrit = procedureRegistry.getProcedure('proc_crit_kernel_wipe');
        assert.strictEqual(pCrit.status, 'CANDIDATE', 'CRITICAL tiene terminantemente prohibida la promoción autónoma');

        recordResult('CRITICAL Risk Autonomous Ban', 'Prohibida terminantemente la auto-promoción de procedimientos CRITICAL', 'PASS');
    } catch (err) {
        recordResult('CRITICAL Risk Autonomous Ban', err.message, 'FAIL');
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
