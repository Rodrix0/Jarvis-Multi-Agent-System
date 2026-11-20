const assert = require('assert');
const fastCommandParser = require('../services/ai/fastCommandParser');
const systemService = require('../services/systemService');
const jarvisActionService = require('../services/jarvisActionService');

console.log('=== TEST 1: FastCommandParser - Variaciones de Minimizar / Maximizar ===');
const windowTests = [
    { text: 'minimisa', expected: 'window.minimize' },
    { text: 'mini misa', expected: 'window.minimize' },
    { text: 'minimizame', expected: 'window.minimize' },
    { text: 'achica', expected: 'window.minimize' },
    { text: 'achicame la ventana', expected: 'window.minimize' },
    { text: 'oculta la ventana', expected: 'window.minimize' },
    { text: 'minimisa todo', expected: 'window.minimize-all' },
    { text: 'maximisa', expected: 'window.maximize' },
    { text: 'maxi misa', expected: 'window.maximize' },
    { text: 'maximizame', expected: 'window.maximize' },
    { text: 'agranda la ventana', expected: 'window.maximize' },
    { text: 'pantalla completa', expected: 'window.maximize' }
];

for (const t of windowTests) {
    const res = fastCommandParser.parse(t.text);
    console.log(`[Window Parser] "${t.text}" -> ${res.action}`);
    assert.strictEqual(res.match, true, `Fallo en match para "${t.text}"`);
    assert.strictEqual(res.action, t.expected, `Acción esperada ${t.expected}, obtenida: ${res.action}`);
}

console.log('\n=== TEST 2: FastCommandParser - Envío Directo de WhatsApp ===');
const waTests = [
    {
        text: 'un mensaje a color cartón que diga te amo',
        expectedContact: 'color cartón',
        expectedMessage: 'te amo'
    },
    {
        text: 'mandale un mensaje a color cartón que diga te amo',
        expectedContact: 'color cartón',
        expectedMessage: 'te amo'
    },
    {
        text: "enviá un mensaje al contacto 'color cartón' que diga 'te amo'",
        expectedContact: 'color cartón',
        expectedMessage: 'te amo'
    },
    {
        text: "WhatsApp, entrá en el historial de pedidos y enviá un mensaje al contacto 'color cartón' que diga 'te amo'",
        expectedContact: 'color cartón',
        expectedMessage: 'te amo'
    },
    {
        text: "gale un mensaje a color cartón que diga un mensaja color carton que digas te amo",
        expectedContact: 'color cartón',
        expectedMessage: 'te amo'
    },
    {
        text: 'enviá un mensaje a mamá que diga llego en 10',
        expectedContact: 'mamá',
        expectedMessage: 'llego en 10'
    },
    {
        text: 'mandale un whatsapp a juan diciendo hola amigo como andas',
        expectedContact: 'juan',
        expectedMessage: 'hola amigo como andas'
    }
];

for (const t of waTests) {
    const res = fastCommandParser.parse(t.text);
    console.log(`[WhatsApp Parser] "${t.text}" -> action: ${res.action} | contact: "${res.params?.contact}" | message: "${res.params?.message}"`);
    assert.strictEqual(res.match, true, `Fallo en match para "${t.text}"`);
    assert.strictEqual(res.action, 'whatsapp.send', `Acción debe ser whatsapp.send para "${t.text}"`);
    assert.strictEqual(res.params.contact.toLowerCase(), t.expectedContact.toLowerCase(), `Contacto incorrecto para "${t.text}"`);
    assert.strictEqual(res.params.message.toLowerCase(), t.expectedMessage.toLowerCase(), `Mensaje incorrecto para "${t.text}"`);
}

console.log('\n=== TEST 3: Prevenir Falsos Positivos de Apertura de YouTube en SystemService ===');
const falsePositivePhrases = [
    'mini misa yutubime el volumen sugi yutube minimisa',
    'yutubime el volumen sugi yutube la carpeta',
    'un mensaje a color cartón que diga te amo'
];

for (const phrase of falsePositivePhrases) {
    const sysRes = systemService.handleSystemCommand(phrase);
    console.log(`[False Positive Check] "${phrase}" -> isSystemCommand: ${sysRes.isSystemCommand} (appName: ${sysRes.appName})`);
    assert.strictEqual(sysRes.isSystemCommand, false, `No debe interpretarse como comando de sistema: "${phrase}"`);
}

// Verificamos que abrir YouTube explícitamente siga funcionando
const validYouTube = systemService.handleSystemCommand('abrí youtube');
assert.strictEqual(validYouTube.isSystemCommand, true);
assert.strictEqual(validYouTube.appName.toLowerCase(), 'youtube');
console.log('[Valid Open Check] "abrí youtube" ->', validYouTube);

console.log('\n=== TEST 4: JarvisActionService Full Intent Resolution ===');
async function runActionTests() {
    const r1 = await jarvisActionService.resolve('mini misa');
    assert.strictEqual(r1.id, 'window.minimize');
    console.log('[ActionService Resolve] "mini misa" ->', r1.id);

    const r2 = await jarvisActionService.resolve('un mensaje a color cartón que diga te amo');
    assert.strictEqual(r2.id, 'whatsapp.send');
    assert.strictEqual(r2.params.contact.toLowerCase(), 'color cartón');
    assert.strictEqual(r2.params.message.toLowerCase(), 'te amo');
    console.log('[ActionService Resolve] "un mensaje a color cartón que diga te amo" ->', r2.id, r2.params);

    const r3 = await jarvisActionService.resolve('mandale un mensaje a color cartón que diga te amo');
    assert.strictEqual(r3.id, 'whatsapp.send');
    console.log('[ActionService Resolve] "mandale un mensaje a color cartón que diga te amo" ->', r3.id, r3.params);

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY 100%!');
}

runActionTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
