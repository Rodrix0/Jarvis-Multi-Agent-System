const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_PATH = process.env.JARVIS_MEMORY_PATH || path.join(__dirname, '..', 'data', 'jarvis_memory.json');
const MAX_TURNS = 240;

const EMPTY_MEMORY = {
    version: 1,
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

function summarizeOldTurns(memory) {
    if (memory.conversations.length <= MAX_TURNS) return;
    const removed = memory.conversations.splice(0, memory.conversations.length - 160);
    const grouped = removed.reduce((acc, turn) => {
        (acc[turn.topic || 'general'] ||= []).push(turn);
        return acc;
    }, {});
    for (const [topic, turns] of Object.entries(grouped)) {
        memory.summaries.push({
            id: crypto.randomUUID(),
            topic,
            createdAt: new Date().toISOString(),
            turnCount: turns.length,
            text: turns.slice(-12).map(turn => `${turn.role}: ${turn.text.slice(0, 180)}`).join(' | ')
        });
    }
    memory.summaries = memory.summaries.slice(-60);
}

function addTurn(role, text, meta = {}) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const memory = read();
    const topic = meta.topic || detectTopic(clean, memory.activeTopic);
    memory.activeTopic = topic;
    memory.topics[topic] = { lastUsedAt: new Date().toISOString(), turnCount: (memory.topics[topic]?.turnCount || 0) + 1 };
    const turn = { id: crypto.randomUUID(), at: new Date().toISOString(), role, text: clean.slice(0, 4000), topic, meta };
    memory.conversations.push(turn);
    summarizeOldTurns(memory);
    write(memory);
    return turn;
}

function recent(limit = 12, topic = '') {
    const memory = read();
    const turns = topic ? memory.conversations.filter(item => item.topic === topic) : memory.conversations;
    return turns.slice(-Math.min(50, Math.max(1, Number(limit) || 12)));
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

function snapshot() {
    const memory = read();
    return {
        activeTopic: memory.activeTopic,
        topics: memory.topics,
        conversations: memory.conversations.slice(-100),
        preferences: memory.preferences,
        corrections: memory.corrections,
        summaries: memory.summaries.slice(-30)
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

module.exports = { addTurn, recent, resolveReferences, addPreference, addCorrection, applyCorrections, snapshot, updateItem, removeItem, clear, detectTopic };
