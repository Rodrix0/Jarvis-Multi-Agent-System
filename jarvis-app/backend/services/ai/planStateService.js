const databaseService = require('../persistence/databaseService');

class PlanStateService {
    savePlan(plan) {
        const now = new Date().toISOString();
        try {
            databaseService.db.prepare(`
                INSERT INTO plans (id, goal_id, plan_version, last_completed_step_id, status, steps_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                plan.id,
                plan.goalId || null,
                plan.planVersion || 1,
                plan.lastCompletedStepId || null,
                plan.status || 'PENDING',
                JSON.stringify(plan.steps || []),
                plan.createdAt || now,
                now
            );
        } catch (err) {
            console.error('[PlanState] Error guardando plan:', err.message);
        }
    }

    updatePlanStep(planId, stepId, status) {
        const row = databaseService.db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
        if (!row) return null;

        const steps = JSON.parse(row.steps_json || '[]');
        const step = steps.find(s => s.id === stepId);
        if (step) {
            step.status = status;
        }

        const now = new Date().toISOString();
        databaseService.db.prepare(`
            UPDATE plans 
            SET steps_json = ?, last_completed_step_id = ?, updated_at = ?
            WHERE id = ?
        `).run(JSON.stringify(steps), status === 'COMPLETED' ? stepId : row.last_completed_step_id, now, planId);

        return { planId, stepId, status };
    }

    getPlan(planId) {
        const row = databaseService.db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
        if (!row) return null;
        return {
            ...row,
            steps: JSON.parse(row.steps_json || '[]')
        };
    }
}

const planStateService = new PlanStateService();
module.exports = planStateService;
