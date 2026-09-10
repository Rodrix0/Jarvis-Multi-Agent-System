/**
 * TEST SUITE: Universal Memory Service (Fase D: Secciones 10-31)
 * Verifica:
 *   1. Las 10 capas de memoria con almacenamiento multidominio.
 *   2. Registro inmutable en raw_archive.jsonl con metadatos de procedencia.
 *   3. Triaje y filtrado de ruido (descarte de trivialidades).
 *   4. Resolución de conflictos por afirmación explícita (supersede).
 *   5. Controles de privacidad (pause, resume, inspect, delete).
 *   6. Búsqueda híbrida universal con desglose explicable.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const universalMemory = require('../services/memory/universalMemoryService');
const databaseService = require('../services/persistence/databaseService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Universal Memory Service (Fase D)');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    async function testAsync(name, fn) {
        total++;
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    // 1. Almacenamiento multidominio universal (Semántica, Hardware, Finanzas, Salud)
    test('Almacena recuerdos multidominio con triaje y procedencia adecuada', () => {
        const r1 = universalMemory.storeMemory({
            tier: 'SEMANTIC',
            key: 'hardware_tv',
            value: 'Mi tele principal es una AIWA 4K de 55 pulgadas en el living',
            metadata: { actor: 'user' }
        });
        assert.ok(r1.ok, 'Debe guardar recuerdo de TV');
        assert.strictEqual(r1.tier, 'SEMANTIC');
        assert.ok(r1.importance >= 0.85, 'Importancia de hardware debe ser alta');

        const r2 = universalMemory.storeMemory({
            tier: 'SEMANTIC',
            key: 'salud_alergia',
            value: 'Soy alérgico a la penicilina y a los mariscos',
            metadata: { actor: 'user' }
        });
        assert.ok(r2.ok);
        assert.strictEqual(r2.importance, 1.0, 'Salud crítica debe tener importancia 1.0');
    });

    // 2. Triaje de Ruido: Descarte de trivialidades transitorias
    test('Descarta automáticamente ruido y estados transitorios (0.00-0.25)', () => {
        const noise = universalMemory.storeMemory({
            tier: 'EPISODIC',
            value: 'tengo mucho sueño hoy'
        });
        assert.ok(noise.ok);
        assert.strictEqual(noise.tier, 'ARCHIVE_ONLY');
        const rows = databaseService.db.prepare('SELECT id FROM memory WHERE value = ?').all('tengo mucho sueño hoy');
        assert.strictEqual(rows.length, 0);
        assert.strictEqual(noise.action, 'ARCHIVE_ONLY');
    });

    // 3. Verificación de Raw Archive inmutable JSONL
    test('Registra auditoría append-only en raw_archive.jsonl', () => {
        const rawPath = path.join(__dirname, '..', 'data', 'memory', 'raw_archive.jsonl');
        assert.ok(fs.existsSync(rawPath), 'raw_archive.jsonl debe existir');
        const lines = fs.readFileSync(rawPath, 'utf8').trim().split('\n');
        assert.ok(lines.length > 0, 'raw_archive.jsonl debe tener entradas');
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        assert.ok(lastEntry.id);
        assert.ok(lastEntry.timestamp);
        assert.ok(lastEntry.provenance);
    });

    // 4. Resolución de Conflictos (Supersede)
    test('Resuelve conflictos actualizando el estado de la memoria antigua a SUPERSEDED', () => {
        universalMemory.storeMemory({
            tier: 'PREFERENCE',
            key: 'pref_bebida',
            value: 'Me gusta el café con azúcar'
        });

        universalMemory.storeMemory({
            tier: 'PREFERENCE',
            key: 'pref_bebida',
            value: 'Ahora tomo el café sin azúcar, totalmente amargo'
        });

        const inspected = universalMemory.inspectMemory({ filter: 'pref_bebida' });
        const active = inspected.records.filter(r => r.status === 'ACTIVE');
        const superseded = inspected.records.filter(r => r.status === 'SUPERSEDED');

        assert.strictEqual(active.length, 1, 'Solo debe haber 1 recuerdo activo');
        assert.ok(active[0].value.includes('amargo'), 'El recuerdo activo debe ser la última versión');
        assert.ok(superseded.length >= 1, 'El recuerdo viejo debe estar SUPERSEDED');
    });

    // 5. Controles de Privacidad (pause, resume, inspect, delete)
    test('Controles de privacidad: pausa y reanudación de memoria', () => {
        universalMemory.pauseMemory();
        assert.strictEqual(universalMemory.isMemoryPaused(), true);

        const blocked = universalMemory.storeMemory({
            tier: 'SEMANTIC',
            value: 'Este dato no debe guardarse mientras esté pausado'
        });
        assert.strictEqual(blocked.ok, false);
        assert.strictEqual(blocked.paused, true);

        universalMemory.resumeMemory();
        assert.strictEqual(universalMemory.isMemoryPaused(), false);
    });

    // 6. Eliminación Selectiva (memory.delete)
    test('Eliminación selectiva por ID o patrón clave', () => {
        const created = universalMemory.storeMemory({
            tier: 'EPISODIC',
            key: 'temp_to_delete',
            value: 'Dato efímero para prueba de eliminación'
        });
        assert.ok(created.ok);

        const delRes = universalMemory.deleteMemory(created.id);
        assert.ok(delRes.ok);
        assert.strictEqual(delRes.affected, 1);

        const check = universalMemory.inspectMemory({ filter: created.id });
        assert.strictEqual(check.records[0].status, 'SUPERSEDED');
    });

    // 7. Búsqueda Universal Híbrida con Re-ranking explicable
    await testAsync('Búsqueda universal híbrida clasifica correctamente y entrega breakdown', async () => {
        const results = await universalMemory.queryUniversal('que tele tengo en el living', { limit: 3 });
        assert.ok(results.length > 0, 'Debe devolver resultados relevantes');
        const top = results[0];
        assert.ok(top.text.includes('AIWA'), 'El recuerdo de AIWA debe figurar arriba');
        assert.ok(top.score > 0, 'Puntaje híbrido debe ser positivo');
        assert.ok(top.breakdown, 'Debe incluir breakdown explicable');
        assert.strictEqual(typeof top.breakdown.textMatch, 'number');
        assert.strictEqual(typeof top.breakdown.entityMatch, 'number');
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE UNIVERSAL MEMORY PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Universal Memory:', err);
    process.exit(1);
});
