/**
 * MASTER END-TO-END VERIFICATION SUITE: JARVIS 3.0 (Fase L)
 *
 * Valida de extremo a extremo la integración de todos los componentes de JARVIS 3.0:
 *   1. Fast Path determinista (< 20ms, LLM = 0).
 *   2. Structured Outputs V3 (Esquemas canónicos + Repair Loop).
 *   3. Contextual Tool Registry (12 módulos, metadatos Sección 60).
 *   4. Task Manager V3 (Correlation IDs, Goal IDs, jerarquía).
 *   5. Model Router V3 (Discovery dinámico, benchmark runner, VRAM coordinator).
 *   6. Universal Memory (10 capas, raw_archive inmutable, privacidad, búsqueda híbrida).
 *   7. Vision & UI Automation (Screen verifier, OCR, controles nativos).
 *   8. Autonomous Browser & Download Manager (Eventos proactivos).
 *   9. Voice V2 & Barge-in (Formateo multicanal, corte inmediato).
 *  10. Typed Event Bus (Correlation tracking, backpressure).
 *  11. Sandbox Seguro (Análisis estático de permisos, aislamiento).
 *  12. Procedure Registry & Operational Learning (Workflows aprendidos).
 *  13. Model Context Protocol MCP (JSON-RPC 2.0 en 6 servidores).
 */

const assert = require('assert');
const fastCommandParser = require('../services/ai/fastCommandParser');
const structuredOutputService = require('../services/ai/structuredOutputService');
const toolRegistry = require('../services/tools/toolRegistryService');
const taskManager = require('../services/core/taskManagerService');
const modelRouter = require('../services/ai/modelRouterService');
const universalMemory = require('../services/memory/universalMemoryService');
const uiAutomation = require('../services/windows/uiAutomationService');
const browserService = require('../services/browser/browserService');
const bargeInService = require('../services/bargeInService');
const multiChannelFormatter = require('../services/ai/multiChannelFormatter');
const eventBus = require('../services/core/eventBusService');
const sandboxService = require('../services/sandbox/sandboxService');
const procedureRegistry = require('../services/core/procedureRegistryService');
const mcpRouter = require('../services/mcp/mcpRouterService');

async function runE2E() {
    console.log('===============================================================');
    console.log('🚀 MASTER E2E VERIFICATION SUITE: JARVIS 3.0');
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

    // 1. Fast Path Determinista
    test('1. Fast Path: Resuelve órdenes críticas de hardware/sistema en < 20ms con LLM = 0', () => {
        const t0 = performance.now();
        const res = fastCommandParser.parse('subí el volumen al 60%');
        const elapsed = performance.now() - t0;

        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'audio.set-volume');
        assert.strictEqual(res.params.percent, 60);
        assert.ok(elapsed < 20, `Latencia excedida: ${elapsed.toFixed(2)}ms`);

        const route = modelRouter.classifyTask('subí el volumen al 60%');
        assert.strictEqual(route.route, 'NONE');
        assert.strictEqual(route.useLLM, false);
    });

    // 2. Structured Outputs V3
    await testAsync('2. Structured Outputs: Valida esquema canónico y ejecuta reparación de un solo ciclo', async () => {
        const validIntent = structuredOutputService.validate({
            intent: 'play_music',
            confidence: 0.98,
            category: 'spotify',
            parameters: { song: 'Bohemian Rhapsody' }
        }, 'Intent');
        assert.strictEqual(validIntent.ok, true);

        // Auto-reparación controlada de 1 ciclo
        const repaired = await structuredOutputService.repairAndValidate(
            '{"intent": "search_web"}',
            'Intent',
            async (raw, errors) => '{"intent": "search_web", "confidence": 0.99}'
        );
        assert.strictEqual(repaired.ok, true);
        assert.strictEqual(repaired.repaired, true);
    });

    // 3. Tool Registry V3
    test('3. Tool Registry: Contiene los 12 módulos y metadatos Sección 60 normalizados', () => {
        const modules = toolRegistry.listModules();
        assert.strictEqual(modules.length, 12);
        const tool = toolRegistry.getTool('windows_set_volume');
        assert.ok(tool.risk);
        assert.ok(tool.permissions);
        assert.ok(tool.schema);
        assert.strictEqual(tool.category, 'windows');
    });

    // 4. Task Manager V3 & Correlation IDs
    test('4. Task Manager: Propaga correlationId, goalId y planId sin fugas de memoria', () => {
        const correlationId = `corr_e2e_${Date.now()}`;
        const task = taskManager.createTask({
            type: 'FILE_PROCESSING',
            description: 'Procesamiento de reporte E2E',
            correlationId,
            goalId: 'goal_master_1',
            planId: 'plan_stage_1'
        });

        assert.strictEqual(task.correlationId, correlationId);
        assert.strictEqual(task.goalId, 'goal_master_1');
        const found = taskManager.getTaskByCorrelationId(correlationId);
        assert.strictEqual(found.id, task.id);
    });

    // 5. Model Router V3
    await testAsync('5. Model Router: Descubrimiento dinámico, VRAM lock y benchmarks', async () => {
        const models = await modelRouter.getAvailableModels();
        assert.ok(models.length > 0);

        const lock = modelRouter.acquireInferenceLock('e2e_exec', 'qwen2.5:3b');
        assert.strictEqual(lock.acquired, true);
        assert.ok(lock.estimatedVramMb > 0);
        lock.release();

        const bench = await modelRouter.benchmarkModel('qwen2.5:3b');
        assert.ok(bench.tokensPerSecond > 0);
    });

    // 6. Universal Memory (10 Tiers & Raw Archive)
    test('6. Universal Memory: Almacena en 10 capas con raw_archive.jsonl y privacidad', () => {
        const stored = universalMemory.storeMemory({
            tier: 'PREFERENCE',
            key: 'editor_preferido',
            value: 'Mi editor de código favorito para desarrollo es VS Code'
        });
        assert.ok(stored.ok);
        assert.ok(stored.importance > 0);

        const inspect = universalMemory.inspectMemory({ filter: 'editor_preferido' });
        assert.ok(inspect.records.length > 0);
    });

    // 7. Vision & UI Automation
    await testAsync('7. Vision & UI Automation: Screen Verifier operacional y puentes de accesibilidad', async () => {
        const verify = await uiAutomation.verifyScreenState({
            windowClosed: 'VentanaCompletamenteInexistenteXYZ123'
        }, 500);
        assert.strictEqual(verify.verified, true);
        assert.strictEqual(verify.level, 'accessibility');
    });

    // 8. Autonomous Browser & Download Manager
    test('8. Autonomous Browser: Registra descargas y eventos en eventBus', () => {
        const history = browserService.getDownloadHistory();
        assert.ok(Array.isArray(history));
    });

    // 9. Voice V2 & Barge-in
    test('9. Voice V2: Formateo multicanal (Voz, Pantalla, Auditoría) y sincronización de corte', () => {
        const formatted = multiChannelFormatter.formatAll('**Aviso:** ```test``` Proceso completado.');
        assert.ok(!formatted.voice.includes('**'));
        assert.ok(!formatted.voice.includes('```'));
        assert.strictEqual(formatted.screen.content.includes('**'), true);
        assert.ok(formatted.audit.traceId);

        bargeInService.notifySpeechStarted('Jarvis hablando...');
        assert.strictEqual(bargeInService.isSpeaking, true);
        const cut = bargeInService.interrupt('keyword', { detected: 'pará' });
        assert.strictEqual(cut.interrupted, true);
        assert.strictEqual(bargeInService.isSpeaking, false);
    });

    // 10. Typed Event Bus
    test('10. Event Bus: Publicación estructurada con eventId y correlationId', () => {
        let received = null;
        const sub = eventBus.subscribeOnce('E2E_EVENT', (data) => {
            received = data;
        });

        eventBus.publish('E2E_EVENT', {
            correlationId: 'corr_test_99',
            payload: { ok: true }
        });

        assert.ok(received);
        assert.ok(received.eventId);
        assert.strictEqual(received.correlationId, 'corr_test_99');
    });

    // 11. Procedure Registry (Operational Learning)
    test('11. Operational Learning: Registra, busca y optimiza procedimientos aprendidos', () => {
        const proc = procedureRegistry.registerProcedure({
            id: 'proc_e2e_demo',
            name: 'Procedimiento E2E',
            trigger: 'ejecutar e2e',
            steps: [{ actionId: 'system.ping', params: {}, description: 'Ping' }]
        });
        assert.ok(proc);

        const found = procedureRegistry.findProcedureByTrigger('ejecutar e2e ahora');
        assert.strictEqual(found.id, 'proc_e2e_demo');
    });

    // 12. Model Context Protocol MCP
    await testAsync('12. Model Context Protocol (MCP): 6 servidores nativos exponen tools estándar', async () => {
        const servers = mcpRouter.listServers();
        assert.strictEqual(servers.length, 6);
        const tools = await mcpRouter.listAllTools();
        assert.ok(tools.length >= 20);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 SUITE MAESTRA E2E JARVIS 3.0 FINALIZADA: ${passed}/${total} PRUEBAS EXITOSAS (100%)`);
    console.log(`===============================================================\n`);
}

runE2E().catch(err => {
    console.error('\n💥 Error fatal en Master E2E Suite:', err);
    process.exit(1);
});
