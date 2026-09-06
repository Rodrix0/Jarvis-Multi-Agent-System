const crypto = require('crypto');
const databaseService = require('../persistence/databaseService');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text:latest';
const QUERY_TIMEOUT_MS = 300; // 300ms estricto para no demorar la respuesta de Jarvis

function cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    let dot = 0, ma = 0, mb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        ma += a[i] * a[i];
        mb += b[i] * b[i];
    }
    if (ma === 0 || mb === 0) return 0;
    return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

function bufferToFloat32Array(buf) {
    if (!buf || buf.byteLength < 4) return null;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function float32ArrayToBuffer(arr) {
    if (!arr) return Buffer.alloc(0);
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

class EmbeddingService {
    constructor() {
        this.model = EMBED_MODEL;
        this.ollamaUrl = OLLAMA_HOST;
        this.isProcessingQueue = false;
        this.queue = [];
    }

    /**
     * Genera un embedding vectorial de 768 dimensiones.
     * Con límite estricto de timeout (300ms por defecto en inferencia)
     * para evitar bloqueos por swapping de VRAM entre modelos.
     */
    async generateEmbedding(text, timeoutMs = QUERY_TIMEOUT_MS) {
        if (!text || typeof text !== 'string' || !text.trim()) return null;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${this.ollamaUrl}/api/embed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    input: text.slice(0, 2000),
                    keep_alive: '60m'
                }),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!response.ok) {
                if (response.status === 404) {
                    return this._generateEmbeddingLegacy(text, timeoutMs);
                }
                return null;
            }

            const data = await response.json();
            if (data.embeddings && data.embeddings.length > 0) {
                return new Float32Array(data.embeddings[0]);
            }
            return null;
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                console.warn(`[EmbeddingService] Timeout (> ${timeoutMs}ms) en Ollama. Activando fallback léxico instantáneo.`);
            } else {
                console.warn(`[EmbeddingService] Error en Ollama embed: ${err.message}. Usando fallback léxico.`);
            }
            return null;
        }
    }

    async _generateEmbeddingLegacy(text, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: text.slice(0, 2000),
                    keep_alive: '60m'
                }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const d = await res.json();
            return d.embedding ? new Float32Array(d.embedding) : null;
        } catch {
            clearTimeout(timer);
            return null;
        }
    }

    /**
     * Guarda un recuerdo en la tabla `memory_vectors`.
     * Por defecto guarda el registro inmediatamente con vector vacío y procesa
     * el embedding en background para jamás demorar la respuesta por voz o comandos.
     */
    async storeMemoryVector({ id = null, text, category = 'general', metadata = {}, sync = false }) {
        if (!text || typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'Texto vacío' };

        const memId = id || `vec-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

        let vectorBuf = Buffer.alloc(0);

        if (sync) {
            // Modo sincrónico (para tests o tareas programadas en reposo)
            const embedding = await this.generateEmbedding(text, 15000);
            if (embedding) {
                vectorBuf = float32ArrayToBuffer(embedding);
            }
        }

        try {
            databaseService.db.prepare(`
                INSERT INTO memory_vectors (id, text, vector, category, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    text = excluded.text,
                    vector = CASE WHEN length(excluded.vector) > 0 THEN excluded.vector ELSE memory_vectors.vector END,
                    category = excluded.category,
                    metadata_json = excluded.metadata_json,
                    created_at = excluded.created_at
            `).run(memId, text.trim(), vectorBuf, category, metaStr, now);

            if (!sync && vectorBuf.length === 0) {
                // Encolar para embedding asíncrono en background
                this.queue.push({ id: memId, text: text.trim() });
                this.processQueue();
            }

            return { ok: true, id: memId, hasVector: vectorBuf.length > 0 };
        } catch (err) {
            console.error('[EmbeddingService] Error insertando en SQLite:', err.message);
            return { ok: false, reason: err.message };
        }
    }

    processQueue() {
        if (this.isProcessingQueue || this.queue.length === 0) return;
        this.isProcessingQueue = true;

        setImmediate(async () => {
            while (this.queue.length > 0) {
                const item = this.queue.shift();
                try {
                    const embedding = await this.generateEmbedding(item.text, 20000);
                    if (embedding) {
                        const buf = float32ArrayToBuffer(embedding);
                        databaseService.db.prepare(`
                            UPDATE memory_vectors SET vector = ? WHERE id = ?
                        `).run(buf, item.id);
                    }
                } catch (e) {
                    console.warn(`[EmbeddingService] Error en worker de fondo para ${item.id}:`, e.message);
                }
            }
            this.isProcessingQueue = false;
        });
    }

    /**
     * Búsqueda semántica híbrida:
     * 1. Intenta búsqueda vectorial rápida (timeout 300ms).
     * 2. Si hay timeout o falla de VRAM en Ollama, ejecuta fallback léxico instantáneo (<1ms).
     */
    async searchSimilar(queryText, options = {}) {
        const limit = options.limit || 3;
        const threshold = options.threshold !== undefined ? options.threshold : 0.42;
        const category = options.category || null;
        const maxCandidates = options.maxCandidates || 1000;

        if (!queryText || typeof queryText !== 'string' || !queryText.trim()) return [];

        const queryVec = await this.generateEmbedding(queryText, QUERY_TIMEOUT_MS);

        if (!queryVec) {
            // Fallback léxico instantáneo si hubo timeout o fallo de VRAM
            return this.searchLexical(queryText, limit, category);
        }

        try {
            let sql = `SELECT id, text, vector, category, metadata_json, created_at FROM memory_vectors WHERE length(vector) >= 3072`;
            const params = [];

            if (category) {
                sql += ` AND category = ?`;
                params.push(category);
            }

            sql += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(maxCandidates);

            const rows = databaseService.db.prepare(sql).all(...params);
            if (!rows || rows.length === 0) {
                return this.searchLexical(queryText, limit, category);
            }

            const scored = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const vec = bufferToFloat32Array(row.vector);
                if (!vec) continue;

                const sim = cosineSimilarity(queryVec, vec);
                if (sim >= threshold) {
                    scored.push({
                        id: row.id,
                        text: row.text,
                        category: row.category,
                        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
                        score: sim,
                        method: 'semantic'
                    });
                }
            }

            scored.sort((a, b) => b.score - a.score);

            if (scored.length === 0) {
                return this.searchLexical(queryText, limit, category);
            }

            return scored.slice(0, limit);
        } catch (err) {
            console.error('[EmbeddingService] Error en búsqueda vectorial:', err.message);
            return this.searchLexical(queryText, limit, category);
        }
    }

    /**
     * Búsqueda léxica (BM25 simplificada) como fallback sin depender de Ollama ni VRAM.
     */
    searchLexical(queryText, limit = 3, category = null) {
        try {
            const terms = queryText
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(t => t.length > 2);

            if (terms.length === 0) return [];

            let sql = `SELECT id, text, category, metadata_json, created_at FROM memory_vectors`;
            const params = [];
            if (category) {
                sql += ` WHERE category = ?`;
                params.push(category);
            }
            sql += ` ORDER BY created_at DESC LIMIT 500`;

            const rows = databaseService.db.prepare(sql).all(...params);
            if (!rows || rows.length === 0) return [];

            const scored = [];
            for (const row of rows) {
                const normalizedText = row.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                let matches = 0;
                for (const term of terms) {
                    if (normalizedText.includes(term)) matches++;
                }
                if (matches > 0) {
                    scored.push({
                        id: row.id,
                        text: row.text,
                        category: row.category,
                        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
                        score: matches / terms.length,
                        method: 'lexical'
                    });
                }
            }

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, limit);
        } catch (e) {
            console.error('[EmbeddingService] Error en búsqueda léxica:', e.message);
            return [];
        }
    }
}

const embeddingService = new EmbeddingService();
module.exports = embeddingService;
