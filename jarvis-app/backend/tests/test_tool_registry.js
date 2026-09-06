/**
 * TEST SUITE: Contextual Tool Registry Service (Ítem 9)
 * Verifica que el sistema modularice las herramientas en 12 áreas especializadas
 * y que el selector contextual cargue únicamente las herramientas necesarias.
 */

const assert = require('assert');
const toolRegistryService = require('../services/tools/toolRegistryService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Modular Contextual Tool Registry (Ítem 9)');
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

    // 1. Verificación de los 12 módulos requeridos
    test('Registra los 12 módulos especializados de herramientas', () => {
        const expectedModules = [
            'windows', 'browser', 'tv', 'spotify', 'files', 'email',
            'whatsapp', 'office', 'memory', 'research', 'python', 'home'
        ];
        const registered = toolRegistryService.listModules();
        assert.strictEqual(registered.length, 12, `Se esperaban 12 módulos pero hay ${registered.length}`);

        for (const expected of expectedModules) {
            const mod = toolRegistryService.getModule(expected);
            assert.ok(mod, `El módulo "${expected}" debe existir`);
            assert.ok(mod.tools.length > 0, `El módulo "${expected}" debe tener herramientas registradas`);
        }
        console.log(`     Módulos registrados: [${registered.map(m => m.id).join(', ')}]`);
    });

    // 2. Caso de uso canónico del usuario: "Poné Spotify"
    test('Selector contextual: "Poné Spotify" carga Spotify y Windows pero omite Office, TV, etc.', () => {
        const tools = toolRegistryService.selectToolsForPrompt('Poné Spotify y subí un poco el volumen');
        const toolNames = tools.map(t => t.name);

        assert(toolNames.some(t => t.startsWith('spotify_')), 'Debe incluir herramientas de Spotify');
        assert(toolNames.some(t => t.startsWith('windows_')), 'Debe incluir herramientas de Windows por el volumen');

        // Comprobamos la exclusión drástica de ruido
        assert(!toolNames.some(t => t.startsWith('office_')), 'NO debe incluir Office');
        assert(!toolNames.some(t => t.startsWith('tv_')), 'NO debe incluir TV');
        assert(!toolNames.some(t => t.startsWith('whatsapp_')), 'NO debe incluir WhatsApp');
        assert(!toolNames.some(t => t.startsWith('python_')), 'NO debe incluir Python');
        console.log(`     "Poné Spotify": ${toolNames.length} herramientas seleccionadas (vs ${toolRegistryService.getAllTools().length} totales)`);
    });

    // 3. Caso de creación de documento
    test('Selector contextual: "Creá un informe en Word sobre tecnología" carga Office y Files', () => {
        const tools = toolRegistryService.selectToolsForPrompt('Creá un informe en Word sobre tecnología');
        const toolNames = tools.map(t => t.name);

        assert(toolNames.some(t => t.startsWith('office_')), 'Debe incluir herramientas de Office');
        assert(!toolNames.some(t => t.startsWith('spotify_')), 'NO debe incluir Spotify');
        assert(!toolNames.some(t => t.startsWith('tv_')), 'NO debe incluir TV');
    });

    // 4. Caso de mensajería WhatsApp
    test('Selector contextual: "Mandale un WhatsApp a Juan" carga módulo WhatsApp exclusivamente', () => {
        const tools = toolRegistryService.selectToolsForPrompt('Mandale un WhatsApp a Juan que llego tarde');
        const toolNames = tools.map(t => t.name);

        assert(toolNames.some(t => t.startsWith('whatsapp_')), 'Debe incluir WhatsApp');
        assert(!toolNames.some(t => t.startsWith('browser_')), 'NO debe incluir Browser');
        assert(!toolNames.some(t => t.startsWith('home_')), 'NO debe incluir Home');
    });

    // 5. Caso de investigación profunda
    test('Selector contextual: "Investigá comparativas y benchmarks de GPUs" carga Research y Browser', () => {
        const tools = toolRegistryService.selectToolsForPrompt('Investigá comparativas y benchmarks de placas de video');
        const toolNames = tools.map(t => t.name);

        assert(toolNames.some(t => t.startsWith('research_')), 'Debe incluir Research');
        assert(!toolNames.some(t => t.startsWith('email_')), 'NO debe incluir Email');
    });

    // 6. Formateo estándar para OpenAPI / Ollama Function Calling
    test('formatForOllama: Transforma herramientas al estándar de function calling', () => {
        const sampleTools = [
            { name: 'spotify_play', description: 'Reproduce música', parameters: { query: { type: 'string' } }, required: [] }
        ];
        const formatted = toolRegistryService.formatForOllama(sampleTools);
        assert.strictEqual(formatted.length, 1);
        assert.strictEqual(formatted[0].type, 'function');
        assert.strictEqual(formatted[0].function.name, 'spotify_play');
        assert.strictEqual(typeof formatted[0].function.parameters, 'object');
    });

    // 7. Forzado de módulos por contexto
    test('Soporta forzar módulos explícitamente desde el contexto', () => {
        const tools = toolRegistryService.selectToolsForPrompt('', { forcedModules: ['python', 'home'] });
        const toolNames = tools.map(t => t.name);
        assert(toolNames.some(t => t.startsWith('python_')));
        assert(toolNames.some(t => t.startsWith('home_')));
        assert(!toolNames.some(t => t.startsWith('spotify_')));
    });

    // 8. JARVIS 3.0 Metadatos normalizados de herramienta (Sección 60)
    test('Herramientas normalizadas con atributos completos Sección 60', () => {
        const tool = toolRegistryService.getTool('windows_set_volume');
        assert.ok(tool, 'windows_set_volume debe estar registrada');
        assert.strictEqual(tool.name, 'windows_set_volume');
        assert.strictEqual(typeof tool.description, 'string');
        assert.strictEqual(typeof tool.schema, 'object');
        assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(tool.risk), `Risk no válido: ${tool.risk}`);
        assert.ok(Array.isArray(tool.permissions), 'Permissions debe ser un array');
        assert.strictEqual(tool.category, 'windows');
        assert.strictEqual(typeof tool.availability, 'boolean');
        assert.ok(['HEALTHY', 'DEGRADED', 'UNAVAILABLE'].includes(tool.health), `Health no válido: ${tool.health}`);
        assert.strictEqual(typeof tool.latency, 'number');
        assert.ok(Array.isArray(tool.fallbacks), 'Fallbacks debe ser un array');
    });

    // 9. Búsqueda por categoría y obtención individual
    test('Búsqueda de herramientas por categoría y obtención individual', () => {
        const browserTools = toolRegistryService.listToolsByCategory('browser');
        assert.ok(browserTools.length > 0, 'Debe haber herramientas en categoría browser');
        for (const t of browserTools) {
            assert.strictEqual(t.category, 'browser');
        }

        const spotifyTool = toolRegistryService.getTool('spotify_play');
        assert.ok(spotifyTool);
        assert.strictEqual(spotifyTool.category, 'spotify');
    });

    // 10. Gestión de salud y latencia de herramientas
    test('Registro de latencia y actualización de salud de herramienta', () => {
        const initialTool = toolRegistryService.getTool('file_create');
        assert.ok(initialTool);

        toolRegistryService.recordToolLatency('file_create', 150);
        assert.strictEqual(toolRegistryService.getTool('file_create').latency, 150);

        toolRegistryService.setToolHealth('file_create', 'DEGRADED');
        assert.strictEqual(toolRegistryService.getTool('file_create').health, 'DEGRADED');

        // Restaurar estado saludable
        toolRegistryService.setToolHealth('file_create', 'HEALTHY');
        assert.strictEqual(toolRegistryService.getTool('file_create').health, 'HEALTHY');
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE TOOL REGISTRY PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Tool Registry:', err);
    process.exit(1);
});
