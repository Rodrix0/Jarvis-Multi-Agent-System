/**
 * test_confidence_engine.js
 * 
 * Suite de pruebas unitarias para el Ítem 37:
 * Control de Confianza (Confidence Scoring & Adaptive Execution: >0.8, 0.5-0.8, <0.5).
 */

const assert = require('assert');
const { confidenceEngine } = require('../services/intelligence/confidenceEngine');
const structuredLogger = require('../services/diagnostics/structuredLoggerService');

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
    console.log('🎯 INICIANDO SUITE DE PRUEBAS: ÍTEM 37 - CONTROL DE CONFIANZA');
    console.log('===============================================================\n');

    // Test 1: Comando con Alta Confianza (> 0.8) -> EXECUTE
    test('Score > 0.8 resulta en decisión EXECUTE (ejecución limpia sin fricción)', () => {
        const candidate = {
            name: 'Poner música en Spotify',
            triggers: ['pone musica en spotify', 'reproduce musica'],
            requiredParams: ['query'],
            params: { query: 'Imagine Dragons' },
            historyFrequency: 8
        };

        const res = confidenceEngine.evaluate(candidate, 'pone musica en spotify', { confidence: 0.95 });

        assert.ok(res.score > 0.8, `Score (${res.score}) debe ser > 0.8`);
        assert.strictEqual(res.decision, 'EXECUTE');
        assert.strictEqual(res.askContext, false);
        assert.strictEqual(res.requiresClarification, false);
        assert.strictEqual(res.clarifyPrompt, null);
    });

    // Test 2: Comando con Confianza Media (0.5 a 0.8) -> EXECUTE_WITH_CONTEXT
    test('Score 0.5 - 0.8 resulta en decisión EXECUTE_WITH_CONTEXT (ejecutar pidiendo contexto)', () => {
        const candidate = {
            name: 'Subir volumen',
            triggers: ['subi el volumen', 'aumenta volumen'],
            requiredParams: ['level'], // Falta parámetro específico
            params: {}, // No especifica nivel
            historyFrequency: 3
        };

        const res = confidenceEngine.evaluate(candidate, 'subi volumen', { confidence: 0.70 });

        assert.ok(res.score >= 0.5 && res.score <= 0.8, `Score (${res.score}) debe estar entre 0.5 y 0.8`);
        assert.strictEqual(res.decision, 'EXECUTE_WITH_CONTEXT');
        assert.strictEqual(res.askContext, true);
        assert.strictEqual(res.requiresClarification, false);
        assert.ok(res.contextPrompt.includes('detalles o confirmar el contexto'));
    });

    // Test 3: Comando con Baja Confianza (< 0.5) -> CLARIFY con prompt "¿Querías decir X?"
    test('Score < 0.5 resulta en decisión CLARIFY preguntando "¿Querías decir X?"', () => {
        const candidate = {
            name: 'Abrir Spotify',
            triggers: ['abrir spotify'],
            requiredParams: [],
            historyFrequency: 0
        };

        // Frase con baja coincidencia léxica y baja confianza acústica
        const res = confidenceEngine.evaluate(candidate, 'abrigar botijo', { confidence: 0.30 });

        assert.ok(res.score < 0.5, `Score (${res.score}) debe ser < 0.5`);
        assert.strictEqual(res.decision, 'CLARIFY');
        assert.strictEqual(res.askContext, false);
        assert.strictEqual(res.requiresClarification, true);
        assert.ok(res.clarifyPrompt.includes('¿Querías decir "Abrir Spotify"?'));
    });

    // Test 4: Función stringSimilarity mide precisión léxica Levenshtein
    test('stringSimilarity calcula similitud léxica normalizada entre 0.0 y 1.0', () => {
        assert.strictEqual(confidenceEngine.stringSimilarity('minimiza', 'minimiza'), 1.0);
        assert.strictEqual(confidenceEngine.stringSimilarity('minimisa', 'minimiza'), 0.88);
        assert.ok(confidenceEngine.stringSimilarity('youtube', 'yutub') >= 0.5);
        assert.strictEqual(confidenceEngine.stringSimilarity('hola', 'xyz123'), 0.0);
    });

    // Test 5: Completitud de Parámetros Penaliza Adecuadamente el Score
    test('Parámetros requeridos faltantes reducen el puntaje final', () => {
        const withParams = {
            name: 'Enviar WhatsApp',
            requiredParams: ['contact', 'message'],
            params: { contact: 'Carlos', message: 'Llego en 10' }
        };
        const withoutParams = {
            name: 'Enviar WhatsApp',
            requiredParams: ['contact', 'message'],
            params: {}
        };

        const resWith = confidenceEngine.evaluate(withParams, 'manda un whatsapp', { confidence: 0.8 });
        const resWithout = confidenceEngine.evaluate(withoutParams, 'manda un whatsapp', { confidence: 0.8 });

        assert.ok(resWith.score > resWithout.score, 'El score con parámetros debe superar al incompleto');
        assert.strictEqual(resWithout.factors.parameters, 0.0);
        assert.strictEqual(resWith.factors.parameters, 1.0);
    });

    // Test 6: Baja Confianza Acústica (Whisper con ruido) Arrastra el Score al Nivel de Aclaración
    test('Baja confianza ASR (acústica) fuerza la decisión hacia clarificación de seguridad', () => {
        const candidate = {
            name: 'Apagar la computadora',
            triggers: ['apagar la computadora'],
            requiredParams: []
        };

        // Acústica muy baja (0.15) como en ambientes con mucho ruido
        const res = confidenceEngine.evaluate(candidate, 'apagar la computadora', { confidence: 0.15 });
        assert.ok(res.score < 0.7, 'La mala acústica debe deprimir significativamente el score');
    });

    // Test 7: Historial Frecuente Otorga Bono de Confianza Adaptativo
    test('Familiaridad histórica eleva la puntuación para comandos habituales', () => {
        const frequent = {
            name: 'Dólar Blue',
            triggers: ['dolar blue'],
            historyFrequency: 10
        };
        const infrequent = {
            name: 'Dólar Blue',
            triggers: ['dolar blue'],
            historyFrequency: 0
        };

        const resFreq = confidenceEngine.evaluate(frequent, 'dolar', { confidence: 0.7 });
        const resInfreq = confidenceEngine.evaluate(infrequent, 'dolar', { confidence: 0.7 });

        assert.ok(resFreq.score > resInfreq.score, 'El historial debe incrementar el score de confianza');
    });

    // Test 8: Desglose de Factores Detallados en la Respuesta
    test('El objeto de evaluación retorna el desglose matemático de cada factor', () => {
        const res = confidenceEngine.evaluate({ name: 'Test' }, 'Test', { confidence: 0.9 });
        assert.ok(res.factors, 'Debe incluir factores');
        assert.ok('lexical' in res.factors);
        assert.ok('acoustic' in res.factors);
        assert.ok('parameters' in res.factors);
        assert.ok('history' in res.factors);
    });

    // Test 9: Auditoría en Structured Logs de Evaluaciones de Confianza
    test('Cada evaluación de confianza queda registrada en structured_logs', () => {
        const testPhrase = `conf_audit_${Date.now()}`;
        confidenceEngine.evaluate({ name: 'Audit Action' }, testPhrase, { confidence: 0.88 });

        const logs = structuredLogger.query({ module: 'confidenceEngine', action: 'confidence_evaluated' });
        assert.ok(logs.length > 0, 'Debe existir registro en structured_logs');
        const match = logs.find(l => l.metadata && l.metadata.text === testPhrase);
        assert.ok(match, 'Debe encontrar el registro con el texto auditado');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 37 PASARON EXITOSAMENTE.\n');
        process.exit(0);
    } else {
        console.error(`💥 FALLARON ${totalTests - passedTests} TESTS.\n`);
        process.exit(1);
    }
}

runSuite().catch(e => {
    console.error('Excepción fatal en suite de pruebas:', e);
    process.exit(1);
});
