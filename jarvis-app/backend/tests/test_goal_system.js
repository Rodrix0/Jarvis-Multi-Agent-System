/**
 * test_goal_system.js
 * 
 * Suite de pruebas unitarias para el Ítem 50:
 * Sistema de Objetivos Jerárquicos y Ejecución Autónoma Paso a Paso.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const goalManager = require('../services/goals/goalManagerService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService');

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
    console.log('🧪 INICIANDO SUITE DE PRUEBAS: SISTEMA DE OBJETIVOS (ÍTEM 50)');
    console.log('===============================================================');

    let unityGoalId = null;

    // 1. Descomposición automática de instrucción macro en subobjetivos (Ejemplo Unity)
    test('Descomposición automática de meta: "Crear juego simple en Unity"', () => {
        const goal = goalManager.planGoalFromInstruction('Crear juego simple en Unity');
        unityGoalId = goal.id;

        assert.ok(goal.id && goal.id.startsWith('goal-'), 'Debe generar un ID de objetivo válido');
        assert.strictEqual(goal.title, 'Crear juego simple en Unity');
        assert.strictEqual(goal.status, 'PENDING');
        assert.strictEqual(goal.subgoals.length, 5, 'Debe desglosarse en 5 subobjetivos');

        assert.strictEqual(goal.subgoals[0].id, 'sg-1');
        assert.ok(goal.subgoals[0].title.includes('proyecto'), 'Paso 1: crear proyecto');
        assert.strictEqual(goal.subgoals[1].id, 'sg-2');
        assert.ok(goal.subgoals[1].title.includes('Player'), 'Paso 2: crear player');
        assert.strictEqual(goal.subgoals[2].id, 'sg-3');
        assert.ok(goal.subgoals[2].title.includes('Movimiento'), 'Paso 3: crear movimiento');
        assert.strictEqual(goal.subgoals[3].id, 'sg-4');
        assert.ok(goal.subgoals[3].title.includes('Enemigo'), 'Paso 4: crear enemigo');
        assert.strictEqual(goal.subgoals[4].id, 'sg-5');
        assert.ok(goal.subgoals[4].title.includes('compilación') || goal.subgoals[4].title.includes('Testear'), 'Paso 5: testear');
    });

    // 2. Consulta de progreso inicial
    test('Métricas y cálculo de progreso inicial (0%)', () => {
        const prog = goalManager.getGoalProgress(unityGoalId);
        assert.strictEqual(prog.totalSteps, 5);
        assert.strictEqual(prog.completedSteps, 0);
        assert.strictEqual(prog.progressPercentage, 0);
        assert.strictEqual(prog.currentStep.id, 'sg-1');
    });

    // 3. Ejecución unitaria del primer paso (stepGoal)
    await testAsync('Ejecución paso a paso: completar paso 1 (20% de avance)', async () => {
        const stepRes = await goalManager.stepGoal(unityGoalId);
        assert.strictEqual(stepRes.ok, true);
        assert.strictEqual(stepRes.completedSubgoal.id, 'sg-1');
        assert.strictEqual(stepRes.completedSubgoal.status, 'COMPLETED');
        assert.strictEqual(stepRes.progressPercentage, 20);
        assert.strictEqual(stepRes.nextSubgoal.id, 'sg-2');
        assert.strictEqual(stepRes.isComplete, false);

        const prog = goalManager.getGoalProgress(unityGoalId);
        assert.strictEqual(prog.completedSteps, 1);
        assert.strictEqual(prog.progressPercentage, 20);
        assert.strictEqual(prog.status, 'IN_PROGRESS');
    });

    // 4. Control de pausa y reanudación
    await testAsync('Control de misión: pausar y reanudar ejecución', async () => {
        goalManager.pauseGoal(unityGoalId);
        const progPaused = goalManager.getGoalProgress(unityGoalId);
        assert.strictEqual(progPaused.status, 'PAUSED');

        // Intentar avanzar con objetivo pausado debe ser bloqueado
        const blockedStep = await goalManager.stepGoal(unityGoalId);
        assert.strictEqual(blockedStep.ok, false);
        assert.ok(blockedStep.error.includes('pausa'), 'Debe reportar que el objetivo está en pausa');

        // Reanudar objetivo
        goalManager.resumeGoal(unityGoalId);
        const progResumed = goalManager.getGoalProgress(unityGoalId);
        assert.strictEqual(progResumed.status, 'IN_PROGRESS');

        // Ahora avanzar paso 2
        const step2 = await goalManager.stepGoal(unityGoalId);
        assert.strictEqual(step2.ok, true);
        assert.strictEqual(step2.completedSubgoal.id, 'sg-2');
        assert.strictEqual(step2.progressPercentage, 40);
    });

    // 5. Ejecución secuencial hasta completar la totalidad de la meta (100%)
    await testAsync('Ejecución autónoma secuencial hasta completar el 100%', async () => {
        // Ejecutar los pasos restantes (sg-3, sg-4, sg-5)
        const execRes = await goalManager.executeGoalStepByStep(unityGoalId, { maxSteps: 10 });
        assert.strictEqual(execRes.ok, true);

        const finalProg = goalManager.getGoalProgress(unityGoalId);
        assert.strictEqual(finalProg.completedSteps, 5);
        assert.strictEqual(finalProg.progressPercentage, 100);
        assert.strictEqual(finalProg.status, 'COMPLETED');
    });

    // 6. Persistencia e integridad en SQLite
    test('Persistencia e integridad en base de datos SQLite', () => {
        const goals = goalManager.listGoals('COMPLETED');
        const found = goals.find(g => g.id === unityGoalId);
        assert.ok(found, 'El objetivo completado debe persistir en SQLite');
        assert.strictEqual(found.status, 'COMPLETED');
        assert.strictEqual(found.subgoals.filter(s => s.status === 'COMPLETED').length, 5);
    });

    // 7. Integración completa con ActionKernel (goal.plan, goal.plan_and_execute, goal.progress)
    await testAsync('Integración con ActionKernel: goal.plan_and_execute y goal.progress', async () => {
        // Planificar y ejecutar meta de backend autónomamente mediante ActionKernel
        const planExec = await actionKernel.execute('goal.plan_and_execute', {
            instruction: 'Crear API REST con Node.js',
            maxSteps: 10
        });

        assert.strictEqual(planExec.status, 'completed');
        assert.ok(planExec.message.includes('Progreso: 100%') || planExec.message.includes('Ejecutados'));

        const goalId = planExec.data.goalId;
        const progRes = await actionKernel.execute('goal.progress', { goalId });
        assert.strictEqual(progRes.status, 'completed');
        assert.strictEqual(progRes.data.progressPercentage, 100);
        assert.strictEqual(progRes.data.status, 'COMPLETED');
    });

    console.log('===============================================================');
    console.log(`🏁 RESULTADOS SUITE SISTEMA DE OBJETIVOS: ${passedTests} / ${totalTests} PASS`);
    console.log('===============================================================');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Error fatal ejecutando suite:', err);
    process.exit(1);
});
