/**
 * test_risk_assessment.js
 * 
 * Suite de pruebas unitarias para el Ítem 38:
 * Confirmaciones según Riesgo (Gobernanza en 4 Niveles: LOW, MEDIUM, HIGH, CRITICAL con PIN).
 */

const assert = require('assert');
const { riskAssessmentService } = require('../services/security/riskAssessmentService');
const actionKernel = require('../services/actionKernelService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function runSuite() {
    console.log('===============================================================');
    console.log('🔒 INICIANDO SUITE DE PRUEBAS: ÍTEM 38 - CONFIRMACIONES POR RIESGO');
    console.log('===============================================================\n');

    // Resetear estado de seguridad antes de los tests
    riskAssessmentService.failedPinAttempts = 0;
    riskAssessmentService.lockedUntil = 0;

    // Test 1: Clasificación de Nivel BAJO (LOW)
    test('Clasificación de riesgo BAJO para operaciones inocuas y multimedia', () => {
        assert.strictEqual(riskAssessmentService.classify('volume.set'), 'LOW');
        assert.strictEqual(riskAssessmentService.classify('spotify.play'), 'LOW');
        assert.strictEqual(riskAssessmentService.classify('weather.get'), 'LOW');
        assert.strictEqual(riskAssessmentService.classify('window.minimize'), 'LOW');

        const reqs = riskAssessmentService.getRequirements('LOW');
        assert.strictEqual(reqs.requiresExplicitConfirmation, false);
        assert.strictEqual(reqs.requiresPin, false);
    });

    // Test 2: Clasificación de Nivel MEDIO (MEDIUM)
    test('Clasificación de riesgo MEDIO para creación de recursos y adición de tareas', () => {
        assert.strictEqual(riskAssessmentService.classify('file.create'), 'MEDIUM');
        assert.strictEqual(riskAssessmentService.classify('folder.create'), 'MEDIUM');
        assert.strictEqual(riskAssessmentService.classify('reminder.add'), 'MEDIUM');
        assert.strictEqual(riskAssessmentService.classify('whatsapp.send'), 'MEDIUM');

        const reqs = riskAssessmentService.getRequirements('MEDIUM');
        assert.strictEqual(reqs.requiresExplicitConfirmation, false);
        assert.strictEqual(reqs.requiresPin, false);
        assert.strictEqual(reqs.confirmationType, 'soft_undoable');
    });

    // Test 3: Clasificación de Nivel ALTO (HIGH)
    test('Clasificación de riesgo ALTO para destrucción de archivos o carpetas', () => {
        assert.strictEqual(riskAssessmentService.classify('folder.delete'), 'HIGH');
        assert.strictEqual(riskAssessmentService.classify('file.remove'), 'HIGH');
        assert.strictEqual(riskAssessmentService.classify('trash.empty_trash'), 'HIGH');
        assert.strictEqual(riskAssessmentService.classify('process.kill'), 'HIGH');

        const reqs = riskAssessmentService.getRequirements('HIGH');
        assert.strictEqual(reqs.requiresExplicitConfirmation, true);
        assert.strictEqual(reqs.requiresPin, false);
        assert.strictEqual(reqs.confirmationType, 'explicit_token');
    });

    // Test 4: Clasificación de Nivel CRÍTICO (CRITICAL)
    test('Clasificación de riesgo CRÍTICO para impacto en hardware, apagado y base de datos', () => {
        assert.strictEqual(riskAssessmentService.classify('system.shutdown'), 'CRITICAL');
        assert.strictEqual(riskAssessmentService.classify('system.reboot'), 'CRITICAL');
        assert.strictEqual(riskAssessmentService.classify('database.reset'), 'CRITICAL');
        assert.strictEqual(riskAssessmentService.classify('apagar_pc'), 'CRITICAL');

        const reqs = riskAssessmentService.getRequirements('CRITICAL');
        assert.strictEqual(reqs.requiresExplicitConfirmation, true);
        assert.strictEqual(reqs.requiresPin, true);
        assert.strictEqual(reqs.confirmationType, 'dual_with_pin');
    });

    // Test 5: ActionKernel ejecuta acción LOW directamente sin confirmación
    await testAsync('ActionKernel ejecuta acciones LOW de inmediato sin pedir confirmación', async () => {
        const actionId = `test_low_${Date.now()}`;
        let executed = false;

        actionKernel.register({
            id: actionId,
            name: 'Subir volumen',
            riskLevel: 'LOW',
            permission: 'READ_ONLY',
            execute: async () => { executed = true; return { ok: true, volume: 50 }; }
        });

        const res = await actionKernel.execute(actionId, {});
        assert.strictEqual(executed, true);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.status, 'completed');
    });

    // Test 6: ActionKernel frena acción HIGH exigiendo confirmación explícita con token
    await testAsync('ActionKernel frena acciones HIGH y genera token de confirmación', async () => {
        const actionId = `test_high_${Date.now()}`;
        let executed = false;

        actionKernel.register({
            id: actionId,
            name: 'Borrar Carpeta de Proyectos',
            riskLevel: 'HIGH',
            permission: 'STANDARD',
            execute: async () => { executed = true; return { ok: true }; }
        });

        // Intento sin confirmar
        const res = await actionKernel.execute(actionId, {});
        assert.strictEqual(executed, false, 'No debe ejecutarse sin confirmación previa');
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.status, 'awaiting_confirmation');
        assert.strictEqual(res.riskLevel, 'HIGH');
        assert.ok(res.confirmationToken, 'Debe proveer un confirmationToken');

        // Confirmar con el token
        const confirmRes = await actionKernel.confirm(res.confirmationToken);
        assert.strictEqual(executed, true, 'Debe ejecutarse tras confirmar con token');
        assert.strictEqual(confirmRes.ok, true);
        assert.strictEqual(confirmRes.status, 'completed');
    });

    // Test 7: ActionKernel frena acción CRITICAL exigiendo PIN de seguridad
    await testAsync('ActionKernel frena acciones CRITICAL solicitando token y PIN', async () => {
        const actionId = `test_critical_${Date.now()}`;
        let executed = false;

        actionKernel.register({
            id: actionId,
            name: 'Apagar la Computadora',
            riskLevel: 'CRITICAL',
            permission: 'STANDARD',
            execute: async () => { executed = true; return { ok: true }; }
        });

        const res = await actionKernel.execute(actionId, {});
        assert.strictEqual(executed, false);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.status, 'awaiting_pin_confirmation');
        assert.strictEqual(res.riskLevel, 'CRITICAL');
        assert.ok(res.confirmationToken);

        // Intento de confirmar con PIN incorrecto
        const failConfirm = await actionKernel.confirm(res.confirmationToken, {}, { pin: '0000' });
        assert.strictEqual(executed, false, 'No debe ejecutarse con PIN incorrecto');
        assert.strictEqual(failConfirm.ok, false);
        assert.strictEqual(failConfirm.status, 'pin_verification_failed');
    });

    // Test 8: Confirmación Exitosa de Acción CRITICAL con PIN Válido
    await testAsync('Acción CRITICAL se ejecuta tras proveer PIN de seguridad correcto (1234)', async () => {
        const actionId = `test_crit_ok_${Date.now()}`;
        let executed = false;

        actionKernel.register({
            id: actionId,
            name: 'Resetear Base de Datos',
            riskLevel: 'CRITICAL',
            permission: 'STANDARD',
            execute: async () => { executed = true; return { ok: true, reset: 'done' }; }
        });

        const res = await actionKernel.execute(actionId, {});
        assert.strictEqual(res.status, 'awaiting_pin_confirmation');

        // Confirmar con el PIN válido por defecto ('1234')
        const confirmRes = await actionKernel.confirm(res.confirmationToken, {}, { pin: '1234' });
        assert.strictEqual(executed, true, 'Debe ejecutarse tras ingresar PIN correcto');
        assert.strictEqual(confirmRes.ok, true);
        assert.strictEqual(confirmRes.status, 'completed');
    });

    // Test 9: Protección contra Fuerza Bruta de PIN (Bloqueo tras 3 intentos)
    test('Protección anti-fuerza bruta bloquea temporalmente el PIN tras 3 fallos', () => {
        riskAssessmentService.failedPinAttempts = 0;
        riskAssessmentService.lockedUntil = 0;

        // Intento 1
        const r1 = riskAssessmentService.verifyPin('9999');
        assert.strictEqual(r1.ok, false);
        assert.strictEqual(r1.locked, false);

        // Intento 2
        const r2 = riskAssessmentService.verifyPin('8888');
        assert.strictEqual(r2.ok, false);
        assert.strictEqual(r2.locked, false);

        // Intento 3 -> Bloqueo
        const r3 = riskAssessmentService.verifyPin('7777');
        assert.strictEqual(r3.ok, false);
        assert.strictEqual(r3.locked, true);
        assert.ok(r3.error.includes('Bloqueado temporalmente'));

        // Intento 4 aún bloqueado
        const r4 = riskAssessmentService.verifyPin('1234'); // Aunque sea el PIN correcto
        assert.strictEqual(r4.ok, false);
        assert.strictEqual(r4.locked, true);

        // Limpiar bloqueo
        riskAssessmentService.failedPinAttempts = 0;
        riskAssessmentService.lockedUntil = 0;
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 38 PASARON EXITOSAMENTE.\n');
        process.exit(0);
    } else {
        console.error(`💥 FALLARON ${totalTests - passedTests} TESTS.\n`);
        process.exit(1);
    }
}

runSuite().catch(e => {
    console.error('Excepción fatal en suite de pruebas:', e);
    process.exit(1);
});
