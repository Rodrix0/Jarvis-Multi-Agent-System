/**
 * Task Manager Service for Jarvis (Ítems 25 y 28)
 * Gestor centralizado de ciclo de vida de tareas con persistencia transaccional en SQLite,
 * puntos de control incrementales (checkpointing), detección de caídas (crash detection)
 * y protocolo de recuperación automática ante reinicio (auto-recovery).
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

const TASK_STATUS = {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    AWAITING_RETRY: 'AWAITING_RETRY',
    AWAITING_USER_CONFIRMATION: 'AWAITING_USER_CONFIRMATION',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
};

const TASK_TYPES = {
    DOWNLOAD: 'download',
    INSTALLATION: 'installation',
    BROWSER: 'browser',
    PYTHON_SKILL: 'python_skill',
    RESEARCH: 'research',
    TTS: 'tts',
    AUTOMATION: 'automation',
    GENERIC: 'generic'
};

const RECOVERY_POLICIES = {
    RESUME: 'RESUME',
    RETRY: 'RETRY',
    PROMPT_USER: 'PROMPT_USER',
    ABORT_ON_CRASH: 'ABORT_ON_CRASH'
};

class TaskManagerService extends EventEmitter {
    constructor() {
        super();
        this.tasks = new Map(); // taskId -> TaskObject
        this.resumeHandlers = new Map(); // taskType -> async (task, checkpoint) => { ... }
        this.maxHistory = 100;
        this.databaseService = databaseService;
    }

    /**
     * Registra un manejador de reanudación para un tipo específico de tarea (ej: 'download', 'plan_step').
     */
    registerResumeHandler(type, handler) {
        if (typeof handler === 'function') {
            this.resumeHandlers.set(String(type).toLowerCase().trim(), handler);
        }
    }

    /**
     * Registra y crea una nueva tarea en el gestor con persistencia en SQLite.
     */
    createTask({
        type = TASK_TYPES.GENERIC,
        description = 'Tarea sin descripción',
        priority = 'NORMAL',
        payload = null,
        checkpoint = null,
        recoveryPolicy = RECOVERY_POLICIES.RESUME,
        maxRetries = 3,
        cancelFn = null,
        pauseFn = null,
        resumeFn = null,
        abortController = null,
        childProcess = null,
        metadata = {},
        correlationId = null,
        goalId = null,
        planId = null
    } = {}) {
        const id = `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const createdAt = new Date().toISOString();
        const corrId = correlationId || metadata.correlationId || `corr_${id}`;

        const task = {
            id,
            correlationId: corrId,
            goalId: goalId || metadata.goalId || null,
            planId: planId || metadata.planId || null,
            type,
            description,
            priority,
            status: TASK_STATUS.PENDING,
            progress: 0,
            payload,
            checkpoint,
            recovery_policy: recoveryPolicy,
            retry_count: 0,
            max_retries: maxRetries,
            createdAt,
            startedAt: null,
            finishedAt: null,
            error: null,
            metadata: { ...metadata, correlationId: corrId, goalId, planId },
            handle: {
                cancelFn,
                pauseFn,
                resumeFn,
                abortController,
                childProcess
            }
        };

        // 1. Guardar en memoria
        this.tasks.set(id, task);
        this._trimHistory();

        // 2. Persistir en SQLite (Ítem 28)
        try {
            this.databaseService.savePersistentTask(task);
        } catch (err) {
            console.error(`[TaskManager] Error persistiendo tarea ${id} en BD:`, err.message);
        }

        this.emit('task:created', this.sanitizeTask(task));
        return task;
    }

    /**
     * Marca una tarea como iniciada (RUNNING).
     */
    startTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (task.status === TASK_STATUS.CANCELLED || task.status === TASK_STATUS.COMPLETED) {
            return false;
        }

        task.status = TASK_STATUS.RUNNING;
        task.startedAt = task.startedAt || new Date().toISOString();

        try {
            this.databaseService.updatePersistentTask(taskId, {
                status: TASK_STATUS.RUNNING,
                started_at: task.startedAt
            });
        } catch (e) {}

        this.emit('task:started', this.sanitizeTask(task));
        return true;
    }

    /**
     * Actualiza el progreso numérico de una tarea (0 a 100).
     */
    updateProgress(taskId, progress, metadataUpdate = {}) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        task.progress = Math.min(100, Math.max(0, Number(progress) || 0));
        Object.assign(task.metadata, metadataUpdate);

        try {
            this.databaseService.updatePersistentTask(taskId, {
                progress: task.progress,
                metadata: task.metadata
            });
        } catch (e) {}

        this.emit('task:progress', { id: taskId, progress: task.progress, metadata: task.metadata });
        return true;
    }

    /**
     * Registra un punto de control (checkpoint) intermedio de la tarea en SQLite.
     * Permite reanudar exactamente desde este punto en caso de reinicio.
     */
    checkpoint(taskId, { stepIndex = null, stepName = 'Paso intermedio', data = {} } = {}) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.checkpoint = data;
        }

        try {
            const cp = this.databaseService.saveTaskCheckpoint(taskId, stepIndex, stepName, data);
            this.emit('task:checkpoint', { taskId, checkpoint: cp });
            return cp;
        } catch (err) {
            console.error(`[TaskManager] Error guardando checkpoint para ${taskId}:`, err.message);
            return null;
        }
    }

    /**
     * Pausa una tarea en ejecución si tiene soporte de pausa.
     */
    pause(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { ok: false, message: `No se encontró la tarea con ID ${taskId}.` };
        }

        if (task.status !== TASK_STATUS.RUNNING) {
            return { ok: false, message: `La tarea no está en ejecución (estado actual: ${task.status}).` };
        }

        if (task.handle.pauseFn && typeof task.handle.pauseFn === 'function') {
            try {
                task.handle.pauseFn();
            } catch (err) {
                console.error(`[TaskManager] Error en pauseFn de ${taskId}:`, err);
            }
        }

        task.status = TASK_STATUS.PAUSED;

        try {
            this.databaseService.updatePersistentTask(taskId, { status: TASK_STATUS.PAUSED });
        } catch (e) {}

        this.emit('task:paused', this.sanitizeTask(task));
        return { ok: true, taskId, status: task.status, message: `Tarea "${task.description}" pausada.` };
    }

    /**
     * Reanuda una tarea pausada.
     */
    resume(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { ok: false, message: `No se encontró la tarea con ID ${taskId}.` };
        }

        if (task.status !== TASK_STATUS.PAUSED && task.status !== TASK_STATUS.AWAITING_USER_CONFIRMATION) {
            return { ok: false, message: `La tarea no está pausada (estado actual: ${task.status}).` };
        }

        if (task.handle.resumeFn && typeof task.handle.resumeFn === 'function') {
            try {
                task.handle.resumeFn();
            } catch (err) {
                console.error(`[TaskManager] Error en resumeFn de ${taskId}:`, err);
            }
        }

        task.status = TASK_STATUS.RUNNING;

        try {
            this.databaseService.updatePersistentTask(taskId, { status: TASK_STATUS.RUNNING });
        } catch (e) {}

        this.emit('task:resumed', this.sanitizeTask(task));
        return { ok: true, taskId, status: task.status, message: `Tarea "${task.description}" reanudada.` };
    }

    /**
     * Cancela de forma inmediata una tarea específica.
     */
    cancel(taskId, reason = 'Cancelado por el usuario') {
        const task = this.tasks.get(taskId);
        if (!task) {
            return { ok: false, message: `No se encontró la tarea con ID ${taskId}.` };
        }

        if (task.status === TASK_STATUS.COMPLETED || task.status === TASK_STATUS.CANCELLED) {
            return { ok: false, message: `La tarea ya finalizó con estado ${task.status}.` };
        }

        // 1. Abortar AbortController si existe
        if (task.handle.abortController) {
            try {
                task.handle.abortController.abort();
            } catch (e) {}
        }

        // 2. Matar proceso hijo si existe
        if (task.handle.childProcess) {
            try {
                task.handle.childProcess.kill('SIGKILL');
            } catch (e) {}
        }

        // 3. Ejecutar función de cancelación personalizada
        if (task.handle.cancelFn && typeof task.handle.cancelFn === 'function') {
            try {
                task.handle.cancelFn(reason);
            } catch (err) {
                console.error(`[TaskManager] Error en cancelFn de ${taskId}:`, err);
            }
        }

        task.status = TASK_STATUS.CANCELLED;
        task.finishedAt = new Date().toISOString();
        task.metadata.cancelReason = reason;

        try {
            this.databaseService.updatePersistentTask(taskId, {
                status: TASK_STATUS.CANCELLED,
                finished_at: task.finishedAt,
                metadata: task.metadata
            });
        } catch (e) {}

        this.emit('task:cancelled', this.sanitizeTask(task));
        try {
            const eventBus = require('./eventBusService');
            const { SYSTEM_EVENTS } = require('./eventBusService');
            eventBus.publish(SYSTEM_EVENTS.TASK_CANCELLED, this.sanitizeTask(task));
        } catch (e) {}

        return {
            ok: true,
            taskId,
            status: task.status,
            description: task.description,
            message: `Tarea "${task.description}" cancelada con éxito.`
        };
    }

    /**
     * Cancela la tarea activa más reciente o filtra por tipo (ej: "download").
     */
    cancelCurrent(filterType = null, reason = 'Cancelado por comando de voz') {
        const active = this.getActiveTasks();
        if (active.length === 0) {
            try {
                const ttsService = require('../ttsService');
                if (ttsService.isPlaying()) {
                    ttsService.stop();
                    return { ok: true, message: 'Detuve la respuesta de voz.' };
                }
            } catch (e) {}

            return { ok: false, message: 'No hay ninguna tarea activa para cancelar.' };
        }

        let target = null;
        if (filterType) {
            const normalizedType = String(filterType).toLowerCase().trim();
            target = active.reverse().find(t => t.type.toLowerCase().includes(normalizedType) || normalizedType.includes(t.type.toLowerCase()));
        }

        if (!target) {
            target = active[active.length - 1];
        }

        return this.cancel(target.id, reason);
    }

    /**
     * Cancela todas las tareas activas a la vez.
     */
    cancelAll(reason = 'Cancelación global solicitada') {
        const active = this.getActiveTasks();
        const results = [];
        for (const task of active) {
            results.push(this.cancel(task.id, reason));
        }

        try {
            const ttsService = require('../ttsService');
            ttsService.stop();
        } catch (e) {}

        return {
            ok: true,
            cancelledCount: results.length,
            tasks: results,
            message: results.length > 0
                ? `Cancelé ${results.length} tarea${results.length > 1 ? 's' : ''} activa${results.length > 1 ? 's' : ''}.`
                : 'No había tareas activas en ejecución.'
        };
    }

    /**
     * Marca una tarea como finalizada exitosamente.
     */
    completeTask(taskId, result = null) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        task.status = TASK_STATUS.COMPLETED;
        task.progress = 100;
        task.finishedAt = new Date().toISOString();
        if (result !== null) task.metadata.result = result;

        try {
            this.databaseService.updatePersistentTask(taskId, {
                status: TASK_STATUS.COMPLETED,
                progress: 100,
                finished_at: task.finishedAt,
                metadata: task.metadata
            });
        } catch (e) {}

        this.emit('task:completed', this.sanitizeTask(task));
        try {
            const eventBus = require('./eventBusService');
            const { SYSTEM_EVENTS } = require('./eventBusService');
            eventBus.publish(SYSTEM_EVENTS.TASK_FINISHED, this.sanitizeTask(task));
        } catch (e) {}
        return true;
    }

    /**
     * Marca una tarea como fallida.
     */
    failTask(taskId, error = null) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        task.status = TASK_STATUS.FAILED;
        task.finishedAt = new Date().toISOString();
        task.error = error ? String(error.message || error) : 'Error desconocido';

        try {
            this.databaseService.updatePersistentTask(taskId, {
                status: TASK_STATUS.FAILED,
                finished_at: task.finishedAt,
                error: task.error
            });
        } catch (e) {}

        this.emit('task:failed', this.sanitizeTask(task));
        return true;
    }

    /**
     * Protocolo de Recuperación ante Caídas / Reinicios (Crash Recovery).
     * Escanea tareas huérfanas en SQLite y las gestiona según su política de recuperación.
     */
    async recoverOrphanTasks({ silent = false } = {}) {
        let orphanTasks = [];
        try {
            orphanTasks = this.databaseService.getOrphanTasksOnCrash();
        } catch (err) {
            console.error('[TaskManager] Error consultando tareas huérfanas en BD:', err.message);
            return { ok: false, recovered: [] };
        }

        if (orphanTasks.length === 0) {
            return { ok: true, count: 0, recovered: [] };
        }

        console.log(`[TaskManager] 🔄 Detectadas ${orphanTasks.length} tarea(s) huérfana(s) de sesión previa.`);
        const recovered = [];

        for (const orphan of orphanTasks) {
            const policy = orphan.recovery_policy || RECOVERY_POLICIES.RESUME;
            let finalStatus = orphan.status;
            let resumeSuccess = false;

            // Cargar tarea huérfana en memoria
            const inMemoryTask = {
                ...orphan,
                handle: {
                    cancelFn: null,
                    pauseFn: null,
                    resumeFn: null,
                    abortController: new AbortController(),
                    childProcess: null
                }
            };
            this.tasks.set(orphan.id, inMemoryTask);

            switch (policy) {
                case RECOVERY_POLICIES.RESUME: {
                    const handler = this.resumeHandlers.get(String(orphan.type).toLowerCase());
                    if (handler) {
                        try {
                            const res = await handler(inMemoryTask, orphan.checkpoint);
                            finalStatus = TASK_STATUS.RUNNING;
                            resumeSuccess = true;
                        } catch (err) {
                            console.warn(`[TaskManager] Falló reanudación automática de ${orphan.id}:`, err.message);
                            finalStatus = TASK_STATUS.PAUSED;
                        }
                    } else {
                        // Si no hay handler registrado de ejecución viva, dejarla pausada
                        finalStatus = TASK_STATUS.PAUSED;
                    }
                    break;
                }

                case RECOVERY_POLICIES.RETRY: {
                    if (Number(orphan.retry_count || 0) < Number(orphan.max_retries || 3)) {
                        inMemoryTask.retry_count = Number(orphan.retry_count || 0) + 1;
                        inMemoryTask.progress = 0;
                        finalStatus = TASK_STATUS.AWAITING_RETRY;
                    } else {
                        finalStatus = TASK_STATUS.FAILED;
                        inMemoryTask.error = 'Superó el límite máximo de reintentos tras reinicios.';
                    }
                    break;
                }

                case RECOVERY_POLICIES.PROMPT_USER: {
                    finalStatus = TASK_STATUS.AWAITING_USER_CONFIRMATION;
                    if (!silent) {
                        try {
                            const notificationService = require('./notificationService');
                            notificationService.notify({
                                title: 'Tarea Recuperada',
                                message: `Se recuperó la tarea "${orphan.description}". ¿Deseás continuarla?`,
                                priority: 'HIGH',
                                channels: ['HUD']
                            });
                        } catch (e) {}
                    }
                    break;
                }

                case RECOVERY_POLICIES.ABORT_ON_CRASH:
                default: {
                    finalStatus = TASK_STATUS.CANCELLED;
                    inMemoryTask.error = 'Cancelada automáticamente tras el reinicio del sistema por política de seguridad.';
                    inMemoryTask.finishedAt = new Date().toISOString();
                    break;
                }
            }

            inMemoryTask.status = finalStatus;
            this.databaseService.updatePersistentTask(orphan.id, {
                status: finalStatus,
                retry_count: inMemoryTask.retry_count,
                error: inMemoryTask.error,
                finished_at: inMemoryTask.finishedAt
            });

            recovered.push(this.sanitizeTask(inMemoryTask));
            this.emit('task:recovered', this.sanitizeTask(inMemoryTask));
        }

        return {
            ok: true,
            count: recovered.length,
            recovered
        };
    }

    /**
     * Reintenta una tarea específica fallida o interrumpida.
     */
    retryTask(taskId) {
        let task = this.tasks.get(taskId);
        if (!task) {
            const dbTask = this.databaseService.getPersistentTask(taskId);
            if (dbTask) {
                task = {
                    ...dbTask,
                    handle: { cancelFn: null, pauseFn: null, resumeFn: null, abortController: new AbortController(), childProcess: null }
                };
                this.tasks.set(taskId, task);
            }
        }

        if (!task) {
            return { ok: false, message: `No se encontró la tarea con ID ${taskId}.` };
        }

        task.status = TASK_STATUS.RUNNING;
        task.progress = 0;
        task.error = null;
        task.startedAt = new Date().toISOString();
        task.retry_count = (task.retry_count || 0) + 1;

        this.databaseService.updatePersistentTask(taskId, {
            status: TASK_STATUS.RUNNING,
            progress: 0,
            error: null,
            started_at: task.startedAt,
            retry_count: task.retry_count
        });

        this.emit('task:retried', this.sanitizeTask(task));
        return { ok: true, taskId, status: task.status, message: `Reintentando tarea "${task.description}".` };
    }

    /**
     * Obtiene una tarea por ID (desde memoria o SQLite).
     */
    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (task) return this.sanitizeTask(task);

        const dbTask = this.databaseService.getPersistentTask(taskId);
        return dbTask ? dbTask : null;
    }

    /**
     * Obtiene todos los puntos de control registrados de una tarea.
     */
    getCheckpoints(taskId) {
        return this.databaseService.getTaskCheckpoints(taskId);
    }

    /**
     * Lista las tareas activas (RUNNING, PAUSED o AWAITING).
     */
    getActiveTasks() {
        return Array.from(this.tasks.values())
            .filter(t => [TASK_STATUS.RUNNING, TASK_STATUS.PAUSED, TASK_STATUS.AWAITING_RETRY, TASK_STATUS.AWAITING_USER_CONFIRMATION].includes(t.status))
            .map(t => this.sanitizeTask(t));
    }

    /**
     * Lista tareas con filtros opcionales de estado o tipo (desde SQLite si se solicita historial completo).
     */
    listTasks({ status = null, type = null, limit = 50, fromDb = false } = {}) {
        if (fromDb) {
            return this.databaseService.getAllPersistentTasks({ status, type, limit });
        }

        let list = Array.from(this.tasks.values());
        if (status) list = list.filter(t => t.status === status);
        if (type) list = list.filter(t => t.type === type);
        return list.slice(-limit).map(t => this.sanitizeTask(t)).reverse();
    }

    /**
     * Limpia referencias internas y callbacks para serialización JSON segura.
     */
    sanitizeTask(task) {
        return {
            id: task.id,
            correlationId: task.correlationId || task.metadata?.correlationId || task.id,
            goalId: task.goalId || task.metadata?.goalId || null,
            planId: task.planId || task.metadata?.planId || null,
            type: task.type,
            description: task.description,
            status: task.status,
            priority: task.priority || 'NORMAL',
            progress: task.progress,
            payload: task.payload,
            checkpoint: task.checkpoint,
            recovery_policy: task.recovery_policy,
            retry_count: task.retry_count,
            max_retries: task.max_retries,
            createdAt: task.createdAt || task.created_at,
            startedAt: task.startedAt || task.started_at,
            finishedAt: task.finishedAt || task.finished_at,
            error: task.error,
            metadata: task.metadata
        };
    }

    getTaskByCorrelationId(correlationId) {
        if (!correlationId) return null;
        for (const task of this.tasks.values()) {
            if (task.correlationId === correlationId || task.metadata?.correlationId === correlationId) {
                return this.sanitizeTask(task);
            }
        }
        return null;
    }

    getTasksByGoalId(goalId) {
        if (!goalId) return [];
        const matches = [];
        for (const task of this.tasks.values()) {
            if (task.goalId === goalId || task.metadata?.goalId === goalId) {
                matches.push(this.sanitizeTask(task));
            }
        }
        return matches;
    }

    _trimHistory() {
        if (this.tasks.size > this.maxHistory) {
            const finished = Array.from(this.tasks.entries())
                .filter(([_, t]) => t.status === TASK_STATUS.COMPLETED || t.status === TASK_STATUS.CANCELLED || t.status === TASK_STATUS.FAILED);
            
            const toDelete = finished.slice(0, this.tasks.size - this.maxHistory);
            for (const [id] of toDelete) {
                this.tasks.delete(id);
            }
        }
    }
}

const taskManagerService = new TaskManagerService();
module.exports = taskManagerService;
module.exports.TaskManagerService = TaskManagerService;
module.exports.TASK_STATUS = TASK_STATUS;
module.exports.TASK_TYPES = TASK_TYPES;
module.exports.RECOVERY_POLICIES = RECOVERY_POLICIES;
