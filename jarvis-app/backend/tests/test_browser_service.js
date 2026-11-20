/**
 * TEST SUITE: Autonomous Browser Service (Playwright + Chrome)
 * Verifica que Jarvis pueda navegar, interactuar, leer contenido
 * y cerrar sesiones web autónomas mediante Playwright y Chrome.
 */

const assert = require('assert');
const browserService = require('../services/browser/browserService');
const jarvisActionService = require('../services/jarvisActionService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Autonomous Browser Service (Playwright + Chrome)');
    console.log('===============================================================\n');

    try {
        // 1. Detección de binario nativo de Chrome
        console.log('--- TEST 1: Detección de Ejecutable de Chrome ---');
        const execPath = browserService.executablePath;
        console.log(`Ejecutable detectado: ${execPath}`);
        assert.ok(execPath, 'Debe detectar la ruta de Chrome o Edge en Windows');
        console.log('✅ TEST 1 PASSED: Ejecutable de navegador verificado.\n');

        // 2. Apertura de página y extracción de título (openPage)
        console.log('--- TEST 2: openPage() y carga de contenido ---');
        const openRes = await browserService.openPage('https://example.com');
        console.log(`Página cargada: "${openRes.title}" (${openRes.url})`);
        assert.strictEqual(openRes.ok, true);
        assert.ok(openRes.title.includes('Example Domain'), 'El título debe coincidir con Example Domain');
        console.log('✅ TEST 2 PASSED: openPage ejecutado con éxito.\n');

        // 3. Extracción de texto semántico (getText)
        console.log('--- TEST 3: getText() ---');
        const h1Text = await browserService.getText('h1');
        console.log(`Texto extraído del h1: "${h1Text.text}"`);
        assert.strictEqual(h1Text.ok, true);
        assert.strictEqual(h1Text.text, 'Example Domain');

        const bodyText = await browserService.getText('body');
        assert.ok(bodyText.text.includes('documentation examples') || bodyText.text.includes('Example Domain'), 'Debe contener el cuerpo de la página');
        console.log(`Texto del cuerpo extraído correctamente (${bodyText.length} caracteres).`);
        console.log('✅ TEST 3 PASSED: getText operativo.\n');

        // 4. Búsqueda de elementos (findElement)
        console.log('--- TEST 4: findElement() ---');
        const linkElem = await browserService.findElement('a');
        console.log(`Elemento enlace encontrado: count=${linkElem.count}, visible=${linkElem.visible}`);
        assert.strictEqual(linkElem.ok, true);
        assert.strictEqual(linkElem.visible, true);

        const missingElem = await browserService.findElement('.clase-totalmente-inexistente-1234');
        assert.strictEqual(missingElem.ok, false);
        assert.strictEqual(missingElem.count, 0);
        console.log('✅ TEST 4 PASSED: findElement validado.\n');

        // 5. Scroll en la página (scroll)
        console.log('--- TEST 5: scroll() ---');
        const scrollRes = await browserService.scroll('down', 300);
        assert.strictEqual(scrollRes.ok, true);
        console.log('Desplazamiento completado exitosamente.');
        console.log('✅ TEST 5 PASSED: scroll operativo.\n');

        // 7. Verificación de Download Manager e Historial (Sección 8-9)
        console.log('--- TEST 7: Gestor de Descargas e Historial ---');
        const history = browserService.getDownloadHistory();
        assert.ok(Array.isArray(history), 'Debe retornar un array de historial de descargas');
        console.log(`Historial de descargas activo: ${history.length} elementos`);
        console.log('✅ TEST 7 PASSED: Gestor de descargas operativo.\n');

    } finally {
        // 8. Cierre limpio de sesión de navegador
        console.log('--- TEST 8: close() ---');
        const closeRes = await browserService.close();
        assert.strictEqual(closeRes.ok, true);
        assert.strictEqual(closeRes.closed, true);
        console.log('Sesión de navegador cerrada limpiamente.');
        console.log('✅ TEST 8 PASSED: Limpieza y cierre verificado.\n');
    }

    console.log('===============================================================');
    console.log('🎉 TODOS LOS TESTS DE BROWSER SERVICE PASARON EXITOSAMENTE (100%)');
    console.log('===============================================================\n');
}

runTests().catch(err => {
    console.error('\n❌ ERROR EN SUITE DE BROWSER SERVICE:', err);
    process.exit(1);
});
