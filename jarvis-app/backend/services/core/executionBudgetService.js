const configService = require('./configService');

class ExecutionBudgetService {
    constructor() {
        this.budgets = new Map(); // planId/actionId -> BudgetTracker
    }

    createBudget(id, customBudget = {}) {
        const defaultBudgets = configService.get('budgets', {});
        const budget = {
            maxSteps: customBudget.maxSteps || defaultBudgets.maxSteps || 20,
            maxRuntimeMs: customBudget.maxRuntimeMs || defaultBudgets.maxRuntimeMs || 120000,
            maxLLMCalls: customBudget.maxLLMCalls || defaultBudgets.maxLLMCalls || 5,
            maxRetries: customBudget.maxRetries || defaultBudgets.maxRetries || 2,
            maxParallelTasks: customBudget.maxParallelTasks || defaultBudgets.maxParallelTasks || 3,
            maxPlanRevisions: customBudget.maxPlanRevisions || defaultBudgets.maxPlanRevisions || 3,
            
            // Contadores actuales
            currentSteps: 0,
            currentLLMCalls: 0,
            currentRetries: 0,
            currentPlanRevisions: 0,
            startedAt: Date.now()
        };

        this.budgets.set(id, budget);
        return budget;
    }

    checkBudget(id) {
        const b = this.budgets.get(id);
        if (!b) return { ok: true };

        const elapsed = Date.now() - b.startedAt;
        if (elapsed > b.maxRuntimeMs) {
            return { ok: false, code: 'ERR_BUDGET_RUNTIME_EXCEEDED', reason: `Tiempo límite de ejecución (${b.maxRuntimeMs / 1000}s) excedido.` };
        }
        if (b.currentSteps >= b.maxSteps) {
            return { ok: false, code: 'ERR_BUDGET_STEPS_EXCEEDED', reason: `Cantidad máxima de pasos (${b.maxSteps}) excedida.` };
        }
        if (b.currentLLMCalls >= b.maxLLMCalls) {
            return { ok: false, code: 'ERR_BUDGET_LLM_CALLS_EXCEEDED', reason: `Límite de llamadas a IA (${b.maxLLMCalls}) alcanzado.` };
        }
        if (b.currentPlanRevisions >= b.maxPlanRevisions) {
            return { ok: false, code: 'ERR_BUDGET_REVISIONS_EXCEEDED', reason: `Límite de revisiones de plan (${b.maxPlanRevisions}) alcanzado.` };
        }

        return { ok: true };
    }

    recordStep(id) {
        const b = this.budgets.get(id);
        if (b) b.currentSteps++;
    }

    recordLLMCall(id) {
        const b = this.budgets.get(id);
        if (b) b.currentLLMCalls++;
    }

    recordPlanRevision(id) {
        const b = this.budgets.get(id);
        if (b) {
            b.currentPlanRevisions++;
            return b.currentPlanRevisions <= b.maxPlanRevisions;
        }
        return true;
    }

    clearBudget(id) {
        this.budgets.delete(id);
    }
}

const executionBudgetService = new ExecutionBudgetService();
module.exports = executionBudgetService;
