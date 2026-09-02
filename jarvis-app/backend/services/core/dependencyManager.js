class DependencyManager {
    constructor() {
        this.graphs = new Map(); // planId/actionId -> Map<stepId, { dependsOn: Set<string>, dependents: Set<string>, status: string }>
    }

    registerPlanGraph(planId, steps = []) {
        const stepMap = new Map();
        for (const step of steps) {
            stepMap.set(step.id, {
                dependsOn: new Set(step.dependsOn || []),
                dependents: new Set(),
                status: 'PENDING'
            });
        }

        // Construir dependientes inversos
        for (const [id, node] of stepMap.entries()) {
            for (const depId of node.dependsOn) {
                if (stepMap.has(depId)) {
                    stepMap.get(depId).dependents.add(id);
                }
            }
        }

        this.graphs.set(planId, stepMap);
    }

    canExecute(planId, stepId) {
        const stepMap = this.graphs.get(planId);
        if (!stepMap || !stepMap.has(stepId)) return true;

        const node = stepMap.get(stepId);
        for (const depId of node.dependsOn) {
            const depNode = stepMap.get(depId);
            if (!depNode || depNode.status !== 'COMPLETED') {
                return false;
            }
        }
        return true;
    }

    markCompleted(planId, stepId) {
        const stepMap = this.graphs.get(planId);
        if (stepMap && stepMap.has(stepId)) {
            stepMap.get(stepId).status = 'COMPLETED';
        }
    }

    markFailed(planId, stepId) {
        const stepMap = this.graphs.get(planId);
        if (!stepMap || !stepMap.has(stepId)) return [];

        stepMap.get(stepId).status = 'FAILED';

        // Cancelar en cascada todos los pasos dependientes
        const cancelledSteps = [];
        const queue = [...stepMap.get(stepId).dependents];

        while (queue.length > 0) {
            const currentId = queue.shift();
            const currNode = stepMap.get(currentId);
            if (currNode && currNode.status === 'PENDING') {
                currNode.status = 'CANCELLED';
                cancelledSteps.push(currentId);
                for (const nextId of currNode.dependents) {
                    queue.push(nextId);
                }
            }
        }

        return cancelledSteps;
    }

    clearGraph(planId) {
        this.graphs.delete(planId);
    }
}

const dependencyManager = new DependencyManager();
module.exports = dependencyManager;
