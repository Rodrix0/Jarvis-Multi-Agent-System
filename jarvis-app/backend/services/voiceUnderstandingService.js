const recentConversation = [];
const LOCAL_MODEL = process.env.OLLAMA_VOICE_MODEL || 'qwen2.5:3b';
const MAX_CONTEXT_ITEMS = 6;

const CRITICAL_TERMS = [
    'prend', 'encend', 'apag', 'abr', 'busc', 'reproduc', 'pon', 'mov',
    'derecha', 'izquierda', 'arriba', 'abajo', 'borr', 'elimin', 'envi',
    'compr', 'public', 'descarg', 'cancel'
];

function normalized(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function addsUnsupportedCriticalAction(originalCandidates, corrected) {
    const evidence = normalized(originalCandidates.join(' '));
    const result = normalized(corrected);
    return CRITICAL_TERMS.some(term => result.includes(term) && !evidence.includes(term));
}

function remember(text) {
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return;
    recentConversation.push(clean);
    if (recentConversation.length > MAX_CONTEXT_ITEMS) recentConversation.shift();
}

async function understand(payload = {}) {
    const original = String(payload.text || '').trim();
    const candidates = [original, ...(payload.alternatives || [])]
        .map(item => typeof item === 'string' ? item : item?.transcript)
        .filter(Boolean)
        .map(item => String(item).trim())
        .filter((item, index, all) => item && all.indexOf(item) === index)
        .slice(0, 4);
    const localUnderstandingEnabled = payload.allowLocal === true;
    const confidence = Number(payload.confidence) || 0;
    const contextualReference = /\b(eso|esa|ese|anterior|lo mismo|segui|seguí|continua|continuá)\b/i.test(original);
    const alternativesDisagree = candidates.length > 1
        && normalized(candidates[0]) !== normalized(candidates[1]);
    // Si la frase ya contiene una orden clara del sistema, app, multimedia o carpeta,
    // nunca la enviamos a un LLM secundario para evitar latencia innecesaria.
    const hasClearAction = /\b(?:whatsapp|whatsapps|watsap|wasap|guasap|youtube|yutub|netflix|spotify|discord|chrome|recordame|avisame|agendame|carpeta|directorio|volumen|brillo|bater[ií]a|abrí|abre|abrir|crear)\b/i.test(original);
    const needsRepair = !hasClearAction && (contextualReference || confidence < 0.35 || alternativesDisagree);
    if (!original || !localUnderstandingEnabled || !needsRepair) {
        remember(original);
        return {
            text: original,
            refined: false,
            provider: payload.provider || 'local-whisper',
            contextualUnderstandingDisabled: !localUnderstandingEnabled
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const context = recentConversation.length ? recentConversation.join('\n- ') : '(sin contexto previo)';
    const tvContext = payload.tvContext || {};
    const prompt = [
        'Reconstruí la frase que realmente dijo el usuario a partir de hipótesis de reconocimiento de voz.',
        'El usuario habla español rioplatense. Puede pedir cualquier tema o acción: no lo limites a un catálogo.',
        'No respondas la consulta y no la conviertas en una orden distinta. Solo devolvé la transcripción corregida.',
        'Conservá todos los verbos, negaciones, nombres, destinos y cantidades. Si no hay evidencia suficiente, usá la primera hipótesis.',
        `Hipótesis actuales: ${JSON.stringify(candidates)}`,
        `Contexto reciente:\n- ${context}`,
        `Estado de TV/Netflix: ${JSON.stringify(tvContext)}`
    ].join('\n');

    try {
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LOCAL_MODEL,
                prompt,
                stream: false,
                format: 'json',
                keep_alive: '5m',
                options: { temperature: 0.1, num_predict: 80 }
            }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const data = await response.json();
        const raw = data.response || '';
        const corrected = String(JSON.parse(raw).text || '').trim().slice(0, 700);
        if (!corrected || addsUnsupportedCriticalAction(candidates, corrected)) {
            remember(original);
            return { text: original, refined: false, provider: 'browser', guarded: true };
        }
        remember(corrected);
        return { text: corrected, refined: normalized(corrected) !== normalized(original), provider: 'ollama-local' };
    } catch (error) {
        console.warn('[Voz] Comprensión general no disponible:', error.message);
        remember(original);
        return { text: original, refined: false, provider: payload.provider || 'local-whisper', error: error.message };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { understand };
