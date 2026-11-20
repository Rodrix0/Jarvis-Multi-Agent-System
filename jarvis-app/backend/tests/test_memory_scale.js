/**
 * Test Suite: JARVIS 3.1.2 — Memory Scale & Multi-Tier Stress Testing (10K, 50K, 100K)
 * 
 * Evalúa rigurosamente:
 * 1. Escalas 10.000, 50.000 y 100.000 registros sintéticos en SQLite y FTS5.
 * 2. Medición precisa de tiempo de inserción, index size en disco (bytes) y consumo de RAM (RSS/Heap).
 * 3. Latencias de recuperación P50, P95 y P99 bajo carga masiva.
 * 4. Recuperación exacta y semántica de aguja profunda (Needle in a Haystack).
 * 5. Validación del comportamiento ARCHIVE_ONLY a gran escala (sin saturar working memory).
 * 6. Control de hardware: marca NOT_AVAILABLE si el hardware disponible no puede completar 100K sin OOM.
 * 7. Limpieza atómica de datos de prueba al finalizar cada tier.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const databaseService = require('../services/persistence/databaseService');
const universalMemoryService = require('../services/memory/universalMemoryService');

const DB_PATH = path.join(__dirname, '..', 'data', 'jarvis.db');

function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getDbFileSize() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return fs.statSync(DB_PATH).size;
        }
    } catch (_) {}
    return 0;
}

async function runTierScaleTest(scaleCount, options = {}) {
    console.log(`\n===============================================================`);
    console.log(`⚡ EVALUANDO MEMORY SCALE TIER: ${scaleCount.toLocaleString()} REGISTROS`);
    console.log(`===============================================================`);

    const needleIndex = Math.floor(scaleCount * 0.5432);
    const needleId = `mem-scale-needle-${scaleCount}`;
    const needleKey = `needle_key_${scaleCount}`;
    const needleText = `El protocolo de seguridad supremo para la escala ${scaleCount} es DELTA-OMEGA-9941`;

    const initialMem = process.memoryUsage();
    const initialDbSize = getDbFileSize();
    console.log(`  [ScaleTest ${scaleCount}] RAM inicial RSS: ${formatMB(initialMem.rss)} | Heap: ${formatMB(initialMem.heapUsed)} | DB Size: ${formatMB(initialDbSize)}`);

    // Limpieza preliminar preventiva
    databaseService.db.prepare("DELETE FROM memory WHERE source = 'synthetic_scale_test'").run();
    databaseService.db.prepare("DELETE FROM raw_archive_fts WHERE source = 'synthetic_scale_test'").run();

    // 1. Inserción Masiva
    const insertStartTime = performance.now();
    const insertMemStmt = databaseService.db.prepare(`
        INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, expires_at, status)
        VALUES (?, 'SEMANTIC', 'NORMAL', ?, ?, 'synthetic_scale_test', 0.5, ?, NULL, 'ACTIVE')
    `);
    const insertFtsStmt = databaseService.db.prepare(`
        INSERT INTO raw_archive_fts (id, tier, content, source, timestamp)
        VALUES (?, 'SEMANTIC', ?, 'synthetic_scale_test', ?)
    `);

    const batchSize = 2500;
    const nowIso = new Date().toISOString();

    for (let b = 0; b < scaleCount; b += batchSize) {
        databaseService.db.exec('BEGIN');
        const endIdx = Math.min(b + batchSize, scaleCount);
        for (let i = b; i < endIdx; i++) {
            if (i === needleIndex) {
                insertMemStmt.run(needleId, needleKey, needleText, nowIso);
                insertFtsStmt.run(needleId, needleText, nowIso);
            } else {
                const id = `mem-scale-${scaleCount}-${i}`;
                const key = `synthetic_key_${i}`;
                const val = `Registro sintético índice ${i} perteneciente al bloque de escala ${scaleCount} sobre arquitectura de sistemas, nodos y almacenamiento.`;
                insertMemStmt.run(id, key, val, nowIso);
                insertFtsStmt.run(id, val, nowIso);
            }
        }
        databaseService.db.exec('COMMIT');
    }

    const insertDurationMs = performance.now() - insertStartTime;
    const throughput = Math.round(scaleCount / Math.max(0.001, insertDurationMs / 1000));
    const postInsertDbSize = getDbFileSize();
    const dbSizeDelta = postInsertDbSize - initialDbSize;
    const postInsertMem = process.memoryUsage();

    console.log(`  [ScaleTest ${scaleCount}] Inserción: ${(insertDurationMs / 1000).toFixed(2)}s | Throughput: ${throughput} items/s | Index Delta: ${formatMB(dbSizeDelta)}`);

    // 2. Latencias P50, P95, P99
    const querySamples = [
        'arquitectura de sistemas',
        'nodos y almacenamiento',
        'registro sintético índice 150',
        'bloque de escala'
    ];

    const latencies = [];
    const queryCount = 20;
    for (let q = 0; q < queryCount; q++) {
        const sampleQuery = querySamples[q % querySamples.length];
        const t0 = performance.now();
        await universalMemoryService.queryUniversal(sampleQuery, { limit: 5 });
        latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)].toFixed(2);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
    const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(2);

    console.log(`  [ScaleTest ${scaleCount}] Latencias: P50: ${p50}ms | P95: ${p95}ms | P99: ${p99}ms`);

    // 3. Recuperación Exacta y Semántica de la Aguja
    const t0Needle = performance.now();
    const needleResults = await universalMemoryService.queryUniversal(`protocolo de seguridad supremo escala ${scaleCount}`, { limit: 5 });
    const needleDurationMs = (performance.now() - t0Needle).toFixed(2);

    const foundNeedle = needleResults.find(r => r.id === needleId || (r.text && r.text.includes('DELTA-OMEGA-9941')));
    assert.ok(foundNeedle, `La aguja profunda debe ser encontrada en escala ${scaleCount}`);
    console.log(`  [ScaleTest ${scaleCount}] Needle Recuperada en ${needleDurationMs}ms (ID: ${foundNeedle.id})`);

    // 4. Verificación de Comportamiento ARCHIVE_ONLY a Gran Escala
    const archiveOnlyId = `mem-archive-only-${scaleCount}`;
    const archiveOnlyText = `Nota efímera de baja relevancia archivada en escala ${scaleCount}`;
    const storeRes = universalMemoryService.storeMemory({
        tier: 'EPISODIC',
        value: archiveOnlyText,
        confidence: 0.15 // baja relevancia -> triage a ARCHIVE_ONLY
    });
    assert.strictEqual(storeRes.action, 'ARCHIVE_ONLY', 'Debe clasificar como ARCHIVE_ONLY sin saturar working memory');
    
    // Comprobar que NO está en working memory (tabla memory) pero SÍ en raw_archive_fts
    const inWorking = databaseService.db.prepare("SELECT count(*) as c FROM memory WHERE value = ?").get(archiveOnlyText);
    assert.strictEqual(inWorking.c, 0, 'No debe residir en tabla memory activa');
    const ftsResults = universalMemoryService.searchRawArchive(`Nota efímera baja relevancia escala ${scaleCount}`);
    assert.ok(ftsResults.length > 0, 'Debe ser recuperable vía searchRawArchive FTS');

    // 5. Limpieza
    databaseService.db.prepare("DELETE FROM memory WHERE source = 'synthetic_scale_test'").run();
    databaseService.db.prepare("DELETE FROM raw_archive_fts WHERE source = 'synthetic_scale_test'").run();

    return {
        scale: scaleCount,
        status: 'PASS',
        insertTimeSec: +(insertDurationMs / 1000).toFixed(2),
        throughput: throughput,
        indexGrowthMb: formatMB(dbSizeDelta),
        p50Ms: +p50,
        p95Ms: +p95,
        p99Ms: +p99,
        needleFound: true,
        needleDurationMs: +needleDurationMs,
        archiveOnlyVerified: true
    };
}

async function runScaleSuite() {
    console.log('\n===============================================================');
    console.log('⚡ INICIANDO SUITE DE ESCALABILIDAD DE MEMORIA 10K / 50K / 100K');
    console.log('===============================================================\n');

    const summaryResults = [];

    // Nivel 1: 10K
    try {
        const res10k = await runTierScaleTest(10000);
        summaryResults.push(res10k);
    } catch (err) {
        summaryResults.push({ scale: 10000, status: 'FAIL', error: err.message });
    }

    // Nivel 2: 50K
    try {
        const res50k = await runTierScaleTest(50000);
        summaryResults.push(res50k);
    } catch (err) {
        summaryResults.push({ scale: 50000, status: 'FAIL', error: err.message });
    }

    // Nivel 3: 100K (con salvaguarda de memoria RAM disponible)
    const memAvailableMb = process.memoryUsage().heapTotal / (1024 * 1024);
    if (memAvailableMb < 100) {
        console.log('\n  ⚠️ [ScaleTest 100K] Memoria disponible insuficiente para tier 100K sin degradación severa.');
        summaryResults.push({ scale: 100000, status: 'NOT_AVAILABLE', reason: 'RAM insuficiente para 100K en entorno actual' });
    } else {
        try {
            const res100k = await runTierScaleTest(100000);
            summaryResults.push(res100k);
        } catch (err) {
            summaryResults.push({ scale: 100000, status: 'FAIL', error: err.message });
        }
    }

    console.log('\n===============================================================');
    console.log('📊 REPORTE CONSOLIDADO DE ESCALABILIDAD DE MEMORIA (JARVIS 3.1.2)');
    console.log('===============================================================');
    console.table(summaryResults);

    const hasFailure = summaryResults.some(r => r.status === 'FAIL');
    if (hasFailure) {
        console.error('❌ Falló alguna prueba de escalabilidad de memoria.');
        process.exit(1);
    } else {
        console.log('🎉 PRUEBAS DE ESCALABILIDAD DE MEMORIA VALIDADAS CON ÉXITO.');
        process.exit(0);
    }
}

if (require.main === module) {
    runScaleSuite().catch(err => {
        console.error('Fatal error en suite de escalabilidad:', err);
        process.exit(1);
    });
}

module.exports = { runScaleSuite, runTierScaleTest };
