const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');
const eventBus = require('../core/eventBusService');

class GoalManagerService {
    createGoal({
        title,
        priority = 'MEDIUM', // 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
        deadline = null,
        createdBy = 'user',
        subgoals = []
    }) {
        const goalId = `goal-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        const goal = {
            id: goalId,
            title,
            status: 'IN_PROGRESS', // 'PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'
            priority,
            deadline,
            createdBy,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            subgoals: subgoals.map((sg, idx) => ({
                id: sg.id || `sg-${idx + 1}`,
                title: sg.title || sg,
                status: 'PENDING'
            }))
        };

        try {
            databaseService.db.prepare(`
                INSERT INTO goals (id, title, status, priority, deadline, created_by, created_at, updated_at, subgoals_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(goal.id, goal.title, goal.status, goal.priority, goal.deadline, goal.createdBy, goal.createdAt, goal.updatedAt, JSON.stringify(goal.subgoals));
        } catch (err) {
            console.error('[GoalManager] Error guardando objetivo:', err.message);
        }

        eventBus.publish('GOAL_CREATED', { goal });
        return goal;
    }

    updateSubgoalStatus(goalId, subgoalId, status) {
        const row = databaseService.db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
        if (!row) return null;

        const subgoals = JSON.parse(row.subgoals_json || '[]');
        const target = subgoals.find(s => s.id === subgoalId);
        if (target) {
            target.status = status;
        }

        // Si todos los subobjetivos están completos, completar objetivo
        const allCompleted = subgoals.length > 0 && subgoals.every(s => s.status === 'COMPLETED');
        const nextStatus = allCompleted ? 'COMPLETED' : row.status;
        const now = new Date().toISOString();

        databaseService.db.prepare(`
            UPDATE goals 
            SET status = ?, subgoals_json = ?, updated_at = ?, completed_at = ?
            WHERE id = ?
        `).run(nextStatus, JSON.stringify(subgoals), now, allCompleted ? now : null, goalId);

        return { goalId, status: nextStatus, subgoals };
    }

    setGoalStatus(goalId, status) {
        const now = new Date().toISOString();
        const completedAt = status === 'COMPLETED' ? now : null;
        databaseService.db.prepare(`
            UPDATE goals 
            SET status = ?, updated_at = ?, completed_at = ?
            WHERE id = ?
        `).run(status, now, completedAt, goalId);

        return { goalId, status, updatedAt: now };
    }

    listGoals(filterStatus = null) {
        let sql = 'SELECT * FROM goals';
        const params = [];
        if (filterStatus) {
            sql += ' WHERE status = ?';
            params.push(filterStatus);
        }
        sql += ' ORDER BY created_at DESC';

        const rows = databaseService.db.prepare(sql).all(...params);
        return rows.map(r => ({
            ...r,
            subgoals: JSON.parse(r.subgoals_json || '[]')
        }));
    }
}

const goalManagerService = new GoalManagerService();
module.exports = goalManagerService;
