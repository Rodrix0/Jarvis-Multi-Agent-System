/**
 * Universal Memory Service for JARVIS 3.0 (Secciones 10-31)
 *
 * Implementa una arquitectura unificada de memoria en 10 capas:
 *   1. Raw Archive (JSONL inmutable / append-only audit trail: backend/data/memory/raw_archive.jsonl)
 *   2. Working Memory (Buffer dinámico con presupuesto de tokens y poda suave)
 *   3. Episodic Memory (Eventos fechados con TTL y decaimiento)
 *   4. Semantic Memory (Hechos universales, conceptos y conocimiento general)
 *   5. Preference Memory (Hábitos, afinidades, gustos y personalizaciones)
 *   6. Operational Memory (Historial de acciones ejecutadas, comandos y resultados de herramientas)
 *   7. Procedural Memory (Workflows, secuencias y procedimientos paso a paso)
 *   8. Entity Memory (Entidades y relaciones del EntityGraph)
 *   9. Temporal Memory (Líneas de tiempo, fechas relativas y turnos/eventos temporales)
 *  10. Consolidated Memory (Síntesis de alta densidad sin pérdida de vínculos originales)
 *
 * Características Clave:
 *   - Pipeline híbrido de 6 factores: Vector + BM25/Text + Entity + Recency + Importance + Temporal Relevance.
 *   - Re-ranking explicable con desglose numérico.
 *   - Registro de procedencia (Provenance): fuente, timestamp, nivel de certeza, actor.
 *   - Resolución de conflictos con histórico supersede.
 *   - Controles de Privacidad de Memoria: memory.pause(), memory.resume(), memory.inspect(), memory.delete().
 *   - 100% agnóstico al dominio (no limitado a proyectos de software).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');
const hybridMemoryService = require('./hybridMemoryService');
const memoryImportanceService = require('./memoryImportanceService');
const memoryConflictResolver = require('./memoryConflictResolver');
const memoryConsolidationService = require('./memoryConsolidationService');
const entityGraphService = require('./entityGraphService');

const RAW_ARCHIVE_DIR = path.join(__dirname, '..', '..', 'data', 'memory');
const RAW_ARCHIVE_FILE = path.join(RAW_ARCHIVE_DIR, 'raw_archive.jsonl');

class UniversalMemoryService {
    constructor() {
        this.privacyMode = {
            paused: false,
            pauseUntil: null
        };
        this._ensureStorage();
    }

    _ensureStorage() {
        if (!fs.existsSync(RAW_ARCHIVE_DIR)) {
            fs.mkdirSync(RAW_ARCHIVE_DIR, { recursive: true });
        }
    }

    /**
     * 1. RAW ARCHIVE: Registro inmutable en append-only JSONL
     */
    appendRawArchive(entry) {
        try {
            this._ensureStorage();
            const record = {
                id: entry.id || `raw-${crypto.randomUUID()}`,
                timestamp: new Date().toISOString(),
                tier: entry.tier || 'SEMANTIC',
                provenance: entry.provenance || { source: 'unknown', confidence: 1.0 },
                payload: entry.payload || entry.value || entry
            };
            fs.appendFileSync(RAW_ARCHIVE_FILE, JSON.stringify(record) + '\n', 'utf8');
            return record.id;
        } catch (err) {
            console.error('[UniversalMemory] Error guardando en raw_archive.jsonl:', err.message);
            return null;
        }
    }

    /**
     * Controles de Privacidad (Sección 26)
     */
    pauseMemory(durationMinutes = 0) {
        this.privacyMode.paused = true;
        if (durationMinutes > 0) {
            this.privacyMode.pauseUntil = Date.now() + (durationMinutes * 60 * 1000);
        } else {
            this.privacyMode.pauseUntil = null;
        }
        return { ok: true, paused: true, pauseUntil: this.privacyMode.pauseUntil };
    }

    resumeMemory() {
        this.privacyMode.paused = false;
        this.privacyMode.pauseUntil = null;
        return { ok: true, paused: false };
    }

    isMemoryPaused() {
        if (!this.privacyMode.paused) return false;
        if (this.privacyMode.pauseUntil && Date.now() > this.privacyMode.pauseUntil) {
            this.privacyMode.paused = false;
            this.privacyMode.pauseUntil = null;
            return false;
        }
        return true;
    }

    /**
     * Inserción universal con evaluación de importancia, procedencia y resolución de conflictos
     */
    storeMemory({
        tier = 'SEMANTIC', // 'EPISODIC', 'SEMANTIC', 'PREFERENCE', 'OPERATIONAL', 'PROCEDURAL', 'TEMPORAL'
        key = null,
        value,
        source = 'explicit_user_statement',
        confidence = null,
        expiresAt = null,
        metadata = {}
    }) {
        if (this.isMemoryPaused()) {
            return { ok: false, paused: true, message: 'La persistencia de memoria está actualmente pausada.' };
        }

        if (!value || typeof value !== 'string' || !value.trim()) {
            return { ok: false, message: 'El valor del recuerdo no puede estar vacío.' };
        }

        const cleanVal = value.trim();

        // 1. Triaje de Importancia Universal
        const triage = memoryImportanceService.triageMemory(cleanVal, { type: tier, tier, key });
        if (triage.action === 'DISCARD') {
            return {
                ok: true,
                discarded: true,
                action: 'DISCARD',
                importance: triage.importance,
                reason: triage.reason
            };
        }

        let effectiveExpiresAt = expiresAt;
        if (!effectiveExpiresAt && triage.action === 'EPISODIC') {
            effectiveExpiresAt = triage.expiresAt;
        }

        const effectiveConfidence = typeof confidence === 'number' ? confidence : triage.importance;

        // 2. Resolución de conflictos si hay clave
        if (key) {
            memoryConflictResolver.resolveConflict(key, cleanVal, source);
        }

        const id = `mem-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        // 3. Registrar en SQLite Memory
        try {
            databaseService.db.prepare(`
                INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            `).run(id, tier, triage.action === 'PERMANENT' ? 'CORE' : 'NORMAL', key, cleanVal, source, effectiveConfidence, now, effectiveExpiresAt);
        } catch (err) {
            return { ok: false, message: err.message };
        }

        // 4. Registrar en Raw Archive inmutable
        this.appendRawArchive({
            id,
            tier,
            provenance: { source, confidence: effectiveConfidence, actor: metadata.actor || 'user' },
            payload: { key, value: cleanVal, expiresAt: effectiveExpiresAt, metadata }
        });

        // 5. Vincular a Grafo de Entidades
        try {
            const triples = entityGraphService.extractTriplesFromText(cleanVal);
            for (const t of triples) {
                const objId = `${t.object_type || 'concept'}:${t.object_name.replace(/\s+/g, '_')}`;
                if (!entityGraphService.getEntity(objId)) {
                    entityGraphService.createEntity({
                        id: objId,
                        name: t.object_name,
                        type: t.object_type || 'concept',
                        aliases: [t.object_name]
                    });
                }
                entityGraphService.createRelation({
                    subject_id: t.subject_id,
                    predicate: t.predicate,
                    object_id: objId,
                    confidence: effectiveConfidence
                });
            }
        } catch (_) {}

        return {
            ok: true,
            id,
            tier,
            importance: effectiveConfidence,
            message: 'Recuerdo universal almacenado con éxito.'
        };
    }

    /**
     * Búsqueda Universal Híbrida multicapa con re-ranking explicable
     */
    async queryUniversal(queryText, options = {}) {
        const limit = options.limit || 5;
        const targetTier = options.tier || null;

        // Obtener candidatos de SQLite
        let sql = `
            SELECT id, type as tier, tier as core_tier, key, value as text, source, confidence as importance, created_at, expires_at
            FROM memory 
            WHERE status = 'ACTIVE'
        `;
        const params = [];
        if (targetTier) {
            sql += ` AND type = ?`;
            params.push(targetTier);
        }
        sql += ` ORDER BY created_at DESC LIMIT 250`;

        let rows = [];
        try {
            rows = databaseService.db.prepare(sql).all(...params);
        } catch (err) {
            console.error('[UniversalMemory] Error consultando SQLite:', err.message);
            rows = [];
        }

        // Filtrar expirados
        const now = Date.now();
        const validCandidates = rows.filter(r => {
            if (!r.expires_at) return true;
            return new Date(r.expires_at).getTime() > now;
        });

        // Ejecutar búsqueda híbrida ponderada
        const scored = await hybridMemoryService.searchHybrid(queryText, {
            candidates: validCandidates,
            limit
        });

        return scored;
    }

    /**
     * Inspección y Auditoría de Memoria (memory.inspect)
     */
    inspectMemory(options = {}) {
        const filterKey = options.filter || '';
        const limit = options.limit || 50;

        let sql = `
            SELECT id, type as tier, tier as storage_tier, key, value, source, confidence, created_at, expires_at, status
            FROM memory
        `;
        const params = [];
        if (filterKey) {
            sql += ` WHERE (id LIKE ? OR key LIKE ? OR value LIKE ?)`;
            params.push(`%${filterKey}%`, `%${filterKey}%`, `%${filterKey}%`);
        }
        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        const rows = databaseService.db.prepare(sql).all(...params);

        return {
            totalInspected: rows.length,
            paused: this.isMemoryPaused(),
            records: rows
        };
    }

    /**
     * Eliminación Controlada de Memoria (memory.delete)
     */
    deleteMemory(idOrPattern) {
        if (!idOrPattern) return { ok: false, message: 'Se requiere ID o patrón para eliminar.' };

        const isExactId = idOrPattern.startsWith('mem-');
        let res;

        if (isExactId) {
            res = databaseService.db.prepare(`UPDATE memory SET status = 'SUPERSEDED' WHERE id = ?`).run(idOrPattern);
        } else {
            res = databaseService.db.prepare(`UPDATE memory SET status = 'SUPERSEDED' WHERE key LIKE ? OR value LIKE ?`).run(`%${idOrPattern}%`, `%${idOrPattern}%`);
        }

        return {
            ok: true,
            affected: res.changes,
            message: `Se marcaron ${res.changes} registro(s) como superados/eliminados.`
        };
    }

    /**
     * Consolidación de recuerdos afines
     */
    consolidateMemories() {
        const activeMemories = databaseService.db.prepare(`
            SELECT id, type as tier, key, value, created_at FROM memory WHERE status = 'ACTIVE'
        `).all();

        const clusters = memoryConsolidationService.findMemoryClusters(activeMemories);
        const consolidated = [];

        for (const cluster of clusters) {
            const synthesized = memoryConsolidationService.synthesizeCluster(cluster.topic, cluster.memories);
            if (synthesized) {
                consolidated.push(synthesized);
            }
        }

        return {
            clustersFound: clusters.length,
            consolidatedCount: consolidated.length,
            clusters: consolidated
        };
    }
}

const universalMemoryService = new UniversalMemoryService();
module.exports = universalMemoryService;
