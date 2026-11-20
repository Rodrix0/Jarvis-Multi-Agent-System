/**
 * Test Suite: JARVIS 3.1 Long Term Memory Hardening
 *
 * Valida:
 * 1. Persistencia de hechos Core/Permanentes a +30 días y +365 días (sin decaer a olvido).
 * 2. Expiración de recuerdos episódicos según TTL.
 * 3. Almacenamiento permanente de recuerdos de baja importancia (0.10 - 0.25) en Raw Archive + FTS5.
 * 4. Búsqueda histórica y recuperación desde Raw Archive FTS ("qué te dije", "el icono era").
 * 5. Trazabilidad temporal de cambios y resolución de conflictos ("qué prefería antes" vs "ahora").
 * 6. Escaneo y redacción de secretos (API keys, passwords) antes de persistir.
 * 7. Trazabilidad de memorias consolidadas con sus IDs originales.
 */

const assert = require('assert');
const universalMemoryService = require('../services/memory/universalMemoryService');
const memoryConflictResolver = require('../services/memory/memoryConflictResolver');
const databaseService = require('../services/persistence/databaseService');
const memoryConsolidationService = require('../services/memory/memoryConsolidationService');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        failedTests++;
    }
}

async function runAsyncTest(name, fn) {
    try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        failedTests++;
    }
}

async function runSuite() {
    console.log('\n===============================================================');
    console.log('🧠 INICIANDO TEST SUITE: MEMORIA PERMANENTE Y HARDENING (JARVIS 3.1)');
    console.log('===============================================================\n');

    // 1. Redacción de secretos
    test('Escaneo y redacción de secretos (API keys y passwords)', () => {
        const secretText = 'Mi api key de OpenAI es sk-abc1234567890abcdef1234567890 y la password: superSecretPassword123';
        const res = universalMemoryService.storeMemory({
            tier: 'SEMANTIC',
            value: secretText,
            key: 'test_secret_key'
        });
        assert.strictEqual(res.ok, true);

        // Verificar que en SQLite no esté la clave en texto plano
        const row = databaseService.db.prepare('SELECT value FROM memory WHERE id = ?').get(res.id);
        assert.ok(row, 'Debe existir el registro en BD');
        assert.ok(!row.value.includes('sk-abc1234567890abcdef1234567890'), 'No debe contener la API key en texto plano');
        assert.ok(!row.value.includes('superSecretPassword123'), 'No debe contener la contraseña en texto plano');
        assert.ok(row.value.includes('[REDACTED_API_KEY]'), 'Debe contener la etiqueta de API key redactada');
        assert.ok(row.value.includes('[REDACTED_SECRET]'), 'Debe contener la etiqueta de password redactada');
    });

    // 2. Almacenamiento de baja importancia en Raw Archive y FTS
    test('Baja importancia (0.10) va a ARCHIVE_ONLY sin poblar working memory activo', () => {
        databaseService.db.prepare("DELETE FROM memory WHERE value LIKE '%naranja chillón%'").run();
        databaseService.db.prepare("DELETE FROM raw_archive_fts WHERE content LIKE '%naranja chillón%'").run();

        const lowText = 'el icono de la aplicacion de ayer era color naranja chillón';
        const res = universalMemoryService.storeMemory({
            tier: 'SEMANTIC',
            value: lowText
        });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.action, 'ARCHIVE_ONLY', 'Debe ser categorizado como ARCHIVE_ONLY');

        // No debe estar en la tabla active memory
        const activeRow = databaseService.db.prepare('SELECT * FROM memory WHERE id = ?').get(res.id);
        assert.strictEqual(activeRow, undefined, 'No debe insertarse en la tabla activa de working memory');

        // Debe estar indexado en raw_archive_fts
        const ftsMatches = universalMemoryService.searchRawArchive('icono naranja');
        assert.ok(ftsMatches.length > 0, 'Debe encontrarse en raw_archive_fts');
        assert.ok(ftsMatches.some(m => m.text.includes('naranja chillón')), 'Debe contener el texto indexado');
    });

    // 3. Consulta histórica recupera desde Raw Archive FTS
    await runAsyncTest('Recuperación histórica con disparadores temporales ("te acordas", "el icono era")', async () => {
        const results = await universalMemoryService.queryUniversal('¿te acordas que el icono era naranja?', { limit: 5 });
        assert.ok(results.length > 0, 'Debe retornar al menos 1 resultado');
        const found = results.find(r => r.text && r.text.includes('naranja chillón'));
        assert.ok(found, 'Debe recuperar el recuerdo de baja importancia desde Raw Archive');
        assert.strictEqual(found.sourceTier, 'RAW_ARCHIVE_FTS', 'Debe indicar procedencia RAW_ARCHIVE_FTS');
    });

    // 4. Resolución de Conflictos y Trazabilidad Histórica ("qué prefería antes" vs "ahora")
    test('Trazabilidad temporal de cambios y resolución de conflictos', () => {
        const key = 'editor_codigo_preferido';

        // Primer valor histórico
        universalMemoryService.storeMemory({
            tier: 'PREFERENCE',
            key,
            value: 'Mi editor de código favorito siempre fue Sublime Text',
            source: 'explicit_user_statement'
        });

        // Segundo valor que superseda al anterior
        universalMemoryService.storeMemory({
            tier: 'PREFERENCE',
            key,
            value: 'Ahora mi editor principal de código es Neovim con Lua',
            source: 'explicit_user_statement'
        });

        // Verificar valor activo actual
        const active = databaseService.db.prepare("SELECT value FROM memory WHERE key = ? AND status = 'ACTIVE'").get(key);
        assert.ok(active, 'Debe existir memoria activa');
        assert.ok(active.value.includes('Neovim'), 'La memoria activa debe ser la más reciente (Neovim)');

        // Consultar valor histórico previo
        const historical = memoryConflictResolver.getHistoricalValue(key);
        assert.ok(historical, 'Debe existir registro histórico de la preferencia anterior');
        assert.ok(historical.previous_value.includes('Sublime Text'), 'El valor histórico previo debe ser Sublime Text');
        assert.ok(historical.new_value.includes('Neovim'), 'El nuevo valor registrado en historial debe ser Neovim');

        // Historial completo
        const fullHist = memoryConflictResolver.getFullHistory(key);
        assert.ok(fullHist.length >= 1, 'El historial debe contener los cambios registrados');
    });

    // 5. Simulación temporal: Hechos Core a +30 días y +365 días vs Episódicos expirados
    await runAsyncTest('Persistencia temporal simulada: Core (+365 días) vs Episódica expirada', async () => {
        const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // Hace 35 días
        const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // Expiró hace 5 días

        // 1. Episódica con expires_at en el pasado
        databaseService.db.prepare(`
            INSERT OR REPLACE INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
            VALUES ('mem-exp-1', 'EPISODIC', 'NORMAL', 'reunion_pasada', 'Tengo reunión con el cliente el jueves pasado', 'user', 0.6, ?, ?, 'ACTIVE')
        `).run(pastDate, expiredDate);

        // 2. Core persistente (sin expiración) creada hace 1 año (365 días)
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        databaseService.db.prepare(`
            INSERT OR REPLACE INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
            VALUES ('mem-core-365', 'SEMANTIC', 'CORE', 'regla_arquitectura', 'La base de datos principal de JARVIS siempre es SQLite', 'user', 0.95, ?, NULL, 'ACTIVE')
        `).run(oneYearAgo);

        // Consultar memoria
        const queryResults = await universalMemoryService.queryUniversal('base de datos principal de JARVIS', { limit: 5 });
        const coreFound = queryResults.find(r => r.id === 'mem-core-365');
        assert.ok(coreFound, 'El recuerdo permanente de hace 365 días debe seguir recuperándose');

        // Consultar reunión expirada
        const expiredResults = await universalMemoryService.queryUniversal('reunión con el cliente el jueves pasado', { limit: 5 });
        const expiredFound = expiredResults.find(r => r.id === 'mem-exp-1');
        assert.strictEqual(expiredFound, undefined, 'El recuerdo episódico con fecha de expiración superada NO debe estar en resultados activos');
    });

    // 6. Trazabilidad de memorias consolidadas
    test('Consolidación de recuerdos preserva IDs originales (source_ids)', () => {
        const cluster = [
            { id: 'mem-node-1', value: 'Uso Node.js v24 para el backend' },
            { id: 'mem-node-2', value: 'En Node.js v24 usamos node:sqlite nativo' },
            { id: 'mem-node-3', value: 'El runtime del servidor siempre es Node.js' }
        ];

        const synthesized = memoryConsolidationService.synthesizeCluster('runtime_nodejs', cluster);
        assert.ok(synthesized, 'Debe generar síntesis');
        assert.strictEqual(synthesized.source_ids.length, 3, 'Debe conservar los 3 IDs de origen');
        assert.ok(synthesized.source_ids.includes('mem-node-1'));
        assert.ok(synthesized.source_ids.includes('mem-node-2'));
        assert.ok(synthesized.source_ids.includes('mem-node-3'));
    });

    console.log('\n---------------------------------------------------------------');
    console.log(`📊 RESULTADOS: ${passedTests} APROBADOS, ${failedTests} FALLIDOS`);
    console.log('===============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en suite de memoria:', err);
    process.exit(1);
});
