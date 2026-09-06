/**
 * actionTimelineService.js
 * 
 * Servicio de Historial de Acciones y Timeline Operacional para JARVIS.
 * 
 * Capacidades:
 * - Registro persistente cronológico de cada acción ("18:41 - abriste Spotify")
 * - Consultas temporales en lenguaje natural ("¿qué hiciste en los últimos 20 minutos?")
 * - Reversión integrada de última acción ("deshacé el último cambio")
 * - Persistencia dual: buffer en memoria de alta velocidad + archivo append-only JSONL
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIMELINE_DIR = path.join(__dirname, '..', '..', 'data', 'history');
const TIMELINE_FILE = path.join(TIMELINE_DIR, 'action_timeline.jsonl');

class ActionTimelineService {
    constructor() {
        this.timelineFile = TIMELINE_FILE;
        this.memoryBuffer = []; // Últimas 500 acciones
        this.maxBuffer = 500;
        this._initStorage();
    }

    _initStorage() {
        try {
            fs.mkdirSync(path.dirname(this.timelineFile), { recursive: true });
            if (fs.existsSync(this.timelineFile)) {
                // Cargar últimas entradas en memoria
                const lines = fs.readFileSync(this.timelineFile, 'utf8')
                    .split('\n')
                    .filter(Boolean)
                    .slice(-this.maxBuffer);
                for (const line of lines) {
                    try {
                        this.memoryBuffer.push(JSON.parse(line));
                    } catch {}
                }
            }
        } catch (e) {
            console.error('[ActionTimelineService] Error inicializando almacén:', e.message);
        }
    }

    _formatTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    /**
     * Deduce una descripción amigable en español si no se proporcionó una explícita.
     */
    _resolveDescription(actionId, params = {}) {
        const id = String(actionId || '').toLowerCase();

        if (id.includes('spotify.play') || id.includes('music.play')) {
            return params.query ? `reprodujiste "${params.query}" en Spotify` : 'abriste y reprodujiste Spotify';
        }
        if (id.includes('git.safe_branch') || id.includes('git.branch')) {
            return `cambiaste branch a ${params.taskName || params.branchName || 'rama jarvis'}`;
        }
        if (id.includes('code.autonomous_fix') || id.includes('code.compile')) {
            return params.instruction ? `corriste build y fix para "${params.instruction}"` : 'corriste build y verificación de código';
        }
        if (id.includes('git.safe_commit')) {
            return `hiciste commit: "${params.message || 'cambios de código'}"`;
        }
        if (id.includes('snapshot.create')) {
            return `creaste snapshot del proyecto (${params.label || 'pre-acción'})`;
        }
        if (id.includes('file.create')) {
            return `creaste el archivo "${params.fileName || 'nuevo documento'}"`;
        }
        if (id.includes('document.template_create')) {
            return `generaste documento con plantilla ${params.template || 'formal'}`;
        }
        if (id.includes('whatsapp') || id.includes('message.send')) {
            return `enviaste mensaje a ${params.contact || params.recipient || 'contacto'}`;
        }
        if (id.includes('volume')) {
            return `ajustaste el volumen al ${params.level || ''}%`;
        }
        if (id.includes('profile.switch')) {
            return `cambiaste perfil a ${params.profileId || 'nuevo perfil'}`;
        }

        return `ejecutaste ${actionId.replace('.', ' ')}`;
    }

    /**
     * Registra una acción en la línea temporal.
     */
    recordAction({
        actionId,
        params = {},
        result = null,
        description = null,
        status = 'SUCCESS',
        reversible = false,
        undoData = null
    }) {
        const now = new Date();
        const formattedTime = this._formatTime(now);
        const humanDescription = description || this._resolveDescription(actionId, params);

        const entry = {
            id: `tl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            timestamp: now.getTime(),
            iso: now.toISOString(),
            formattedTime,
            actionId,
            humanDescription,
            params,
            status,
            reversible: Boolean(reversible),
            undoData: undoData || null
        };

        this.memoryBuffer.push(entry);
        if (this.memoryBuffer.length > this.maxBuffer) {
            this.memoryBuffer.shift();
        }

        // Persistencia append-only
        try {
            fs.appendFileSync(this.timelineFile, `${JSON.stringify(entry)}\n`, 'utf8');
        } catch (e) {
            console.warn('[ActionTimelineService] Error escribiendo log:', e.message);
        }

        return entry;
    }

    /**
     * Obtiene las acciones ocurridas en los últimos N minutos.
     */
    getTimeline(minutes = 20, limit = 50) {
        const cutoff = Date.now() - (minutes * 60 * 1000);
        const filtered = this.memoryBuffer
            .filter(item => item.timestamp >= cutoff)
            .slice(-limit);

        const lines = filtered.map(item => `${item.formattedTime} - ${item.humanDescription}`);
        const formattedText = lines.length > 0
            ? lines.join('\n')
            : `No se registraron acciones en los últimos ${minutes} minutos.`;

        return {
            minutes,
            totalCount: filtered.length,
            entries: filtered,
            formattedText
        };
    }

    /**
     * Responde consultas en lenguaje natural ("¿qué hiciste en los últimos 20 minutos?").
     */
    queryTimeline(utterance = '') {
        const text = String(utterance || '').toLowerCase();
        let minutes = 20; // Default: 20 minutos

        // Extraer número de minutos si fue especificado
        const matchMinutes = text.match(/([0-9]+)\s*minuto/);
        if (matchMinutes) {
            minutes = parseInt(matchMinutes[1], 10);
        } else if (text.includes('hora')) {
            const matchHours = text.match(/([0-9]+)\s*hora/);
            minutes = matchHours ? parseInt(matchHours[1], 10) * 60 : 60;
        } else if (text.includes('hoy')) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            minutes = Math.ceil((Date.now() - startOfDay.getTime()) / (60 * 1000));
        }

        const timeline = this.getTimeline(minutes);
        let responseMessage = '';

        if (timeline.totalCount === 0) {
            responseMessage = `En los últimos ${minutes} minutos no realicé ninguna acción.`;
        } else {
            responseMessage = `En los últimos ${minutes} minutos realicé las siguientes acciones:\n${timeline.formattedText}`;
        }

        return {
            ok: true,
            minutes,
            actionsCount: timeline.totalCount,
            entries: timeline.entries,
            formattedTimeline: timeline.formattedText,
            message: responseMessage
        };
    }

    /**
     * Deshace la última acción reversible registrada.
     */
    async undoLastAction() {
        // Buscar de atrás hacia adelante la última acción reversible y no revertida aún
        let targetIndex = -1;
        for (let i = this.memoryBuffer.length - 1; i >= 0; i--) {
            const act = this.memoryBuffer[i];
            if (act.reversible && act.status !== 'ROLLED_BACK') {
                targetIndex = i;
                break;
            }
        }

        let undoneEntry = null;

        if (targetIndex !== -1) {
            undoneEntry = this.memoryBuffer[targetIndex];
            const undoData = undoneEntry.undoData;

            try {
                if (undoData) {
                    if (undoData.type === 'snapshot' && undoData.snapshotId) {
                        const { snapshotService } = require('../developer/snapshotService');
                        await snapshotService.restoreSnapshot(undoData.snapshotId);
                    } else if (undoData.type === 'git' && undoData.repoPath) {
                        const { gitIntegrationService } = require('../developer/gitIntegrationService');
                        gitIntegrationService.rollback(undoData.repoPath, undoData.mode || 'working_tree');
                    } else if (undoData.type === 'file' && undoData.filePath && fs.existsSync(undoData.filePath)) {
                        fs.unlinkSync(undoData.filePath);
                    } else if (typeof undoData.undoFn === 'function') {
                        await undoData.undoFn();
                    }
                }

                undoneEntry.status = 'ROLLED_BACK';
                undoneEntry.rolledBackAt = new Date().toISOString();
            } catch (err) {
                return {
                    ok: false,
                    error: `Error al revertir la acción: ${err.message}`
                };
            }
        } else {
            // Intentar con el UndoManager tradicional como fallback
            try {
                const undoManager = require('./undoManager');
                const undoRes = await undoManager.undoLast('GLOBAL');
                if (undoRes.ok) {
                    return {
                        ok: true,
                        message: `Deshice el último cambio registrado en el gestor global: ${undoRes.description || 'cambio revertido'}.`
                    };
                }
            } catch {}

            return {
                ok: false,
                error: 'No se encontraron acciones reversibles recientes para deshacer.'
            };
        }

        // Registrar el evento de reversión en la línea temporal
        this.recordAction({
            actionId: 'timeline.undo_last',
            description: `deshiciste el cambio: ${undoneEntry.humanDescription}`,
            status: 'SUCCESS',
            reversible: false
        });

        return {
            ok: true,
            undoneAction: undoneEntry,
            message: `Deshice el último cambio: ${undoneEntry.humanDescription}.`
        };
    }
}

const actionTimelineService = new ActionTimelineService();

module.exports = {
    ActionTimelineService,
    actionTimelineService
};
