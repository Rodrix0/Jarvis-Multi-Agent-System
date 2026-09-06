/**
 * Role: EXECUTOR
 * Responsable exclusivo de la ejecución de cada paso de un plan,
 * resolviendo variables dinámicas de pasos anteriores y ejecutando
 * las acciones a través del ActionKernel de Jarvis.
 */

const actionKernel = require('../actionKernelService');

class ExecutorService {
    /**
     * Resuelve referencias a resultados de pasos anteriores de forma recursiva y segura
     * (inmune a barras invertidas de Windows).
     * Ejemplo: params: { folderName: '{{step-1.folderName}}' }
     */
    resolveValue(val, context = {}) {
        if (typeof val === 'string') {
            return val.replace(/\{\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\}\}/g, (match, stepId, propPath) => {
                const stepResult = context.stepResults?.[stepId];
                if (!stepResult) return match;
                const value = propPath.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), stepResult.data || stepResult);
                return value !== undefined ? String(value) : match;
            });
        }
        if (Array.isArray(val)) {
            return val.map(item => this.resolveValue(item, context));
        }
        if (val && typeof val === 'object') {
            const res = {};
            for (const [k, v] of Object.entries(val)) {
                res[k] = this.resolveValue(v, context);
            }
            return res;
        }
        return val;
    }

    resolveParams(params, context = {}) {
        if (!params || typeof params !== 'object') return params;
        return this.resolveValue(params, context);
    }

    /**
     * Ejecuta un paso individual de un plan.
     */
    async executeStep(step, context = {}) {
        const start = Date.now();
        console.log(`[Executor] ⚙️ Ejecutando paso [${step.id}]: ${step.description || step.actionId}...`);

        try {
            const resolvedParams = this.resolveParams(step.params || {}, context);
            const kernelResult = await actionKernel.execute(step.actionId, resolvedParams, context);

            const elapsedMs = Date.now() - start;
            return {
                ok: kernelResult.ok !== false,
                stepId: step.id,
                actionId: step.actionId,
                params: resolvedParams,
                output: kernelResult,
                data: kernelResult.data || kernelResult.output || kernelResult,
                elapsedMs,
                error: kernelResult.ok === false ? kernelResult.message : null
            };
        } catch (error) {
            return {
                ok: false,
                stepId: step.id,
                actionId: step.actionId,
                params: step.params,
                output: null,
                elapsedMs: Date.now() - start,
                error: error.message
            };
        }
    }
}

const executorService = new ExecutorService();
module.exports = executorService;
