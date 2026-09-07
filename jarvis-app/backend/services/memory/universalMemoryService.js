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

function redactSecrets(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    // OpenAI/Anthropic/generic API keys (sk-..., ghp_..., etc.)
    result = result.replace(/\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9]{10,})\b/g, '[REDACTED_API_KEY]');
    // AWS keys
    result = result.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
    // Private keys
    result = result.replace(/-----BEGIN[ A-Z_-]+PRIVATE KEY-----[^-]+-----END[ A-Z_-]+PRIVATE KEY-----/gs, '[REDACTED_PRIVATE_KEY]');
    // Generic passwords / tokens in assignments: password=xyz, clave: 1234
    result = result.replace(/(\b(?:password|contrase[ñn]a|clave|token|secret)\s*[:=]\s*)([^\s,;"']+)/gi, '$1[REDACTED_SECRET]');
    return result;
}

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
     * 1. RAW ARCHIVE: Registro inmutable en append-only JSONL + Sincronización FTS5
     */
    appendRawArchive(entry) {
        try {
            this._ensureStorage();
            const record = {
                id: entry.id || `raw-${crypto.randomUUID()}`,
                timestamp: entry.timestamp || new Date().toISOString(),
                tier: entry.tier || 'SEMANTIC',
                provenance: entry.provenance || { source: 'unknown', confidence: 1.0 },
                payload: entry.payload || entry.value || entry
            };
            fs.appendFileSync(RAW_ARCHIVE_FILE, JSON.stringify(record) + '\n', 'utf8');

            // Sincronizar de forma inmediata con raw_archive_fts (FTS5)
            try {
                let contentText = '';
                if (typeof record.payload === 'string') {
                    contentText = record.payload;
                } else if (record.payload && typeof record.payload === 'object') {
                    contentText = record.payload.value || record.payload.text || JSON.stringify(record.payload);
                } else {
                    contentText = String(record.payload || '');
                }

                databaseService.db.prepare(`
                    INSERT INTO raw_archive_fts (id, tier, content, source, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    record.id,
                    record.tier,
                    contentText,
                    record.provenance?.source || 'unknown',
                    record.timestamp
                );
            } catch (ftsErr) {
                console.warn('[UniversalMemory] Advertencia FTS raw_archive_fts:', ftsErr.message);
            }

            return record.id;
        } catch (err) {
            console.error('[UniversalMemory] Error guardando en raw_archive.jsonl:', err.message);
            return null;
        }
    }

    /**
     * Búsqueda léxica directa en Raw Archive mediante FTS5
     */
    searchRawArchive(queryText, options = {}) {
        const limit = options.limit || 10;
        try {
            const sanitized = queryText.replace(/['"*^(){}[\]]/g, ' ').trim();
            if (!sanitized) return [];

            const words = sanitized.split(/\s+/).filter(w => w.length > 1);
            if (words.length === 0) return [];
            const ftsQuery = words.map(w => `"${w}"*`).join(' OR ');

            const rows = databaseService.db.prepare(`
                SELECT id, tier, content as text, source, timestamp as created_at, rank
                FROM raw_archive_fts
                WHERE raw_archive_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `).all(ftsQuery, limit);

            return rows.map(r => ({
                id: r.id,
                tier: r.tier || 'RAW_ARCHIVE',
                text: r.text || r.content,
                source: r.source,
                created_at: r.created_at || r.timestamp,
                fromArchive: true,
                score: Math.max(0.1, 1.0 / (1.0 + Math.abs(r.rank || 1)))
            }));
        } catch (err) {
            console.warn('[UniversalMemory] Error en FTS searchRawArchive:', err.message);
            return [];
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
     * Inserción universal con evaluación de importancia, procedencia, secretos y resolución de conflictos
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

        // Sanitización y escaneo de secretos antes de persistir
        const cleanVal = redactSecrets(value.trim());

        // 1. Triaje de Importancia Universal
        const triage = memoryImportanceService.triageMemory(cleanVal, { type: tier, tier, key, confidence });
        if (triage.action === 'DISCARD') {
            return {
                ok: true,
                discarded: true,
                action: 'DISCARD',
                importance: triage.importance,
                reason: triage.reason
            };
        }

        const id = `mem-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const effectiveConfidence = typeof confidence === 'number' ? confidence : triage.importance;

        // Si es ARCHIVE_ONLY (baja importancia inmediata, ej: <= 0.25):
        // NO se inserta en working memory (tabla memory activa), pero se guarda permanentemente en Raw Archive y FTS
        if (triage.action === 'ARCHIVE_ONLY') {
            this.appendRawArchive({
                id,
                tier: 'ARCHIVE_ONLY',
                provenance: { source, confidence: effectiveConfidence, actor: metadata.actor || 'user' },
                payload: { key, value: cleanVal, metadata }
            });

            return {
                ok: true,
                id,
                tier: 'ARCHIVE_ONLY',
                action: 'ARCHIVE_ONLY',
                importance: effectiveConfidence,
                message: 'Recuerdo preservado permanentemente en Raw Archive (baja relevancia activa).'
            };
        }

        let effectiveExpiresAt = expiresAt;
        if (!effectiveExpiresAt && triage.action === 'EPISODIC') {
            effectiveExpiresAt = triage.expiresAt;
        }

        // 2. Resolución de conflictos si hay clave
        if (key) {
            memoryConflictResolver.resolveConflict(key, cleanVal, source, id);
        }

        // 3. Registrar en SQLite Memory (Working / Active Memory)
        try {
            databaseService.db.prepare(`
                INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            `).run(id, tier, triage.action === 'PERMANENT' ? 'CORE' : 'NORMAL', key, cleanVal, source, effectiveConfidence, now, effectiveExpiresAt);
        } catch (err) {
            return { ok: false, message: err.message };
        }

        // 4. Registrar en Raw Archive inmutable + FTS5
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
     * Búsqueda Universal Híbrida multicapa con re-ranking explicable y fallback a Raw Archive
     */
    async queryUniversal(queryText, options = {}) {
        const limit = options.limit || 5;
        const targetTier = options.tier || null;

        // Obtener candidatos de SQLite (Active Memory)
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

        // Detectar si la consulta es histórica o si la confianza es baja para activar Raw Archive FTS
        const isHistoricalQuery = /\b(?:cuando hablamos|hace meses|hace tiempo|te acordas|te acuerdas|que te dije|que habiamos dicho|antes|historico|icono era|recordas|antiguo)\b/i.test(queryText);
        const topScore = scored.length > 0 ? (scored[0].finalScore || 0) : 0;

        if (options.includeArchive || isHistoricalQuery || topScore < 0.35) {
            const archiveMatches = this.searchRawArchive(queryText, { limit });
            const existingIds = new Set(scored.map(s => s.id));

            for (const match of archiveMatches) {
                if (!existingIds.has(match.id)) {
                    scored.push({
                        ...match,
                        finalScore: match.score || 0.40,
                        scoreBreakdown: {
                            vector: 0,
                            bm25: 0.8,
                            entity: 0,
                            recency: 0.2,
                            importance: 0.3,
                            temporal: isHistoricalQuery ? 0.9 : 0.4
                        },
                        sourceTier: 'RAW_ARCHIVE_FTS'
                    });
                }
            }
            // Reordenar por finalScore
            scored.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
        }

        return scored.slice(0, limit);
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

        const isExactId = idOrPattern.startsWith('mem-') || idOrPattern.startsWith('raw-');
        let res;

        if (isExactId) {
            res = databaseService.db.prepare(`UPDATE memory SET status = 'SUPERSEDED' WHERE id = ?`).run(idOrPattern);
            try {
                databaseService.db.prepare(`DELETE FROM raw_archive_fts WHERE id = ?`).run(idOrPattern);
            } catch (_) {}
        } else {
            res = databaseService.db.prepare(`UPDATE memory SET status = 'SUPERSEDED' WHERE key LIKE ? OR value LIKE ?`).run(`%${idOrPattern}%`, `%${idOrPattern}%`);
            try {
                databaseService.db.prepare(`DELETE FROM raw_archive_fts WHERE content LIKE ?`).run(`%${idOrPattern}%`);
            } catch (_) {}
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
