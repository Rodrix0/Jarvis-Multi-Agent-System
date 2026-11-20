/**
 * Test Suite para TaskManager y Cancelación de Acciones (Ítem 25)
 * Verifica:
 *  1. Registro y ciclo de vida de tareas con estados: PENDING, RUNNING, PAUSED, CANCELLED, COMPLETED, FAILED.
 *  2. Operaciones cancel(), pause(), resume() individuales con callbacks y AbortController.
 *  3. Cancelación contextual por comando de voz ("cancelá la descarga", "jarvis cancelá").
 *  4. Cancelación global cancelAll().
 *  5. Resolución de intenciones de voz en jarvisActionService sin regresiones.
 *  6. Idempotencia y seguridad ante tareas inexistentes o ya finalizadas.
 */

const assert = require('assert');
const taskManager = require('../services/core/taskManagerService');
const { TASK_STATUS, TASK_TYPES } = require('../services/core/taskManagerService');
const jarvisActionService = require('../services/jarvisActionService');

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runAsyncTest(description, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function main() {
    console.log('===============================================================');
    console.log('🛑 INICIANDO SUITE DE TESTS: TASK MANAGER & CANCELACIÓN (ÍTEM 25)');
    console.log('===============================================================');

    // Limpiar estado
    taskManager.tasks.clear();

    console.log('\n--- BLOQUE 1: Ciclo de Vida y Creación de Tareas ---');

    let createdTask = null;
    runTest('Crear tarea con metadatos y estado PENDING', () => {
        createdTask = taskManager.createTask({
            type: TASK_TYPES.DOWNLOAD,
            description: 'Descarga de video de YouTube (Blender 4.0 Tutorial)',
            metadata: { url: 'https://youtube.com/watch?v=123' }
        });

        assert.ok(createdTask.id.startsWith('task_'));
        assert.strictEqual(createdTask.status, TASK_STATUS.PENDING);
        assert.strictEqual(createdTask.type, TASK_TYPES.DOWNLOAD);
        assert.strictEqual(createdTask.progress, 0);
    });

    runTest('Iniciar tarea transiciona a RUNNING y registra startedAt', () => {
        const started = taskManager.startTask(createdTask.id);
        assert.strictEqual(started, true);
        const task = taskManager.getTask(createdTask.id);
        assert.strictEqual(task.status, TASK_STATUS.RUNNING);
        assert.ok(task.startedAt);
    });

    runTest('Actualización de progreso y finalización COMPLETED', () => {
        taskManager.updateProgress(createdTask.id, 50);
        let task = taskManager.getTask(createdTask.id);
        assert.strictEqual(task.progress, 50);

        taskManager.completeTask(createdTask.id, { savedTo: '/downloads/video.mp4' });
        task = taskManager.getTask(createdTask.id);
        assert.strictEqual(task.status, TASK_STATUS.COMPLETED);
        assert.strictEqual(task.progress, 100);
        assert.ok(task.finishedAt);
        assert.strictEqual(task.metadata.result.savedTo, '/downloads/video.mp4');
    });

    console.log('\n--- BLOQUE 2: Control de Pausa y Reanudación (pause, resume) ---');

    let pausedCount = 0;
    let resumedCount = 0;
    const pausableTask = taskManager.createTask({
        type: TASK_TYPES.RESEARCH,
        description: 'Investigación web profunda sobre física cuántica',
        pauseFn: () => { pausedCount++; },
        resumeFn: () => { resumedCount++; }
    });
    taskManager.startTask(pausableTask.id);

    runTest('Pausar tarea en ejecución invoca callback y cambia estado a PAUSED', () => {
        const result = taskManager.pause(pausableTask.id);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.status, TASK_STATUS.PAUSED);
        assert.strictEqual(pausedCount, 1);
        const task = taskManager.getTask(pausableTask.id);
        assert.strictEqual(task.status, TASK_STATUS.PAUSED);
    });

    runTest('Reanudar tarea pausada invoca callback y retorna a RUNNING', () => {
        const result = taskManager.resume(pausableTask.id);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.status, TASK_STATUS.RUNNING);
        assert.strictEqual(resumedCount, 1);
        const task = taskManager.getTask(pausableTask.id);
        assert.strictEqual(task.status, TASK_STATUS.RUNNING);
    });

    console.log('\n--- BLOQUE 3: Cancelación Directa e Inmediata (cancel) ---');

    let cancelCallbackFired = false;
    const abortCtrl = new AbortController();
    const cancellableTask = taskManager.createTask({
        type: TASK_TYPES.BROWSER,
        description: 'Automatización de navegación en portal web',
        abortController: abortCtrl,
        cancelFn: () => { cancelCallbackFired = true; }
    });
    taskManager.startTask(cancellableTask.id);

    runTest('Cancelar tarea aborta controlador, invoca callback y pasa a CANCELLED', () => {
        const result = taskManager.cancel(cancellableTask.id, 'Cancelado en prueba unitaria');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.status, TASK_STATUS.CANCELLED);
        assert.strictEqual(cancelCallbackFired, true);
        assert.strictEqual(abortCtrl.signal.aborted, true);

        const task = taskManager.getTask(cancellableTask.id);
        assert.strictEqual(task.status, TASK_STATUS.CANCELLED);
        assert.ok(task.finishedAt);
        assert.strictEqual(task.metadata.cancelReason, 'Cancelado en prueba unitaria');
    });

    runTest('Cancelar tarea ya terminada o cancelada es idempotente y seguro', () => {
        const result = taskManager.cancel(cancellableTask.id);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.message.includes('ya finalizó'), true);
    });

    console.log('\n--- BLOQUE 4: Cancelación Contextual y Global (cancelCurrent, cancelAll) ---');

    const downloadTask = taskManager.createTask({
        type: TASK_TYPES.DOWNLOAD,
        description: 'Descarga activa de prueba'
    });
    taskManager.startTask(downloadTask.id);

    const skillTask = taskManager.createTask({
        type: TASK_TYPES.PYTHON_SKILL,
        description: 'Ejecución de script en sandbox'
    });
    taskManager.startTask(skillTask.id);

    runTest('cancelCurrent con filtro de tipo cancela específicamente esa tarea', () => {
        const result = taskManager.cancelCurrent('download');
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.taskId, downloadTask.id);

        const t = taskManager.getTask(downloadTask.id);
        assert.strictEqual(t.status, TASK_STATUS.CANCELLED);

        // La otra tarea debe seguir activa
        const s = taskManager.getTask(skillTask.id);
        assert.strictEqual(s.status, TASK_STATUS.RUNNING);
    });

    runTest('cancelAll cancela todas las tareas activas restantes', () => {
        const result = taskManager.cancelAll('Parada de prueba');
        assert.strictEqual(result.ok, true);
        assert.ok(result.cancelledCount >= 1);

        const active = taskManager.getActiveTasks();
        assert.strictEqual(active.length, 0);
    });

    console.log('\n--- BLOQUE 5: Integración con Intenciones de Voz (jarvisActionService) ---');

    await runAsyncTest('Parser de voz: "cancelá la descarga" resuelve a task.cancel con target download', async () => {
        const resolved = await jarvisActionService.resolve('cancelá la descarga');
        assert.strictEqual(resolved.id, 'task.cancel');
        assert.strictEqual(resolved.params.target, 'download');
    });

    await runAsyncTest('Parser de voz: "Jarvis cancelá" resuelve a task.cancel general', async () => {
        const resolved = await jarvisActionService.resolve('Jarvis cancelá');
        assert.strictEqual(resolved.id, 'task.cancel');
        assert.strictEqual(resolved.params.target, null);
    });

    await runAsyncTest('Parser de voz: "pausá la descarga" resuelve a task.pause', async () => {
        const resolved = await jarvisActionService.resolve('pausá la descarga');
        assert.strictEqual(resolved.id, 'task.pause');
    });

    await runAsyncTest('Parser de voz: "reanudá la descarga" resuelve a task.resume', async () => {
        const resolved = await jarvisActionService.resolve('reanudá la descarga');
        assert.strictEqual(resolved.id, 'task.resume');
    });

    await runAsyncTest('Parser de voz: "listar tareas" resuelve a task.list', async () => {
        const resolved = await jarvisActionService.resolve('listar tareas');
        assert.strictEqual(resolved.id, 'task.list');
    });

    await runAsyncTest('Ejecución de acción task.list reporta mensaje claro al usuario', async () => {
        const result = await jarvisActionService.execute('task.list', {});
        assert.strictEqual(result.ok, true);
        assert.ok(typeof result.message === 'string');
    });

    console.log('===============================================================');
    console.log(`🏁 TESTS FINALIZADOS: ${passedTests}/${totalTests} EXITOSOS (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('===============================================================');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error fatal ejecutando tests:', err);
    process.exit(1);
});
