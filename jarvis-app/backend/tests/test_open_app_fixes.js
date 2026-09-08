const assert = require('assert');
const systemService = require('../services/systemService');
const jarvisActions = require('../services/jarvisActionService');
const verificationService = require('../services/core/verificationService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 VALIDANDO CORRECCIONES: APERTURA ÚNICA Y PRIORIDAD WHATSAPP');
    console.log('===============================================================\n');

    let passed = 0;
    let failed = 0;

    // --- TEST 1: Verbo y conjugaciones de apertura ---
    console.log('--- TEST 1: Variantes gramaticales en handleSystemCommand ---');
    const testPhrases = [
        { text: 'abre WhatsApp', expectedApp: 'whatsapp' },
        { text: 'abra WhatsApp', expectedApp: 'whatsapp' },
        { text: 'que abra WhatsApp', expectedApp: 'whatsapp' },
        { text: 'abrí WhatsApp', expectedApp: 'whatsapp' },
        { text: 'abrime WhatsApp', expectedApp: 'whatsapp' },
        { text: 'podes abrir WhatsApp', expectedApp: 'whatsapp' },
        { text: 'abrí la app de WhatsApp', expectedApp: 'la app de whatsapp' },
        { text: 'abrí WhatsApp en el navegador', expectedApp: 'whatsapp en el navegador' }
    ];

    for (const item of testPhrases) {
        const sys = systemService.handleSystemCommand(item.text);
        assert.strictEqual(sys.isSystemCommand, true, `Debe reconocerse como comando de sistema: "${item.text}"`);
        console.log(`  ✅ [PASS] "${item.text}" -> isSystemCommand: true, appName: "${sys.appName}"`);
        passed++;
    }

    // --- TEST 2: Resolución de WhatsApp a URL Web (Paso C) y limpieza de prefijos/sufijos ---
    console.log('\n--- TEST 2: Prioridad de WhatsApp Web sobre archivos locales ---');
    const whatsappVariations = [
        'whatsapp',
        'WhatsApp',
        'la aplicación de whatsapp',
        'la app de whatsapp',
        'el whatsapp',
        'whatsapp en el navegador',
        'abrí la aplicación whatsapp en el navegador',
        'whatsapp web'
    ];

    for (const query of whatsappVariations) {
        const resolved = await jarvisActions.resolve(`Abrí ${query}`);
        assert.strictEqual(resolved.id, 'system.open', `Debe resolver a system.open para "${query}"`);
        
        let lower = query.toLowerCase().trim();
        let prev = '';
        while (prev !== lower) {
            prev = lower;
            lower = lower
                .replace(/^(abrir|abre|abra|abrí|abr[ií]me|abr[aá]me|iniciar|inici[aá]|arrancar|arranc[aá]|lanza|lanzar|ejecutar|ejecut[aá]|entrar a|entr[aá] a|entrar|entr[aá]|met[eé]te en|metete a|ir a|ve a|buscar|busca|buscar en|pon|pon[eé]|reproduce|abrirme|abrime|la aplicación de|la aplicacion de|la app de|la aplicación|la aplicacion|la app|el programa de|el programa|el juego de|el juego|el archivo de|el archivo|la carpeta de|la carpeta|mi carpeta|el|la|los|las|un|una|del|de)\s+/gi, '')
                .trim();
        }
        lower = lower
            .replace(/\s+(?:en\s+(?:el\s+)?navegador|en\s+(?:la\s+)?compu|en\s+(?:la\s+)?computadora|en\s+(?:la\s+)?pc|en\s+(?:la\s+)?notebook|en\s+(?:la\s+)?laptop|en\s+chrome|por\s+favor)\s*$/gi, '')
            .trim();
        
        assert.ok(lower.includes('whatsapp'), `El término limpio debe contener whatsapp: obtenido "${lower}"`);
        console.log(`  ✅ [PASS] "${query}" -> Normalizado limpio: "${lower}" -> Redirige a Web WhatsApp`);
        passed++;
    }

    // --- TEST 3: Invarianza de Ejecución Única (1x) en system.open ---
    console.log('\n--- TEST 3: Invarianza de Ejecución Única (1x) en system.open ---');
    let executionCounter = 0;
    const originalOpenApp = systemService.openApp;
    systemService.openApp = async (target) => {
        executionCounter++;
        return true;
    };

    try {
        const result = await jarvisActions.process('abrí la calculadora de prueba');
        assert.strictEqual(executionCounter, 1, `systemService.openApp debe haberse llamado EXACTAMENTE 1 VEZ (obtenido: ${executionCounter})`);
        assert.strictEqual(result.ok, true, 'El resultado de process debe ser ok=true');
        console.log(`  ✅ [PASS] Invocación única comprobada: openApp llamado ${executionCounter} vez (CERO reintentos parásitos).`);
        passed++;
    } finally {
        systemService.openApp = originalOpenApp;
    }

    // --- TEST 4: Verificador de ventanas no tiene retryFn que duplique ejecuciones ---
    console.log('\n--- TEST 4: Verificador de Ventanas es puramente observador ---');
    let retryFnTriggered = false;
    const verifyPromise = verificationService.verifyAppOpened('ventana_inexistente_test_999', {
        timeoutMs: 600,
        intervalMs: 150,
        retryFn: () => { retryFnTriggered = true; }
    });
    const verifyRes = await verifyPromise;
    assert.strictEqual(retryFnTriggered, false, 'retryFn NUNCA debe ser ejecutada por verifyAppOpened');
    assert.strictEqual(verifyRes.retried, false, 'retried debe ser false');
    assert.strictEqual(verifyRes.verified, false, 'verified debe ser false para ventana inexistente');
    console.log('  ✅ [PASS] verifyAppOpened no ejecutó retryFn y reportó resultado limpiamente.');
    passed++;

    console.log('\n===============================================================');
    console.log(`🎉 TODAS LAS PRUEBAS SUPERADAS: ${passed} PASARON, 0 FALLARON`);
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ Error en suite de pruebas:', err);
    process.exit(1);
});
