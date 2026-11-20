/**
 * Restart Recovery, Checkpoints & Idempotency Test Suite (JARVIS 3.1 Hardening)
 *
 * Valida:
 * 1. Puntos de control incrementales (checkpoints) y reanudación exacta de pasos.
 * 2. Llaves de idempotencia (idempotencyKey) para evitar doble ejecución de mutaciones.
 * 3. Recuperación de tareas huérfanas tras reinicio simulado (recoverOrphanTasks).
 * 4. Cumplimiento de políticas de recuperación:
 *    - RESUME: Reanuda desde el último checkpoint válido.
 *    - VERIFY_THEN_RESUME: Verifica condiciones externas antes de reanudar.
 *    - FAIL_SAFE: Detiene preventivamente requiriendo confirmación.
 *    - DO_NOT_RESUME: Cancela limpiamente registrando el cese de actividad.
 */

const assert = require('assert');
const taskManager = require('../services/core/taskManagerService');
const databaseService = require('../services/persistence/databaseService');
const { TASK_STATUS, RECOVERY_POLICIES } = require('../services/core/taskManagerService');

let passedTests = 0;
let failedTests = 0;

function logPass(name, detail = '') {
    console.log(`  ✅ [PASS] ${name} ${detail ? '(' + detail + ')' : ''}`);
    passedTests++;
}

function logFail(name, err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    failedTests++;
}

async function runRecoverySuite() {
    console.log('\n===============================================================');
    console.log('🔄 INICIANDO SUITE: RESTART RECOVERY & CHECKPOINTS (JARVIS 3.1)');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // PRUEBA 1: Flujo Multi-Paso con Checkpoints Incrementales
    // -------------------------------------------------------------
    try {
        console.log('--- TEST 1: Checkpoints Incrementales en SQLite ---');
        const task = taskManager.createTask({
            type: 'pipeline_multi_paso',
            description: 'Pipeline de 3 pasos con checkpoints',
            recoveryPolicy: RECOVERY_POLICIES.RESUME
        });
        taskManager.startTask(task.id);

        // Paso 1
        taskManager.updateProgress(task.id, 33);
        taskManager.checkpoint(task.id, { stepIndex: 1, stepName: 'Descarga de datos', data: { bytes: 1024 } });

        // Paso 2
        taskManager.updateProgress(task.id, 66);
        taskManager.checkpoint(task.id, { stepIndex: 2, stepName: 'Transformación', data: { rows: 500 } });

        // Paso 3
        taskManager.updateProgress(task.id, 90);
        const cp3 = taskManager.checkpoint(task.id, { stepIndex: 3, stepName: 'Cálculo de métricas', data: { score: 98.5 } });

        assert.ok(cp3.id, 'Debe retornar ID de checkpoint');
        const checkpointsInDb = databaseService.getTaskCheckpoints(task.id);
        assert.strictEqual(checkpointsInDb.length, 3, 'Deben existir 3 checkpoints en BD');
        assert.strictEqual(checkpointsInDb[2].stepName, 'Cálculo de métricas');
        assert.strictEqual(checkpointsInDb[2].data.score, 98.5);

        logPass('Checkpoints Incrementales', '3 checkpoints persistidos y recuperados de SQLite');
    } catch (err) {
        logFail('Checkpoints Incrementales', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 2: Llave de Idempotencia (Prevención de Doble Ejecución)
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 2: Idempotencia en Mutaciones ---');
        const idempotencyKey = `idem_${Date.now()}_unique_action`;

        const task1 = taskManager.createTask({
            type: 'mutation_task',
            description: 'Acción financiera o modificación de archivo',
            idempotencyKey,
            payload: { amount: 500 }
        });

        // Segundo intento con la misma llave
        const task2 = taskManager.createTask({
            type: 'mutation_task',
            description: 'Acción idéntica repetida por error de red o reintento',
            idempotencyKey,
            payload: { amount: 500 }
        });

        assert.strictEqual(task1.id, task2.id, 'Las dos llamadas deben retornar la misma instancia de tarea');
        logPass('Idempotencia de Tareas', `Mismo ID devuelto (${task1.id}), sin duplicación`);
    } catch (err) {
        logFail('Idempotencia de Tareas', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 3: Recuperación de Tarea Huérfana con Política RESUME
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 3: Recuperación Huérfana (RESUME) ---');
        const orphanId = `task_orphan_resume_${Date.now()}`;
        databaseService.savePersistentTask({
            id: orphanId,
            type: 'resume_worker',
            description: 'Tarea interrumpida a la mitad',
            status: 'RUNNING',
            progress: 50,
            checkpoint: { lastItem: 25 },
            recovery_policy: RECOVERY_POLICIES.RESUME
        });

        let resumedCalled = false;
        let checkpointReceived = null;
        taskManager.registerResumeHandler('resume_worker', async (task, cp) => {
            resumedCalled = true;
            checkpointReceived = cp;
            return { ok: true };
        });

        const recoveryRes = await taskManager.recoverOrphanTasks({ silent: true });
        assert.ok(recoveryRes.ok, 'recoverOrphanTasks debió responder ok');
        assert.strictEqual(resumedCalled, true, 'El handler de reanudación debió ser invocado');
        assert.strictEqual(checkpointReceived.lastItem, 25, 'Debe recibir el checkpoint persistido');

        const updated = databaseService.getPersistentTask(orphanId);
        assert.strictEqual(updated.status, TASK_STATUS.RUNNING, 'Estado debe quedar en RUNNING tras reanudación');

        logPass('Recuperación RESUME', 'Reanudó desde el checkpoint exacto');
    } catch (err) {
        logFail('Recuperación RESUME', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 4: Política VERIFY_THEN_RESUME
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 4: Política VERIFY_THEN_RESUME ---');
        const verifyTaskId = `task_orphan_verify_${Date.now()}`;
        databaseService.savePersistentTask({
            id: verifyTaskId,
            type: 'verify_worker',
            description: 'Tarea que requiere verificación de estado externo',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.VERIFY_THEN_RESUME
        });

        let verifyExecuted = false;
        taskManager.registerResumeHandler('verify_worker', async (task, cp, options) => {
            if (options && options.verify) {
                verifyExecuted = true;
            }
            return { ok: true };
        });

        await taskManager.recoverOrphanTasks({ silent: true });
        assert.strictEqual(verifyExecuted, true, 'La verificación debió ejecutarse');

        const updated = databaseService.getPersistentTask(verifyTaskId);
        assert.strictEqual(updated.status, TASK_STATUS.RUNNING);

        logPass('Política VERIFY_THEN_RESUME', 'Verificación completada antes de reanudar');
    } catch (err) {
        logFail('Política VERIFY_THEN_RESUME', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 5: Política FAIL_SAFE
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 5: Política FAIL_SAFE ---');
        const failSafeId = `task_orphan_failsafe_${Date.now()}`;
        databaseService.savePersistentTask({
            id: failSafeId,
            type: 'sensitive_mutation',
            description: 'Modificación crítica que no debe reanudarse a ciegas',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.FAIL_SAFE
        });

        await taskManager.recoverOrphanTasks({ silent: true });
        const updated = databaseService.getPersistentTask(failSafeId);
        assert.strictEqual(updated.status, TASK_STATUS.AWAITING_USER_CONFIRMATION, 'FAIL_SAFE debe exigir confirmación');
        assert.ok(updated.error.includes('FAIL_SAFE'), 'Debe documentar la detención preventiva');

        logPass('Política FAIL_SAFE', 'Detenida preventivamente en AWAITING_USER_CONFIRMATION');
    } catch (err) {
        logFail('Política FAIL_SAFE', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 6: Política DO_NOT_RESUME
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 6: Política DO_NOT_RESUME ---');
        const noResumeId = `task_orphan_no_resume_${Date.now()}`;
        databaseService.savePersistentTask({
            id: noResumeId,
            type: 'fire_and_forget',
            description: 'Tarea efímera cancelable tras caída',
            status: 'RUNNING',
            recovery_policy: RECOVERY_POLICIES.DO_NOT_RESUME
        });

        await taskManager.recoverOrphanTasks({ silent: true });
        const updated = databaseService.getPersistentTask(noResumeId);
        assert.strictEqual(updated.status, TASK_STATUS.CANCELLED, 'DO_NOT_RESUME debe marcarse como CANCELLED');
        assert.ok(updated.finished_at, 'Debe marcar finished_at');

        logPass('Política DO_NOT_RESUME', 'Cancelada limpiamente con timestamp de finalización');
    } catch (err) {
        logFail('Política DO_NOT_RESUME', err);
    }

    // -------------------------------------------------------------
    // PRUEBA 7: Reanudación Real Multi-Paso (Paso 3 de 5 con Idempotencia)
    // -------------------------------------------------------------
    try {
        console.log('\n--- TEST 7: Reanudación Exacta Multi-Paso (3/5) sin re-ejecución ---');
        const pipelineId = `task_pipeline_5steps_${Date.now()}`;
        
        // Simulación: El proceso anterior ejecutó pasos 1, 2 y 3, y murió abruptamente
        databaseService.savePersistentTask({
            id: pipelineId,
            type: 'five_step_pipeline',
            description: 'Proceso de 5 pasos interrumpido en el paso 3',
            status: TASK_STATUS.RUNNING,
            progress: 60,
            recovery_policy: RECOVERY_POLICIES.RESUME,
            checkpoint: {
                lastCompletedStep: 3,
                stepsExecuted: [1, 2, 3],
                accumulatedResult: ['data1', 'data2', 'data3']
            }
        });

        // Registrar checkpoints previos en SQLite
        databaseService.saveTaskCheckpoint(pipelineId, 1, 'Paso 1: Ingesta', { step: 1 });
        databaseService.saveTaskCheckpoint(pipelineId, 2, 'Paso 2: Limpieza', { step: 2 });
        databaseService.saveTaskCheckpoint(pipelineId, 3, 'Paso 3: Transformación', { step: 3 });

        // Handler de reanudación en el nuevo proceso
        const stepsRunInRecovery = [];
        taskManager.registerResumeHandler('five_step_pipeline', async (task, cp) => {
            const lastStep = cp ? (cp.step || cp.lastCompletedStep || cp.stepIndex || 0) : 0;
            const startStep = lastStep + 1;
            const accum = cp && cp.accumulatedResult ? [...cp.accumulatedResult] : ['data1', 'data2', 'data3'];

            for (let step = startStep; step <= 5; step++) {
                stepsRunInRecovery.push(step);
                accum.push(`data${step}`);
                taskManager.checkpoint(task.id, {
                    stepIndex: step,
                    stepName: `Paso ${step}`,
                    data: { step, accumulatedResult: accum }
                });
                taskManager.updateProgress(task.id, Math.round((step / 5) * 100));
            }

            taskManager.completeTask(task.id, { finalResult: accum });
            return { ok: true, completed: true };
        });

        // Ejecutar recuperación
        await taskManager.recoverOrphanTasks({ silent: true });

        // Validar idempotencia: pasos 1, 2 y 3 NO se ejecutaron de nuevo
        assert.deepStrictEqual(stepsRunInRecovery, [4, 5], 'Solo deben ejecutarse los pasos 4 y 5');
        
        // Validar estado final
        const finalTask = databaseService.getPersistentTask(pipelineId);
        assert.strictEqual(finalTask.status, TASK_STATUS.COMPLETED, 'El estado final debe ser COMPLETED');
        assert.strictEqual(finalTask.progress, 100, 'El progreso final debe ser 100%');

        const allCps = databaseService.getTaskCheckpoints(pipelineId);
        assert.strictEqual(allCps.length, 5, 'Deben existir exactamente 5 checkpoints en SQLite');

        logPass('Reanudación Multi-Paso (3/5)', 'Reanudó en paso 4 y 5 sin re-ejecutar pasos 1, 2, 3');
    } catch (err) {
        logFail('Reanudación Multi-Paso (3/5)', err);
    }

    // -------------------------------------------------------------
    // RESUMEN
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS RECOVERY & CHECKPOINTS: ${passedTests} APROBADOS, ${failedTests} FALLIDOS`);
    console.log('===============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runRecoverySuite().catch(err => {
    console.error('Fatal error en suite de restart recovery:', err);
    process.exit(1);
});
