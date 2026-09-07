/**
 * Test Suite: JARVIS 3.1.1 — Memory Scale & Needle in a Haystack Real
 * 
 * Evalúa:
 * 1. Inserción masiva de 10.000 registros sintéticos en SQLite y FTS5.
 * 2. Inserción de una aguja única ("Needle") en una posición arbitraria profunda.
 * 3. Medición de throughput de inserción (items/seg).
 * 4. Latencias de recuperación P50 y P95 sobre 10.000+ registros.
 * 5. Recuperación exacta y semántica de la aguja ("Needle in a Haystack").
 * 6. Uso de memoria RAM antes y después (prevención de leaks).
 * 7. Limpieza controlada de datos de prueba sintéticos.
 */

const assert = require('assert');
const databaseService = require('../services/persistence/databaseService');
const universalMemoryService = require('../services/memory/universalMemoryService');

const SCALE_COUNT = 10000;
const NEEDLE_INDEX = 5432;
const NEEDLE_ID = 'mem-scale-needle-92741';
const NEEDLE_KEY = 'needle_helicoptero_azul';
const NEEDLE_TEXT = 'El código de activación secreto del helicóptero azul es ZULU-9812-DELTA';

function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function runScaleSuite() {
    console.log('\n===============================================================');
    console.log('⚡ INICIANDO FASE 4: MEMORY SCALE & NEEDLE IN A HAYSTACK (10K)');
    console.log('===============================================================\n');

    const initialMem = process.memoryUsage();
    console.log(`[ScaleTest] Memoria inicial RSS: ${formatMB(initialMem.rss)} | HeapUsed: ${formatMB(initialMem.heapUsed)}`);

    // Limpieza preliminar preventiva
    databaseService.db.prepare("DELETE FROM memory WHERE source = 'synthetic_scale_test'").run();
    databaseService.db.prepare("DELETE FROM raw_archive_fts WHERE source = 'synthetic_scale_test'").run();

    // 1. Inserción Masiva Sintética
    console.log(`[ScaleTest] Generando e insertando ${SCALE_COUNT} registros sintéticos...`);
    const insertStartTime = Date.now();

    const insertMemStmt = databaseService.db.prepare(`
        INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
        VALUES (?, 'SEMANTIC', 'NORMAL', ?, ?, 'synthetic_scale_test', 0.5, ?, NULL, 'ACTIVE')
    `);
    const insertFtsStmt = databaseService.db.prepare(`
        INSERT INTO raw_archive_fts (id, tier, content, source, timestamp)
        VALUES (?, 'SEMANTIC', ?, 'synthetic_scale_test', ?)
    `);

    // Inserción en transacción por lotes para velocidad óptima de SQLite
    const batchSize = 1000;
    const nowIso = new Date().toISOString();

    for (let b = 0; b < SCALE_COUNT; b += batchSize) {
        databaseService.db.exec('BEGIN');
        const endIdx = Math.min(b + batchSize, SCALE_COUNT);
        for (let i = b; i < endIdx; i++) {
            if (i === NEEDLE_INDEX) {
                // Insertar Aguja
                insertMemStmt.run(NEEDLE_ID, NEEDLE_KEY, NEEDLE_TEXT, nowIso);
                insertFtsStmt.run(NEEDLE_ID, NEEDLE_TEXT, nowIso);
            } else {
                const id = `mem-scale-${i}`;
                const key = `synthetic_key_${i}`;
                const val = `Registro sintético número ${i} con información general sobre tópicos de computación, servidores, redes y tareas recurrentes de testing.`;
                insertMemStmt.run(id, key, val, nowIso);
                insertFtsStmt.run(id, val, nowIso);
            }
        }
        databaseService.db.exec('COMMIT');
    }

    const insertDurationSec = (Date.now() - insertStartTime) / 1000;
    const throughput = Math.round(SCALE_COUNT / Math.max(0.001, insertDurationSec));
    console.log(`[ScaleTest] Inserción completada en ${insertDurationSec.toFixed(2)}s. Throughput: ${throughput} items/seg`);

    const postInsertMem = process.memoryUsage();
    console.log(`[ScaleTest] Memoria post-inserción RSS: ${formatMB(postInsertMem.rss)} | HeapUsed: ${formatMB(postInsertMem.heapUsed)}`);

    // 2. Medición de Latencias P50 y P95
    console.log(`[ScaleTest] Ejecutando 50 consultas de prueba para calcular percentiles de latencia...`);
    const querySamples = [
        'servidores y redes',
        'computación y tareas recurrentes',
        'información general de testing',
        'registro sintético número 350',
        'tópicos de computación',
        'base de datos principal',
        'editor de código',
        'información general sobre tópicos'
    ];

    const latencies = [];
    for (let q = 0; q < 50; q++) {
        const sampleQuery = querySamples[q % querySamples.length];
        const t0 = performance.now();
        await universalMemoryService.queryUniversal(sampleQuery, { limit: 5 });
        const t1 = performance.now();
        latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)].toFixed(2);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
    const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(2);

    console.log(`[ScaleTest] Latencias sobre 10K+ registros:`);
    console.log(`   - P50: ${p50} ms`);
    console.log(`   - P95: ${p95} ms`);
    console.log(`   - P99: ${p99} ms`);

    // 3. Prueba Needle in a Haystack
    console.log(`[ScaleTest] Buscando la aguja: "código de activación secreto helicóptero azul"...`);
    const needleStart = performance.now();
    const needleResults = await universalMemoryService.queryUniversal('código de activación secreto helicóptero azul', { limit: 3 });
    const needleDuration = (performance.now() - needleStart).toFixed(2);

    console.log(`[ScaleTest] Búsqueda de aguja completada en ${needleDuration} ms. Resultados devueltos: ${needleResults.length}`);
    const foundNeedle = needleResults.find(r => r.id === NEEDLE_ID || (r.text && r.text.includes('ZULU-9812-DELTA')));

    assert.ok(foundNeedle, 'La aguja (Needle) debe ser encontrada en el top de resultados');
    console.log(`  ✅ [PASS] Needle in a Haystack recuperada exitosamente (ID: ${foundNeedle.id}, Score: ${foundNeedle.score || foundNeedle.finalScore})`);

    // 4. Verificación de Fuga de Memoria
    const finalMem = process.memoryUsage();
    const heapGrowthMB = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
    console.log(`[ScaleTest] Memoria final HeapUsed: ${formatMB(finalMem.heapUsed)} (Delta: ${heapGrowthMB.toFixed(2)} MB)`);
    assert.ok(heapGrowthMB < 120, `El crecimiento del Heap (${heapGrowthMB.toFixed(2)} MB) debe estar acotado (< 120 MB)`);
    console.log(`  ✅ [PASS] Gestión de memoria estable y sin fugas catastróficas`);

    // 5. Limpieza de Registros Sintéticos
    console.log(`[ScaleTest] Limpiando los ${SCALE_COUNT} registros sintéticos de prueba...`);
    databaseService.db.prepare("DELETE FROM memory WHERE source = 'synthetic_scale_test'").run();
    databaseService.db.prepare("DELETE FROM raw_archive_fts WHERE source = 'synthetic_scale_test'").run();
    console.log(`[ScaleTest] Limpieza completada.`);

    console.log('\n---------------------------------------------------------------');
    console.log('📊 FASE 4: TODAS LAS PRUEBAS DE ESCALA Y AGUJA EN PAJAR SUPERADAS');
    console.log('===============================================================\n');
}

runScaleSuite().catch(err => {
    console.error('Fatal error en Scale Suite:', err);
    process.exit(1);
});
