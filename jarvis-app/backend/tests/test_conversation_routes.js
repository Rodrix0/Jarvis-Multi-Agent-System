const assert = require('node:assert/strict');
const { isPureConversation } = require('../services/ai/conversationIntent');

async function run() {
    for (const phrase of [
        '¿Estás listo para trabajar?',
        '¿Qué opinás de usar mi 4070 para este trabajo?',
        'Contame cómo funciona una red neuronal'
    ]) assert.equal(isPureConversation(phrase), true, phrase);
    for (const phrase of [
        'Abrí WhatsApp',
        '¿Podés buscar el clima actual?',
        '¿Qué opinás de abrir Netflix?'
    ]) assert.equal(isPureConversation(phrase), false, phrase);

    const tv = require('../services/tvVoiceService');
    const actions = require('../services/jarvisActionService');
    tv.activateSession();
    assert.equal((await actions.resolve('¿Estás listo para trabajar?')).id, 'assistant.respond');
    assert.equal(tv.isSessionActive(), false, 'una charla nueva sale del contexto de TV');

    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }) };
        if (String(url).endsWith('/api/chat')) return { ok: true, json: async () => ({ message: { role: 'assistant', content: 'Sí, estoy listo. ¿Por dónde empezamos?' } }) };
        throw new Error(`Red no esperada: ${url}`);
    };
    try {
        const ai = require('../services/aiService');
        const answer = await ai.getAIResponse('¿Qué opinás de usar mi 4070 para este trabajo?', null, null, null, { structuredActions: true });
        assert.match(answer, /estoy listo/);
        const chatCall = calls.find(call => call.url.endsWith('/api/chat'));
        assert.ok(chatCall, 'consulta al modelo local');
        const payload = JSON.parse(chatCall.options.body);
        assert.equal(payload.tools, undefined, 'la charla no puede disparar herramientas');
    } finally {
        globalThis.fetch = originalFetch;
    }
    console.log('PASS: charla local sin herramientas, cambio de tema fuera de TV y 4070 sin acción forzada.');
}

run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
