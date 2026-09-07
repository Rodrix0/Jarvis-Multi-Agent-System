/**
 * Memory Consolidation Service for Jarvis (Ítem 19)
 * Detecta agrupaciones de recuerdos relacionados o fragmentados en cualquier dominio
 * (Programación, Finanzas, Salud, Universidad, Hogar, Vida Diaria, Creatividad)
 * y los sintetiza en un conocimiento consolidado de alta densidad sin perder los vínculos originales.
 */

const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');
const hybridMemoryService = require('./hybridMemoryService');

class MemoryConsolidationService {
    constructor() {
        this._ensureSchema();
    }

    _ensureSchema() {
        try {
            databaseService.db.exec(`
                CREATE TABLE IF NOT EXISTS consolidated_memories (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    source_ids_json TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    tokens_saved_estimate INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    status TEXT DEFAULT 'active'
                );
            `);
        } catch (err) {
            console.error('[MemoryConsolidation] Error asegurando tabla consolidated_memories:', err.message);
        }
    }

    /**
     * Agrupa recuerdos activos según entidades compartidas o temas afines.
     */
    findMemoryClusters(memories = []) {
        if (!memories || memories.length === 0) return [];

        const clustersByTopic = new Map();

        for (const mem of memories) {
            const text = mem.value || mem.text || '';
            const entities = hybridMemoryService.extractEntities(text);

            if (entities.length === 0) continue;

            // Determinar el tema principal del recuerdo (primeras entidades dominantes)
            for (const entity of entities) {
                // Filtrar números o entidades menores a 3 letras para el agrupamiento raíz
                if (/^\d+$/.test(entity) || entity.length < 3) continue;

                if (!clustersByTopic.has(entity)) {
                    clustersByTopic.set(entity, []);
                }
                const currentCluster = clustersByTopic.get(entity);
                if (!currentCluster.some(m => m.id === mem.id)) {
                    currentCluster.push(mem);
                }
            }
        }

        // Retornar solo grupos que tengan al menos 2 recuerdos relacionados
        const validClusters = [];
        const seenMemoryIds = new Set();

        for (const [topic, cluster] of clustersByTopic.entries()) {
            if (cluster.length >= 2) {
                // Evitar duplicar agrupaciones idénticas
                const clusterKey = cluster.map(m => m.id).sort().join(',');
                if (!seenMemoryIds.has(clusterKey)) {
                    seenMemoryIds.add(clusterKey);
                    validClusters.push({
                        topic,
                        memories: cluster
                    });
                }
            }
        }

        return validClusters;
    }

    /**
     * Sintetiza un grupo de recuerdos relacionados en una declaración cohesiva de alta densidad.
     */
    synthesizeCluster(topic, memories = []) {
        const rawTexts = memories.map(m => m.value || m.text || '').filter(Boolean);
        if (rawTexts.length === 0) return null;

        // Limpiar prefijos redundantes (ej. "Rodri usa", "El usuario tiene")
        const facts = rawTexts.map(t => {
            return t
                .replace(/^(?:rodri|el\s+usuario)\s+(?:usa|desarrolla|trabaja\s+en|tiene|pago|pago\s+por|rinde|configura|ejecuta)\s+/i, '')
                .trim();
        });

        // Remover menciones repetitivas del tema principal dentro de cada hecho
        const topicRegex = new RegExp(`\\b${topic}\\b`, 'gi');
        const compressedFacts = facts.map(f => {
            const stripped = f.replace(topicRegex, '').replace(/\s+/g, ' ').trim();
            return stripped.length > 3 ? stripped : f;
        });

        // Deducir dominio general
        const combined = rawTexts.join(' ').toLowerCase();
        let domain = 'General';
        if (/(?:docker|postgres|node|python|backend|api|git|servidor|puerto)/i.test(combined)) {
            domain = 'Desarrollo / Infraestructura';
        } else if (/(?:pago|factura|banco|dolar|pesos|tarjeta|suscripcion)/i.test(combined)) {
            domain = 'Finanzas';
        } else if (/(?:examen|final|parcial|catedra|facultad|universidad|materia|tp)/i.test(combined)) {
            domain = 'Estudio / Universidad';
        } else if (/(?:tv|tele|router|monitor|living|dormitorio|hogar|luz)/i.test(combined)) {
            domain = 'Hogar / Dispositivos';
        } else if (/(?:alergia|salud|medicamento|presion|medico)/i.test(combined)) {
            domain = 'Salud';
        } else if (/(?:unity|juego|terror|bosque|escena|personaje)/i.test(combined)) {
            domain = 'Videojuegos / Creatividad';
        }

        // Generar título y síntesis
        const capitalizedTopic = topic.charAt(0).toUpperCase() + topic.slice(1);
        const title = `${capitalizedTopic} (${domain})`;
        
        // Unificar hechos sin duplicar términos
        const uniqueFacts = Array.from(new Set(compressedFacts));
        const summary = `${capitalizedTopic}: ${uniqueFacts.join('; ')}.`;

        // Estimar ahorro de tokens (caracteres originales vs sintetizados / 4)
        const originalChars = rawTexts.reduce((acc, t) => acc + t.length, 0);
        const tokensSaved = Math.max(0, Math.round((originalChars - summary.length) / 4));

        return {
            title,
            summary,
            domain,
            topic,
            tokensSaved,
            sourceIds: memories.map(m => m.id),
            source_ids: memories.map(m => m.id)
        };
    }

    /**
     * Ejecuta el trabajo de consolidación en base de datos.
     * Inserta el nuevo recuerdo consolidado, preserva los vínculos y marca los originales como CONSOLIDATED.
     */
    runConsolidationJob(options = {}) {
        let memories = options.candidates;

        // Si no se suministran candidatos directos, buscar en SQLite los recuerdos activos
        if (!memories) {
            try {
                memories = databaseService.db.prepare(`
                    SELECT * FROM memory 
                    WHERE status = 'ACTIVE' 
                    ORDER BY created_at DESC LIMIT 500
                `).all();
            } catch (err) {
                memories = [];
            }
        }

        const clusters = this.findMemoryClusters(memories);
        const consolidations = [];
        let totalProcessed = 0;
        let totalTokensSaved = 0;

        for (const cluster of clusters) {
            const synthesized = this.synthesizeCluster(cluster.topic, cluster.memories);
            if (!synthesized) continue;

            const consolidationId = `cons-${crypto.randomUUID().slice(0, 8)}`;
            const memoryId = `mem-cons-${crypto.randomUUID().slice(0, 8)}`;
            const now = new Date().toISOString();

            try {
                // 1. Guardar en tabla de auditoría consolidated_memories
                databaseService.db.prepare(`
                    INSERT INTO consolidated_memories (id, title, summary, source_ids_json, domain, tokens_saved_estimate, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
                `).run(
                    consolidationId,
                    synthesized.title,
                    synthesized.summary,
                    JSON.stringify(synthesized.sourceIds),
                    synthesized.domain,
                    synthesized.tokensSaved,
                    now
                );

                // 2. Insertar en tabla central de memoria con tier 'CORE'
                databaseService.db.prepare(`
                    INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, status)
                    VALUES (?, 'CONSOLIDATED', 'CORE', ?, ?, 'consolidation_job', 0.95, ?, 'ACTIVE')
                `).run(
                    memoryId,
                    `consolidated_${cluster.topic}`,
                    synthesized.summary,
                    now
                );

                // 3. Actualizar los recuerdos originales a 'CONSOLIDATED' (sin borrarlos)
                for (const sourceId of synthesized.sourceIds) {
                    databaseService.db.prepare("UPDATE memory SET status = 'CONSOLIDATED' WHERE id = ?").run(sourceId);
                }

                totalProcessed += synthesized.sourceIds.length;
                totalTokensSaved += synthesized.tokensSaved;

                consolidations.push({
                    consolidationId,
                    memoryId,
                    title: synthesized.title,
                    summary: synthesized.summary,
                    domain: synthesized.domain,
                    sourcesCount: synthesized.sourceIds.length,
                    sourceIds: synthesized.sourceIds,
                    tokensSaved: synthesized.tokensSaved
                });
            } catch (err) {
                console.error(`[MemoryConsolidation] Error consolidando tema ${cluster.topic}:`, err.message);
            }
        }

        return {
            ok: true,
            clustersFound: clusters.length,
            memoriesProcessed: totalProcessed,
            consolidationsCreated: consolidations.length,
            totalTokensSavedEstimate: totalTokensSaved,
            consolidations
        };
    }

    /**
     * Permite revertir una consolidación (Rollback) restaurando los recuerdos originales a 'ACTIVE'.
     */
    rollbackConsolidation(consolidationId) {
        const record = databaseService.db.prepare("SELECT * FROM consolidated_memories WHERE id = ?").get(consolidationId);
        if (!record) {
            return { ok: false, message: `Registro de consolidación '${consolidationId}' no encontrado.` };
        }

        try {
            const sourceIds = JSON.parse(record.source_ids_json || '[]');

            // Reactivar recuerdos originales
            for (const sId of sourceIds) {
                databaseService.db.prepare("UPDATE memory SET status = 'ACTIVE' WHERE id = ?").run(sId);
            }

            // Marcar consolidación como deshecha
            databaseService.db.prepare("UPDATE consolidated_memories SET status = 'rolled_back' WHERE id = ?").run(consolidationId);
            databaseService.db.prepare("UPDATE memory SET status = 'SUPERSEDED' WHERE key = ?").run(`consolidated_${record.domain}`);

            return {
                ok: true,
                consolidationId,
                restoredCount: sourceIds.length,
                message: `Consolidación '${consolidationId}' revertida con éxito. Se restauraron ${sourceIds.length} recuerdos originales.`
            };
        } catch (err) {
            return { ok: false, message: `Fallo durante rollback de consolidación: ${err.message}` };
        }
    }

    /**
     * Lista las consolidaciones activas con sus vínculos originales.
     */
    listConsolidations() {
        const rows = databaseService.db.prepare("SELECT * FROM consolidated_memories WHERE status = 'active' ORDER BY created_at DESC").all();
        return rows.map(r => ({
            ...r,
            sourceIds: JSON.parse(r.source_ids_json || '[]')
        }));
    }
}

const memoryConsolidationService = new MemoryConsolidationService();
module.exports = memoryConsolidationService;
