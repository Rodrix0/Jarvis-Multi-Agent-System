const fs = require('fs');
const path = require('path');
const memoryService = require('./memoryService');
const voiceSettingsService = require('./voiceSettingsService');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'voice_history.jsonl');
const MAX_HISTORY_BYTES = 1024 * 1024;

function normalizeVoiceTranscript(text) {
    const [collapsed] = collapseRepeatedTranscript(String(text || ''));
    let basic = collapsed
        .trim()
        .replace(/\b(?:yarvis|jarbis|charvis|harvis)\b/gi, 'Jarvis')
        .replace(/\b(?:edrey|edrei|yervis)\b/gi, 'Jarvis')
        .replace(/\b(?:un\s+)?(?:tequi\s*te|tequiste|tequi|te\s+que\s+te|tequis|tx\s*t|t\s+x\s+t)\b/gi, 'txt')
        .replace(/\b(crear|creame|crea|hacer|haceme|hace|generar|genera)\s+(?:un\s+)?tequila\b/gi, '$1 un txt')
        .replace(/\s+/g, ' ');
    return memoryService.applyCorrections(repairApplicationCommand(basic));
}

function collapseRepeatedTranscript(text) {
    const tokens = String(text || '').match(/[\p{L}\p{N}]+/gu) || [];
    if (tokens.length < 3) return [String(text || '').trim(), false];
    const comparable = tokens.map(normalizedForMatching);
    const output = [];
    let changed = false;
    for (let index = 0; index < tokens.length;) {
        let bestSize = 0;
        let bestRepeats = 1;
        const maximum = Math.min(14, Math.floor((tokens.length - index) / 2));
        for (let size = 1; size <= maximum; size++) {
            const block = comparable.slice(index, index + size).join(' ');
            let repeats = 1;
            let cursor = index + size;
            while (comparable.slice(cursor, cursor + size).join(' ') === block) {
                repeats++;
                cursor += size;
            }
            if (repeats >= 2 && size * repeats > bestSize * bestRepeats) {
                bestSize = size;
                bestRepeats = repeats;
            }
        }
        if (bestRepeats >= 2) {
            output.push(...tokens.slice(index, index + bestSize));
            index += bestSize * bestRepeats;
            changed = true;
        } else {
            output.push(tokens[index++]);
        }
    }
    if (output.length >= 3 && /^(abri|abre|abrir)$/.test(normalizedForMatching(output[0]))
        && normalizedForMatching(output.at(-1)) === normalizedForMatching(output[0])) {
        output.pop();
        changed = true;
    }
    return [output.join(' ').trim(), changed];
}

function normalizedForMatching(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function repairApplicationCommand(text) {
    const normalized = normalizedForMatching(text);
    const match = normalized.match(/^(?:jarvis\s+)?(?:abri|abrir|abre|abrin|apli|averi|avery|a veri)\s+(.+)$/);
    if (!match) return text;
    const heardApp = match[1].trim();
    // Vocabulario fonético de destinos, no de órdenes: Whisper puede traducir
    // marcas extranjeras aunque el verbo se haya entendido correctamente.
    const aliases = [
        { app: 'WhatsApp', values: ['whatsapp', 'what s up', 'watsap', 'wasap', 'guasap'] },
        { app: 'Discord', values: ['discord', 'discor', 'niscor', 'niscord', 'g score', 'giscore', 'de ese'] },
        { app: 'Netflix', values: ['netflix', 'netfli', 'net free'] },
        { app: 'YouTube', values: ['youtube', 'you tube', 'yutub'] },
        { app: 'Spotify', values: ['spotify', 'spotifai'] },
        { app: 'Chrome', values: ['chrome', 'crom'] }
    ];
    const destination = aliases.find(item => item.values.includes(heardApp));
    return destination ? `Abrí ${destination.app}` : text;
}

function words(text) {
    return normalizeVoiceTranscript(text).toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/).filter(Boolean);
}

function similarity(a, b) {
    const left = new Set(words(a));
    const right = new Set(words(b));
    if (!left.size && !right.size) return 1;
    const common = [...left].filter(item => right.has(item)).length;
    return common / Math.max(left.size, right.size, 1);
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
    const settings = voiceSettingsService.get();
    const normalizedAlternatives = alternatives.slice(0, 5).map(item => normalizeVoiceTranscript(item.transcript));
    const confidence = Number(selected.confidence) || 0;
    const comparable = normalizedAlternatives.slice(1);
    const agreement = comparable.length
        ? comparable.reduce((sum, item) => sum + similarity(normalizedAlternatives[0], item), 0) / comparable.length
        : 1;
    // Chrome a veces informa confianza 0 aunque la frase sea válida. En ese caso
    // usamos el acuerdo entre hipótesis; nunca buscamos palabras de un catálogo.
    const threshold = payload.source === 'local-whisper'
        ? settings.localConfidenceThreshold
        : settings.confidenceThreshold;
    const safeKnownCommand = /^(?:jarvis\s+)?abri\s+(whatsapp|spotify|discord|youtube|netflix|chrome)$/
        .test(normalizedForMatching(normalizedAlternatives[0]));
    const lowConfidence = confidence > 0 && confidence < threshold
        && !(safeKnownCommand && confidence >= 0.48);
    const lowAgreement = comparable.length > 0 && agreement < settings.agreementThreshold;
    const audioLevel = Number(payload.audioLevel) || 0;
    const tooFar = audioLevel > 0 && audioLevel < settings.noiseFloor * settings.proximityMultiplier;
    return {
        text: normalizeVoiceTranscript(selected.transcript),
        confidence,
        agreement,
        audioLevel,
        uncertain: settings.confirmUncertain && (lowConfidence || lowAgreement || tooFar),
        uncertaintyReason: tooFar ? 'voz demasiado baja o lejana' : lowAgreement ? 'las hipótesis no coinciden' : lowConfidence ? 'confianza baja' : '',
        alternatives: normalizedAlternatives
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

module.exports = { chooseTranscript, normalizeVoiceTranscript, recordTranscript, repairApplicationCommand, collapseRepeatedTranscript };
