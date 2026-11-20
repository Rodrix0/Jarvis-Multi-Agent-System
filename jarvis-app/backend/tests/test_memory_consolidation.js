/**
 * Test Suite para el Ítem 19: Consolidación de Recuerdos (memoryConsolidationService.js)
 * Verifica:
 *   1. Detección y agrupamiento semántico (Semantic Clustering) de recuerdos afines.
 *   2. Consolidación multidominio universal (Desarrollo, Finanzas, Universidad, Creatividad).
 *   3. Preservación inmutable de vínculos (Trazabilidad hacia IDs originales).
 *   4. Cambio de estado a 'CONSOLIDATED' de los recuerdos originales sin pérdida de datos.
 *   5. Estimación y métricas de compresión / ahorro de tokens.
 *   6. Reversibilidad y Rollback de una consolidación a estado 'ACTIVE'.
 */

const memoryConsolidationService = require('../services/memory/memoryConsolidationService');
const databaseService = require('../services/persistence/databaseService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 19 - CONSOLIDACION DE RECUERDOS ===\n');
    let passed = 0;
    let total = 0;

    function assert(condition, message) {
        total++;
        if (condition) {
            console.log(`  [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${message}`);
        }
    }

    // 1. Detección y Agrupamiento Semántico Multidominio
    console.log('--- Test 1: Agrupamiento Semántico Multidominio ---');
    const mockMemories = [
        // Dominio: Desarrollo / Docker
        { id: 'mem-d1', value: 'Rodri usa Docker para desplegar contenedores en su notebook' },
        { id: 'mem-d2', value: 'Rodri configura Docker Compose en puerto 5432' },
        { id: 'mem-d3', value: 'El contenedor de PostgreSQL corre en Docker' },

        // Dominio: Finanzas / Pagos
        { id: 'mem-f1', value: 'Pago por Netflix suscripcion mensual 4000 pesos' },
        { id: 'mem-f2', value: 'Pago por Spotify Premium 2500 pesos' },

        // Dominio: Universidad / Algoritmos
        { id: 'mem-u1', value: 'Rinde final de Algoritmos y Estructuras de Datos el 14 de Diciembre' },
        { id: 'mem-u2', value: 'El examen final de Algoritmos es en el Aula 302' },

        // Dominio: Creatividad / Unity (Ejemplo del usuario)
        { id: 'mem-g1', value: 'Rodri usa Unity para crear juegos' },
        { id: 'mem-g2', value: 'Rodri desarrolla juego narrativo de terror en Unity' },
        { id: 'mem-g3', value: 'El juego de Unity esta ambientado en un bosque y camping' }
    ];

    const clusters = memoryConsolidationService.findMemoryClusters(mockMemories);
    assert(clusters.length >= 3, `Identificó ${clusters.length} agrupaciones semánticas temáticas`);
    
    const dockerCluster = clusters.find(c => c.topic === 'docker');
    assert(dockerCluster && dockerCluster.memories.length === 3, 'Agrupación Docker contiene 3 recuerdos afines');

    const unityCluster = clusters.find(c => c.topic === 'unity');
    assert(unityCluster && unityCluster.memories.length === 3, 'Agrupación Unity contiene 3 recuerdos afines');

    // 2. Síntesis y Calidad de Compresión
    console.log('\n--- Test 2: Síntesis de Conocimiento de Alta Densidad ---');
    const synthesizedDocker = memoryConsolidationService.synthesizeCluster('docker', dockerCluster.memories);
    assert(synthesizedDocker.domain === 'Desarrollo / Infraestructura', 'Identifica dominio Desarrollo / Infraestructura');
    assert(synthesizedDocker.summary.includes('Docker') && synthesizedDocker.summary.includes('PostgreSQL'), 'Síntesis integra Docker y PostgreSQL');
    assert(synthesizedDocker.tokensSaved > 0, `Ahorro estimado de tokens: ${synthesizedDocker.tokensSaved} tokens`);

    const synthesizedUnity = memoryConsolidationService.synthesizeCluster('unity', unityCluster.memories);
    assert(synthesizedUnity.domain === 'Videojuegos / Creatividad', 'Identifica dominio Videojuegos / Creatividad');
    assert(synthesizedUnity.summary.includes('terror') && synthesizedUnity.summary.includes('bosque'), 'Síntesis captura terror y bosque');

    // 3. Ejecución del Proceso de Consolidación con Persistencia en DB
    console.log('\n--- Test 3: Ejecución de Consolidación y Preservación de Vínculos ---');
    // Insertar recuerdos de prueba en SQLite para verificar el ciclo completo
    const now = new Date().toISOString();
    databaseService.db.prepare("DELETE FROM memory WHERE id LIKE 'test-cons-%'").run();
    databaseService.db.prepare("DELETE FROM consolidated_memories WHERE id LIKE 'test-job-%'").run();

    const dbTestMemories = [
        { id: 'test-cons-1', value: 'Rodri usa Docker para pruebas' },
        { id: 'test-cons-2', value: 'Rodri ejecuta PostgreSQL en Docker' }
    ];
    for (const m of dbTestMemories) {
        databaseService.db.prepare(`
            INSERT INTO memory (id, type, tier, key, value, source, confidence, created_at, status)
            VALUES (?, 'SEMANTIC', 'NORMAL', 'test_key', ?, 'user', 1.0, ?, 'ACTIVE')
        `).run(m.id, m.value, now);
    }

    const jobResult = memoryConsolidationService.runConsolidationJob({
        candidates: dbTestMemories
    });

    assert(jobResult.ok === true, 'Trabajo de consolidación completado con éxito');
    assert(jobResult.consolidationsCreated >= 1, 'Creó al menos 1 consolidación persistente');

    // Verificar que los recuerdos originales pasaron a 'CONSOLIDATED'
    const orig1 = databaseService.db.prepare("SELECT * FROM memory WHERE id = 'test-cons-1'").get();
    const orig2 = databaseService.db.prepare("SELECT * FROM memory WHERE id = 'test-cons-2'").get();
    assert(orig1.status === 'CONSOLIDATED', 'Recuerdo 1 marcado como CONSOLIDATED (no borrado)');
    assert(orig2.status === 'CONSOLIDATED', 'Recuerdo 2 marcado como CONSOLIDATED (no borrado)');

    // 4. Verificación de Auditoría y Trazabilidad
    console.log('\n--- Test 4: Auditoría y Linaje en Base de Datos ---');
    const consRecord = jobResult.consolidations[0];
    const storedCons = databaseService.db.prepare("SELECT * FROM consolidated_memories WHERE id = ?").get(consRecord.consolidationId);
    assert(storedCons !== null, 'Registro de consolidación almacenado en SQLite');
    const sourceIds = JSON.parse(storedCons.source_ids_json);
    assert(sourceIds.includes('test-cons-1') && sourceIds.includes('test-cons-2'), 'Trazabilidad: contiene los IDs originales exactos');

    // 5. Reversibilidad y Rollback de Consolidación
    console.log('\n--- Test 5: Reversibilidad / Rollback de Consolidación ---');
    const rollbackRes = memoryConsolidationService.rollbackConsolidation(consRecord.consolidationId);
    assert(rollbackRes.ok === true, 'Operación de rollback de consolidación exitosa');
    assert(rollbackRes.restoredCount === 2, 'Restauró exactamente los 2 recuerdos originales');

    const origRestored = databaseService.db.prepare("SELECT * FROM memory WHERE id = 'test-cons-1'").get();
    assert(origRestored.status === 'ACTIVE', 'Recuerdo original restaurado a estado ACTIVE');

    // Limpieza post-test
    databaseService.db.prepare("DELETE FROM memory WHERE id LIKE 'test-cons-%' OR id LIKE 'mem-cons-%'").run();
    databaseService.db.prepare("DELETE FROM consolidated_memories WHERE id = ?").run(consRecord.consolidationId);

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de memory consolidation:', err);
    process.exit(1);
});
