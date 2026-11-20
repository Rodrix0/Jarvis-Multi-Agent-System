/**
 * Central Orchestrator: Planner -> Executor -> Verifier
 * Coordina tareas de múltiples pasos en un bucle cerrado con verificación
 * empírica paso a paso, reintento inteligente y replanificación en caso de fallo.
 */

const plannerService = require('./plannerService');
const executorService = require('./executorService');
const verifierRoleService = require('./verifierRoleService');
const replannerService = require('./replannerService');
const planStateService = require('./planStateService');

class TaskOrchestratorService {
    /**
     * Ejecuta una meta compleja o un plan estructurado mediante el bucle
     * Planner -> Executor -> Verifier -> ¿correcto? (sí: sig / no: reintentar/replanificar).
     */
    async executeGoal(goalOrPlan, options = {}) {
        let plan;
        if (typeof goalOrPlan === 'object' && Array.isArray(goalOrPlan.steps)) {
            plan = goalOrPlan;
        } else {
            plan = plannerService.createPlanForGoal({ goal: String(goalOrPlan), utterance: String(goalOrPlan) });
        }

        console.log(`\n[Orchestrator] 🚀 Iniciando ejecución de plan [${plan.id}] con ${plan.steps.length} pasos para meta: "${plan.goal}"`);
        planStateService.savePlan(plan);

        const context = {
            planId: plan.id,
            goal: plan.goal,
            stepResults: {},
            ...options.context
        };

        const executionLog = [];
        let currentStepIndex = 0;
        let totalRevisions = 0;
        const maxRevisions = 2;

        while (currentStepIndex < plan.steps.length) {
            const step = plan.steps[currentStepIndex];
            step.status = 'IN_PROGRESS';
            planStateService.updatePlanStep(plan.id, step.id, 'IN_PROGRESS');

            let stepCompleted = false;
            let attempts = 0;
            const maxRetries = step.maxRetries !== undefined ? step.maxRetries : 1;

            while (!stepCompleted && attempts <= maxRetries) {
                attempts++;
                console.log(`[Orchestrator] ➡️ Paso ${currentStepIndex + 1}/${plan.steps.length} [${step.id}] (Intento ${attempts}/${maxRetries + 1}): ${step.description}`);

                // 1. EXECUTOR ejecuta la acción
                const execResult = await executorService.executeStep(step, context);

                // 2. VERIFIER comprueba el resultado empíricamente
                const verifyResult = await verifierRoleService.verifyStep(step, execResult, context);

                executionLog.push({
                    stepId: step.id,
                    attempt: attempts,
                    execution: execResult,
                    verification: verifyResult,
                    timestamp: new Date().toISOString()
                });

                // 3. ¿Correcto?
                if (verifyResult.correct) {
                    console.log(`[Orchestrator] ✅ Paso [${step.id}] VERIFICADO con éxito.`);
                    step.status = 'COMPLETED';
                    planStateService.updatePlanStep(plan.id, step.id, 'COMPLETED');
                    context.stepResults[step.id] = {
                        output: execResult.output,
                        data: execResult.data,
                        evidence: verifyResult.evidence
                    };
                    stepCompleted = true;
                    currentStepIndex++;
                } else {
                    console.warn(`[Orchestrator] ⚠️ Paso [${step.id}] falló verificación: ${verifyResult.reason}`);
                    if (attempts <= maxRetries) {
                        console.log(`[Orchestrator] 🔄 Reintentando paso [${step.id}]...`);
                        await new Promise(r => setTimeout(r, 400));
                    } else {
                        // Reintentos agotados: Consultar a Replanner
                        totalRevisions++;
                        if (totalRevisions > maxRevisions) {
                            console.error(`[Orchestrator] 🛑 Límite de revisiones (${maxRevisions}) alcanzado. Deteniendo plan.`);
                            step.status = 'FAILED';
                            planStateService.updatePlanStep(plan.id, step.id, 'FAILED');
                            return {
                                ok: false,
                                status: 'FAILED',
                                planId: plan.id,
                                failedStepId: step.id,
                                error: `Límite de revisiones alcanzado tras fallo en '${step.description}': ${verifyResult.reason}`,
                                message: `La tarea se detuvo en el paso "${step.description}": ${verifyResult.reason}`,
                                log: executionLog,
                                context
                            };
                        }

                        console.log(`[Orchestrator] 🛑 Reintentos agotados para [${step.id}]. Activando Replanner (Revisión ${totalRevisions}/${maxRevisions})...`);
                        const replanRes = replannerService.replanOnFailure(plan, step.id, verifyResult.reason);

                        if (replanRes.ok && replanRes.revisedPlan) {
                            console.log(`[Orchestrator] 🔀 Plan replanificado a versión ${replanRes.revisedPlan.planVersion}. Reanudando...`);
                            plan = replanRes.revisedPlan;
                            // Reubicamos el índice al primer paso PENDING
                            const nextPendingIdx = plan.steps.findIndex(s => s.status === 'PENDING');
                            currentStepIndex = nextPendingIdx !== -1 ? nextPendingIdx : plan.steps.length;
                            stepCompleted = true; // Salir del bucle interno para tomar el nuevo paso
                        } else {
                            // No se puede replanificar o se alcanzó el límite
                            console.error(`[Orchestrator] ❌ Plan fallido sin recuperación posible: ${verifyResult.reason}`);
                            step.status = 'FAILED';
                            planStateService.updatePlanStep(plan.id, step.id, 'FAILED');
                            return {
                                ok: false,
                                status: 'FAILED',
                                planId: plan.id,
                                failedStepId: step.id,
                                error: verifyResult.reason,
                                message: `La tarea se detuvo en el paso "${step.description}": ${verifyResult.reason}`,
                                log: executionLog,
                                context
                            };
                        }
                    }
                }
            }
        }

        console.log(`[Orchestrator] 🎉 Plan [${plan.id}] COMPLETADO y verificado al 100%.\n`);
        return {
            ok: true,
            status: 'COMPLETED',
            planId: plan.id,
            goal: plan.goal,
            results: context.stepResults,
            message: `Plan "${plan.goal}" completado exitosamente con todos sus pasos verificados.`,
            log: executionLog
        };
    }
}

const taskOrchestratorService = new TaskOrchestratorService();
module.exports = taskOrchestratorService;
