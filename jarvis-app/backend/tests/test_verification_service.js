/**
 * TEST SUITE: Verification Service (Post-Execution Verification & Retry)
 * Verifica que Jarvis compruebe evidencia real en el sistema tras cada acción
 * y deje de asumir éxito ciegamente.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const verificationService = require('../services/core/verificationService');
const actionKernel = require('../services/actionKernelService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Verification Service (Verificación Post-Acción)');
    console.log('===============================================================\n');

    // 1. Verificación genérica de condición (Polling y Timeout)
    console.log('--- TEST 1: verifyCondition() ---');
    let counter = 0;
    const passCondition = await verificationService.verifyCondition(async () => {
        counter++;
        return counter >= 3 ? { reached: counter } : false;
    }, { timeoutMs: 2000, intervalMs: 50, label: 'Contador >= 3' });

    assert.strictEqual(passCondition.verified, true);
    assert.strictEqual(passCondition.result.reached, 3);
    console.log(`verifyCondition resolvió con éxito en ${passCondition.elapsedMs}ms tras ${counter} sondeos.`);

    const failCondition = await verificationService.verifyCondition(async () => false, {
        timeoutMs: 800,
        intervalMs: 100,
        label: 'Condición imposible'
    });
    assert.strictEqual(failCondition.verified, false);
    assert.ok(failCondition.error.includes('Condición imposible'));
    console.log(`verifyCondition timeout controlado tras ${failCondition.elapsedMs}ms: ${failCondition.error}`);
    console.log('✅ TEST 1 PASSED: Bucle de condición verificado.\n');

    // 2. Verificación de archivos creados y eliminados
    console.log('--- TEST 2: verifyFileCreated() y verifyDeleted() ---');
    const testFile = path.join(__dirname, '..', 'data', `test_verify_${Date.now()}.txt`);
    
    // Antes de crearlo debe fallar
    const beforeCreate = await verificationService.verifyFileCreated(testFile, { timeoutMs: 500 });
    assert.strictEqual(beforeCreate.verified, false);
    console.log('Verificación previa: Archivo no existe (correcto).');

    // Lo creamos
    fs.writeFileSync(testFile, 'Contenido de prueba para verificación', 'utf8');
    const afterCreate = await verificationService.verifyFileCreated(testFile, { timeoutMs: 1000, minSize: 5 });
    assert.strictEqual(afterCreate.verified, true);
    assert.strictEqual(afterCreate.result.path, testFile);
    console.log(`Verificación de creación: Archivo existe (${afterCreate.result.size} bytes).`);

    // Lo borramos
    fs.unlinkSync(testFile);
    const afterDelete = await verificationService.verifyDeleted(testFile, { timeoutMs: 1000 });
    assert.strictEqual(afterDelete.verified, true);
    console.log('Verificación de eliminación: Archivo borrado exitosamente.');
    console.log('✅ TEST 2 PASSED: Verificación de archivos completa.\n');

    // 3. Verificación de ventana / aplicación abierta
    console.log('--- TEST 3: verifyAppOpened() ---');
    // Buscamos una ventana existente
    const appCheck = await verificationService.verifyAppOpened('Chrome', { timeoutMs: 2000 });
    if (appCheck.verified) {
        console.log(`App detectada abierta: "${appCheck.window.Title}" (HWND: ${appCheck.window.Hwnd})`);
        assert.ok(appCheck.evidence.hwnd > 0);
    } else {
        console.log('Aviso: Chrome no estuvo en el primer plano, resultado controlado:', appCheck.error);
    }

    // App inexistente con reintento automático
    let retryTriggered = false;
    const missingAppCheck = await verificationService.verifyAppOpened('AppInexistenteQueDebeFallar999', {
        timeoutMs: 1200,
        intervalMs: 150,
        retryFn: () => {
            retryTriggered = true;
            console.log('  -> Reintento automático ejecutado por verificationService.');
        }
    });
    assert.strictEqual(missingAppCheck.verified, false);
    assert.strictEqual(retryTriggered, true, 'El reintento debe haberse disparado');
    console.log('Verificación de app fallida y reintento completados correctamente.');
    console.log('✅ TEST 3 PASSED: verifyAppOpened verificado.\n');

    // 4. Integración con ActionKernel (Ganchos de verificación y reintento)
    console.log('--- TEST 4: ActionKernel + Verification Hook & Retry ---');
    
    // Acción con verificador exitoso
    actionKernel.register({
        id: 'test.verified-action',
        name: 'Acción con Verificador',
        execute: async () => ({ ok: true, message: 'Operación ejecutada.' }),
        verifier: async (output) => ({ verified: true, detail: 'Evidencia comprobada al 100%' })
    });

    const execRes1 = await actionKernel.execute('test.verified-action', {});
    assert.strictEqual(execRes1.ok, true);
    assert.strictEqual(execRes1.verified, true);
    assert.strictEqual(execRes1.status, 'completed');
    assert.strictEqual(execRes1.evidence.verification.detail, 'Evidencia comprobada al 100%');
    console.log('Acción verificada con éxito:', execRes1.status, '| verified:', execRes1.verified);

    // Acción con verificador fallido y reintento
    let actionExecCount = 0;
    actionKernel.register({
        id: 'test.failing-action',
        name: 'Acción que Falla en Verificación',
        retry: true,
        execute: async () => {
            actionExecCount++;
            return { ok: true, message: 'Se ejecutó la acción pero el estado no cambió.' };
        },
        verifier: async (output) => {
            return { verified: false, error: 'El estado esperado no se produjo.' };
        }
    });

    const execRes2 = await actionKernel.execute('test.failing-action', {});
    assert.strictEqual(execRes2.ok, false);
    assert.strictEqual(execRes2.verified, false);
    assert.strictEqual(execRes2.status, 'verification_failed');
    assert.strictEqual(actionExecCount, 2, 'Debe haber reintentado la ejecución una vez');
    console.log('Acción fallida en verificación:', execRes2.status, '| Mensaje honesto:', execRes2.message);
    console.log('✅ TEST 4 PASSED: Integración ActionKernel con ciclo acción->verificación->reintento comprobada.\n');

    console.log('===============================================================');
    console.log('🎉 TODOS LOS TESTS DE VERIFICACIÓN PASARON EXITOSAMENTE (100%)');
    console.log('===============================================================\n');
}

runTests().catch(err => {
    console.error('\n❌ ERROR EN SUITE DE VERIFICACIÓN:', err);
    process.exit(1);
});
