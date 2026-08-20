const recentConversation = [];
const MODEL = 'gemini-2.5-flash-lite';
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
    const cloudUnderstandingEnabled = String(process.env.VOICE_CONTEXT_AI_ENABLED || '').toLowerCase() === 'true';
    if (!original || !process.env.GEMINI_API_KEY || !cloudUnderstandingEnabled) {
        remember(original);
        return {
            text: original,
            refined: false,
            provider: 'browser',
            contextualUnderstandingDisabled: !cloudUnderstandingEnabled
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
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
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 160,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: { text: { type: 'STRING' } },
                        required: ['text']
                    }
                }
            }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        const corrected = String(JSON.parse(raw).text || '').trim().slice(0, 700);
        if (!corrected || addsUnsupportedCriticalAction(candidates, corrected)) {
            remember(original);
            return { text: original, refined: false, provider: 'browser', guarded: true };
        }
        remember(corrected);
        return { text: corrected, refined: normalized(corrected) !== normalized(original), provider: 'gemini' };
    } catch (error) {
        console.warn('[Voz] Comprensión general no disponible:', error.message);
        remember(original);
        return { text: original, refined: false, provider: 'browser', error: error.message };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { understand };
