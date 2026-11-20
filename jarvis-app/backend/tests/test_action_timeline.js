/**
 * test_action_timeline.js
 * 
 * Suite de pruebas unitarias para el Ítem 48:
 * Historial de Acciones y Timeline Operacional Persistente.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { actionTimelineService } = require('../services/core/actionTimelineService');
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
    console.log('⏳ INICIANDO SUITE DE PRUEBAS: ÍTEM 48 - ACTION TIMELINE');
    console.log('===============================================================');

    // Test 1: Registro estructurado en la línea temporal con inferencia de descripción
    test('recordAction almacena eventos con timestamps formateados y descripciones amigables', () => {
        const ev1 = actionTimelineService.recordAction({
            actionId: 'spotify.play',
            params: { query: 'Daft Punk' }
        });
        assert.ok(ev1.id.startsWith('tl_'));
        assert.ok(/^\d{2}:\d{2}$/.test(ev1.formattedTime));
        assert.strictEqual(ev1.humanDescription, 'reprodujiste "Daft Punk" en Spotify');

        const ev2 = actionTimelineService.recordAction({
            actionId: 'git.safe_branch',
            params: { taskName: 'fix-player-controller' }
        });
        assert.strictEqual(ev2.humanDescription, 'cambiaste branch a fix-player-controller');

        const ev3 = actionTimelineService.recordAction({
            actionId: 'code.autonomous_fix',
            params: { instruction: 'reparar inventario Unity' }
        });
        assert.strictEqual(ev3.humanDescription, 'corriste build y fix para "reparar inventario Unity"');
    });

    // Test 2: getTimeline filtra por ventana de minutos y genera texto con formato requerido
    test('getTimeline devuelve las acciones recientes en formato "HH:mm - acción"', () => {
        const res = actionTimelineService.getTimeline(20);
        assert.ok(res.totalCount >= 3);
        assert.ok(res.formattedText.includes('reprodujiste "Daft Punk" en Spotify'));
        assert.ok(res.formattedText.includes('cambiaste branch a fix-player-controller'));

        // Formato requerido: 18:41 - abriste Spotify
        const lines = res.formattedText.split('\n');
        assert.ok(lines.some(l => /^\d{2}:\d{2} - /.test(l)));
    });

    // Test 3: queryTimeline interpreta preguntas en lenguaje natural ("¿qué hiciste en los últimos 20 minutos?")
    test('queryTimeline extrae la ventana temporal y redacta respuesta para el usuario', () => {
        const queryRes = actionTimelineService.queryTimeline('¿qué hiciste en los últimos 20 minutos?');
        assert.strictEqual(queryRes.ok, true);
        assert.strictEqual(queryRes.minutes, 20);
        assert.ok(queryRes.actionsCount >= 3);
        assert.ok(queryRes.message.includes('En los últimos 20 minutos realicé las siguientes acciones:'));
        assert.ok(queryRes.formattedTimeline.includes('reprodujiste'));

        // Consulta de 1 hora
        const hourRes = actionTimelineService.queryTimeline('¿qué hiciste en la última hora?');
        assert.strictEqual(hourRes.minutes, 60);
    });

    // Test 4: undoLastAction revierte la última acción reversible y la marca como ROLLED_BACK
    await testAsync('undoLastAction localiza y revierte la última acción reversible', async () => {
        let undoExecuted = false;

        // Registrar acción reversible
        const revAction = actionTimelineService.recordAction({
            actionId: 'file.create',
            params: { fileName: 'temporal_test.txt' },
            description: 'creaste el archivo temporal_test.txt',
            reversible: true,
            undoData: {
                type: 'custom',
                undoFn: async () => { undoExecuted = true; }
            }
        });

        assert.strictEqual(revAction.reversible, true);
        assert.strictEqual(revAction.status, 'SUCCESS');

        const undoRes = await actionTimelineService.undoLastAction();
        assert.strictEqual(undoRes.ok, true);
        assert.strictEqual(undoExecuted, true);
        assert.strictEqual(revAction.status, 'ROLLED_BACK');
        assert.ok(undoRes.message.includes('Deshice el último cambio'));
    });

    // Test 5: ActionKernel registra automáticamente cada ejecución en el Timeline
    await testAsync('ActionKernel registra automáticamente en el Timeline cualquier herramienta ejecutada', async () => {
        const beforeCount = actionTimelineService.memoryBuffer.length;

        // Ejecutar herramienta a través del kernel
        await actionKernel.execute('profile.current', {});

        const afterCount = actionTimelineService.memoryBuffer.length;
        assert.strictEqual(afterCount, beforeCount + 1);

        const lastEvt = actionTimelineService.memoryBuffer[actionTimelineService.memoryBuffer.length - 1];
        assert.strictEqual(lastEvt.actionId, 'profile.current');
    });

    // Test 6: Integración en ActionKernel (timeline.query y timeline.recent)
    await testAsync('ActionKernel ejecuta timeline.query y timeline.recent', async () => {
        const recentRes = await actionKernel.execute('timeline.recent', { minutes: 15 });
        assert.strictEqual(recentRes.ok, true);
        assert.ok(recentRes.data.totalCount > 0);

        const queryRes = await actionKernel.execute('timeline.query', {
            utterance: '¿qué hiciste en los últimos 10 minutos?'
        });
        assert.strictEqual(queryRes.ok, true);
        assert.strictEqual(queryRes.data.minutes, 10);
        assert.ok(queryRes.message.includes('En los últimos 10 minutos'));
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 48 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_action_timeline:', err);
    process.exit(1);
});
