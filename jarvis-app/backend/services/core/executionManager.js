const crypto = require('crypto');
const eventBus = require('./eventBusService');
const databaseService = require('../persistence/databaseService');
const resourceLockManager = require('./resourceLockManager');
const configService = require('./configService');

// Matriz de transiciones válidas de estado
const VALID_TRANSITIONS = {
    'PENDING': new Set(['AWAITING_AUTH', 'AWAITING_INFO', 'RUNNING', 'CANCELLED', 'FAILED']),
    'AWAITING_AUTH': new Set(['RUNNING', 'CANCELLED', 'FAILED']),
    'AWAITING_INFO': new Set(['RUNNING', 'CANCELLED', 'FAILED']),
    'RUNNING': new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    'COMPLETED': new Set([]), // Estado final
    'FAILED': new Set([]),    // Estado final
    'CANCELLED': new Set([]), // Estado final
    'INTERRUPTED': new Set(['RUNNING', 'CANCELLED', 'FAILED']) // Puede reanudarse si es restart_safe
};

const PRIORITY_ORDER = {
    'EMERGENCY': 0,
    'SYSTEM': 1,
    'USER_INTERACTIVE': 2,
    'BACKGROUND': 3,
    'MAINTENANCE': 4
};

class ExecutionManager {
    constructor() {
        this.activeExecutions = new Map(); // executionId -> ExecutionContext
        this.idempotencyCache = new Map(); // hash -> { executionId, timestamp, result }
        this.childProcesses = new Set();  // Set<ChildProcess> para kill switch rápido
    }

    registerChildProcess(proc) {
        if (!proc) return;
        this.childProcesses.add(proc);
        proc.on?.('exit', () => this.childProcesses.delete(proc));
    }

    unregisterChildProcess(proc) {
        this.childProcesses.delete(proc);
    }

    checkIdempotency(action, params = {}) {
        const hash = crypto.createHash('sha256')
            .update(`${action}|${JSON.stringify(params)}`, 'utf8')
            .digest('hex');
        
        const cached = this.idempotencyCache.get(hash);
        if (cached && (Date.now() - cached.timestamp < 3000)) {
            return { duplicate: true, executionId: cached.executionId, result: cached.result };
        }
        return { duplicate: false, hash };
    }

    recordIdempotency(hash, executionId, result) {
        this.idempotencyCache.set(hash, {
            executionId,
            timestamp: Date.now(),
            result
        });
        setTimeout(() => this.idempotencyCache.delete(hash), 5000).unref?.();
    }

    transition(execCtx, nextStatus, error = null) {
        const current = execCtx.status;
        const validNext = VALID_TRANSITIONS[current];

        if (!validNext || !validNext.has(nextStatus)) {
            console.error(`[ExecutionManager] ❌ Transición de estado inválida para ${execCtx.id}: ${current} -> ${nextStatus}`);
            return false;
        }

        execCtx.status = nextStatus;
        if (error) execCtx.error = error;
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(nextStatus)) {
            execCtx.finishedAt = new Date().toISOString();
        }

        // Actualizar en base de datos SQLite
        try {
            databaseService.db.prepare(`
                UPDATE executions 
                SET status = ?, finished_at = ?, progress = ?, error = ? 
                WHERE id = ?
            `).run(execCtx.status, execCtx.finishedAt || null, execCtx.progress || 0, execCtx.error ? String(execCtx.error) : null, execCtx.id);
        } catch (err) {
            console.error(`[ExecutionManager] Error actualizando BD para ${execCtx.id}:`, err.message);
        }

        // Emitir en Event Bus
        eventBus.publish(`EXECUTION_${nextStatus}`, {
            executionId: execCtx.id,
            actionId: execCtx.actionId,
            status: nextStatus,
            action: execCtx.action,
            level: execCtx.level,
            error: execCtx.error
        });

        return true;
    }

    async runTask({
        action,
        actionId = crypto.randomUUID(),
        parentExecutionId = null,
        level = 'L1',
        priority = 'USER_INTERACTIVE',
        params = {},
        requiredLock = null,
        timeoutMs = null,
        reversible = false,
        executeFn
    }) {
        const executionId = `exec-${crypto.randomUUID().slice(0, 8)}`;
        const idempotency = this.checkIdempotency(action, params);
        if (idempotency.duplicate) {
            console.log(`[ExecutionManager] 🔁 Orden duplicada detectada (<3s) para ${action}. Reutilizando resultado.`);
            return idempotency.result;
        }

        const effectiveTimeout = timeoutMs || configService.get(`timeouts.${action}Ms`) || 30000;
        const startedAt = new Date().toISOString();

        const execCtx = {
            id: executionId,
            actionId,
            parentExecutionId,
            action,
            level,
            priority,
            priorityVal: PRIORITY_ORDER[priority] || 2,
            status: 'PENDING',
            startedAt,
            finishedAt: null,
            progress: 0,
            error: null,
            cancelable: 1,
            rollbackAvailable: reversible ? 1 : 0,
            params,
            abortController: new AbortController()
        };

        this.activeExecutions.set(executionId, execCtx);

        // Guardar registro inicial en SQLite
        try {
            databaseService.db.prepare(`
                INSERT INTO executions (id, action_id, parent_execution_id, level, status, started_at, cancelable, rollback_available, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                executionId,
                actionId,
                parentExecutionId,
                level,
                'PENDING',
                startedAt,
                1,
                reversible ? 1 : 0,
                JSON.stringify({ action, params })
            );
        } catch (err) {
            console.error(`[ExecutionManager] Error guardando registro inicial para ${executionId}:`, err.message);
        }

        // 1. Adquirir lock de recurso si se solicita
        if (requiredLock) {
            const lockResult = resourceLockManager.acquireLock(requiredLock, executionId);
            if (!lockResult.acquired) {
                this.transition(execCtx, 'FAILED', lockResult.reason);
                this.activeExecutions.delete(executionId);
                return { ok: false, code: lockResult.code || 'ERR_RESOURCE_LOCKED', message: lockResult.reason };
            }
        }

        // 2. Transicionar a RUNNING
        this.transition(execCtx, 'RUNNING');

        // 3. Ejecutar con Timeout estricto
        let timeoutHandle = null;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    execCtx.abortController.abort();
                    reject(new Error(`ERR_TIMEOUT: La acción ${action} superó el límite de ${effectiveTimeout / 1000}s.`));
                }, effectiveTimeout);
            });

            const result = await Promise.race([
                executeFn(execCtx.abortController.signal),
                timeoutPromise
            ]);

            clearTimeout(timeoutHandle);
            this.transition(execCtx, 'COMPLETED');
            this.recordIdempotency(idempotency.hash, executionId, result);

            // Auditar en hash chain
            databaseService.appendAudit({
                executionId,
                action,
                level,
                status: 'COMPLETED',
                data: { params, resultSummary: result?.message || 'OK' }
            });

            return result;
        } catch (err) {
            clearTimeout(timeoutHandle);
            const isAborted = execCtx.abortController.signal.aborted;
            const finalStatus = isAborted ? 'CANCELLED' : 'FAILED';
            this.transition(execCtx, finalStatus, err.message);

            // Auditar fallo en hash chain
            databaseService.appendAudit({
                executionId,
                action,
                level,
                status: finalStatus,
                data: { params, error: err.message }
            });

            return { ok: false, code: err.message.startsWith('ERR_') ? err.message.split(':')[0] : 'ERR_EXECUTION_FAILED', message: err.message };
        } finally {
            if (requiredLock) {
                resourceLockManager.releaseLock(requiredLock, executionId);
            }
            this.activeExecutions.delete(executionId);
        }
    }

    abortAll() {
        console.log(`[ExecutionManager] 🚨 EMERGENCY STOP disparado. Abortando ${this.activeExecutions.size} tareas activas y ${this.childProcesses.size} procesos hijos...`);
        
        // 1. Abortar señales de tareas
        for (const [id, execCtx] of this.activeExecutions.entries()) {
            try {
                execCtx.abortController.abort();
                this.transition(execCtx, 'CANCELLED', 'Abortado por Emergency Stop.');
            } catch (e) {}
        }
        this.activeExecutions.clear();

        // 2. Matar procesos hijos
        for (const proc of this.childProcesses) {
            try {
                proc.kill('SIGKILL');
            } catch (e) {}
        }
        this.childProcesses.clear();

        eventBus.publish('EMERGENCY_STOP', { timestamp: new Date().toISOString() });
    }
}

const executionManager = new ExecutionManager();
module.exports = executionManager;
