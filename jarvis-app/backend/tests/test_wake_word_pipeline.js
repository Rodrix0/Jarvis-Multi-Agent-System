/**
 * Test Suite: Ítem 22 - Wake Word y Pipeline de Voz Eficiente (Mic -> Wake Word -> VAD -> Whisper)
 */

const assert = require('assert');
const { WakeWordService, STATES } = require('../services/wakeWordService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 22 - WAKE WORD Y PIPELINE DE VOZ EFICIENTE ===\n');
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    const pipeline = new WakeWordService({ followUpDurationMs: 300 });

    // -------------------------------------------------------------
    // BLOQUE 1: Detección y Normalización de Wake Words
    // -------------------------------------------------------------
    console.log('--- Test 1: Detección y Normalización de Wake Words ---');

    await test('Detecta variaciones fonéticas canónicas de Jarvis', () => {
        const variations = ['jarvis', 'Jarvis', 'YARVIS', 'charvis', 'hey jarvis', 'ok jarvis', 'che jarvis', 'hola jarvis'];
        for (const v of variations) {
            const res = pipeline.detectWakeWord(v);
            assert.ok(res, `Debe detectar "${v}" como wake word`);
            assert.ok(res.matched, `matched debe ser true para "${v}"`);
        }
    });

    await test('Rechaza palabras similares que son falsos positivos', () => {
        const falsePositives = ['jueves', 'servicio', 'visita', 'árbol', 'avisar', 'barco', 'vamos'];
        for (const fp of falsePositives) {
            const res = pipeline.detectWakeWord(fp);
            assert.strictEqual(res, null, `"${fp}" NO debe ser detectado como wake word`);
        }
    });

    // -------------------------------------------------------------
    // BLOQUE 2: Desacople de Órdenes Compuestas Directas (One-Shot)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Desacople de Órdenes Compuestas Directas (One-Shot) ---');

    await test('Parsea orden compuesta directa: "Jarvis, abrime Netflix"', () => {
        const parsed = pipeline.parseCompoundCommand('Jarvis, abrime Netflix');
        assert.strictEqual(parsed.hasWakeWord, true);
        assert.strictEqual(parsed.isCompound, true);
        assert.strictEqual(parsed.wakeWord, 'jarvis');
        assert.strictEqual(parsed.command, 'abrime netflix');
    });

    await test('Parsea orden compuesta rioplatense: "Che Jarvis qué hora es"', () => {
        const parsed = pipeline.parseCompoundCommand('Che Jarvis qué hora es');
        assert.strictEqual(parsed.hasWakeWord, true);
        assert.strictEqual(parsed.isCompound, true);
        assert.strictEqual(parsed.wakeWord, 'che jarvis');
        assert.strictEqual(parsed.command, 'que hora es');
    });

    await test('Detección de invocación solitaria: "Jarvis"', () => {
        const parsed = pipeline.parseCompoundCommand('Jarvis');
        assert.strictEqual(parsed.hasWakeWord, true);
        assert.strictEqual(parsed.isCompound, false);
        assert.strictEqual(parsed.command, '');
    });

    // -------------------------------------------------------------
    // BLOQUE 3: Modo STANDBY_WAKE_WORD y Supresión de Ruido / Ahorro CPU
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Modo STANDBY y Supresión de Ruidos (Ahorro de CPU) ---');

    await test('Charla de fondo sin wake word es ignorada sin llamar a Whisper', () => {
        pipeline.forceStandby();
        assert.strictEqual(pipeline.state, STATES.STANDBY_WAKE_WORD);

        const res = pipeline.processUtterance('estamos hablando de la reunión de ayer con Juan');
        assert.strictEqual(res.shouldTranscribe, false, 'No debe transcribir');
        assert.strictEqual(res.action, 'IGNORE');
        assert.strictEqual(res.reason, 'wake_word_required');
        assert.strictEqual(pipeline.state, STATES.STANDBY_WAKE_WORD, 'Permanece en standby');
        assert.strictEqual(pipeline.metrics.savedWhisperCalls, 1, 'Registra 1 llamada a Whisper ahorrada');
    });

    // -------------------------------------------------------------
    // BLOQUE 4: Procesamiento de Orden Compuesta Directa
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Procesamiento de Orden Compuesta Directa ---');

    await test('"Jarvis, poné música en Spotify" dispara transcripción selectiva directamente', () => {
        pipeline.forceStandby();
        const res = pipeline.processUtterance('Jarvis, poné música en Spotify');
        assert.strictEqual(res.shouldTranscribe, true);
        assert.strictEqual(res.action, 'TRANSCRIBE_COMPOUND');
        assert.strictEqual(res.command, 'pone musica en spotify');
        assert.strictEqual(res.isCompound, true);
        assert.strictEqual(pipeline.state, STATES.TRANSCRIBING);
    });

    // -------------------------------------------------------------
    // BLOQUE 5: Flujo de Dos Fases (Wake Word -> Espera de Comando)
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Flujo de 2 Fases (Wake -> Command) ---');

    await test('Fase 1: Usuario dice solo "Jarvis" -> Solicita comando y activa VAD', () => {
        pipeline.forceStandby();
        const res = pipeline.processUtterance('Jarvis');
        assert.strictEqual(res.shouldTranscribe, false);
        assert.strictEqual(res.action, 'AWAIT_COMMAND');
        assert.strictEqual(pipeline.state, STATES.LISTENING_COMMAND);
    });

    await test('Fase 2: Usuario da la orden -> Se dispara transcripción del comando', () => {
        assert.strictEqual(pipeline.state, STATES.LISTENING_COMMAND);
        const res = pipeline.processUtterance('cerrá todas las ventanas');
        assert.strictEqual(res.shouldTranscribe, true);
        assert.strictEqual(res.action, 'TRANSCRIBE_COMMAND');
        assert.strictEqual(res.command, 'cerra todas las ventanas');
        assert.strictEqual(pipeline.state, STATES.TRANSCRIBING);
    });

    // -------------------------------------------------------------
    // BLOQUE 6: Ventana de Gracia Conversacional (Follow-up)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Ventana Conversacional de Seguimiento (Follow-up) ---');

    await test('Al completar el comando, entra en FOLLOW_UP permitiendo diálogo sin repetir "Jarvis"', () => {
        pipeline.notifyCommandCompleted();
        assert.strictEqual(pipeline.state, STATES.FOLLOW_UP);

        // El usuario hace una repregunta directa sin decir "Jarvis"
        const res = pipeline.processUtterance('y cuál es la cotización del dólar blue?');
        assert.strictEqual(res.shouldTranscribe, true);
        assert.strictEqual(res.action, 'TRANSCRIBE_FOLLOW_UP');
        assert.strictEqual(res.isFollowUp, true);
        assert.ok(res.command.includes('dolar blue'));
    });

    await test('Al expirar el tiempo de gracia, retorna automáticamente a STANDBY_WAKE_WORD', async () => {
        pipeline.notifyCommandCompleted();
        assert.strictEqual(pipeline.state, STATES.FOLLOW_UP);

        // Esperar expiración del temporizador de prueba (300ms)
        await new Promise(r => setTimeout(r, 450));

        assert.strictEqual(pipeline.state, STATES.STANDBY_WAKE_WORD, 'Debe haber retornado a standby');

        // Ahora una frase casual sin wake word vuelve a ser ignorada
        const res = pipeline.processUtterance('qué lindo día hace afuera');
        assert.strictEqual(res.shouldTranscribe, false);
        assert.strictEqual(res.reason, 'wake_word_required');
    });

    // -------------------------------------------------------------
    // BLOQUE 7: Métricas de Telemetría y Eficiencia
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Métricas de Telemetría y Ahorro ---');

    await test('getMetrics reporta estadísticas completas del pipeline', () => {
        const metrics = pipeline.getMetrics();
        assert.ok(metrics.totalUtterancesEvaluated >= 5, 'Debe haber evaluado múltiples emisiones');
        assert.ok(metrics.savedWhisperCalls >= 2, 'Debe registrar llamadas a Whisper evitadas');
        assert.ok(metrics.wakeWordDetections >= 2, 'Debe registrar detecciones de wake word');
        assert.ok(typeof metrics.cpuSavingsPercent === 'string', 'Debe reportar % de ahorro de CPU');
    });

    console.log(`\n=== RESULTADO FINAL: ${passed}/${passed + failed} PRUEBAS APROBADAS ===`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en suite de pruebas:', err);
    process.exit(1);
});
