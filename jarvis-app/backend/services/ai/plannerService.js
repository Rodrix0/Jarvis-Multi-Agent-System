const crypto = require('crypto');
const planValidatorService = require('./planValidatorService');
const toolRegistryService = require('../core/toolRegistryService');

class PlannerService {
    createPlanForGoal({ goal, utterance }) {
        const planId = `plan-${crypto.randomUUID().slice(0, 8)}`;
        const clean = String(utterance || goal || '').toLowerCase();

        // 1. Plantilla Heurística Rápida: "Buscá X, haceme copia y mandáselo a Y"
        if (clean.includes('busca') && clean.includes('copia') && (clean.includes('manda') || clean.includes('envia'))) {
            const plan = {
                id: planId,
                goal: goal || 'Buscar archivo, duplicar y enviar',
                planVersion: 1,
                lastCompletedStepId: null,
                status: 'PENDING',
                steps: [
                    { id: 'step-1', tool: 'file.search@2', params: { query: 'documento' }, dependsOn: [] },
                    { id: 'step-2', tool: 'file.copy@1', params: { source: '', destination: '' }, dependsOn: ['step-1'] },
                    { id: 'step-3', tool: 'communication.send-email@1', params: { recipient: '', subject: 'Envío de documento', body: '' }, dependsOn: ['step-2'] }
                ]
            };

            const validated = planValidatorService.validatePlanSchema(plan);
            if (validated.valid) {
                return planValidatorService.insertHumanCheckpoints(plan);
            }
        }

        // 2. Plan genérico de paso simple
        return {
            id: planId,
            goal: goal || utterance,
            planVersion: 1,
            lastCompletedStepId: null,
            status: 'PENDING',
            steps: [
                { id: 'step-1', tool: 'file.search@2', params: { query: clean }, dependsOn: [] }
            ]
        };
    }
}

const plannerService = new PlannerService();
module.exports = plannerService;
