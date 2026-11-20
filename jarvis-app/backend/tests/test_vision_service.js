const assert = require('assert');
const path = require('path');
const fastCommandParser = require('../services/ai/fastCommandParser');
const jarvisActionService = require('../services/jarvisActionService');
const visionService = require('../services/vision/visionService');

async function runTests() {
    console.log('=== TEST 1: Vision Commands Parsing ===');
    const visionQueries = [
        'fijate qué error salió',
        'fijate que error hay',
        'qué error salió',
        'mirá la pantalla',
        'qué dice la pantalla',
        'analiza la pantalla',
        'revisa la pantalla',
        'qué dice la captura',
        'leeme la captura',
        'qué hay en la captura',
        'qué captura sacaste',
        'analiza la captura'
    ];

    for (const q of visionQueries) {
        const parsed = fastCommandParser.parse(q);
        console.log(`[Parser] "${q}" -> ${parsed.action}`);
        assert.strictEqual(parsed.match, true, `Debe reconocer: "${q}"`);
        assert.strictEqual(parsed.action, 'vision.analyze-screen');
    }

    console.log('\n=== TEST 2: JarvisActionService Plan Resolution ===');
    const plan = await jarvisActionService.resolve('Jarvis, fijate qué error salió');
    console.log('Resolved plan ID:', plan.id);
    assert.strictEqual(plan.id, 'vision.analyze-screen');

    console.log('\n=== TEST 3: Windows Native OCR & Error Detection ===');
    const sampleImagePath = path.join(__dirname, '..', 'data', 'unity_error_sample.png');
    const screenInspect = await visionService.inspectScreen(sampleImagePath);

    console.log('Inspect Result:');
    console.log('- Active Window:', screenInspect.activeWindow);
    console.log('- Line Count:', screenInspect.lines.length);
    console.log('- Detected Errors:', screenInspect.detectedErrors);

    assert.ok(screenInspect.lines.length > 0, 'Debe extraer al menos una línea');
    assert.ok(screenInspect.detectedErrors.length > 0, 'Debe detectar al menos una línea de error');

    console.log('\n=== TEST 4: Vision Analysis with Local LLM / Heuristics ===');
    const t0 = performance.now();
    const analysis = await visionService.analyzeScreen('Fijate qué error salió y cómo se soluciona', sampleImagePath);
    const tElapsed = performance.now() - t0;
    console.log(`Analysis took ${tElapsed.toFixed(0)}ms:`);
    console.log('JARVIS DIAGNOSIS:\n', analysis.reply);

    assert.strictEqual(analysis.ok, true);
    assert.ok(analysis.reply && analysis.reply.length > 20, 'Debe entregar un diagnóstico sustancial');

    console.log('\n🎉 ALL VISION SUBSYSTEM TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('❌ Error en test de visión:', err);
    process.exit(1);
});
