/**
 * test_smart_clipboard.js
 * 
 * Suite de pruebas unitarias para el Ítem 47:
 * Clipboard Inteligente Bajo Demanda con Clasificación Semántica, Escudo de Privacidad y Enrutamiento Deíctico.
 */

const assert = require('assert');
const { smartClipboardService } = require('../services/intelligence/smartClipboardService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function runSuite() {
    console.log('===============================================================');
    console.log('📋 INICIANDO SUITE DE PRUEBAS: ÍTEM 47 - CLIPBOARD INTELIGENTE');
    console.log('===============================================================');

    // Test 1: Lectura y escritura controlada en el portapapeles de Windows
    test('writeClipboard y readClipboard escriben y recuperan contenido en el portapapeles', () => {
        const testPayload = 'JARVIS_CLIPBOARD_VERIFICATION_PAYLOAD_2026';
        const writeOk = smartClipboardService.writeClipboard(testPayload);
        assert.strictEqual(writeOk, true);

        const readBack = smartClipboardService.readClipboard();
        assert.strictEqual(readBack, testPayload);
    });

    // Test 2: Clasificación semántica de tipos de contenido
    test('classifyContent clasifica con precisión CODE, STACKTRACE, URL, JSON y TEXT', () => {
        const codeSample = 'public class InventoryManager { public void AddItem() { return; } }';
        assert.strictEqual(smartClipboardService.classifyContent(codeSample), 'CODE');

        const stacktraceSample = 'NullReferenceException: Object reference not set to an instance\n  at PlayerController.Update () [0x00000] in <00000000>:0';
        assert.strictEqual(smartClipboardService.classifyContent(stacktraceSample), 'STACKTRACE');

        const urlSample = 'https://github.com/Rodrix0/Jarvis-Multi-Agent-System';
        assert.strictEqual(smartClipboardService.classifyContent(urlSample), 'URL');

        const jsonSample = '{"status": "online", "model": "qwen2.5"}';
        assert.strictEqual(smartClipboardService.classifyContent(jsonSample), 'JSON');

        const textSample = 'Recordá comprar pan y leche al volver del trabajo.';
        assert.strictEqual(smartClipboardService.classifyContent(textSample), 'TEXT');
    });

    // Test 3: Escudo de Privacidad (Secret Shield) detecta y ofusca credenciales sensibles
    test('sanitizeSecrets detecta y rediseña tokens y claves sensibles', () => {
        const sensitiveText = 'Mi api key es sk-abcdef12345678901234567890 y la de AWS es AKIAIOSFODNN7EXAMPLE';
        const res = smartClipboardService.sanitizeSecrets(sensitiveText);

        assert.strictEqual(res.isSensitive, true);
        assert.ok(res.foundTypes.includes('OpenAI API Key'));
        assert.ok(res.foundTypes.includes('AWS Access Key'));
        assert.ok(!res.sanitizedText.includes('sk-abcdef'));
        assert.ok(!res.sanitizedText.includes('AKIAIOSFODNN7EXAMPLE'));
        assert.ok(res.sanitizedText.includes('[PROTECTED_SECRET_REDACTED]'));
    });

    // Test 4: Enrutamiento de orden "Arreglame esto" sobre código roto
    await testAsync('processClipboardIntent con "Arreglame esto" repara sintaxis de código', async () => {
        const brokenCode = 'public void BrokenMethod() {\n    int a = 5;\n'; // Llave sin cerrar
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'arreglame esto',
            explicitText: brokenCode,
            autoWriteResult: false
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'FIX');
        assert.strictEqual(res.contentType, 'CODE');
        assert.ok(res.resultText.includes('}')); // Cerró la llave
        assert.ok(res.message.includes('Arreglé el code'));
    });

    // Test 5: Enrutamiento de orden "Mandale esto a mamá"
    await testAsync('processClipboardIntent con "Mandale esto a mamá" extrae contacto y payload', async () => {
        const msg = 'Llego a casa a las 8 para cenar juntos.';
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'mandale esto a mamá por favor',
            explicitText: msg
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'SEND');
        assert.strictEqual(res.targetContact, 'mamá');
        assert.strictEqual(res.payload.recipient, 'mamá');
        assert.strictEqual(res.payload.text, msg);
    });

    // Test 6: Enrutamiento de orden "Explicame esto"
    await testAsync('processClipboardIntent con "Explicame esto" desglosa el contenido copiado', async () => {
        const trace = 'Error: Cannot find module docx at Module._resolveFilename';
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'explicame esto',
            explicitText: trace
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'EXPLAIN');
        assert.strictEqual(res.contentType, 'STACKTRACE');
        assert.ok(res.explanation.includes('Traza de error'));
    });

    // Test 7: Enrutamiento de orden "Traducí esto"
    await testAsync('processClipboardIntent con "Traducí esto a inglés" traduce y copia', async () => {
        const phrase = 'El sistema autónomo opera con cero regresiones.';
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'traducí esto a inglés',
            explicitText: phrase,
            autoWriteResult: false
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'TRANSLATE');
        assert.strictEqual(res.targetLanguage, 'inglés');
        assert.ok(res.resultText.includes('[Traducción a inglés]'));
    });

    // Test 8: Enrutamiento de orden "Guardame esto"
    await testAsync('processClipboardIntent con "Guardame esto" prepara el guardado de datos', async () => {
        const notes = 'Puntos clave de la reunión de arquitectura: microkernel y reactive bus.';
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'guardame esto',
            explicitText: notes
        });

        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'SAVE');
        assert.strictEqual(res.contentToSave, notes);
    });

    // Test 9: Manejo elegante cuando el portapapeles está vacío
    await testAsync('processClipboardIntent reporta mensaje descriptivo si el clipboard está vacío', async () => {
        const res = await smartClipboardService.processClipboardIntent({
            utterance: 'arreglame esto',
            explicitText: '   '
        });

        assert.strictEqual(res.ok, false);
        assert.ok(res.error.includes('portapapeles se encuentra vacío'));
    });

    // Test 10: Integración con ActionKernel (clipboard.process y clipboard.read)
    await testAsync('ActionKernel ejecuta clipboard.process y clipboard.read', async () => {
        smartClipboardService.writeClipboard('Código en el portapapeles: const a = 1;');

        const readRes = await actionKernel.execute('clipboard.read', {});
        assert.strictEqual(readRes.ok, true);
        assert.ok(readRes.data.text.includes('const a = 1;'));

        const processRes = await actionKernel.execute('clipboard.process', {
            utterance: 'explicame esto'
        });
        assert.strictEqual(processRes.ok, true);
        assert.strictEqual(processRes.data.intent, 'EXPLAIN');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 47 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_smart_clipboard:', err);
    process.exit(1);
});
