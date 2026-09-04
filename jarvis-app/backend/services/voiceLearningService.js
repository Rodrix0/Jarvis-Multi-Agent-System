const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEARNING_PATH = process.env.JARVIS_VOICE_LEARNING_PATH
    || path.join(__dirname, '..', 'data', 'voice_learning.json');
const LEXICON_PATH = process.env.JARVIS_VOICE_LEXICON_PATH
    || path.join(__dirname, '..', 'data', 'voice_lexicon.json');

const CORE_VOCABULARY = [
    'Jarvis', 'BroadLink', 'WhatsApp', 'Netflix', 'YouTube', 'Discord', 'Spotify',
    'Chrome', 'Google', 'ChatGPT', 'Ollama', 'The Walking Dead', 'Haikyu',
    'Dorohedoro', 'El Mentalista', 'Rubius', 'Coscu', 'Davo', 'La Cobra',
    'prendete', 'apagate', 'computadora', 'notebook', 'televisión', 'película',
    'serie', 'capítulo', 'temporada', 'continuar viendo', 'descargar', 'dólar'
];

const SAFE_REPLAY_ACTIONS = new Set([
    'system.open', 'system.media-search', 'document.create-info', 'tv.control',
    'observer.set', 'mode.activate', 'information.dollar', 'download.url'
]);

const EMPTY = { version: 1, vocabulary: [], phrases: [] };

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function read() {
    try {
        if (!fs.existsSync(LEARNING_PATH)) return structuredClone(EMPTY);
        const value = JSON.parse(fs.readFileSync(LEARNING_PATH, 'utf8'));
        return {
            ...structuredClone(EMPTY), ...value,
            vocabulary: Array.isArray(value.vocabulary) ? value.vocabulary : [],
            phrases: Array.isArray(value.phrases) ? value.phrases : []
        };
    } catch (error) {
        console.error('[Aprendizaje de voz] Archivo inválido:', error.message);
        return structuredClone(EMPTY);
    }
}

function atomicWrite(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, filePath);
}

function write(value) {
    atomicWrite(LEARNING_PATH, value);
    refreshLexicon(value);
}

function usefulTerm(value) {
    const clean = String(value || '').trim().replace(/^https?:\/\/\S+$/i, '');
    if (clean.length < 3 || clean.length > 100) return '';
    if (/^(true|false|null|undefined|youtube|netflix)$/i.test(clean)) return '';
    return clean;
}

function addVocabulary(memory, canonical, variant = '', source = 'verified-action') {
    const cleanCanonical = usefulTerm(canonical);
    if (!cleanCanonical) return;
    const key = normalize(cleanCanonical);
    let item = memory.vocabulary.find(entry => normalize(entry.canonical) === key);
    if (!item) {
        item = { id: crypto.randomUUID(), canonical: cleanCanonical, variants: [], source, uses: 0, createdAt: new Date().toISOString() };
        memory.vocabulary.push(item);
    }
    const cleanVariant = usefulTerm(variant);
    if (cleanVariant && normalize(cleanVariant) !== key && !item.variants.some(entry => normalize(entry) === normalize(cleanVariant))) {
        item.variants.push(cleanVariant);
    }
    item.uses = (item.uses || 0) + 1;
    item.lastUsedAt = new Date().toISOString();
}

function vocabularyFromParams(params = {}) {
    const preferredKeys = ['appName', 'query', 'title', 'topic', 'platform', 'modeId'];
    return preferredKeys.flatMap(key => {
        const value = params[key];
        if (typeof value !== 'string') return [];
        const clean = usefulTerm(value);
        if (!clean) return [];
        const properWords = clean.split(/\s+/).filter(word => word.length >= 4);
        return [clean, ...properWords];
    });
}

function safeParams(params = {}) {
    return JSON.parse(JSON.stringify(params, (key, value) => {
        if (/token|password|secret|authorization|cookie/i.test(key)) return undefined;
        if (typeof value === 'string') return value.slice(0, 500);
        return value;
    }));
}

function recordVerifiedExecution({ utterance, actionId, params = {}, result = {} }) {
    if (!utterance || result.status !== 'completed' || result.verified !== true || !SAFE_REPLAY_ACTIONS.has(actionId)) return false;
    const memory = read();
    const normalized = normalize(utterance);
    if (!normalized) return false;
    let phrase = memory.phrases.find(entry => entry.normalized === normalized && entry.actionId === actionId);
    if (!phrase) {
        phrase = {
            id: crypto.randomUUID(), utterance: String(utterance).trim(), normalized,
            actionId, params: safeParams(params), verifiedRuns: 0, createdAt: new Date().toISOString()
        };
        memory.phrases.push(phrase);
    }
    phrase.params = safeParams(params);
    phrase.verifiedRuns += 1;
    phrase.lastVerifiedAt = new Date().toISOString();
    for (const term of vocabularyFromParams(params)) addVocabulary(memory, term);
    memory.phrases = memory.phrases.slice(-500);
    memory.vocabulary = memory.vocabulary
        .sort((a, b) => (b.uses || 0) - (a.uses || 0))
        .slice(0, 300);
    write(memory);
    return true;
}

function recordCorrection(from, to) {
    const source = usefulTerm(from);
    const target = usefulTerm(to);
    if (!source || !target) return false;
    const memory = read();
    addVocabulary(memory, target, source, 'explicit-correction');
    write(memory);
    return true;
}

function resolveVerifiedPhrase(text) {
    const key = normalize(text);
    if (!key) return null;
    const matches = read().phrases
        .filter(entry => entry.normalized === key && entry.verifiedRuns > 0 && SAFE_REPLAY_ACTIONS.has(entry.actionId))
        .sort((a, b) => Date.parse(b.lastVerifiedAt || 0) - Date.parse(a.lastVerifiedAt || 0));
    if (!matches.length) return null;
    return { id: matches[0].actionId, params: structuredClone(matches[0].params), learned: true };
}

function refreshLexicon(memory = read()) {
    const ranked = [...CORE_VOCABULARY];
    for (const item of memory.vocabulary
        .slice()
        .sort((a, b) => (b.uses || 0) - (a.uses || 0))) {
        ranked.push(item.canonical, ...(item.variants || []));
    }
    const seen = new Set();
    const terms = ranked.filter(term => {
        const key = normalize(term);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 180);
    atomicWrite(LEXICON_PATH, { version: 1, updatedAt: new Date().toISOString(), terms });
    return terms;
}

function snapshot() {
    const memory = read();
    return {
        vocabulary: memory.vocabulary.slice().sort((a, b) => (b.uses || 0) - (a.uses || 0)),
        phrases: memory.phrases.slice().reverse(),
        lexicon: refreshLexicon(memory)
    };
}

refreshLexicon();

module.exports = {
    recordVerifiedExecution, recordCorrection, resolveVerifiedPhrase,
    refreshLexicon, snapshot, normalize
};
