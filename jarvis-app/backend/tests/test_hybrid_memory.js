/**
 * Test Suite para el Ítem 17: Memoria Híbrida (hybridMemoryService.js)
 * Verifica:
 *   1. Ponderación exacta de 5 factores (0.40, 0.25, 0.15, 0.10, 0.10 = 1.00).
 *   2. Caso de uso del usuario: "¿Qué cantidad de árboles tenía mi bosque?" -> "319 árboles".
 *   3. Decaimiento temporal suave de la recencia.
 *   4. Influencia de la importancia intrínseca (1.0 vs 0.1).
 *   5. Detección y emparejamiento de entidades críticas (números, nombres propios).
 *   6. Resiliencia y fallback transparente ante ausencia de vector.
 */

const hybridMemoryService = require('../services/memory/hybridMemoryService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 17 - MEMORIA HIBRIDA ===\n');
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

    // 1. Verificación de Ponderaciones Canónicas
    console.log('--- Test 1: Ponderaciones Canónicas de 5 Factores ---');
    const w = hybridMemoryService.defaultWeights;
    const sum = w.vector + w.textMatch + w.recency + w.importance + w.entityMatch;
    assert(Math.abs(sum - 1.0) < 0.0001, `La suma de pesos es exactamente 1.00 (obtenido: ${sum.toFixed(2)})`);
    assert(w.vector === 0.40, 'Vector similarity: 40%');
    assert(w.textMatch === 0.25, 'Text match: 25%');
    assert(w.recency === 0.15, 'Recency: 15%');
    assert(w.importance === 0.10, 'Importance: 10%');
    assert(w.entityMatch === 0.10, 'Entity match: 10%');

    // 2. Caso del Usuario: "¿Qué cantidad de árboles tenía mi bosque?"
    console.log('\n--- Test 2: Caso de Estudio: "¿Qué cantidad de árboles tenía mi bosque?" ---');
    const query = '¿Qué cantidad de árboles tenía mi bosque?';
    
    const candidates = [
        {
            id: 'c1',
            text: 'El mapa actual del bosque contiene 319 árboles en total en el terreno principal.',
            vectorScore: 0.88,
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // hace 2 horas
            importance: 0.90
        },
        {
            id: 'c2',
            text: 'En el bosque hay muchas rocas oscuras y un río que cruza el sendero.',
            vectorScore: 0.55,
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(), // hace 5 días
            importance: 0.60
        },
        {
            id: 'c3',
            text: 'Ayer comí una manzana roja en la cocina.',
            vectorScore: 0.08,
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
            importance: 0.20
        },
        {
            id: 'c4',
            text: 'Cantidad de horas dormidas esta noche: 7 horas.',
            vectorScore: 0.22,
            created_at: new Date().toISOString(),
            importance: 0.30
        }
    ];

    const results = await hybridMemoryService.searchHybrid(query, {
        candidates,
        limit: 4
    });

    assert(results.length === 4, 'Recuperó los 4 candidatos evaluados');
    assert(results[0].id === 'c1', 'El recuerdo sobre 319 árboles clasifica en el puesto #1');
    assert(results[0].score > 0.70, `Puntaje híbrido del ganador es alto: ${results[0].score}`);
    assert(results[0].breakdown.entityMatch === 1.0, 'Coincidencia de entidades de c1 es 100% (detecta bosque y árboles)');
    assert(results[0].breakdown.textMatch > 0.40, 'Coincidencia léxica significativa');

    // 3. Decaimiento Temporal (Recency)
    console.log('\n--- Test 3: Decaimiento Temporal (Recency Score) ---');
    const freshDate = new Date(Date.now() - 1000 * 60 * 30).toISOString(); // 30 min atrás
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(); // 90 días atrás

    const freshScore = hybridMemoryService.calculateRecency(freshDate);
    const oldScore = hybridMemoryService.calculateRecency(oldDate);

    assert(freshScore > 0.95, `Recuerdo fresco obtiene recencia alta: ${freshScore.toFixed(3)}`);
    assert(oldScore < 0.25, `Recuerdo de 90 días tiene recencia degradada: ${oldScore.toFixed(3)}`);
    assert(freshScore > oldScore, 'Recuerdo fresco supera claramente en recencia al antiguo');

    // 4. Ponderación por Importancia
    console.log('\n--- Test 4: Influencia de la Importancia ---');
    const highImpCandidate = { text: 'Mi TV es AIWA 4K', vectorScore: 0.5, importance: 1.0, created_at: freshDate };
    const lowImpCandidate = { text: 'Mi TV es AIWA 4K', vectorScore: 0.5, importance: 0.1, created_at: freshDate };

    const scoredHigh = hybridMemoryService.scoreCandidate('que tele tengo?', null, highImpCandidate);
    const scoredLow = hybridMemoryService.scoreCandidate('que tele tengo?', null, lowImpCandidate);

    assert(scoredHigh.score > scoredLow.score, `Importancia 1.0 (${scoredHigh.score}) supera a importancia 0.1 (${scoredLow.score})`);
    assert(scoredHigh.breakdown.importance === 1.0, 'Desglose de importancia refleja 1.0');

    // 5. Extracción y Emparejamiento de Entidades
    console.log('\n--- Test 5: Extracción y Emparejamiento de Entidades ---');
    const entitiesExtracted = hybridMemoryService.extractEntities('Hay 319 árboles en el mapa de Unity URP');
    assert(entitiesExtracted.includes('319'), 'Extrae número 319');
    assert(entitiesExtracted.includes('unity'), 'Extrae nombre propio Unity');
    assert(entitiesExtracted.includes('urp'), 'Extrae sigla técnica URP');
    assert(entitiesExtracted.includes('arboles'), 'Extrae sustantivo relevante árboles');

    const entityMatchScore = hybridMemoryService.calculateEntityMatch(
        'árboles en Unity',
        'Hay 319 árboles en el mapa de Unity'
    );
    assert(entityMatchScore === 1.0, 'Coincidencia total de entidades solicitadas (1.0)');

    // 6. Resiliencia y Fallback ante Ausencia de Vector
    console.log('\n--- Test 6: Resiliencia Dinámica sin Vector ---');
    const fallbackRes = hybridMemoryService.scoreCandidate(
        'árboles en el bosque',
        null, // Sin vector
        { text: 'Hay muchos árboles altos en el bosque', importance: 0.8, created_at: freshDate }
    );
    assert(!isNaN(fallbackRes.score) && fallbackRes.score > 0, `Genera puntaje válido sin vector: ${fallbackRes.score}`);
    assert(fallbackRes.breakdown.vector === 0.0, 'Vector reporta 0.0 limpiamente');
    assert(fallbackRes.breakdown.textMatch > 0.6, 'Texto y entidades asumen el peso principal');

    // 7. Universalidad Multidominio (Finanzas, Universidad, Hogar, Programación)
    console.log('\n--- Test 7: Universalidad Multidominio (Finanzas, Universidad, Hogar, Dev) ---');
    const multiDomainCandidates = [
        { id: 'fin', text: 'Factura de luz pagada en Banco Galicia: 15420 pesos.', importance: 0.9, created_at: freshDate },
        { id: 'facu', text: 'Final de Algoritmos y Estructuras de Datos el 14 de Diciembre en Aula 302.', importance: 0.95, created_at: freshDate },
        { id: 'hogar', text: 'Las llaves de repuesto del auto estan en el cajon derecho del escritorio.', importance: 0.8, created_at: freshDate },
        { id: 'dev', text: 'El backend de Jarvis usa Node.js 24 con SQLite nativo y puerto 3001.', importance: 0.85, created_at: freshDate }
    ];

    // Consulta de Finanzas
    const resFin = await hybridMemoryService.searchHybrid('cuanto pague de luz en galicia?', { candidates: multiDomainCandidates, limit: 1 });
    assert(resFin[0].id === 'fin', 'Recupera con éxito consulta de Finanzas');

    // Consulta de Universidad
    const resFacu = await hybridMemoryService.searchHybrid('cuando rindo el final de algoritmos?', { candidates: multiDomainCandidates, limit: 1 });
    assert(resFacu[0].id === 'facu', 'Recupera con éxito consulta de Universidad');

    // Consulta del Hogar
    const resHogar = await hybridMemoryService.searchHybrid('donde estan las llaves del auto?', { candidates: multiDomainCandidates, limit: 1 });
    assert(resHogar[0].id === 'hogar', 'Recupera con éxito consulta del Hogar');

    // Consulta de Programación
    const resDev = await hybridMemoryService.searchHybrid('que puerto usa el backend de jarvis?', { candidates: multiDomainCandidates, limit: 1 });
    assert(resDev[0].id === 'dev', 'Recupera con éxito consulta de Programación');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de hybrid memory:', err);
    process.exit(1);
});
