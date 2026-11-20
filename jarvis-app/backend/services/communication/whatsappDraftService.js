function isExactDictation(utterance) {
    return /(?:que diga|con el texto|con el mensaje)\s*["“'][^"”']+["”']/i.test(String(utterance || ''));
}

function isIndirect(utterance, message) {
    if (isExactDictation(utterance)) return false;
    return /\b(?:que le diga|decile que|avisale que|contale que|diciendole que|diciendo que)\b/i.test(String(utterance || ''))
        || /\b(?:decile|avisale|contale)\b[\s\S]{1,100}\bque\b/i.test(String(utterance || ''))
        || /^que\s+(?:yo|estoy|voy|llego|tenemos|tengo|puedo|podemos|necesito|hoy|mañana|manana)\b/i.test(String(message || '').trim());
}

function polish(message) {
    const clean = String(message || '').trim()
        .replace(/^que\s+(?=(?:yo|estoy|voy|llego|tenemos|tengo|puedo|podemos|necesito|hoy|mañana|manana)\b)/i, '')
        .trim();
    return clean ? clean[0].toUpperCase() + clean.slice(1) : '';
}

async function prepare(params = {}, context = {}) {
    const utterance = context.originalUtterance || context.userText || '';
    const original = String(params.message || '').trim();
    if (!isIndirect(utterance, original)) return { ...params, message: original, reviewRequired: false };
    let draft = polish(original);
    // Una frase ya formulada en primera persona no necesita cargar el modelo.
    if (/^(?:que\s+)?(?:yo|estoy|voy|llego|tenemos|tengo|puedo|podemos|necesito)\b/i.test(original)
        || /^(?:hoy|mañana|manana)\s+(?:voy|llego|tengo|puedo|necesito)\b/i.test(original)) {
        return { ...params, message: draft, reviewRequired: true };
    }
    try {
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(4000),
            body: JSON.stringify({
                model: process.env.OLLAMA_VOICE_MODEL || 'qwen2.5:3b', stream: false, format: 'json',
                keep_alive: process.env.OLLAMA_VOICE_KEEP_ALIVE || '90s',
                options: { temperature: 0.1, num_predict: 120 },
                prompt: `Reescribí el mensaje indirecto como un WhatsApp natural enviado por la persona que habla. Conservá exactamente los hechos, nombres, fechas, negaciones y tono. No inventes información ni agregues saludos. Devolvé sólo JSON con la clave "message".\nDestinatario: ${String(params.contact || '').slice(0, 100)}\nMensaje dictado: ${original.slice(0, 1000)}`
            })
        });
        if (response.ok) {
            const parsed = JSON.parse((await response.json()).response || '{}');
            const candidate = String(parsed.message || '').trim();
            if (candidate && candidate.length <= Math.max(500, original.length * 2)) draft = candidate;
        }
    } catch (_) {
        // Sin modelo disponible conservamos un borrador legible y pedimos aprobación.
    }
    return { ...params, message: draft, reviewRequired: true };
}

module.exports = { prepare, isIndirect, polish };
