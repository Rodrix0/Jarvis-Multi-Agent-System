class UndoManager {
    constructor() {
        this.undoStack = []; // Array<{ executionId, action, reversible: boolean, undoFn, targetResource, timestamp }>
    }

    recordReversibleAction({
        executionId,
        action,
        reversible = false,
        undoFn,
        targetResource = null,
        description = ''
    }) {
        if (!reversible || typeof undoFn !== 'function') {
            return false;
        }

        this.undoStack.push({
            executionId,
            action,
            reversible: true,
            undoFn,
            targetResource,
            description,
            timestamp: Date.now()
        });

        // Mantener últimas 50 acciones reversibles
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }

        return true;
    }

    async undoLast(scope = 'GLOBAL', filter = null) {
        if (this.undoStack.length === 0) {
            return { ok: false, code: 'ERR_NOTHING_TO_UNDO', message: 'No hay acciones reversibles registradas.' };
        }

        let targetIndex = -1;

        if (scope === 'GLOBAL') {
            targetIndex = this.undoStack.length - 1;
        } else if (scope === 'RESOURCE' && filter) {
            for (let i = this.undoStack.length - 1; i >= 0; i--) {
                if (this.undoStack[i].targetResource === filter) {
                    targetIndex = i;
                    break;
                }
            }
        } else if (scope === 'TIME_WINDOW' && typeof filter === 'number') {
            const cutoff = Date.now() - filter;
            for (let i = this.undoStack.length - 1; i >= 0; i--) {
                if (this.undoStack[i].timestamp >= cutoff) {
                    targetIndex = i;
                    break;
                }
            }
        }

        if (targetIndex === -1) {
            return { ok: false, code: 'ERR_NO_MATCHING_UNDO', message: `No se encontraron acciones reversibles para el alcance solicitado (${scope}).` };
        }

        const [item] = this.undoStack.splice(targetIndex, 1);
        try {
            console.log(`[UndoManager] ↩️ Deshaciendo acción ${item.action} (${item.description || item.executionId})...`);
            const undoResult = await item.undoFn();
            return {
                ok: true,
                action: item.action,
                description: item.description,
                result: undoResult,
                message: `Se deshizo correctamente: ${item.description || item.action}`
            };
        } catch (err) {
            console.error(`[UndoManager] Error al ejecutar rollback para ${item.action}:`, err.message);
            return { ok: false, code: 'ERR_UNDO_FAILED', message: `Falló al revertir ${item.action}: ${err.message}` };
        }
    }
}

const undoManager = new UndoManager();
module.exports = undoManager;
