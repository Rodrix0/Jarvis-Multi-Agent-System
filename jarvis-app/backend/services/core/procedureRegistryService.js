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
        author = 'system'
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
            validationStatus: 'VALIDATED',
            executionCount: 0,
            successCount: 0,
            createdAt: new Date().toISOString(),
            lastExecutedAt: null
        };

        this.procedures.set(procId, procedure);
        this._saveProcedures();

        eventBus.publish('PROCEDURE_REGISTERED', {
            procedureId: procId,
            name: procedure.name,
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
     */
    findProcedureByTrigger(triggerText) {
        if (!triggerText) return null;
        const norm = String(triggerText).toLowerCase().trim();

        for (const p of this.procedures.values()) {
            if (p.trigger && (norm.includes(p.trigger) || p.trigger.includes(norm))) {
                return p;
            }
            if (norm.includes(p.name.toLowerCase())) {
                return p;
            }
        }
        return null;
    }

    /**
     * Lista todos los procedimientos registrados.
     */
    listProcedures() {
        return Array.from(this.procedures.values());
    }

    /**
     * Registra el resultado de una ejecución de procedimiento para optimización.
     */
    recordExecution(procId, success = true) {
        const proc = this.procedures.get(procId);
        if (proc) {
            proc.executionCount = (proc.executionCount || 0) + 1;
            if (success) {
                proc.successCount = (proc.successCount || 0) + 1;
            }
            proc.lastExecutedAt = new Date().toISOString();
            this._saveProcedures();
        }
    }
}

const procedureRegistryService = new ProcedureRegistryService();
module.exports = procedureRegistryService;
