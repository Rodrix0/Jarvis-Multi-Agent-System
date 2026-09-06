/**
 * Test Suite para el Ítem 18: Memoria con Importancia y Triaje (memoryImportanceService.js)
 * Verifica:
 *   1. Evaluación universal de importancia (0.0 a 1.0) en múltiples dominios.
 *   2. Triaje de charlas triviales y ruido -> DISCARD (<= 0.25).
 *   3. Triaje de eventos y tareas transitorias -> EPISÓDICA (0.26 - 0.70 con TTL).
 *   4. Triaje de hechos inmutables, hardware e identidad -> PERMANENTE (0.71 - 1.00).
 *   5. Integración con memoryService: descarte sin escribir en DB y ascenso a CORE.
 */

const memoryImportanceService = require('../services/memory/memoryImportanceService');
const memoryService = require('../services/memory/memoryService');
const databaseService = require('../services/persistence/databaseService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 18 - MEMORIA CON IMPORTANCIA ===\n');
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

    // 1. Charlas Triviales y Ruido (DISCARD)
    console.log('--- Test 1: Triaje de Charlas Triviales y Ruido (DISCARD) ---');
    const trivialStatements = [
        'Hoy tengo sueño',
        'Qué calor hace hoy',
        'jajaja gracias amigo',
        'estoy comiendo una pizza',
        'dale ok listo'
    ];

    for (const text of trivialStatements) {
        const triage = memoryImportanceService.triageMemory(text);
        assert(triage.action === 'DISCARD', `"${text}" clasificado como DISCARD`);
        assert(triage.importance <= 0.25, `Importancia de "${text}" es baja (${triage.importance})`);
    }

    // 2. Recuerdos Episódicos y Transitorios (EPISODIC con TTL)
    console.log('\n--- Test 2: Recuerdos Episódicos Multidominio (EPISODIC con TTL) ---');
    const episodicStatements = [
        { text: 'El jueves tengo que llevar el auto al taller', domain: 'Hogar/Agenda' },
        { text: 'Comprar café y yerba en el supermercado', domain: 'Compras' },
        { text: 'El bug de login dio error 404 en la consola', domain: 'Desarrollo' },
        { text: 'Estoy viendo el capitulo 4 de la serie', domain: 'Entretenimiento' }
    ];

    for (const item of episodicStatements) {
        const triage = memoryImportanceService.triageMemory(item.text);
        assert(triage.action === 'EPISODIC', `[${item.domain}] "${item.text}" clasificado como EPISODIC`);
        assert(triage.importance > 0.25 && triage.importance <= 0.70, `Importancia en rango episódico (${triage.importance})`);
        assert(triage.expiresAt !== null && triage.ttlDays > 0, `Asigna TTL de expiración (${triage.ttlDays} días)`);
    }

    // 3. Hechos Críticos, Hardware e Identidad (PERMANENT / CORE)
    console.log('\n--- Test 3: Hechos Críticos e Inmutables Multidominio (PERMANENT) ---');
    const permanentStatements = [
        { text: 'Mi TV es AIWA 4K de 55 pulgadas', domain: 'Hardware' },
        { text: 'El backend usa PostgreSQL en puerto 5432', domain: 'Arquitectura' },
        { text: 'Soy alérgico a la penicilina y mariscos', domain: 'Salud' },
        { text: 'Mi cuenta bancaria en Banco Galicia es 4022-1234', domain: 'Finanzas' },
        { text: 'Mi DNI es 40.123.456', domain: 'Identidad' },
        { text: 'Recordá siempre que el servidor corre en Node 24', domain: 'Mandato explícito' }
    ];

    for (const item of permanentStatements) {
        const triage = memoryImportanceService.triageMemory(item.text);
        assert(triage.action === 'PERMANENT', `[${item.domain}] "${item.text}" clasificado como PERMANENT`);
        assert(triage.importance >= 0.75, `Importancia alta (${triage.importance})`);
        assert(triage.tier === 'CORE', 'Tier asignado es CORE');
        assert(triage.expiresAt === null, 'Sin expiración (permanente de por vida)');
    }

    // 4. Integración Directa con memoryService.addMemory
    console.log('\n--- Test 4: Integración y Prevención de Basura en Base de Datos ---');
    // Limpieza previa para garantizar idempotencia
    databaseService.db.prepare("DELETE FROM memory WHERE value LIKE '%Hoy tengo sueño%' OR key = 'device_tv_brand'").run();

    // Caso A: Descarte de dato trivial
    const discardRes = memoryService.addMemory({
        value: 'Hoy tengo sueño y fiaca'
    });
    assert(discardRes.ok === true && discardRes.discarded === true, 'memoryService descartó el dato trivial');
    assert(discardRes.action === 'DISCARD', 'Acción reportada es DISCARD');

    // Verificar que NO se insertó en la base de datos
    const dbCheckTrivial = databaseService.db.prepare("SELECT * FROM memory WHERE value LIKE '%Hoy tengo sueño%'").all();
    assert(dbCheckTrivial.length === 0, 'Cero contaminación en DB: el dato trivial no fue insertado');

    // Caso B: Guardado de dato permanente (elevación a CORE)
    const permanentRes = memoryService.addMemory({
        key: 'device_tv_brand',
        value: 'Mi TV es AIWA'
    });
    assert(permanentRes.ok === true && !permanentRes.discarded, 'memoryService guardó el dato permanente');
    assert(permanentRes.tier === 'CORE', 'Elevó automáticamente el tier a CORE');
    assert(permanentRes.importance >= 0.85, 'Importancia alta asignada');

    // Verificar en DB
    const dbCheckPermanent = databaseService.db.prepare("SELECT * FROM memory WHERE key = 'device_tv_brand'").get();
    assert(dbCheckPermanent && dbCheckPermanent.tier === 'CORE', 'Dato permanente guardado con tier CORE en base de datos');
    assert(dbCheckPermanent.expires_at === null, 'Dato permanente no tiene fecha de expiración');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de memory importance:', err);
    process.exit(1);
});
