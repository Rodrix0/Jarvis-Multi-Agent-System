/**
 * Test Suite: Persistent Task Management System (Ítem 28)
 * Verifica persistencia en SQLite, puntos de control incrementales (checkpointing),
 * simulación de caídas/crashes, protocolo de auto-recuperación ante reinicio,
 * reintentos con backoff, integración con ActionKernel y FastCommandParser.
 */

const assert = require('assert');
const taskManager = require('../services/core/taskManagerService');
const databaseService = require('../services/persistence/databaseService');
const actionKernel = require('../services/actionKernelService');
const jarvisActionService = require('../services/jarvisActionService');
const fastCommandParser = require('../services/ai/fastCommandParser');
const { TASK_STATUS, RECOVERY_POLICIES } = require('../services/core/taskManagerService');

console.log('===============================================================');
console.log('🛡️  INICIANDO TESTS DE TAREAS PERSISTENTES & RECOVERY (Ítem 28)');
console.log('===============================================================\n');

let passCount = 0;
let totalCount = 0;

function test(description, fn) {
    totalCount++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function asyncTest(description, fn) {
    totalCount++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

(async () => {
    // 1. Creación y persistencia inmediata en SQLite
    test('1. Creación de tarea con persistencia inmediata en tabla persistent_tasks de SQLite', () => {
        const task = taskManager.createTask({
            type: 'download',
            description: 'Descarga de modelo Whisper large-v3',
            priority: 'HIGH',
            recoveryPolicy: RECOVERY_POLICIES.RESUME,
            payload: { url: 'https://example.com/whisper-large.bin', destination: 'C:\\Models' },
            metadata: { source: 'unit_test' }
        });

        assert.ok(task.id, 'Debe generar un ID');
        assert.strictEqual(task.status, TASK_STATUS.PENDING);

        // Verificar lectura directa desde SQLite
        const dbRow = databaseService.getPersistentTask(task.id);
        assert.ok(dbRow, 'La tarea debe existir en la base de datos');
        assert.strictEqual(dbRow.id, task.id);
        assert.strictEqual(dbRow.description, 'Descarga de modelo Whisper large-v3');
        assert.strictEqual(dbRow.status, TASK_STATUS.PENDING);
        assert.strictEqual(dbRow.recovery_policy, RECOVERY_POLICIES.RESUME);
        assert.strictEqual(dbRow.payload.url, 'https://example.com/whisper-large.bin');
    });

    // 2. Transiciones de Estado sincronizadas con SQLite
    test('2. startTask actualiza estado a RUNNING y marca started_at en SQLite', () => {
        const task = taskManager.createTask({ description: 'Compilación de Shader' });
        const started = taskManager.startTask(task.id);
        assert.strictEqual(started, true);

        const dbRow = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbRow.status, TASK_STATUS.RUNNING);
        assert.ok(dbRow.started_at, 'started_at debe estar poblado');
    });

    test('3. updateProgress actualiza progreso numérico y metadatos en SQLite', () => {
        const task = taskManager.createTask({ description: 'Procesamiento de audio' });
        taskManager.startTask(task.id);
        taskManager.updateProgress(task.id, 45, { currentChunk: 9 });

        const dbRow = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbRow.progress, 45);
        assert.strictEqual(dbRow.metadata.currentChunk, 9);
    });

    test('4. pause y resume sincronizan su estado con SQLite', () => {
        const task = taskManager.createTask({ description: 'Indexación de archivos' });
        taskManager.startTask(task.id);

        const pauseRes = taskManager.pause(task.id);
        assert.strictEqual(pauseRes.ok, true);
        let dbRow = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbRow.status, TASK_STATUS.PAUSED);

        const resumeRes = taskManager.resume(task.id);
        assert.strictEqual(resumeRes.ok, true);
        dbRow = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbRow.status, TASK_STATUS.RUNNING);
    });

    test('5. completeTask y cancel marcan estado final y finished_at en SQLite', () => {
        const t1 = taskManager.createTask({ description: 'Tarea a completar' });
        taskManager.startTask(t1.id);
        taskManager.completeTask(t1.id, { totalFiles: 5 });

        let dbRow1 = databaseService.getPersistentTask(t1.id);
        assert.strictEqual(dbRow1.status, TASK_STATUS.COMPLETED);
        assert.strictEqual(dbRow1.progress, 100);
        assert.ok(dbRow1.finished_at);

        const t2 = taskManager.createTask({ description: 'Tarea a cancelar' });
        taskManager.startTask(t2.id);
        taskManager.cancel(t2.id, 'Interrupción de usuario');

        let dbRow2 = databaseService.getPersistentTask(t2.id);
        assert.strictEqual(dbRow2.status, TASK_STATUS.CANCELLED);
        assert.ok(dbRow2.finished_at);
        assert.strictEqual(dbRow2.metadata.cancelReason, 'Interrupción de usuario');
    });

    // 3. Puntos de Control Incrementales (Checkpointing)
    test('6. Checkpointing incremental guarda hitos parciales en tabla task_checkpoints', () => {
        const task = taskManager.createTask({
            type: 'research',
            description: 'Investigación sobre Computación Cuántica'
        });
        taskManager.startTask(task.id);

        // Hito 1
        const cp1 = taskManager.checkpoint(task.id, {
            stepIndex: 1,
            stepName: 'Búsqueda de fuentes',
            data: { urlsFound: 8 }
        });
        assert.ok(cp1.id);

        // Hito 2
        const cp2 = taskManager.checkpoint(task.id, {
            stepIndex: 2,
            stepName: 'Extracción de resúmenes',
            data: { summariesExtracted: 5, pendingSources: 3 }
        });
        assert.ok(cp2.id);

        // Verificar checkpoints en SQLite
        const checkpoints = databaseService.getTaskCheckpoints(task.id);
        assert.strictEqual(checkpoints.length, 2);
        assert.strictEqual(checkpoints[0].stepName, 'Búsqueda de fuentes');
        assert.strictEqual(checkpoints[1].stepName, 'Extracción de resúmenes');
        assert.strictEqual(checkpoints[1].data.summariesExtracted, 5);

        // Verificar que la tarea guardó el último checkpoint
        const dbTask = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbTask.checkpoint.summariesExtracted, 5);
    });

    // 4. Simulación de Caída (Crash) y Auto-Recuperación
    await asyncTest('7. Protocolo Crash Recovery: Tarea con RESUME se reanuda con su handler', async () => {
        let resumeCalled = false;
        let receivedCheckpoint = null;

        taskManager.registerResumeHandler('research', async (task, cp) => {
            resumeCalled = true;
            receivedCheckpoint = cp;
            return { ok: true };
        });

        // Crear tarea y simular que quedó RUNNING al caerse el sistema
        const crashTaskId = `task_crash_resume_${Date.now()}`;
        databaseService.savePersistentTask({
            id: crashTaskId,
            type: 'research',
            description: 'Research interrumpido por corte de luz',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.RESUME,
            checkpoint: { lastAnalyzedPage: 4 }
        });

        // Ejecutar recuperación
        const recoveryRes = await taskManager.recoverOrphanTasks({ silent: true });
        assert.strictEqual(recoveryRes.ok, true);

        const recoveredTask = recoveryRes.recovered.find(t => t.id === crashTaskId);
        assert.ok(recoveredTask, 'La tarea debe estar en la lista de recuperadas');
        assert.strictEqual(recoveredTask.status, TASK_STATUS.RUNNING);
        assert.strictEqual(resumeCalled, true, 'El resumeHandler debe haberse ejecutado');
        assert.strictEqual(receivedCheckpoint.lastAnalyzedPage, 4);

        databaseService.deletePersistentTask(crashTaskId);
    });

    await asyncTest('8. Protocolo Crash Recovery: Tarea con RETRY incrementa retry_count', async () => {
        const crashTaskId = `task_crash_retry_${Date.now()}`;
        databaseService.savePersistentTask({
            id: crashTaskId,
            type: 'download',
            description: 'Descarga interrumpida',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.RETRY,
            retry_count: 0,
            max_retries: 3
        });

        const recoveryRes = await taskManager.recoverOrphanTasks({ silent: true });
        const recoveredTask = recoveryRes.recovered.find(t => t.id === crashTaskId);

        assert.ok(recoveredTask);
        assert.strictEqual(recoveredTask.status, TASK_STATUS.AWAITING_RETRY);
        assert.strictEqual(recoveredTask.retry_count, 1);

        databaseService.deletePersistentTask(crashTaskId);
    });

    await asyncTest('9. Protocolo Crash Recovery: Tarea con PROMPT_USER pasa a AWAITING_USER_CONFIRMATION', async () => {
        const crashTaskId = `task_crash_prompt_${Date.now()}`;
        databaseService.savePersistentTask({
            id: crashTaskId,
            type: 'generic',
            description: 'Entrenamiento de modelo local',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.PROMPT_USER
        });

        const recoveryRes = await taskManager.recoverOrphanTasks({ silent: true });
        const recoveredTask = recoveryRes.recovered.find(t => t.id === crashTaskId);

        assert.ok(recoveredTask);
        assert.strictEqual(recoveredTask.status, TASK_STATUS.AWAITING_USER_CONFIRMATION);

        databaseService.deletePersistentTask(crashTaskId);
    });

    await asyncTest('10. Protocolo Crash Recovery: Tarea con ABORT_ON_CRASH se cancela por seguridad', async () => {
        const crashTaskId = `task_crash_abort_${Date.now()}`;
        databaseService.savePersistentTask({
            id: crashTaskId,
            type: 'generic',
            description: 'Operación no idempotente externa',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.ABORT_ON_CRASH
        });

        const recoveryRes = await taskManager.recoverOrphanTasks({ silent: true });
        const recoveredTask = recoveryRes.recovered.find(t => t.id === crashTaskId);

        assert.ok(recoveredTask);
        assert.strictEqual(recoveredTask.status, TASK_STATUS.CANCELLED);
        assert.ok(recoveredTask.error.includes('política de seguridad'));

        databaseService.deletePersistentTask(crashTaskId);
    });

    // 5. Reintento explícito (retryTask)
    test('11. retryTask reanuda tarea fallida reseteando su progreso a 0', () => {
        const task = taskManager.createTask({ description: 'Copia de seguridad' });
        taskManager.startTask(task.id);
        taskManager.failTask(task.id, 'Disco lleno');

        const retryRes = taskManager.retryTask(task.id);
        assert.strictEqual(retryRes.ok, true);

        const dbTask = databaseService.getPersistentTask(task.id);
        assert.strictEqual(dbTask.status, TASK_STATUS.RUNNING);
        assert.strictEqual(dbTask.progress, 0);
        assert.strictEqual(dbTask.error, null);
        assert.strictEqual(dbTask.retry_count, 1);
    });

    // 6. Integración con FastCommandParser
    test('12. FastCommandParser reconoce intenciones de tareas persistentes', () => {
        const recoverCmd = fastCommandParser.parse('recuperar tareas pendientes');
        assert.strictEqual(recoverCmd.match, true);
        assert.strictEqual(recoverCmd.action, 'task.recover');

        const historyCmd = fastCommandParser.parse('ver historial de tareas');
        assert.strictEqual(historyCmd.match, true);
        assert.strictEqual(historyCmd.action, 'task.history');

        const retryCmd = fastCommandParser.parse('reintentar la descarga');
        assert.strictEqual(retryCmd.match, true);
        assert.strictEqual(retryCmd.action, 'task.retry');
    });

    // 7. Integración con ActionKernel
    await asyncTest('13. ActionKernel ejecuta task.recover y task.history sin errores', async () => {
        const recoverRes = await actionKernel.execute('task.recover', {});
        assert.strictEqual(recoverRes.ok, true);
        assert.ok(recoverRes.message.includes('tarea'));

        const historyRes = await actionKernel.execute('task.history', { limit: 10 });
        assert.strictEqual(historyRes.ok, true);
        assert.ok(historyRes.message.includes('registro histórico'));
    });

    console.log('\n===============================================================');
    console.log(`🎉 SUITE FINALIZADA: ${passCount}/${totalCount} TESTS EXITOSOS (${Math.round((passCount / totalCount) * 100)}%)`);
    console.log('===============================================================');

    if (passCount !== totalCount) {
        process.exit(1);
    } else {
        process.exit(0);
    }
})();
