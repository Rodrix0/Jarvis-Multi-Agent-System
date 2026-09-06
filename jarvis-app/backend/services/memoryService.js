const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_PATH = process.env.JARVIS_MEMORY_PATH || path.join(__dirname, '..', 'data', 'jarvis_memory.json');

// Presupuesto Dinámico de Tokens (Ítem 21): sustituye el límite fijo de 240 turnos
const MAX_TOKENS = parseInt(process.env.JARVIS_MAX_CONTEXT_TOKENS, 10) || 20000;
const TARGET_TOKENS = Math.floor(MAX_TOKENS * 0.90); // 18.000 tokens (zona óptima de confort)

/**
 * Estimador de tokens calibrado para español, inglés y sintaxis de programación.
 * Pondera palabras, signos de puntuación y operadores/símbolos de código.
 */
function estimateTokens(text) {
    if (!text) return 0;
    const str = String(text);
    const words = str.trim().split(/\s+/).filter(Boolean);
    const symbols = (str.match(/[{}[\]()<>=;:,.*+?^$|\\!@#%&~`"'/_-]/g) || []).length;
    // ~1.25 tokens por palabra + 0.3 por símbolo de puntuación o código
    const estimated = Math.ceil((words.length * 1.25) + (symbols * 0.3));
    return Math.max(1, Math.max(estimated, Math.ceil(str.length / 4.0)));
}

function getTotalTokens(conversations = []) {
    return conversations.reduce((acc, turn) => acc + (turn.tokens || estimateTokens(turn.text)), 0);
}

const EMPTY_MEMORY = {
    version: 2,
    activeTopic: 'general',
    conversations: [],
    topics: {},
    preferences: [],
    corrections: [],
    summaries: []
};

function read() {
    try {
        if (!fs.existsSync(MEMORY_PATH)) return structuredClone(EMPTY_MEMORY);
        return { ...structuredClone(EMPTY_MEMORY), ...JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')) };
    } catch (error) {
        console.error('[Memoria] Archivo inválido:', error.message);
        return structuredClone(EMPTY_MEMORY);
    }
}

function write(memory) {
    fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
    const temporary = `${MEMORY_PATH}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(memory, null, 2));
    fs.renameSync(temporary, MEMORY_PATH);
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function detectTopic(text, previous = 'general') {
    const value = normalize(text);
    const topics = [
        ['television', /\b(netflix|tele|television|broadlink|pelicula|serie)\b/],
        ['programacion', /\b(codigo|programa|software|web|javascript|python|error|proyecto)\b/],
        ['estudio', /\b(estudi|tarea|examen|documento|pdf|resumen|explica)\b/],
        ['agenda', /\b(recorda|agenda|alarma|calendario|pendiente)\b/],
        ['musica', /\b(spotify|musica|cancion|artista|playlist)\b/],
        ['sistema', /\b(windows|computadora|notebook|archivo|carpeta|aplicacion)\b/]
    ];
    for (const [topic, pattern] of topics) if (pattern.test(value)) return topic;
    if (/\b(otra cosa|cambiando de tema|ahora hablemos)\b/.test(value)) return 'general';
    return previous || 'general';
}

function summarizeEvictedTurns(memory, evictedTurns = []) {
    if (!evictedTurns || evictedTurns.length === 0) return;
    const grouped = evictedTurns.reduce((acc, turn) => {
        (acc[turn.topic || 'general'] ||= []).push(turn);
        return acc;
    }, {});

    for (const [topic, turns] of Object.entries(grouped)) {
        const textSummary = turns.slice(-12).map(turn => `${turn.role}: ${turn.text.slice(0, 200)}`).join(' | ');
        memory.summaries.push({
            id: crypto.randomUUID(),
            topic,
            createdAt: new Date().toISOString(),
            turnCount: turns.length,
            tokensEstimate: estimateTokens(textSummary),
            text: textSummary,
            timeRange: {
                from: turns[0]?.at,
                to: turns[turns.length - 1]?.at
            }
        });
    }

    // Mantener un historial de resúmenes rodantes (máximo 60)
    memory.summaries = memory.summaries.slice(-60);
}

function evictOldTurnsProgressively(memory) {
    let currentTokens = getTotalTokens(memory.conversations);
    if (currentTokens <= MAX_TOKENS) return;

    const evicted = [];

    // Desalojo progresivo FIFO respetando turnos fijados ('pinned' o 'priority: high')
    let i = 0;
    while (i < memory.conversations.length && currentTokens > TARGET_TOKENS) {
        const turn = memory.conversations[i];
        const isPinned = turn.meta && (turn.meta.pinned === true || turn.meta.importance === 'HIGH' || turn.meta.priority === 'high');

        if (isPinned) {
            i++;
            continue;
        }

        const [removed] = memory.conversations.splice(i, 1);
        const removedTokens = removed.tokens || estimateTokens(removed.text);
        currentTokens -= removedTokens;
        evicted.push(removed);
    }

    if (evicted.length > 0) {
        summarizeEvictedTurns(memory, evicted);
    }
}

function addTurn(role, text, meta = {}) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const memory = read();
    const topic = meta.topic || detectTopic(clean, memory.activeTopic);
    memory.activeTopic = topic;
    memory.topics[topic] = { lastUsedAt: new Date().toISOString(), turnCount: (memory.topics[topic]?.turnCount || 0) + 1 };
    
    const tokens = estimateTokens(clean);
    const turn = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        role,
        text: clean.slice(0, 16000),
        tokens,
        topic,
        meta
    };
    memory.conversations.push(turn);
    evictOldTurnsProgressively(memory);
    write(memory);
    return turn;
}

function recent(limit = 12, topic = '') {
    const memory = read();
    const turns = topic ? memory.conversations.filter(item => item.topic === topic) : memory.conversations;
    return turns.slice(-Math.min(50, Math.max(1, Number(limit) || 12)));
}

function recentByTokens(tokenBudget = 4000, topic = '') {
    const memory = read();
    const allTurns = topic ? memory.conversations.filter(item => item.topic === topic) : memory.conversations;

    const selectedTurns = [];
    let accumulatedTokens = 0;
    const budget = Math.max(100, Number(tokenBudget) || 4000);

    // Iterar desde el más reciente hacia atrás
    for (let i = allTurns.length - 1; i >= 0; i--) {
        const turn = allTurns[i];
        const turnTokens = turn.tokens || estimateTokens(turn.text);

        if (accumulatedTokens + turnTokens <= budget) {
            selectedTurns.unshift(turn);
            accumulatedTokens += turnTokens;
        } else {
            break;
        }
    }

    return {
        turns: selectedTurns,
        totalTokens: accumulatedTokens,
        budget,
        count: selectedTurns.length
    };
}

function resolveReferences(text) {
    const clean = String(text || '').trim();
    const memory = read();
    const reference = /\b(eso|esa|ese|esto|la anterior|el anterior|lo anterior|lo mismo|segui con|seguí con|continua con|continuá con)\b/i.test(clean);
    if (!reference) return { text: clean, resolved: false, context: [] };
    const context = memory.conversations.filter(turn => turn.topic === memory.activeTopic).slice(-6);
    return { text: clean, resolved: context.length > 0, topic: memory.activeTopic, context };
}

function addPreference(key, value, source = 'user') {
    const memory = read();
    const normalizedKey = normalize(key).slice(0, 120);
    const existing = memory.preferences.find(item => item.key === normalizedKey);
    if (existing) {
        existing.value = String(value).slice(0, 1000);
        existing.updatedAt = new Date().toISOString();
        existing.source = source;
    } else {
        memory.preferences.push({ id: crypto.randomUUID(), key: normalizedKey, value: String(value).slice(0, 1000), source, createdAt: new Date().toISOString() });
    }
    write(memory);
    return memory.preferences.find(item => item.key === normalizedKey);
}

function addCorrection(from, to) {
    const memory = read();
    const source = String(from || '').trim();
    const target = String(to || '').trim();
    if (!source || !target) throw new Error('La corrección necesita texto original y correcto.');
    const existing = memory.corrections.find(item => normalize(item.from) === normalize(source));
    if (existing) {
        existing.to = target;
        existing.updatedAt = new Date().toISOString();
    } else {
        memory.corrections.push({ id: crypto.randomUUID(), from: source, to: target, createdAt: new Date().toISOString() });
    }
    write(memory);
    // La corrección también alimenta el vocabulario acústico que Whisper usa
    // como contexto en las siguientes transcripciones.
    require('./voiceLearningService').recordCorrection(source, target);
    return target;
}

function applyCorrections(text) {
    let result = String(text || '');
    for (const correction of read().corrections) {
        result = result.replace(new RegExp(correction.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), correction.to);
    }
    return result;
}

function getMetrics() {
    const memory = read();
    const totalTokens = getTotalTokens(memory.conversations);
    const totalTurns = memory.conversations.length;
    const pinnedTurnsCount = memory.conversations.filter(t => t.meta && (t.meta.pinned === true || t.meta.importance === 'HIGH' || t.meta.priority === 'high')).length;

    return {
        totalTurns,
        totalTokens,
        maxTokens: MAX_TOKENS,
        targetTokens: TARGET_TOKENS,
        utilizationPercent: Math.round((totalTokens / MAX_TOKENS) * 100),
        averageTokensPerTurn: totalTurns ? Math.round(totalTokens / totalTurns) : 0,
        pinnedTurnsCount,
        summariesCount: memory.summaries.length,
        topicsCount: Object.keys(memory.topics).length
    };
}

function snapshot() {
    const memory = read();
    return {
        activeTopic: memory.activeTopic,
        topics: memory.topics,
        conversations: memory.conversations,
        preferences: memory.preferences,
        corrections: memory.corrections,
        summaries: memory.summaries.slice(-30),
        metrics: getMetrics()
    };
}

function updateItem(collection, id, patch = {}) {
    if (!['preferences', 'corrections', 'summaries'].includes(collection)) throw new Error('Colección no editable.');
    const memory = read();
    const item = memory[collection].find(entry => entry.id === id);
    if (!item) throw new Error('Recuerdo no encontrado.');
    Object.assign(item, patch, { id: item.id, updatedAt: new Date().toISOString() });
    write(memory);
    return item;
}

function removeItem(collection, id) {
    if (!['preferences', 'corrections', 'summaries', 'conversations'].includes(collection)) throw new Error('Colección no editable.');
    const memory = read();
    const before = memory[collection].length;
    memory[collection] = memory[collection].filter(entry => entry.id !== id);
    write(memory);
    return memory[collection].length < before;
}

function clear(collection) {
    const memory = read();
    if (collection === 'all') {
        write(structuredClone(EMPTY_MEMORY));
        return true;
    }
    if (!['preferences', 'corrections', 'summaries', 'conversations'].includes(collection)) throw new Error('Colección no válida.');
    memory[collection] = [];
    write(memory);
    return true;
}

module.exports = {
    addTurn,
    recent,
    recentByTokens,
    getMetrics,
    estimateTokens,
    getTotalTokens,
    MAX_TOKENS,
    TARGET_TOKENS,
    resolveReferences,
    addPreference,
    addCorrection,
    applyCorrections,
    snapshot,
    updateItem,
    removeItem,
    clear,
    detectTopic
};
