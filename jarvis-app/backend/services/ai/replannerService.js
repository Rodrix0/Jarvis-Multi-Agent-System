const executionBudgetService = require('../core/executionBudgetService');
const planStateService = require('./planStateService');

class ReplannerService {
    replanOnFailure(originalPlan, failedStepId, errorReason) {
        const canRevise = executionBudgetService.recordPlanRevision(originalPlan.id);
        if (!canRevise) {
            console.warn(`[Replanner] 🛑 Límite de revisiones de plan alcanzado (${originalPlan.id}). Solicitando intervención humana.`);
            return {
                ok: false,
                code: 'ERR_MAX_PLAN_REVISIONS_EXCEEDED',
                message: 'Se alcanzó el límite de 3 intentos de replanificación sin éxito. Se requiere confirmación manual.'
            };
        }

        const newVersion = (originalPlan.planVersion || 1) + 1;
        console.log(`[Replanner] 🔄 Generando Plan v${newVersion} para sustituir paso fallido ${failedStepId} (${errorReason})...`);

        // Clonar pasos completados y sustituir o adaptar pasos restantes
        const revisedSteps = originalPlan.steps.map(step => {
            if (step.id === failedStepId) {
                // Adaptación heurística si era copia de archivo a ruta fallida
                if (step.tool === 'file.copy' && step.params?.destination?.includes('Desktop')) {
                    const fallbackDest = step.params.destination.replace('Desktop', 'Downloads');
                    return {
                        ...step,
                        id: `${step.id}_v${newVersion}`,
                        status: 'PENDING',
                        params: { ...step.params, destination: fallbackDest }
                    };
                }
                return { ...step, status: 'PENDING' };
            }
            if (step.status !== 'COMPLETED') {
                return { ...step, status: 'PENDING' };
            }
            return step;
        });

        const revisedPlan = {
            id: `${originalPlan.id}_v${newVersion}`,
            goalId: originalPlan.goalId,
            planVersion: newVersion,
            lastCompletedStepId: originalPlan.lastCompletedStepId,
            status: 'PENDING',
            steps: revisedSteps
        };

        planStateService.savePlan(revisedPlan);
        return { ok: true, revisedPlan };
    }
}

const replannerService = new ReplannerService();
module.exports = replannerService;
