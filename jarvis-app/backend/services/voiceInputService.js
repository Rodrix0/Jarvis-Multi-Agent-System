const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'voice_history.jsonl');
const MAX_HISTORY_BYTES = 1024 * 1024;

function normalizeVoiceTranscript(text) {
    return String(text || '')
        .trim()
        .replace(/\b(?:yarvis|jarbis|charvis|harvis)\b/gi, 'Jarvis')
        .replace(/\b(?:edrey|edrei|yervis)\b/gi, 'Jarvis')
        .replace(/\b(?:net\s*flix|net\s*fix|neflix|netflics)\b/gi, 'Netflix')
        .replace(/\b(?:jaikyu|haikyu+|haiku|high\s+cube|high\s+school|hay\s+que)\b/gi, 'Haikyu')
        .replace(/\b(?:pon|poneis|ponéis|pones)\b/gi, 'pone')
        .replace(/\b(?:de|the)\s+walking\s+dead\b/gi, 'The Walking Dead')
        .replace(/\b(?:doro\s*hedoro|doro\s+de\s+oro|lodo\s+hero)\b/gi, 'Dorohedoro')
        .replace(/\bel\s+mental\s+ista\b/gi, 'El Mentalista')
        .replace(/\s+/g, ' ');
}

function chooseTranscript(payload = {}) {
    const alternatives = Array.isArray(payload.alternatives)
        ? payload.alternatives.filter(item => item && String(item.transcript || '').trim())
        : [];
    if (!alternatives.length && payload.text) {
        alternatives.push({ transcript: payload.text, confidence: payload.confidence });
    }
    if (!alternatives.length) return { text: '', confidence: 0, alternatives: [] };

    // Chrome ya ordena las alternativas por probabilidad. Para comandos físicos
    // conservamos siempre la primera; reordenarlas por palabras clave puede elegir
    // una frase menos probable y convertir ruido en una orden distinta.
    const selected = alternatives[0];
    return {
        text: normalizeVoiceTranscript(selected.transcript),
        confidence: Number(selected.confidence) || 0,
        alternatives: alternatives.slice(0, 5).map(item => normalizeVoiceTranscript(item.transcript))
    };
}

function recordTranscript(entry) {
    try {
        fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
        if (fs.existsSync(HISTORY_PATH) && fs.statSync(HISTORY_PATH).size > MAX_HISTORY_BYTES) {
            const lines = fs.readFileSync(HISTORY_PATH, 'utf8').trim().split(/\r?\n/).slice(-300);
            fs.writeFileSync(HISTORY_PATH, `${lines.join('\n')}\n`);
        }
        fs.appendFileSync(HISTORY_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    } catch (error) {
        console.error('[Voz] No pude registrar la transcripción:', error.message);
    }
}

module.exports = { chooseTranscript, normalizeVoiceTranscript, recordTranscript };
