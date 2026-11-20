/**
 * Test Suite: Ítem 20 - Entidades Persistentes (Knowledge Graph & Entity Resolution Engine)
 */

const assert = require('assert');
const entityGraphService = require('../services/memory/entityGraphService');
const memoryService = require('../services/memory/memoryService');
const databaseService = require('../services/persistence/databaseService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 20 - ENTIDADES PERSISTENTES (KNOWLEDGE GRAPH) ===\n');
    let passed = 0;
    let failed = 0;

    // Limpieza de entidades de prueba residuales para garantizar idempotencia
    try {
        databaseService.db.prepare("DELETE FROM graph_relations WHERE object_id LIKE '%finanzas%' OR object_id LIKE '%test%'").run();
        databaseService.db.prepare("DELETE FROM graph_entities WHERE id LIKE '%finanzas%' OR id LIKE '%test%'").run();
    } catch (_) {}

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
    // BLOQUE 1: Esquema de Grafo y Nodos/Aristas Semilla en SQLite
    // -------------------------------------------------------------
    console.log('--- Test 1: Verificación de Esquema y Datos Semilla en SQLite ---');

    test('Entidad Rodri existe y tiene tipo person', () => {
        const rodri = entityGraphService.getEntity('person:rodri');
        assert.ok(rodri, 'Rodri debe existir en SQLite');
        assert.strictEqual(rodri.name, 'Rodrigo');
        assert.strictEqual(rodri.type, 'person');
        assert.ok(rodri.aliases.includes('rodri'));
    });

    test('Entidad TV AIWA existe con atributos de control', () => {
        const tv = entityGraphService.getEntity('device:tv_aiwa');
        assert.ok(tv, 'TV AIWA debe existir');
        assert.strictEqual(tv.attributes.brand, 'AIWA');
        assert.strictEqual(tv.attributes.controllable, true);
        assert.strictEqual(tv.attributes.gender, 'feminine');
    });

    test('Entidades de Proyectos (JARVIS y Horror Game) existen', () => {
        const jarvis = entityGraphService.getEntity('project:jarvis');
        const horror = entityGraphService.getEntity('project:horror_game');
        assert.ok(jarvis, 'JARVIS debe existir');
        assert.ok(horror, 'Horror Game debe existir');
        assert.strictEqual(horror.attributes.genre, 'horror');
    });

    test('Entidades de Infraestructura (Ollama, BroadLink, SQLite, Windows) existen', () => {
        assert.ok(entityGraphService.getEntity('service:ollama'), 'Ollama debe existir');
        assert.ok(entityGraphService.getEntity('hardware:broadlink_rm4'), 'BroadLink debe existir');
        assert.ok(entityGraphService.getEntity('database:sqlite'), 'SQLite debe existir');
        assert.ok(entityGraphService.getEntity('system:windows_pc'), 'Windows PC debe existir');
    });

    test('Relaciones semilla del grafo existen en SQLite', () => {
        const rodriOwns = entityGraphService.getRelations({ subject_id: 'person:rodri', predicate: 'owns' });
        assert.ok(rodriOwns.some(r => r.object_id === 'device:tv_aiwa'), 'Rodri owns TV AIWA');

        const rodriDevs = entityGraphService.getRelations({ subject_id: 'person:rodri', predicate: 'develops' });
        assert.ok(rodriDevs.some(r => r.object_id === 'project:jarvis'), 'Rodri develops JARVIS');
        assert.ok(rodriDevs.some(r => r.object_id === 'project:horror_game'), 'Rodri develops Horror Game');

        const jarvisUses = entityGraphService.getRelations({ subject_id: 'project:jarvis', predicate: 'uses' });
        assert.ok(jarvisUses.some(r => r.object_id === 'service:ollama'), 'JARVIS uses Ollama');
        assert.ok(jarvisUses.some(r => r.object_id === 'hardware:broadlink_rm4'), 'JARVIS uses BroadLink');
        assert.ok(jarvisUses.some(r => r.object_id === 'database:sqlite'), 'JARVIS uses SQLite');

        const broadlinkControls = entityGraphService.getRelations({ subject_id: 'hardware:broadlink_rm4', predicate: 'controls' });
        assert.ok(broadlinkControls.some(r => r.object_id === 'device:tv_aiwa'), 'BroadLink controls TV AIWA');
    });

    // -------------------------------------------------------------
    // BLOQUE 2: Resolución de Alias y Nombres Exactos
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Resolución de Alias y Nombres Exactos ---');

    test('Resolución de "la tele" -> device:tv_aiwa', () => {
        const res = entityGraphService.resolveReference('la tele');
        assert.ok(res, 'Debe resolver "la tele"');
        assert.strictEqual(res.entity.id, 'device:tv_aiwa');
        assert.ok(res.confidence >= 0.85);
    });

    test('Resolución de "el televisor" -> device:tv_aiwa', () => {
        const res = entityGraphService.resolveReference('el televisor');
        assert.ok(res, 'Debe resolver "el televisor"');
        assert.strictEqual(res.entity.id, 'device:tv_aiwa');
    });

    test('Resolución de "el juego" -> project:horror_game', () => {
        const res = entityGraphService.resolveReference('el juego');
        assert.ok(res, 'Debe resolver "el juego"');
        assert.strictEqual(res.entity.id, 'project:horror_game');
    });

    test('Resolución de "la compu" -> system:windows_pc', () => {
        const res = entityGraphService.resolveReference('la compu');
        assert.ok(res, 'Debe resolver "la compu"');
        assert.strictEqual(res.entity.id, 'system:windows_pc');
    });

    test('Resolución de "el asistente" -> project:jarvis', () => {
        const res = entityGraphService.resolveReference('el asistente');
        assert.ok(res, 'Debe resolver "el asistente"');
        assert.strictEqual(res.entity.id, 'project:jarvis');
    });

    // -------------------------------------------------------------
    // BLOQUE 3: Resolución de Pronombres Clíticos y Acciones
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Resolución de Pronombres Clíticos y Acciones de Control ---');

    test('Resolución de "prendela" -> TV AIWA con acción de encendido', () => {
        const res = entityGraphService.resolveReference('prendela');
        assert.ok(res, 'Debe resolver "prendela"');
        assert.strictEqual(res.entity.id, 'device:tv_aiwa');
        assert.strictEqual(res.matchType, 'clitic_pronoun_action');
        assert.strictEqual(res.detectedAction, 'power_on');
        assert.strictEqual(res.suggestedAction, 'tv.power');
        assert.ok(res.confidence >= 0.95);
    });

    test('Resolución de "apagala" -> TV AIWA con acción de apagado', () => {
        const res = entityGraphService.resolveReference('apagala');
        assert.ok(res, 'Debe resolver "apagala"');
        assert.strictEqual(res.entity.id, 'device:tv_aiwa');
        assert.strictEqual(res.detectedAction, 'power_off');
    });

    test('Resolución de "subila" -> TV AIWA con control de volumen', () => {
        const res = entityGraphService.resolveReference('subila');
        assert.ok(res, 'Debe resolver "subila"');
        assert.strictEqual(res.entity.id, 'device:tv_aiwa');
        assert.strictEqual(res.matchType, 'clitic_pronoun_audio');
        assert.strictEqual(res.detectedAction, 'volume_up');
    });

    // -------------------------------------------------------------
    // BLOQUE 4: Desambiguación Contextual Semántica
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Desambiguación Contextual Semántica ("el proyecto") ---');

    test('"el proyecto" en contexto de videojuegos -> project:horror_game', () => {
        const res = entityGraphService.resolveReference('el proyecto', {
            text: 'Estuve optimizando los shaders y las luces en Unity para la escena del bosque'
        });
        assert.ok(res, 'Debe resolver la ambigüedad');
        assert.strictEqual(res.entity.id, 'project:horror_game');
        assert.strictEqual(res.matchType, 'contextual_disambiguation');
        assert.ok(res.disambiguatedFrom.includes('JARVIS'));
    });

    test('"el proyecto" en contexto de inteligencia artificial -> project:jarvis', () => {
        const res = entityGraphService.resolveReference('el proyecto', {
            text: 'Revisemos los agentes de node y la conexión con el backend de Ollama'
        });
        assert.ok(res, 'Debe resolver la ambigüedad');
        assert.strictEqual(res.entity.id, 'project:jarvis');
        assert.strictEqual(res.matchType, 'contextual_disambiguation');
        assert.ok(res.disambiguatedFrom.includes('Horror Game'));
    });

    test('"el proyecto" con activeProjectId explícito -> coincide directamente', () => {
        const res = entityGraphService.resolveReference('el proyecto', {
            activeProjectId: 'horror_game'
        });
        assert.ok(res);
        assert.strictEqual(res.entity.id, 'project:horror_game');
    });

    // -------------------------------------------------------------
    // BLOQUE 5: Navegación de Grafo y Rutas Multi-Salto
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Navegación de Grafo y Rutas Multi-Salto (BFS) ---');

    test('getNeighbors: Proyectos que desarrolla Rodri', () => {
        const neighbors = entityGraphService.getNeighbors('person:rodri', { predicate: 'develops' });
        assert.strictEqual(neighbors.length, 2);
        const names = neighbors.map(n => n.entity.name);
        assert.ok(names.includes('JARVIS'));
        assert.ok(names.includes('Horror Game'));
    });

    test('getNeighbors: Qué utiliza JARVIS', () => {
        const neighbors = entityGraphService.getNeighbors('project:jarvis', { predicate: 'uses' });
        assert.strictEqual(neighbors.length, 3);
        const names = neighbors.map(n => n.entity.name);
        assert.ok(names.includes('Ollama'));
        assert.ok(names.includes('BroadLink RM4'));
        assert.ok(names.includes('SQLite'));
    });

    test('findPath: Ruta de control entre JARVIS y TV AIWA (2 saltos)', () => {
        const path = entityGraphService.findPath('project:jarvis', 'device:tv_aiwa');
        assert.ok(path.found, 'Debe encontrar ruta entre JARVIS y la tele');
        assert.strictEqual(path.depth, 2, 'Ruta debe tener exactamente 2 saltos');
        assert.strictEqual(path.path[0].id, 'project:jarvis');
        assert.strictEqual(path.path[1].id, 'hardware:broadlink_rm4');
        assert.strictEqual(path.path[2].id, 'device:tv_aiwa');
        assert.ok(path.summary.includes('JARVIS'));
        assert.ok(path.summary.includes('BroadLink RM4'));
        assert.ok(path.summary.includes('TV AIWA'));
    });

    test('findPath: Ruta entre Rodri y SQLite', () => {
        const path = entityGraphService.findPath('person:rodri', 'database:sqlite');
        assert.ok(path.found, 'Debe encontrar ruta entre Rodri y SQLite');
        assert.strictEqual(path.depth, 2); // Rodri -> develops -> JARVIS -> uses -> SQLite
        assert.strictEqual(path.path[1].id, 'project:jarvis');
    });

    // -------------------------------------------------------------
    // BLOQUE 6: Extracción Dinámica e Integración con Memoria
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Extracción Dinámica de Tripletas e Integración ---');

    test('Extracción de posesión: "Tengo una cafetera Nespresso"', () => {
        const triples = entityGraphService.extractTriplesFromText('Tengo una cafetera Nespresso');
        assert.ok(triples.length > 0);
        assert.strictEqual(triples[0].predicate, 'owns');
        assert.ok(triples[0].object_name.includes('cafetera'));
    });

    test('Extracción de desarrollo: "Estoy programando un juego de carreras"', () => {
        const triples = entityGraphService.extractTriplesFromText('Estoy programando un juego de carreras');
        assert.ok(triples.length > 0);
        assert.strictEqual(triples[0].predicate, 'develops');
        assert.ok(triples[0].object_name.includes('juego de carreras'));
    });

    test('Integración: memoryService.addMemory extrae y persiste en el grafo', () => {
        const memRes = memoryService.addMemory({
            type: 'SEMANTIC',
            tier: 'NORMAL',
            key: 'test_dev_app_finanzas',
            value: 'Desarrollo una app de finanzas personales en Flutter'
        });
        assert.ok(memRes.ok, 'Memoria debe guardarse');

        // Verificar que se haya creado la relación en el grafo
        const rels = entityGraphService.getRelations({ subject_id: 'person:rodri', predicate: 'develops' });
        const finRel = rels.find(r => r.object_id.includes('finanzas'));
        assert.ok(finRel, 'El grafo debe contener la nueva arista de desarrollo');

        // Limpiar entidad y memoria de prueba
        if (finRel) {
            entityGraphService.deleteEntity(finRel.object_id);
        }
        databaseService.db.prepare("DELETE FROM memory WHERE key = 'test_dev_app_finanzas'").run();
    });

    // -------------------------------------------------------------
    // BLOQUE 7: Resumen de Contexto para LLM
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Resumen Contextual para LLM ---');

    test('getGraphContextSummary genera resumen estructurado y conciso', () => {
        const summary = entityGraphService.getGraphContextSummary('person:rodri');
        assert.ok(summary.includes('[KNOWLEDGE GRAPH: Rodrigo]'), 'Debe titular el grafo');
        assert.ok(summary.includes('owns: TV AIWA'), 'Debe listar posesiones');
        assert.ok(summary.includes('develops: JARVIS, Horror Game'), 'Debe listar desarrollos');
        assert.ok(summary.includes('[JARVIS Ecosystem]:'), 'Debe resumir el ecosistema de JARVIS');
    });

    console.log(`\n=== RESULTADO FINAL: ${passed}/${passed + failed} PRUEBAS APROBADAS ===`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal ejecutando suite:', err);
    process.exit(1);
});
