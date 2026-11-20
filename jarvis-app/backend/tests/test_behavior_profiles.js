/**
 * test_behavior_profiles.js
 * 
 * Suite de pruebas unitarias para el Ítem 45:
 * Sistema de Perfiles de Comportamiento (NORMAL, CODING, GAMING, STUDY, HOME).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { behaviorProfileService } = require('../services/intelligence/behaviorProfileService');
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
    console.log('🎭 INICIANDO SUITE DE PRUEBAS: ÍTEM 45 - PERFILES DE COMPORTAMIENTO');
    console.log('===============================================================');

    // Asegurar volver a NORMAL al inicio
    behaviorProfileService.switchProfile('NORMAL');

    // Test 1: Los 5 perfiles incorporados están presentes con configuraciones específicas
    test('listProfiles contiene los 5 perfiles base con sus modelos y configuraciones', () => {
        const profiles = behaviorProfileService.listProfiles();
        const ids = profiles.map(p => p.id);
        assert.ok(ids.includes('NORMAL'));
        assert.ok(ids.includes('CODING'));
        assert.ok(ids.includes('GAMING'));
        assert.ok(ids.includes('STUDY'));
        assert.ok(ids.includes('HOME'));
    });

    // Test 2: Perfil NORMAL por defecto
    test('getActiveProfile retorna perfil NORMAL con parámetros balanceados', () => {
        const profile = behaviorProfileService.getActiveProfile();
        assert.strictEqual(profile.id, 'NORMAL');
        assert.strictEqual(profile.verbosity, 'BALANCED');
        assert.strictEqual(profile.proactiveAggressiveness, 'MEDIUM');
        assert.strictEqual(profile.allowProactiveSuggestions, true);
    });

    // Test 3: Conmutación a CODING
    test('switchProfile a CODING configura modelo técnico, baja temperatura y herramientas dev', () => {
        const res = behaviorProfileService.switchProfile('CODING');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.activeProfile, 'CODING');

        const profile = behaviorProfileService.getActiveProfile();
        assert.strictEqual(profile.id, 'CODING');
        assert.strictEqual(profile.verbosity, 'DETAILED');
        assert.strictEqual(profile.temperature, 0.15);
        assert.ok(profile.allowedCategories.includes('code'));
        assert.ok(profile.allowedCategories.includes('git'));
    });

    // Test 4: Conmutación a GAMING y verbosidad telegráfica
    test('switchProfile a GAMING activa modo telegráfico y desactiva sugerencias proactivas', () => {
        const res = behaviorProfileService.switchProfile('GAMING');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.activeProfile, 'GAMING');

        const profile = behaviorProfileService.getActiveProfile();
        assert.strictEqual(profile.verbosity, 'TELEGRAPHIC');
        assert.strictEqual(profile.proactiveAggressiveness, 'OFF');
        assert.strictEqual(profile.allowProactiveSuggestions, false);
    });

    // Test 5: formatResponseForProfile en modo GAMING reduce a respuesta telegráfica
    test('formatResponseForProfile en GAMING acorta respuestas largas a un formato telegráfico', () => {
        behaviorProfileService.switchProfile('GAMING');
        const longResponse = 'He procedido a ajustar el volumen de los altavoces principales al treinta por ciento como me solicitaste.';
        const formatted = behaviorProfileService.formatResponseForProfile(longResponse);
        const wordCount = formatted.split(/\s+/).length;
        assert.ok(wordCount <= 8);
    });

    // Test 6: Conmutación a STUDY (modo académico y didáctico)
    test('switchProfile a STUDY activa modo didáctico y modelo de razonamiento', () => {
        const res = behaviorProfileService.switchProfile('STUDY');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.activeProfile, 'STUDY');

        const profile = behaviorProfileService.getActiveProfile();
        assert.strictEqual(profile.verbosity, 'DIDACTIC');
        assert.ok(profile.allowedCategories.includes('document'));
    });

    // Test 7: Conmutación a HOME (domótica y tono cálido)
    test('switchProfile a HOME activa perfil doméstico y amigable', () => {
        const res = behaviorProfileService.switchProfile('HOME');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.activeProfile, 'HOME');

        const profile = behaviorProfileService.getActiveProfile();
        assert.strictEqual(profile.verbosity, 'FRIENDLY');
        assert.strictEqual(profile.temperature, 0.7);
        assert.ok(profile.allowedCategories.includes('homeassistant'));
    });

    // Test 8: Restricción de herramientas por perfil en isActionAllowed
    test('isActionAllowed bloquea herramientas de desarrollo en perfil GAMING', () => {
        behaviorProfileService.switchProfile('GAMING');
        const checkDev = behaviorProfileService.isActionAllowed('code.autonomous_fix');
        assert.strictEqual(checkDev.allowed, false);

        const checkGit = behaviorProfileService.isActionAllowed('git.safe_commit');
        assert.strictEqual(checkGit.allowed, false);

        // Pero audio o volumen sí deben estar permitidos
        const checkAudio = behaviorProfileService.isActionAllowed('volume.set');
        assert.strictEqual(checkAudio.allowed, true);
    });

    // Test 9: ActionKernel intercepta y bloquea ejecución restringida por perfil
    await testAsync('ActionKernel bloquea ejecución de acción prohibida en el perfil activo', async () => {
        behaviorProfileService.switchProfile('GAMING');
        const execRes = await actionKernel.execute('code.autonomous_fix', {
            instruction: 'reparar script'
        });

        assert.strictEqual(execRes.ok, false);
        assert.strictEqual(execRes.status, 'profile_restricted');
        assert.ok(execRes.message.includes('restringida en el perfil GAMING'));

        // Al cambiar a CODING, la restricción debe levantarse
        behaviorProfileService.switchProfile('CODING');
        const checkAllowedInCoding = behaviorProfileService.isActionAllowed('code.autonomous_fix');
        assert.strictEqual(checkAllowedInCoding.allowed, true);
    });

    // Test 10: Guardar y persistir perfil personalizado
    test('saveCustomProfile guarda un perfil personalizado y lo incluye en el catálogo', () => {
        const custom = behaviorProfileService.saveCustomProfile('STREAMING', {
            name: 'Streaming en Vivo',
            verbosity: 'CONCISE',
            proactiveAggressiveness: 'LOW',
            temperature: 0.3
        });

        assert.strictEqual(custom.id, 'STREAMING');
        const retrieved = behaviorProfileService.getProfile('STREAMING');
        assert.strictEqual(retrieved.name, 'Streaming en Vivo');
        assert.strictEqual(retrieved.verbosity, 'CONCISE');
    });

    // Test 11: Integración con ActionKernel (profile.switch y profile.current)
    await testAsync('ActionKernel ejecuta profile.switch y profile.current exitosamente', async () => {
        const switchRes = await actionKernel.execute('profile.switch', { profileId: 'NORMAL' });
        assert.strictEqual(switchRes.ok, true);
        assert.strictEqual(switchRes.data.activeProfile, 'NORMAL');

        const currentRes = await actionKernel.execute('profile.current', {});
        assert.strictEqual(currentRes.ok, true);
        assert.strictEqual(currentRes.data.id, 'NORMAL');
    });

    // Restaurar a NORMAL al finalizar
    behaviorProfileService.switchProfile('NORMAL');

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 45 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_behavior_profiles:', err);
    process.exit(1);
});
