/**
 * test_action_explanation.js
 * 
 * Suite de pruebas unitarias para el Ítem 49:
 * Explicación de Acciones y Trazabilidad de Decisiones Operacionales.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const explanationService = require('../services/core/explanationService');
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
    console.log('🧪 INICIANDO SUITE DE PRUEBAS: EXPLICACIÓN DE ACCIONES (ÍTEM 49)');
    console.log('===============================================================');

    // 1. Registro explícito de una decisión y validación de esquema
    test('Registro explícito de decisión operacional con trazabilidad', () => {
        const rec = explanationService.recordDecision({
            actionId: 'system.volume',
            params: { level: 20 },
            intent: 'adjust_volume',
            triggerType: 'USER_COMMAND',
            triggerSummary: 'Comando verbal para bajar volumen',
            reason: 'El usuario pidió bajar el volumen para atender una llamada.',
            userExplanation: 'Ajusté el volumen al 20% porque me pediste bajarlo.',
            confidence: 0.95
        });

        assert.ok(rec.id && rec.id.startsWith('dec_'), 'Debe generar un ID único dec_');
        assert.strictEqual(rec.actionId, 'system.volume');
        assert.strictEqual(rec.confidence, 0.95);
        assert.ok(rec.formattedTime, 'Debe incluir hora formateada HH:mm');
        assert.strictEqual(rec.userExplanation, 'Ajusté el volumen al 20% porque me pediste bajarlo.');
    });

    // 2. Deducción contextual automática para Spotify (fin de estudio + perfil HOME)
    test('Deducción contextual automática: Spotify tras finalizar estudio', () => {
        const synth = explanationService.synthesizeReason('spotify.play', {}, {
            previousProfile: 'STUDY',
            finishedStudying: true,
            profile: 'HOME'
        });

        assert.strictEqual(synth.intent, 'play_relaxing_music');
        assert.strictEqual(synth.triggerType, 'CONTEXT_TRIGGER');
        assert.strictEqual(synth.userExplanation, 'Detecté que terminaste de estudiar y tu perfil decía que escuchás música.');
    });

    // 3. Deducción contextual automática para Limpieza de Archivos (>30 días en temporales)
    test('Deducción contextual automática: Limpieza de descargas temporales >30 días', () => {
        const synth = explanationService.synthesizeReason('file.delete', {
            filePath: 'C:/Users/Rodrigo/Downloads/temp_installer.tmp',
            ageDays: 35
        });

        assert.strictEqual(synth.intent, 'cleanup_stale_files');
        assert.strictEqual(synth.triggerType, 'AUTOMATION_RULE');
        assert.strictEqual(synth.userExplanation, 'Porque estaba en la carpeta de descargas temporales y tenía más de 30 días.');
    });

    // 4. Pregunta natural: "¿Por qué abriste Spotify?"
    await testAsync('Consulta en lenguaje natural: "¿Por qué abriste Spotify?"', async () => {
        explanationService.recordDecision({
            actionId: 'spotify.play',
            params: {},
            context: { previousProfile: 'STUDY', profile: 'HOME' }
        });

        const resp = await explanationService.explainDecision('¿Por qué abriste Spotify?');
        assert.ok(resp.includes('Detecté que terminaste de estudiar y tu perfil decía que escuchás música.'),
            'Debe responder con la explicación contextual exacta de Spotify');
    });

    // 5. Pregunta natural: "¿Por qué borraste ese archivo?"
    await testAsync('Consulta en lenguaje natural: "¿Por qué borraste ese archivo?"', async () => {
        explanationService.recordDecision({
            actionId: 'file.delete',
            params: { filePath: 'C:/temp/archive.tmp', ageDays: 45 }
        });

        const resp = await explanationService.explainDecision('¿Por qué borraste ese archivo?');
        assert.ok(resp.includes('Porque estaba en la carpeta de descargas temporales y tenía más de 30 días.'),
            'Debe responder con la regla de 30 días');
    });

    // 6. Consulta de la última decisión: "Explicame tu última decisión"
    await testAsync('Consulta de la última decisión: "Explicame tu última decisión"', async () => {
        explanationService.recordDecision({
            actionId: 'profile.switch',
            params: { profileId: 'CODING' },
            userExplanation: 'Cambié el perfil a CODING porque abriste Visual Studio Code.'
        });

        const resp = await explanationService.explainDecision('Explicame tu última decisión');
        assert.strictEqual(resp, 'Cambié el perfil a CODING porque abriste Visual Studio Code.');
    });

    // 7. Compatibilidad con explicaciones de seguridad L0-L4
    await testAsync('Compatibilidad con explicaciones de seguridad L0-L4', async () => {
        const respConf = await explanationService.explainDecision('¿Por qué me pediste confirmación?');
        assert.ok(respConf.includes('Nivel L2/L3'), 'Debe explicar política de seguridad L2/L3');

        const respPower = await explanationService.explainDecision('¿Por qué no apagaste la computadora?');
        assert.ok(respPower.includes('token de confirmación explícito'), 'Debe explicar requerimiento de token');
    });

    // 8. Integración completa con ActionKernel: auto-hook y herramientas explain
    await testAsync('Integración con ActionKernel: auto-hook y herramientas explain.*', async () => {
        const beforeCount = explanationService.memoryBuffer.length;

        // Ejecutar una acción a través de ActionKernel
        await actionKernel.execute('profile.switch', { profileId: 'STUDY' });

        const afterCount = explanationService.memoryBuffer.length;
        assert.strictEqual(afterCount, beforeCount + 1, 'ActionKernel execute debe registrar la decisión en el hook');

        // Consultar a través de la herramienta ActionKernel explain.last_decision
        const toolRes = await actionKernel.execute('explain.last_decision');
        assert.strictEqual(toolRes.status, 'completed');
        assert.ok(toolRes.data && toolRes.data.actionId === 'profile.switch');

        // Consultar a través de explain.query
        const queryRes = await actionKernel.execute('explain.query', { query: '¿Por qué abriste Spotify?' });
        assert.strictEqual(queryRes.status, 'completed');
        assert.ok(queryRes.message.includes('Spotify') || queryRes.message.includes('estudiar'));
    });

    console.log('===============================================================');
    console.log(`🏁 RESULTADOS SUITE EXPLICACIÓN DE ACCIONES: ${passedTests} / ${totalTests} PASS`);
    console.log('===============================================================');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Error fatal ejecutando suite:', err);
    process.exit(1);
});
