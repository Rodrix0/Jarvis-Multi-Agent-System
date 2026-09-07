/**
 * Procedure Registry Service for JARVIS 3.0 (Secciones 80-92, Ítem 102)
 *
 * Registra, almacena, valida y reproduce procedimientos operacionales aprendidos
 * a partir de secuencias exitosas de acciones o directivas explícitas del usuario.
 *
 * Características:
 *   - Registro formal de Procedimientos: (id, name, description, trigger, steps, preConditions, postConditions, validationStatus).
 *   - Verificación estricta de seguridad previa a la ejecución.
 *   - Replay determinista paso a paso con rollback condicional.
 *   - Mantenimiento de métricas de éxito y optimización de secuencias repetidas.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');
const eventBus = require('../core/eventBusService');

const PROCEDURES_FILE = path.join(__dirname, '..', '..', 'data', 'procedures.json');

class ProcedureRegistryService {
    constructor() {
        this.procedures = new Map();
        this._loadProcedures();
    }

    _loadProcedures() {
        try {
            if (fs.existsSync(PROCEDURES_FILE)) {
                const raw = fs.readFileSync(PROCEDURES_FILE, 'utf8');
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    for (const p of list) {
                        this.procedures.set(p.id, p);
                    }
                }
            }
        } catch (err) {
            console.warn('[ProcedureRegistry] Error cargando procedures.json:', err.message);
        }
    }

    _saveProcedures() {
        try {
            fs.mkdirSync(path.dirname(PROCEDURES_FILE), { recursive: true });
            const list = Array.from(this.procedures.values());
            const tmp = `${PROCEDURES_FILE}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
            fs.renameSync(tmp, PROCEDURES_FILE);
        } catch (err) {
            console.error('[ProcedureRegistry] Error guardando procedures.json:', err.message);
        }
    }

    /**
     * Registra un nuevo procedimiento operacional.
     */
    registerProcedure({
        id = null,
        name,
        description = '',
        trigger,
        steps = [],
        preConditions = [],
        postConditions = [],
        author = 'system',
        status = 'ACTIVE', // 'ACTIVE', 'CANDIDATE', 'DEPRECATED', 'ROLLED_BACK'
        version = 1,
        canaryThreshold = 3 // ejecuciones canario requeridas para promoción automática
    }) {
        if (!name || !Array.isArray(steps) || steps.length === 0) {
            throw new Error('Un procedimiento válido requiere nombre y al menos un paso.');
        }

        const procId = id || `proc_${crypto.randomUUID().slice(0, 8)}`;
        const procedure = {
            id: procId,
            name: String(name).trim(),
            description: String(description).trim(),
            trigger: trigger ? String(trigger).toLowerCase().trim() : null,
            steps: steps.map((s, idx) => ({
                stepIndex: idx + 1,
                actionId: s.actionId || s.tool,
                params: s.params || {},
                description: s.description || `Paso ${idx + 1}`
            })),
            preConditions,
            postConditions,
            author,
            status: status.toUpperCase(),
            version,
            canaryThreshold,
            consecutiveFailures: 0,
            validationStatus: status.toUpperCase() === 'CANDIDATE' ? 'CANARY_TESTING' : 'VALIDATED',
            executionCount: 0,
            successCount: 0,
            failureCount: 0,
            createdAt: new Date().toISOString(),
            lastExecutedAt: null
        };

        this.procedures.set(procId, procedure);
        this._saveProcedures();

        eventBus.publish('PROCEDURE_REGISTERED', {
            procedureId: procId,
            name: procedure.name,
            status: procedure.status,
            stepsCount: procedure.steps.length
        });

        return procedure;
    }

    /**
     * Obtiene un procedimiento por su ID.
     */
    getProcedure(procId) {
        return this.procedures.get(procId) || null;
    }

    /**
     * Busca un procedimiento por intención de disparo o coincidencia textual.
     * Prioriza procedimientos 'ACTIVE' sobre 'CANDIDATE' a menos que se fuerce canary.
     */
    findProcedureByTrigger(triggerText, allowCandidate = true) {
        if (!triggerText) return null;
        const norm = String(triggerText).toLowerCase().trim();

        const matches = [];
        for (const p of this.procedures.values()) {
            if (p.status === 'ROLLED_BACK' || p.status === 'DEPRECATED') continue;
            if (!allowCandidate && p.status === 'CANDIDATE') continue;

            if (p.trigger && (norm.includes(p.trigger) || p.trigger.includes(norm))) {
                matches.push(p);
            } else if (norm.includes(p.name.toLowerCase())) {
                matches.push(p);
            }
        }

        if (matches.length === 0) return null;

        // Ordenar: primero ACTIVE, luego por tasa de éxito
        matches.sort((a, b) => {
            if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
            if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
            const rateA = a.executionCount > 0 ? a.successCount / a.executionCount : 0;
            const rateB = b.executionCount > 0 ? b.successCount / b.executionCount : 0;
            return rateB - rateA;
        });

        return matches[0];
    }

    /**
     * Lista todos los procedimientos registrados.
     */
    listProcedures(filterStatus = null) {
        let list = Array.from(this.procedures.values());
        if (filterStatus) {
            list = list.filter(p => p.status === filterStatus.toUpperCase());
        }
        return list;
    }

    /**
     * Promueve un procedimiento candidato a activo formalmente.
     */
    promoteProcedure(procId) {
        const proc = this.procedures.get(procId);
        if (!proc) return false;
        proc.status = 'ACTIVE';
        proc.validationStatus = 'VALIDATED';
        this._saveProcedures();
        eventBus.publish('PROCEDURE_PROMOTED', { procedureId: procId, name: proc.name });
        return true;
    }

    /**
     * Realiza rollback de un procedimiento por fallos o regresión.
     */
    rollbackProcedure(procId, reason = 'Excessive failures during execution') {
        const proc = this.procedures.get(procId);
        if (!proc) return false;
        proc.status = 'ROLLED_BACK';
        proc.validationStatus = 'REJECTED';
        proc.rollbackReason = reason;
        this._saveProcedures();
        eventBus.publish('PROCEDURE_ROLLED_BACK', { procedureId: procId, name: proc.name, reason });
        return true;
    }

    /**
     * Registra el resultado de una ejecución de procedimiento para optimización y canary testing.
     */
    recordExecution(procId, success = true, error = null) {
        const proc = this.procedures.get(procId);
        if (!proc) return;

        proc.executionCount = (proc.executionCount || 0) + 1;
        proc.lastExecutedAt = new Date().toISOString();

        if (success) {
            proc.successCount = (proc.successCount || 0) + 1;
            proc.consecutiveFailures = 0;

            // Auto-promoción de candidatos tras alcanzar el umbral de canario sin errores
            if (proc.status === 'CANDIDATE' && proc.successCount >= (proc.canaryThreshold || 3)) {
                this.promoteProcedure(procId);
            }
        } else {
            proc.failureCount = (proc.failureCount || 0) + 1;
            proc.consecutiveFailures = (proc.consecutiveFailures || 0) + 1;

            // Auto-rollback inmediato si un canario falla 2 veces consecutivas o si un activo supera 3 fallos seguidos
            const maxAllowed = proc.status === 'CANDIDATE' ? 2 : 3;
            if (proc.consecutiveFailures >= maxAllowed) {
                this.rollbackProcedure(procId, `Auto-rollback por ${proc.consecutiveFailures} fallas consecutivas: ${error || 'Error no especificado'}`);
            }
        }

        this._saveProcedures();
    }
}

const procedureRegistryService = new ProcedureRegistryService();
module.exports = procedureRegistryService;
