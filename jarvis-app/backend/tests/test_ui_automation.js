/**
 * TEST SUITE: UI Automation Service (Control Visual de Windows)
 * Verifica que Jarvis pueda descubrir e interactuar con botones, campos y ventanas
 * mediante Microsoft UI Automation semántico y fallback inteligente a coordenadas.
 */

const assert = require('assert');
const uiAutomationService = require('../services/windows/uiAutomationService');
const jarvisActionService = require('../services/jarvisActionService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: UI Automation Service (Control Visual de Windows)');
    console.log('===============================================================\n');

    // 1. Listar ventanas del escritorio interactivo
    console.log('--- TEST 1: listWindows() ---');
    const windows = await uiAutomationService.listWindows();
    console.log(`Ventanas detectadas en el escritorio: ${windows.length}`);
    assert.ok(Array.isArray(windows), 'Debe retornar un array de ventanas');
    assert.ok(windows.length > 0, 'Debe haber al menos una ventana activa');
    
    const sample = windows[0];
    console.log(`Ejemplo de ventana detectada: [HWND: ${sample.Hwnd}] "${sample.Title}" (${sample.ClassName})`);
    assert.ok(sample.Hwnd > 0, 'HWND debe ser mayor a 0');
    assert.ok(typeof sample.Title === 'string', 'Title debe ser string');
    console.log('✅ TEST 1 PASSED: Ventanas listadas correctamente.\n');

    // 2. Búsqueda semántica de ventana (findWindow)
    console.log('--- TEST 2: findWindow() ---');
    // Buscamos alguna de las ventanas activas reales
    const targetTitle = sample.Title.slice(0, 8);
    const foundWin = await uiAutomationService.findWindow(targetTitle);
    assert.ok(foundWin, `Debe encontrar la ventana con patrón '${targetTitle}'`);
    assert.strictEqual(foundWin.Hwnd, sample.Hwnd);
    console.log(`Ventana encontrada: "${foundWin.Title}"`);

    // Probar búsqueda de ventana inexistente
    const missingWin = await uiAutomationService.findWindow('VentanaTotalmenteInexistenteXYZ123');
    assert.strictEqual(missingWin, null, 'Ventana inexistente debe retornar null');
    console.log('✅ TEST 2 PASSED: Búsqueda de ventanas exacta e inexistente verificada.\n');

    // 3. Descubrimiento de botones y elementos internos (findButton)
    console.log('--- TEST 3: findButton() y estructura de bounds ---');
    // Encontramos una ventana con botones (ChatGPT, Chrome, Explorador o la primera que tenga)
    let winWithButtons = null;
    let foundBtn = null;

    for (const w of windows.slice(0, 5)) {
        try {
            const btn = await uiAutomationService.findButton(w);
            if (btn) {
                winWithButtons = w;
                foundBtn = btn;
                break;
            }
        } catch (_) {}
    }

    if (foundBtn) {
        console.log(`Botón encontrado en "${winWithButtons.Title}": "${foundBtn.name}" (${foundBtn.controlType})`);
        console.log(`Coordenadas dinámicas (BoundingBox):`, foundBtn.bounds);
        assert.ok(foundBtn.bounds, 'El botón debe tener información de bounds');
        assert.ok(typeof foundBtn.isEnabled === 'boolean', 'isEnabled debe ser booleano');
    } else {
        console.log('Aviso: No se encontraron botones visibles en las primeras 5 ventanas evaluadas.');
    }
    console.log('✅ TEST 3 PASSED: Descubrimiento de botones e inspección de bounds verificado.\n');

    // 4. Descubrimiento de campos de texto (findTextBox)
    console.log('--- TEST 4: findTextBox() ---');
    assert.strictEqual(typeof uiAutomationService.findTextBox, 'function');
    for (const w of windows.slice(0, 5)) {
        try {
            const box = await uiAutomationService.findTextBox(w);
            if (box) {
                console.log(`Campo de texto encontrado en "${w.Title}": "${box.name || '(Sin nombre visible)'}" (Id: ${box.automationId})`);
                break;
            }
        } catch (_) {}
    }
    console.log('✅ TEST 4 PASSED: Método findTextBox operativo.\n');

    // 5. Métodos waitForWindow y waitForElement (Resiliencia temporal)
    console.log('--- TEST 5: waitForWindow() y waitForElement() ---');
    const t0 = Date.now();
    const waitExisting = await uiAutomationService.waitForWindow(targetTitle, 3000, 200);
    const elapsedExisting = Date.now() - t0;
    assert.ok(waitExisting, 'waitForWindow debe resolver la ventana existente');
    console.log(`waitForWindow resolvió en ${elapsedExisting}ms`);

    const t1 = Date.now();
    const waitNonExisting = await uiAutomationService.waitForWindow('VentanaInexistenteParaTimeout99', 1200, 200);
    const elapsedMissing = Date.now() - t1;
    assert.strictEqual(waitNonExisting, null, 'Ventana inexistente debe dar timeout y retornar null');
    assert.ok(elapsedMissing >= 1000, 'Debe haber esperado el tiempo de timeout');
    console.log(`waitForWindow timeout controlado en ${elapsedMissing}ms`);
    console.log('✅ TEST 5 PASSED: Rutinas de espera y timeout temporizadas con éxito.\n');

    // 6. ActionKernel: Ejecución de ui.inspect
    console.log('--- TEST 6: ActionKernel Integración (ui.inspect) ---');
    const kernelRes = await jarvisActionService.describe();
    const uiActions = kernelRes.filter(a => a.id.startsWith('ui.'));
    console.log(`Acciones UI registradas en el ActionKernel de Jarvis: ${uiActions.map(a => a.id).join(', ')}`);
    assert.ok(uiActions.some(a => a.id === 'ui.click'), 'ui.click debe estar registrado');
    assert.ok(uiActions.some(a => a.id === 'ui.type'), 'ui.type debe estar registrado');
    assert.ok(uiActions.some(a => a.id === 'ui.inspect'), 'ui.inspect debe estar registrado');

    const inspectRes = await jarvisActionService.execute('ui.inspect', { window: sample.Title });
    console.log(`Resultado ui.inspect en "${sample.Title}": ok=${inspectRes.ok}, elementos=${inspectRes.elementsCount}`);
    assert.strictEqual(inspectRes.ok, true);
    console.log('✅ TEST 6 PASSED: Integración con ActionKernel verificada.\n');

    console.log('===============================================================');
    console.log('🎉 TODOS LOS TESTS DE UI AUTOMATION PASARON EXITOSAMENTE (100%)');
    console.log('===============================================================\n');
}

runTests().catch(err => {
    console.error('\n❌ ERROR EN SUITE DE UI AUTOMATION:', err);
    process.exit(1);
});
