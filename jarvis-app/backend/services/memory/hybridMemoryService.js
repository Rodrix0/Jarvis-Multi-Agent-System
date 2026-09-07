/**
 * Hybrid Memory Service for Jarvis (Ítem 17)
 * Implementa recuperación y ranking multicriterio con puntuación ponderada:
 *   - Vector similarity:  40% (0.40)
 *   - Text match:         25% (0.25)
 *   - Recency:            15% (0.15)
 *   - Importance:         10% (0.10)
 *   - Entity match:       10% (0.10)
 *
 * Resuelve consultas semánticas complejas ("¿Qué cantidad de árboles tenía mi bosque?" -> "319 árboles")
 * incluso si la frase exacta o redacción difiere notablemente.
 */

const databaseService = require('../persistence/databaseService');

const DEFAULT_WEIGHTS = {
    vector: 0.40,
    textMatch: 0.25,
    recency: 0.15,
    importance: 0.10,
    entityMatch: 0.10
};

function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    const stopWords = new Set([
        'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
        'de', 'del', 'a', 'en', 'para', 'por', 'con', 'sin', 'sobre',
        'que', 'que', 'como', 'cual', 'mi', 'tu', 'su', 'mis', 'tus',
        'es', 'son', 'fue', 'era', 'tenia', 'tiene', 'tengo', 'hay'
    ]);
    const words = normalizeText(text).split(' ');
    return words.filter(w => w.length > 1 && !stopWords.has(w));
}

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
    const sim = dot / (Math.sqrt(ma) * Math.sqrt(mb));
    return Math.max(0, Math.min(1, sim));
}

function bufferToFloat32Array(buf) {
    if (!buf || buf.byteLength < 4) return null;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

class HybridMemoryService {
    constructor() {
        this.defaultWeights = DEFAULT_WEIGHTS;
    }

    /**
     * 1. VECTOR SIMILARITY (40%): Similitud de significado entre embeddings.
     */
    calculateVectorSimilarity(queryVec, docVec) {
        if (!queryVec || !docVec) return 0.0;
        return cosineSimilarity(queryVec, docVec);
    }

    /**
     * 2. TEXT MATCH (25%): Coincidencia léxica directa, solapamiento de tokens y n-gramas.
     */
    calculateTextMatch(queryText, docText) {
        const qTokens = tokenize(queryText);
        const dTokens = tokenize(docText);

        if (qTokens.length === 0 || dTokens.length === 0) return 0.0;

        const docTokenSet = new Set(dTokens);
        let intersection = 0;
        for (const t of qTokens) {
            if (docTokenSet.has(t)) {
                intersection++;
            }
        }

        const overlapScore = intersection / qTokens.length;

        // Bonificación si el texto normalizado contiene la frase o palabras contiguas
        const qNorm = normalizeText(queryText);
        const dNorm = normalizeText(docText);
        const substringBonus = (qNorm.length > 3 && dNorm.includes(qNorm)) ? 0.2 : 0.0;

        return Math.min(1.0, overlapScore + substringBonus);
    }

    /**
     * 3. RECENCY (15%): Decaimiento temporal suave (Half-Life temporal).
     * Los recuerdos frescos tienen ventaja sin olvidar eventos pasados.
     */
    calculateRecency(createdAt, now = new Date()) {
        if (!createdAt) return 0.5;
        try {
            const createdTime = new Date(createdAt).getTime();
            const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
            const diffDays = Math.max(0, (nowTime - createdTime) / (1000 * 60 * 60 * 24));

            // Decaimiento suave: a los 7 días vale 0.66, a los 30 días vale 0.31, etc.
            return Math.max(0.05, 1.0 / (1.0 + (diffDays / 14.0)));
        } catch (_) {
            return 0.5;
        }
    }

    /**
     * 4. IMPORTANCE (10%): Calificación intrínseca del recuerdo (0.0 a 1.0).
     */
    calculateImportance(candidate) {
        if (typeof candidate.importance === 'number') {
            return Math.max(0.0, Math.min(1.0, candidate.importance));
        }
        if (candidate.metadata && typeof candidate.metadata.importance === 'number') {
            return Math.max(0.0, Math.min(1.0, candidate.metadata.importance));
        }
        if (candidate.confidence && typeof candidate.confidence === 'number') {
            return Math.max(0.0, Math.min(1.0, candidate.confidence));
        }
        if (candidate.core_tier === 'CORE' || candidate.tier === 'CORE') return 0.95;
        if (candidate.tier === 'SENSITIVE') return 0.90;
        if (candidate.tier === 'PERSONAL') return 0.80;
        return 0.50; // Default medio equilibrado
    }

    /**
     * 5. ENTITY MATCH (10%): Coincidencia de entidades clave (números, cantidades, nombres propios).
     */
    extractEntities(text) {
        const raw = String(text || '');
        const entities = new Set();

        // 1. Números y cantidades (ej. "319", "50%", "2022")
        const numberMatches = raw.match(/\b\d+(?:[\.,]\d+)?\b/g);
        if (numberMatches) {
            numberMatches.forEach(n => entities.add(n.toLowerCase()));
        }

        // 2. Palabras clave sustantivas, mayúsculas, siglas técnicas y nombres propios
        const ignoredWords = new Set([
            'que', 'cual', 'como', 'donde', 'quien', 'cuando', 'por', 'para',
            'cuanto', 'cuanta', 'cantidad', 'este', 'esta', 'estos', 'estas',
            'aquel', 'aquella', 'hacer', 'tener', 'estar', 'haber', 'decir'
        ]);
        const words = raw.split(/\s+/);
        for (const w of words) {
            const clean = w.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._-]/g, '');
            const cleanLower = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            // Siglas en mayúsculas (ej. API, SQL, URP, PDF, USD, MEP, CPU, RAM)
            if (/^[A-Z0-9]{2,6}$/.test(clean)) {
                entities.add(cleanLower);
            }
            // Nombres propios o términos con mayúscula inicial
            else if (clean.length > 2 && /^[A-ZÁÉÍÓÚ]/.test(clean) && !ignoredWords.has(cleanLower)) {
                entities.add(cleanLower);
            }
            // Identificadores técnicos o nombres de archivo (ej. main.py, config.json, react-native)
            else if (/[._-]/.test(clean) && clean.length > 3) {
                entities.add(cleanLower);
            }
        }

        // 3. Sustantivos y términos de contenido universal (longitud >= 4 sin stopwords)
        // Cubre automáticamente finanzas, medicina, facultad, dev, hogar, deportes, creatividad, etc.
        const contentTokens = tokenize(raw);
        for (const token of contentTokens) {
            if (token.length >= 4 && !ignoredWords.has(token)) {
                entities.add(token);
            }
        }

        return Array.from(entities);
    }

    calculateEntityMatch(queryText, docText) {
        const qEntities = this.extractEntities(queryText);
        const dEntities = this.extractEntities(docText);

        if (qEntities.length === 0) {
            // Si la consulta no tiene entidades explícitas, evaluar tokens significativos
            const qTokens = tokenize(queryText);
            const dTokens = new Set(tokenize(docText));
            const common = qTokens.filter(t => dTokens.has(t));
            return qTokens.length > 0 ? common.length / qTokens.length : 0.0;
        }

        const docEntitySet = new Set(dEntities);
        let matches = 0;
        for (const entity of qEntities) {
            if (docEntitySet.has(entity)) {
                matches++;
            }
        }

        return matches / qEntities.length;
    }

    /**
     * Evalúa un único candidato y calcula el puntaje híbrido ponderado con desglose explicable.
     */
    scoreCandidate(queryText, queryVec, candidate, customWeights = {}) {
        const weights = { ...this.defaultWeights, ...customWeights };

        // 1. Similitud Vectorial
        let vectorScore = 0.0;
        if (candidate.vector) {
            const docVec = Array.isArray(candidate.vector)
                ? new Float32Array(candidate.vector)
                : (candidate.vector instanceof Float32Array ? candidate.vector : bufferToFloat32Array(candidate.vector));
            vectorScore = this.calculateVectorSimilarity(queryVec, docVec);
        } else if (typeof candidate.vectorScore === 'number') {
            vectorScore = candidate.vectorScore;
        }

        // 2. Coincidencia Léxica
        const docText = candidate.text || candidate.value || '';
        const textScore = this.calculateTextMatch(queryText, docText);

        // 3. Recencia
        const createdAt = candidate.created_at || candidate.createdAt || candidate.timestamp;
        const recencyScore = this.calculateRecency(createdAt);

        // 4. Importancia
        const importanceScore = this.calculateImportance(candidate);

        // 5. Coincidencia de Entidades
        const entityScore = this.calculateEntityMatch(queryText, docText);

        // Ponderación compuesta
        // Si no se proporcionó vector (ej. Ollama offline), redistribuir el peso del vector de forma equilibrada
        let effectiveWeights = { ...weights };
        if (!queryVec && !candidate.vector && typeof candidate.vectorScore !== 'number') {
            const factor = 1.0 / (1.0 - weights.vector);
            effectiveWeights = {
                vector: 0.0,
                textMatch: weights.textMatch * factor,
                recency: weights.recency * factor,
                importance: weights.importance * factor,
                entityMatch: weights.entityMatch * factor
            };
        }

        // Relevancia directa: si no coincide ni por vector, ni por texto, ni por entidades, el puntaje es 0
        const directRelevance = Math.max(vectorScore, textScore, entityScore);
        if (directRelevance === 0) {
            return {
                ...candidate,
                score: 0.0,
                breakdown: {
                    vector: Math.round(vectorScore * 1000) / 1000,
                    textMatch: Math.round(textScore * 1000) / 1000,
                    recency: Math.round(recencyScore * 1000) / 1000,
                    importance: Math.round(importanceScore * 1000) / 1000,
                    entityMatch: Math.round(entityScore * 1000) / 1000
                }
            };
        }

        const totalScore = (
            (vectorScore * effectiveWeights.vector) +
            (textScore * effectiveWeights.textMatch) +
            (recencyScore * effectiveWeights.recency) +
            (importanceScore * effectiveWeights.importance) +
            (entityScore * effectiveWeights.entityMatch)
        );

        return {
            ...candidate,
            score: Math.round(totalScore * 1000) / 1000,
            breakdown: {
                vector: Math.round(vectorScore * 1000) / 1000,
                textMatch: Math.round(textScore * 1000) / 1000,
                recency: Math.round(recencyScore * 1000) / 1000,
                importance: Math.round(importanceScore * 1000) / 1000,
                entityMatch: Math.round(entityScore * 1000) / 1000
            }
        };
    }

    /**
     * Ejecuta una búsqueda híbrida multicriterio sobre una colección de recuerdos.
     */
    async searchHybrid(queryText, options = {}) {
        const limit = options.limit || 5;
        const weights = options.weights || this.defaultWeights;
        const queryVec = options.queryVec || null;

        let candidateList = options.candidates;

        // Si no se pasan candidatos explícitos, consultar base de datos
        if (!candidateList) {
            try {
                const rows = databaseService.db.prepare(`
                    SELECT id, type, tier, key, value as text, source, confidence as importance, created_at
                    FROM memory 
                    WHERE status = 'ACTIVE'
                    ORDER BY created_at DESC LIMIT 200
                `).all();
                candidateList = rows;
            } catch (err) {
                candidateList = [];
            }
        }

        const scored = candidateList.map(item => this.scoreCandidate(queryText, queryVec, item, weights));

        // Ordenar descendentemente por puntaje híbrido
        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, limit);
    }
}

const hybridMemoryService = new HybridMemoryService();
module.exports = hybridMemoryService;
