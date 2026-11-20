const assert = require('node:assert/strict');

async function run() {
    console.log('===============================================================');
    console.log('👁️  INICIANDO SUITE DE TESTS: VISIÓN DE PANTALLA Y CÓDIGO (PASO 3)');
    console.log('===============================================================');

    const fastCommandParser = require('../services/ai/fastCommandParser');
    const actions = require('../services/jarvisActionService');
    const visionService = require('../services/vision/visionService');

    // 1. Parsing determinista de consultas de visión y web
    console.log('\n--- TEST 1: Enrutamiento de lenguaje natural para Visión y Web ---');
    const p1 = fastCommandParser.parse('JARVIS, ¿qué te parece mi página web?');
    assert.equal(p1.match, true);
    assert.equal(p1.action, 'vision.analyze-screen');
    console.log('  ✅ [PASS] "JARVIS, ¿qué te parece mi página web?" -> vision.analyze-screen');

    const p2 = fastCommandParser.parse('JARVIS, ¿podés detectar el error en esta parte?');
    assert.equal(p2.match, true);
    assert.equal(p2.action, 'vision.analyze-screen');
    console.log('  ✅ [PASS] "JARVIS, ¿podés detectar el error en esta parte?" -> vision.analyze-screen');

    const p3 = fastCommandParser.parse('opiná sobre mi página web');
    assert.equal(p3.match, true);
    assert.equal(p3.action, 'vision.analyze-screen');
    console.log('  ✅ [PASS] "opiná sobre mi página web" -> vision.analyze-screen');

    const p4 = fastCommandParser.parse('fijate qué error tengo en la pantalla');
    assert.equal(p4.match, true);
    assert.equal(p4.action, 'vision.analyze-screen');
    console.log('  ✅ [PASS] "fijate qué error tengo en la pantalla" -> vision.analyze-screen');

    // 2. Resolución en ActionKernel
    console.log('\n--- TEST 2: Resolución integral en ActionKernel ---');
    const r1 = await actions.resolve('JARVIS, ¿qué te parece mi página web?');
    assert.equal(r1.id, 'vision.analyze-screen');
    assert.match(r1.params.query, /página web/i);
    console.log('  ✅ [PASS] ActionKernel resuelve id "vision.analyze-screen" para feedback web');

    const r2 = await actions.resolve('JARVIS, ¿podés detectar el error en esta parte?');
    assert.equal(r2.id, 'vision.analyze-screen');
    assert.match(r2.params.query, /error/i);
    console.log('  ✅ [PASS] ActionKernel resuelve id "vision.analyze-screen" para diagnóstico de error');

    // 3. Simulación de análisis heurístico y de UX
    console.log('\n--- TEST 3: Generación de feedback de UI/UX ---');
    const mockContext = {
        ok: true,
        imagePath: 'mock_screen.png',
        activeWindow: 'Google Chrome - Mi Proyecto Web',
        detectedErrors: [],
        lines: ['Inicio', 'Servicios', 'Sobre Nosotros', 'Contacto', 'Bienvenidos a la plataforma', 'Comenzar ahora'],
        visibleText: 'Inicio Servicios Sobre Nosotros Contacto Bienvenidos a la plataforma Comenzar ahora'
    };

    // Sobreescribir temporalmente inspectScreen para testing sin disparar screenshot físico
    const originalInspect = visionService.inspectScreen;
    visionService.inspectScreen = async () => mockContext;

    try {
        const webAnalysis = await visionService.analyzeScreen('¿Qué te parece mi página web?');
        assert.equal(webAnalysis.ok, true);
        assert.ok(webAnalysis.reply.length > 50);
        console.log('  ✅ [PASS] Feedback de UI/UX generado con éxito:');
        console.log('     ', webAnalysis.reply.slice(0, 120).replace(/\n/g, ' ') + '...');

        console.log('\n--- TEST 4: Generación de diagnóstico de error y propuesta de arreglo ---');
        mockContext.detectedErrors = ['TypeError: Cannot read properties of undefined (reading "title")', 'at renderCard (app.js:42:15)'];
        const errAnalysis = await visionService.analyzeScreen('¿Podés detectar el error en esta parte?');
        assert.equal(errAnalysis.ok, true);
        assert.match(errAnalysis.reply, /TypeError|error/i);
        console.log('  ✅ [PASS] Diagnóstico de error generado con propuesta de corrección de código');
    } finally {
        visionService.inspectScreen = originalInspect;
    }

    console.log('\n===============================================================');
    console.log('🏁 SUITE DE VISIÓN Y CÓDIGO FINALIZADA CON ÉXITO: 4/4 PRUEBAS (100%)');
    console.log('===============================================================\n');
}

run().catch(err => {
    console.error('FAIL en suite de visión:', err);
    process.exit(1);
});
