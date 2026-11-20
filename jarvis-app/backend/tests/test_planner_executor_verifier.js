/**
 * TEST SUITE: Planner -> Executor -> Verifier Architecture
 * Verifica el ciclo cerrado de planificación, ejecución, verificación empírica
 * y autocorrección para tareas complejas de múltiples pasos en Jarvis.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const plannerService = require('../services/ai/plannerService');
const executorService = require('../services/ai/executorService');
const verifierRoleService = require('../services/ai/verifierRoleService');
const taskOrchestratorService = require('../services/ai/taskOrchestratorService');
const actionKernel = require('../services/actionKernelService');
const jarvisActionService = require('../services/jarvisActionService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Arquitectura Planner -> Executor -> Verifier');
    console.log('===============================================================\n');

    const desktop = process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
    const testFolderName = `Test_PEV_${Date.now()}`;
    const testFolderPath = path.join(desktop, testFolderName);
    const testFileName = 'Resumen_PEV.txt';
    const testFilePath = path.join(testFolderPath, testFileName);

    // 1. Planner Role: Generación de planes estructurados con criterios de verificación
    console.log('--- TEST 1: Rol PLANNER ---');
    const goalText = `Creá una carpeta llamada ${testFolderName} y adentro un txt llamado ${testFileName} sobre pruebas de integración`;
    const plan = plannerService.createPlanForGoal({ goal: goalText });

    assert.ok(plan.id.startsWith('plan-'), 'Plan ID debe comenzar con plan-');
    assert.strictEqual(plan.steps.length, 2, 'El plan debe tener 2 pasos');
    assert.strictEqual(plan.steps[0].actionId, 'folder.create');
    assert.strictEqual(plan.steps[1].actionId, 'file.create');
    assert.ok(plan.steps[0].verification, 'El paso 1 debe incluir verificación de carpeta');
    assert.ok(plan.steps[1].verification, 'El paso 2 debe incluir verificación de archivo');
    console.log(`Planner generó plan [${plan.id}] con ${plan.steps.length} pasos:`);
    plan.steps.forEach(s => console.log(`  - [${s.id}] ${s.description} (Verif: ${s.verification?.type})`));
    console.log('✅ TEST 1 PASSED: Rol Planner operativo.\n');

    // 2. Executor Role: Resolución de variables dinámicas
    console.log('--- TEST 2: Rol EXECUTOR (Resolución de Parámetros) ---');
    const mockContext = {
        stepResults: {
            'step-1': {
                folderPath: 'C:\\Desktop\\MiCarpeta',
                folderName: 'MiCarpeta'
            }
        }
    };
    const resolved = executorService.resolveParams({
        folder: '{{step-1.folderName}}',
        fullPath: '{{step-1.folderPath}}\\archivo.txt',
        staticVal: 42
    }, mockContext);

    assert.strictEqual(resolved.folder, 'MiCarpeta');
    assert.strictEqual(resolved.fullPath, 'C:\\Desktop\\MiCarpeta\\archivo.txt');
    assert.strictEqual(resolved.staticVal, 42);
    console.log('Resolución de variables {{step-1.*}} validada correctamente.');
    console.log('✅ TEST 2 PASSED: Rol Executor operativo.\n');

    // 3. Verifier Role: Verificación empírica de condiciones
    console.log('--- TEST 3: Rol VERIFIER ---');
    // Verificación de paso fallido
    const failVerif = await verifierRoleService.verifyStep(
        { id: 'step-fake', verification: { type: 'file_exists', target: 'C:\\Inexistente_1234.txt', timeoutMs: 300 } },
        { ok: true }
    );
    assert.strictEqual(failVerif.correct, false);
    console.log(`Verifier detectó correctamente ausencia de archivo: ${failVerif.reason}`);
    console.log('✅ TEST 3 PASSED: Rol Verifier operativo.\n');

    // 4. Orquestación Completa en Bucle Cerrado (Planner -> Executor -> Verifier)
    console.log('--- TEST 4: Orquestación Completa con Tarea Real en Windows ---');
    try {
        const result = await taskOrchestratorService.executeGoal(plan);
        assert.strictEqual(result.ok, true, 'El plan debe completarse con éxito');
        assert.strictEqual(result.status, 'COMPLETED');
        assert.strictEqual(result.log.length, 2, 'Debe haber 2 pasos completados');

        // Comprobación física en disco
        assert.ok(fs.existsSync(testFolderPath), 'La carpeta creada debe existir en disco');
        assert.ok(fs.existsSync(testFilePath), 'El archivo creado dentro de la carpeta debe existir');
        console.log(`Comprobación empírica en disco exitosa: ${testFilePath} (${fs.statSync(testFilePath).size} bytes)`);
    } finally {
        // Limpieza de archivos de prueba
        try {
            if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
            if (fs.existsSync(testFolderPath)) fs.rmdirSync(testFolderPath);
            console.log('Archivos de prueba limpiados correctamente.');
        } catch (_) {}
    }
    console.log('✅ TEST 4 PASSED: Ciclo completo Planner -> Executor -> Verifier ejecutado con éxito.\n');

    // 5. Autocorrección y Reintento Automático
    console.log('--- TEST 5: Autocorrección y Reintento Automático ---');
    let attemptCounter = 0;
    actionKernel.register({
        id: 'test.flaky-service',
        name: 'Servicio con fallo inicial',
        execute: async () => {
            attemptCounter++;
            return { ok: true, attempt: attemptCounter };
        }
    });

    const retryPlan = plannerService.createPlanFromSteps('Probar reintento', [
        {
            id: 'step-1',
            actionId: 'test.flaky-service',
            description: 'Acción que requiere reintento',
            maxRetries: 2,
            verification: {
                type: 'custom',
                check: (execResult) => {
                    // Solo es válido a partir del intento 2
                    return { correct: attemptCounter >= 2, reason: 'Intento 1 simuló fallo' };
                }
            }
        }
    ]);

    const retryRes = await taskOrchestratorService.executeGoal(retryPlan);
    assert.strictEqual(retryRes.ok, true);
    assert.strictEqual(retryRes.status, 'COMPLETED');
    assert.strictEqual(attemptCounter, 2, 'Debe haber ejecutado 2 intentos');
    console.log(`Reintento completado en intento ${attemptCounter}: paso corregido y verificado.`);
    console.log('✅ TEST 5 PASSED: Autocorrección por reintento comprobada.\n');

    // 6. Límite Seguro ante Fallos Inevitables (Sin bucles infinitos)
    console.log('--- TEST 6: Límite Seguro ante Fallos Inevitables ---');
    const impossiblePlan = plannerService.createPlanFromSteps('Probar fallo controlado', [
        {
            id: 'step-unreachable',
            actionId: 'test.flaky-service',
            description: 'Paso con condición imposible',
            maxRetries: 1,
            verification: {
                type: 'custom',
                check: () => ({ correct: false, reason: 'Condición permanentemente insatisfecha' })
            }
        }
    ]);

    const failRes = await taskOrchestratorService.executeGoal(impossiblePlan);
    assert.strictEqual(failRes.ok, false);
    assert.strictEqual(failRes.status, 'FAILED');
    assert.ok(failRes.error.includes('Condición permanentemente insatisfecha'));
    console.log(`Fallo reportado limpiamente sin colgar el sistema: ${failRes.message}`);
    console.log('✅ TEST 6 PASSED: Manejo seguro de fallos y salida controlada verificado.\n');

    console.log('===============================================================');
    console.log('🎉 TODOS LOS TESTS DE PLANNER->EXECUTOR->VERIFIER PASARON (100%)');
    console.log('===============================================================\n');
}

runTests().catch(err => {
    console.error('\n❌ ERROR EN SUITE PLANNER-EXECUTOR-VERIFIER:', err);
    process.exit(1);
});
