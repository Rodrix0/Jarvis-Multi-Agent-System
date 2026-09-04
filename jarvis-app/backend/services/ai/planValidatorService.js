const toolRegistryService = require('../core/toolRegistryService');
const securityPolicyService = require('../core/securityPolicyService');

class PlanValidatorService {
    validatePlanSchema(plan) {
        if (!plan || typeof plan !== 'object') {
            return { valid: false, code: 'ERR_INVALID_PLAN_SCHEMA', reason: 'El plan debe ser un objeto JSON estructurado válido.' };
        }
        if (!plan.goal || typeof plan.goal !== 'string') {
            return { valid: false, code: 'ERR_MISSING_PLAN_GOAL', reason: 'El plan carece de un objetivo ("goal") en formato texto.' };
        }
        if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
            return { valid: false, code: 'ERR_EMPTY_PLAN_STEPS', reason: 'El plan debe contener un arreglo de pasos ("steps").' };
        }

        for (const step of plan.steps) {
            if (!step.id || !step.tool) {
                return { valid: false, code: 'ERR_INVALID_STEP_STRUCTURE', reason: `El paso ${JSON.stringify(step)} carece de id o tool.` };
            }

            const toolDef = toolRegistryService.getTool(step.tool.split('@')[0]);
            if (!toolDef) {
                return { valid: false, code: 'ERR_TOOL_NOT_FOUND', reason: `La herramienta ${step.tool} no existe en el registro de Jarvis.` };
            }

            if (toolDef.health === 'OFFLINE' || toolDef.health === 'CIRCUIT_OPEN') {
                return { valid: false, code: 'ERR_TOOL_UNAVAILABLE', reason: `La herramienta ${step.tool} no está disponible (estado: ${toolDef.health}).` };
            }
        }

        return { valid: true };
    }

    insertHumanCheckpoints(plan) {
        // Si el plan tiene pasos de comunicación externa o destructivos, marcar punto de control previo
        const enrichedSteps = plan.steps.map(step => {
            const level = securityPolicyService.getActionLevel(step.tool.split('@')[0]);
            const isSensitive = level === 'L2' || level === 'L3';
            return {
                ...step,
                level,
                requiresHumanCheckpoint: isSensitive
            };
        });

        return { ...plan, steps: enrichedSteps };
    }
}

const planValidatorService = new PlanValidatorService();
module.exports = planValidatorService;
