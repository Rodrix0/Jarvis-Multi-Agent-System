/**
 * Test Suite: Ítem 21 - Buffer de Diálogo con Presupuesto Dinámico de Tokens
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Configurar entorno de pruebas aislado
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-token-budget-'));
const testMemoryPath = path.join(testDir, 'test_memory.json');
process.env.JARVIS_MEMORY_PATH = testMemoryPath;
process.env.JARVIS_MAX_CONTEXT_TOKENS = '20000';

const memory = require('../services/memoryService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 21 - BUFFER CON PRESUPUESTO DE TOKENS ===\n');
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    // -------------------------------------------------------------
    // BLOQUE 1: Calibración y Estimación de Tokens
    // -------------------------------------------------------------
    console.log('--- Test 1: Calibración del Estimador de Tokens ---');

    test('Texto corto devuelve estimación coherente', () => {
        const tokens = memory.estimateTokens('ok dale');
        assert.ok(tokens >= 2 && tokens <= 4, `Esperado entre 2 y 4 tokens, obtenido ${tokens}`);
    });

    test('Frase en español rioplatense pondera conectores y acentos', () => {
        const text = 'Che Jarvis, por favor prendé la tele y poné Netflix en mi perfil de Luffy';
        const tokens = memory.estimateTokens(text);
        assert.ok(tokens >= 15 && tokens <= 25, `Tokens calculados: ${tokens}`);
    });

    test('Bloque de código y símbolos técnicos incrementa tokens apropiadamente', () => {
        const code = 'const config = { host: "127.0.0.1", port: 5432, ssl: true, tags: ["db", "core"] };';
        const tokens = memory.estimateTokens(code);
        assert.ok(tokens >= 20 && tokens <= 35, `Tokens calculados para código: ${tokens}`);
    });

    // -------------------------------------------------------------
    // BLOQUE 2: Superar 240 Turnos sin Descarte si están en Presupuesto
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Flexibilidad para Superar los Antiguos 240 Turnos ---');

    memory.clear('all');

    test('Permite almacenar más de 240 turnos cortos sin desalojo arbitrario', () => {
        // Insertamos 260 turnos ultracortos (~3 tokens cada uno = ~780 tokens, muy por debajo de 20.000)
        for (let i = 1; i <= 260; i++) {
            memory.addTurn(i % 2 === 1 ? 'user' : 'assistant', `Mensaje ${i} listo`);
        }

        const snap = memory.snapshot();
        // El antiguo sistema los hubiera recortado bruscamente a 160. El nuevo conserva los 260.
        assert.strictEqual(snap.conversations.length, 260, `Debe conservar los 260 turnos, actual: ${snap.conversations.length}`);
        
        const metrics = memory.getMetrics();
        assert.strictEqual(metrics.totalTurns, 260);
        assert.ok(metrics.totalTokens < 2000, `Total tokens debe ser bajo (~1000), obtenido: ${metrics.totalTokens}`);
        assert.ok(metrics.utilizationPercent < 15, `Utilización debe ser menor a 15%, obtenido: ${metrics.utilizationPercent}%`);
    });

    // -------------------------------------------------------------
    // BLOQUE 3: Poda Progresiva y Suave al Exceder Presupuesto
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Poda Progresiva y Suave al Exceder MAX_TOKENS ---');

    test('Poda progresiva mantiene el buffer en zona de confort (TARGET_TOKENS)', () => {
        // Insertamos respuestas grandes con código para saturar los 20.000 tokens
        const largeDump = 'function processLargeBatch() { ' + 'const x = 12345; '.repeat(40) + 'return true; }';
        const dumpTokens = memory.estimateTokens(largeDump); // ~250-300 tokens por turno

        // Agregamos turnos hasta forzar la superación del límite
        for (let i = 1; i <= 80; i++) {
            memory.addTurn('assistant', `Respuesta técnica ${i}: ${largeDump}`);
        }

        const metrics = memory.getMetrics();
        // Debe haber podado suavemente sin permitir superar 20.000 tokens
        assert.ok(metrics.totalTokens <= memory.MAX_TOKENS, `Total tokens ${metrics.totalTokens} debe ser <= MAX_TOKENS (${memory.MAX_TOKENS})`);
        assert.ok(metrics.totalTokens >= memory.TARGET_TOKENS - 500, `Total tokens debe estar en la zona objetivo de confort (~${memory.TARGET_TOKENS})`);
    });

    test('Los turnos desalojados generan resúmenes rodantes estructurados', () => {
        const snap = memory.snapshot();
        assert.ok(snap.summaries.length > 0, 'Debe haber generado resúmenes para los turnos desalojados');
        const firstSummary = snap.summaries[0];
        assert.ok(firstSummary.turnCount > 0, 'El resumen debe reportar turnCount');
        assert.ok(firstSummary.text.length > 10, 'El resumen debe contener texto condensado');
    });

    // -------------------------------------------------------------
    // BLOQUE 4: Preservación de Turnos Fijados (Pinned)
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Inmunidad de Turnos Fijados (Pinned) ---');

    test('Turnos con pinned: true sobreviven a la poda progresiva', () => {
        memory.clear('all');

        // Turno fijado con instrucción crítica
        const pinnedTurn = memory.addTurn('user', 'REGLA CRITICA: Siempre responder en formato JSON estructurado', {
            pinned: true,
            importance: 'HIGH'
        });

        // Agregamos gran volumen de mensajes no fijados para provocar múltiples ciclos de desalojo
        const bulkText = 'Log temporal de depuración ' + 'detalles de traza de red '.repeat(30);
        for (let i = 1; i <= 70; i++) {
            memory.addTurn('assistant', `Mensaje transitorio ${i}: ${bulkText}`);
        }

        const snap = memory.snapshot();
        const foundPinned = snap.conversations.find(t => t.id === pinnedTurn.id);
        assert.ok(foundPinned, 'El turno fijado debe seguir existiendo en el buffer tras la poda masiva');
        assert.strictEqual(foundPinned.meta.pinned, true);

        const metrics = memory.getMetrics();
        assert.strictEqual(metrics.pinnedTurnsCount, 1, 'Métricas debe contabilizar 1 turno fijado');
    });

    // -------------------------------------------------------------
    // BLOQUE 5: Recuperación Adaptativa por Presupuesto (recentByTokens)
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Recuperación Adaptativa por Presupuesto (recentByTokens) ---');

    test('recentByTokens(500) respeta estrictamente el presupuesto solicitado', () => {
        const res = memory.recentByTokens(500);
        assert.ok(res.totalTokens <= 500, `Tokens devueltos (${res.totalTokens}) deben ser <= 500`);
        assert.ok(res.turns.length > 0, 'Debe retornar turnos');
        assert.strictEqual(res.budget, 500);
    });

    test('recentByTokens(2500) entrega más contexto sin superar 2500 tokens', () => {
        const smallRes = memory.recentByTokens(500);
        const bigRes = memory.recentByTokens(2500);
        assert.ok(bigRes.totalTokens <= 2500);
        assert.ok(bigRes.turns.length >= smallRes.turns.length, 'Mayor presupuesto debe retornar igual o mayor cantidad de turnos');
    });

    test('recentByTokens respeta el orden cronológico (de más antiguo a más nuevo)', () => {
        const res = memory.recentByTokens(1500);
        if (res.turns.length >= 2) {
            const time1 = new Date(res.turns[0].at).getTime();
            const time2 = new Date(res.turns[1].at).getTime();
            assert.ok(time1 <= time2, 'Los turnos deben estar ordenados cronológicamente');
        }
    });

    // -------------------------------------------------------------
    // BLOQUE 6: Métricas y Snapshot Completo
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Métricas en Tiempo Real y Snapshot ---');

    test('getMetrics reporta estadísticas completas del buffer', () => {
        const metrics = memory.getMetrics();
        assert.ok(typeof metrics.totalTurns === 'number');
        assert.ok(typeof metrics.totalTokens === 'number');
        assert.strictEqual(metrics.maxTokens, 20000);
        assert.strictEqual(metrics.targetTokens, 18000);
        assert.ok(typeof metrics.utilizationPercent === 'number');
        assert.ok(typeof metrics.averageTokensPerTurn === 'number');
    });

    test('snapshot() incluye bloque metrics actualizado', () => {
        const snap = memory.snapshot();
        assert.ok(snap.metrics, 'Snapshot debe incluir métricas');
        assert.strictEqual(snap.metrics.maxTokens, 20000);
    });

    // -------------------------------------------------------------
    // BLOQUE 7: Compatibilidad Retroactiva Completa
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Compatibilidad Retroactiva Total con APIs Históricas ---');

    test('recent(limit, topic) sigue funcionando idéntico al comportamiento histórico', () => {
        const turns = memory.recent(5);
        assert.ok(turns.length <= 5);
    });

    test('resolveReferences resuelve deícticos correctamente', () => {
        memory.addTurn('user', 'Quiero ver una serie en Netflix');
        memory.addTurn('assistant', 'Abrí Netflix en la televisión');
        const ref = memory.resolveReferences('seguí con lo mismo');
        assert.strictEqual(ref.resolved, true);
        assert.strictEqual(ref.topic, 'television');
    });

    test('Preferencias y correcciones operan sin alteraciones', () => {
        memory.addPreference('idioma preferido', 'español rioplatense');
        memory.addCorrection('jarbis', 'Jarvis');
        assert.strictEqual(memory.applyCorrections('hola jarbis'), 'hola Jarvis');
    });

    console.log(`\n=== RESULTADO FINAL: ${passed}/${passed + failed} PRUEBAS APROBADAS ===`);
    if (failed > 0) {
        process.exit(1);
    }

    // Limpieza de directorio temporal de pruebas
    try {
        fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
}

runTests().catch(err => {
    console.error('Error fatal en test suite:', err);
    process.exit(1);
});
