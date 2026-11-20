/**
 * test_activity_context.js
 * 
 * Suite de pruebas unitarias para el Ítem 46:
 * Contexto de Actividad en Tiempo Real (App activa, archivo en foco, proyecto, monitor, hora y comandos implícitos).
 */

const assert = require('assert');
const { activityContextService } = require('../services/intelligence/activityContextService');
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
    console.log('🎯 INICIANDO SUITE DE PRUEBAS: ÍTEM 46 - CONTEXTO DE ACTIVIDAD');
    console.log('===============================================================');

    // Test 1: Parseo de contexto de ventana Unity (Forest_Main.unity)
    test('parseWindowContext detecta correctamente app Unity, archivo .unity y proyecto', () => {
        const title = 'Unity 2022.3.10f1 - Forest_Main.unity - MySurvivalGame - PC, Mac & Linux Standalone';
        const parsed = activityContextService.parseWindowContext(title, 'Unity.exe');

        assert.strictEqual(parsed.app, 'Unity');
        assert.strictEqual(parsed.file, 'Forest_Main.unity');
        assert.strictEqual(parsed.fileExtension, '.unity');
        assert.strictEqual(parsed.project, 'MySurvivalGame');
        assert.strictEqual(parsed.stack, 'unity_csharp');
    });

    // Test 2: Parseo de contexto en Visual Studio Code
    test('parseWindowContext detecta archivo de código C# y proyecto en VS Code', () => {
        const title = 'PlayerController.cs - MySurvivalGame - Visual Studio Code';
        const parsed = activityContextService.parseWindowContext(title, 'Code.exe');

        assert.strictEqual(parsed.app, 'Visual Studio Code');
        assert.strictEqual(parsed.file, 'PlayerController.cs');
        assert.strictEqual(parsed.fileExtension, '.cs');
        assert.strictEqual(parsed.project, 'MySurvivalGame');
        assert.strictEqual(parsed.stack, 'development');
    });

    // Test 3: Parseo de documento en Word
    test('parseWindowContext detecta documento .docx en Microsoft Word', () => {
        const title = 'Informe_Trimestral.docx - Word';
        const parsed = activityContextService.parseWindowContext(title, 'WINWORD.EXE');

        assert.strictEqual(parsed.app, 'Microsoft Word');
        assert.strictEqual(parsed.file, 'Informe_Trimestral.docx');
        assert.strictEqual(parsed.fileExtension, '.docx');
        assert.strictEqual(parsed.stack, 'documents');
    });

    // Test 4: Parseo de navegador web
    test('parseWindowContext detecta Google Chrome y stack web', () => {
        const title = 'GitHub - Rodrix0/Jarvis - Google Chrome';
        const parsed = activityContextService.parseWindowContext(title, 'chrome.exe');

        assert.strictEqual(parsed.app, 'Google Chrome');
        assert.strictEqual(parsed.stack, 'web');
    });

    // Test 5: Cálculo del contexto temporal y fase del día
    test('getTimeContext calcula hora formateada, fase del día y día de semana', () => {
        const timeCtx = activityContextService.getTimeContext();
        assert.ok(/^\d{2}:\d{2}$/.test(timeCtx.formatted));
        assert.ok(['MADRUGADA', 'MAÑANA', 'TARDE', 'NOCHE'].includes(timeCtx.phase));
        assert.ok(typeof timeCtx.isWeekend === 'boolean');
        assert.ok(timeCtx.dayOfWeek.length > 3);
    });

    // Test 6: Dispositivos cercanos en la red
    await testAsync('getNearbyDevices lista dispositivos detectables en el entorno', async () => {
        const devices = await activityContextService.getNearbyDevices();
        assert.ok(Array.isArray(devices));
        assert.ok(devices.length >= 1);
        assert.ok(devices.some(d => d.type === 'tv' || d.type === 'iot_hub'));
    });

    // Test 7: Obtención del contexto global completo
    await testAsync('getCurrentContext retorna instantánea integral con monitor, app y tiempo', async () => {
        const ctx = await activityContextService.getCurrentContext({
            Title: 'Unity 2022.3.10f1 - Forest_Main.unity - ForestRPG - PC Standalone',
            ProcessName: 'Unity.exe',
            ProcessId: 4420,
            Hwnd: 100234,
            Monitor: { Width: 2560, Height: 1440, IsPrimary: true }
        });

        assert.strictEqual(ctx.app, 'Unity');
        assert.strictEqual(ctx.file, 'Forest_Main.unity');
        assert.strictEqual(ctx.project, 'ForestRPG');
        assert.strictEqual(ctx.monitor.resolution, '2560x1440');
        assert.strictEqual(ctx.monitor.isPrimary, true);
        assert.ok(ctx.time.phase);
    });

    // Test 8: Resolución de comando implícito "Compilalo"
    await testAsync('resolveImplicitCommand resuelve "Compilalo" sobre contexto Unity Forest_Main.unity', async () => {
        const mockContext = {
            app: 'Unity',
            file: 'Forest_Main.unity',
            project: 'ForestRPG',
            stack: 'unity_csharp',
            title: 'Unity - Forest_Main.unity'
        };

        const res = await activityContextService.resolveImplicitCommand('Compilalo', mockContext);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.isImplicit, true);
        assert.strictEqual(res.intent, 'COMPILE');
        assert.strictEqual(res.target.app, 'Unity');
        assert.strictEqual(res.target.file, 'Forest_Main.unity');
        assert.strictEqual(res.target.project, 'ForestRPG');
        assert.ok(res.message.includes('Forest_Main.unity'));
    });

    // Test 9: Resolución de comando implícito "Arreglalo" / "Corregilo"
    await testAsync('resolveImplicitCommand resuelve "Arreglalo" sobre script activo', async () => {
        const mockContext = {
            app: 'Visual Studio Code',
            file: 'InventoryManager.cs',
            project: 'ForestRPG',
            stack: 'development',
            title: 'InventoryManager.cs - ForestRPG'
        };

        const res = await activityContextService.resolveImplicitCommand('Arreglalo por favor', mockContext);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.intent, 'AUTONOMOUS_FIX');
        assert.strictEqual(res.target.file, 'InventoryManager.cs');
    });

    // Test 10: Resolución de comando implícito "Cerralo" y "Guardalo"
    await testAsync('resolveImplicitCommand resuelve "Cerralo" y "Guardalo" sobre la ventana activa', async () => {
        const mockContext = {
            app: 'Microsoft Word',
            file: 'Reporte.docx',
            title: 'Reporte.docx - Word'
        };

        const closeRes = await activityContextService.resolveImplicitCommand('cerralo', mockContext);
        assert.strictEqual(closeRes.ok, true);
        assert.strictEqual(closeRes.intent, 'CLOSE_WINDOW');
        assert.strictEqual(closeRes.target.app, 'Microsoft Word');

        const saveRes = await activityContextService.resolveImplicitCommand('guardalo', mockContext);
        assert.strictEqual(saveRes.ok, true);
        assert.strictEqual(saveRes.intent, 'SAVE_DOCUMENT');
        assert.strictEqual(saveRes.target.file, 'Reporte.docx');
    });

    // Test 11: Integración en ActionKernel (context.current y context.resolve_implicit)
    await testAsync('ActionKernel ejecuta context.current y context.resolve_implicit', async () => {
        const currentAction = await actionKernel.execute('context.current', {});
        assert.strictEqual(currentAction.ok, true);
        assert.ok(currentAction.data.time);
        assert.ok(currentAction.data.monitor);

        const resolveAction = await actionKernel.execute('context.resolve_implicit', {
            utterance: 'compilalo'
        });
        assert.strictEqual(resolveAction.ok, true);
        assert.strictEqual(resolveAction.data.intent, 'COMPILE');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 46 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_activity_context:', err);
    process.exit(1);
});
