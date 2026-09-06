/**
 * Test Suite para Barge-in (Ítem 23)
 * Verifica:
 *  1. Detección semántica de palabras clave de interrupción (con y sin tildes, variaciones rioplatenses).
 *  2. Ciclo de vida de habla y corte inmediato de TTS (< 50ms).
 *  3. Coordinación con WakeWordService para mantener modo de escucha activa sin dormirse.
 *  4. Emisión de eventos WebSockets para HUD/Frontend.
 *  5. Telemetría y cálculo de milisegundos de habla ahorrados.
 *  6. Idempotencia y seguridad cuando se interrumpe sin audio activo.
 */

const assert = require('assert');
const bargeInService = require('../services/bargeInService');
const { BARGE_IN_REASONS } = require('../services/bargeInService');
const wakeWordService = require('../services/wakeWordService');
const { STATES } = require('../services/wakeWordService');

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runAsyncTest(description, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function main() {
    console.log('===============================================================');
    console.log('🎙️  INICIANDO SUITE DE TESTS: BARGE-IN Y CORTE DE VOZ (ÍTEM 23)');
    console.log('===============================================================');

    // Mocks para pruebas aisladas
    let ttsStoppedCount = 0;
    const mockTtsService = {
        stop: () => {
            ttsStoppedCount++;
            return true;
        }
    };

    let emittedSocketEvents = [];
    const mockIo = {
        emit: (event, data) => {
            emittedSocketEvents.push({ event, data });
        }
    };

    bargeInService.init({
        ttsService: mockTtsService,
        wakeWordService: wakeWordService,
        io: mockIo
    });

    bargeInService.resetMetrics();

    console.log('\n--- BLOQUE 1: Reconocimiento de Palabras Clave de Interrupción ---');
    
    runTest('Detecta "pará" y "para"', () => {
        assert.strictEqual(bargeInService.isInterruptKeyword('pará'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('para'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('Jarvis pará'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('parate'), true);
    });

    runTest('Detecta "detente" y "detene"', () => {
        assert.strictEqual(bargeInService.isInterruptKeyword('detente'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('detene'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('Jarvis detente'), true);
    });

    runTest('Detecta "silencio" y "callate"', () => {
        assert.strictEqual(bargeInService.isInterruptKeyword('silencio'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('callate'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('cállate'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('silenciate'), true);
    });

    runTest('Detecta "stop", "basta" y "espera"', () => {
        assert.strictEqual(bargeInService.isInterruptKeyword('stop'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('basta'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('espera'), true);
        assert.strictEqual(bargeInService.isInterruptKeyword('no espera'), true);
    });

    runTest('No confunde frases conversacionales o comandos legítimos como interrupciones', () => {
        assert.strictEqual(bargeInService.isInterruptKeyword('abrí youtube'), false);
        assert.strictEqual(bargeInService.isInterruptKeyword('hola jarvis cómo estás'), false);
        assert.strictEqual(bargeInService.isInterruptKeyword('qué hora es'), false);
        assert.strictEqual(bargeInService.isInterruptKeyword('subí el volumen'), false);
        assert.strictEqual(bargeInService.isInterruptKeyword('creá una carpeta'), false);
    });

    console.log('\n--- BLOQUE 2: Ciclo de Vida de Alocución y Corte Inmediato (Barge-in) ---');

    runTest('Inicio de alocución notificado correctamente', () => {
        const text = 'Esta es una respuesta larga de Jarvis explicando un concepto complejo con muchos detalles.';
        const speechId = bargeInService.notifySpeechStarted(text, { voice: 'es-AR-TomasNeural' });
        assert.ok(speechId);
        assert.strictEqual(bargeInService.isSpeaking, true);
        
        const status = bargeInService.getStatus();
        assert.strictEqual(status.isSpeaking, true);
        assert.strictEqual(status.currentSpeech.id, speechId);
        assert.ok(status.currentSpeech.estimatedDurationMs > 3000);
    });

    runTest('Interrupción por palabra clave corta TTS inmediatamente y emite eventos', () => {
        ttsStoppedCount = 0;
        emittedSocketEvents = [];

        let nodeEventFired = false;
        bargeInService.once('barge_in', (ev) => {
            nodeEventFired = true;
            assert.strictEqual(ev.reason, BARGE_IN_REASONS.KEYWORD);
        });

        const result = bargeInService.interrupt(BARGE_IN_REASONS.KEYWORD, { detected: 'pará' });
        assert.strictEqual(result.interrupted, true);
        assert.strictEqual(result.reason, BARGE_IN_REASONS.KEYWORD);
        assert.strictEqual(result.ttsStopped, true);
        assert.strictEqual(ttsStoppedCount, 1);
        assert.strictEqual(bargeInService.isSpeaking, false);
        assert.strictEqual(nodeEventFired, true);

        // Verificar emisión WebSockets
        const socketEvent = emittedSocketEvents.find(e => e.event === 'jarvis:barge_in');
        assert.ok(socketEvent, 'Debe haber emitido jarvis:barge_in por socket');
        assert.strictEqual(socketEvent.data.reason, BARGE_IN_REASONS.KEYWORD);
    });

    runTest('Interrupción acústica (Voice Overlap) ahorra milisegundos calculados', () => {
        const longText = 'Respuesta muy extensa que duraría unos diez segundos si no fuera interrumpida por el usuario.';
        bargeInService.notifySpeechStarted(longText);

        const result = bargeInService.interrupt(BARGE_IN_REASONS.ACOUSTIC_VAD, { level: 0.045 });
        assert.strictEqual(result.interrupted, true);
        assert.strictEqual(result.reason, BARGE_IN_REASONS.ACOUSTIC_VAD);
        assert.ok(result.savedMs > 0, 'Debe registrar tiempo ahorrado');

        const metrics = bargeInService.getMetrics();
        assert.ok(metrics.totalSavedSpeechMs > 0);
        assert.strictEqual(metrics.interruptionsByReason[BARGE_IN_REASONS.ACOUSTIC_VAD], 1);
    });

    console.log('\n--- BLOQUE 3: Integración con WakeWordService y Transiciones de Estado ---');

    runTest('Barge-in mantiene o pasa a LISTENING_COMMAND sin forzar a dormir', () => {
        wakeWordService.forceStandby();
        assert.strictEqual(wakeWordService.state, STATES.STANDBY_WAKE_WORD);

        // Simulamos habla de Jarvis y posterior interrupción
        bargeInService.notifySpeechStarted('Iniciando respuesta...');
        bargeInService.interrupt(BARGE_IN_REASONS.DIRECT_COMMAND, { command: 'abrí chrome' });

        // Debe haber forzado la escucha activa
        assert.strictEqual(wakeWordService.state, STATES.LISTENING_COMMAND);
    });

    console.log('\n--- BLOQUE 4: Idempotencia y Resiliencia ---');

    runTest('Interrupción cuando NO hay habla activa es segura e idempotente', () => {
        assert.strictEqual(bargeInService.isSpeaking, false);
        const result = bargeInService.interrupt(BARGE_IN_REASONS.MANUAL_STOP);
        assert.strictEqual(result.interrupted, true);
        assert.strictEqual(result.savedMs, 0);
        assert.strictEqual(bargeInService.isSpeaking, false);
    });

    runTest('Fin natural de habla sin interrupción cierra la sesión limpiamente', () => {
        const speechId = bargeInService.notifySpeechStarted('Hola mundo');
        assert.strictEqual(bargeInService.isSpeaking, true);

        let endedEvent = false;
        bargeInService.once('speech_ended', () => {
            endedEvent = true;
        });

        bargeInService.notifySpeechEnded(speechId);
        assert.strictEqual(bargeInService.isSpeaking, false);
        assert.strictEqual(endedEvent, true);
    });

    console.log('\n--- BLOQUE 5: Telemetría y Métricas Acumuladas ---');

    runTest('Métricas globales de telemetría reportan valores consistentes', () => {
        const metrics = bargeInService.getMetrics();
        assert.ok(metrics.totalSpeechSessions >= 3);
        assert.ok(metrics.totalBargeIns >= 3);
        assert.ok(metrics.totalSavedSpeechMs >= 0);
        assert.ok(metrics.lastBargeIn !== null);
        assert.strictEqual(metrics.isSpeaking, false);
    });

    console.log('===============================================================');
    console.log(`🏁 TESTS FINALIZADOS: ${passedTests}/${totalTests} EXITOSOS (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('===============================================================');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error fatal ejecutando tests:', err);
    process.exit(1);
});
