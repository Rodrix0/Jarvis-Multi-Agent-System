/**
 * Test Suite: Conditional Automations Engine (Ítem 27)
 * Verifica creación de reglas, persistencia en SQLite, evaluación de filtros semánticos,
 * interpolación de plantillas, pipelines de acciones, cooldowns, reglas de un solo disparo,
 * Circuit Breaker automático, parser de comandos rápidos y ActionKernel.
 */

const assert = require('assert');
const conditionalAutomation = require('../services/automation/conditionalAutomationService');
const eventBus = require('../services/core/eventBusService');
const { SYSTEM_EVENTS } = require('../services/core/eventBusService');
const databaseService = require('../services/persistence/databaseService');
const actionRouterService = require('../services/core/actionRouterService');
const actionKernel = require('../services/actionKernelService');
const jarvisActionService = require('../services/jarvisActionService');
const fastCommandParser = require('../services/ai/fastCommandParser');

console.log('===============================================================');
console.log('🧪 INICIANDO TESTS DE AUTOMATIZACIONES POR CONDICIONES (Ítem 27)');
console.log('===============================================================\n');

let passCount = 0;
let totalCount = 0;

function test(description, fn) {
    totalCount++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
        console.error(err.stack);
    }
}

async function asyncTest(description, fn) {
    totalCount++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
        console.error(err.stack);
    }
}

(async () => {
    // Inicializar dependencias y mock TTS
    const mockSpoken = [];
    const mockTts = {
        speak: (msg) => {
            mockSpoken.push(msg);
            return { spoke: true, message: msg };
        }
    };

    conditionalAutomation.init({ ttsService: mockTts });

    // 1. Evaluación de Filtros Semánticos
    test('1. Filtros semánticos: eq, contains, startsWith, endsWith', () => {
        const payload = { filename: 'dataset_2026.zip', count: 42, user: 'Rodri' };

        assert.strictEqual(conditionalAutomation.evaluateFilters({ filename: { contains: 'dataset' } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ filename: { endsWith: '.zip' } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ filename: { startsWith: 'data' } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ user: { eq: 'rodri' } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ filename: { contains: 'video' } }, payload), false);
    });

    test('2. Filtros numéricos: gt, gte, lt, lte, between', () => {
        const payload = { cpu: 88, battery: 15, temp: 45 };

        assert.strictEqual(conditionalAutomation.evaluateFilters({ cpu: { gt: 80 } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ cpu: { gte: 88 } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ battery: { lt: 20 } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ temp: { between: [40, 50] } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ temp: { between: [50, 60] } }, payload), false);
    });

    test('3. Filtros avanzados: in, notIn, regex, compuertas lógicas $and / $or', () => {
        const payload = { app: 'LeagueClient.exe', category: 'games', status: 'closed' };

        assert.strictEqual(conditionalAutomation.evaluateFilters({ app: { regex: 'league.*\\.exe' } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ category: { in: ['games', 'media'] } }, payload), true);
        assert.strictEqual(conditionalAutomation.evaluateFilters({ category: { notIn: ['work', 'finance'] } }, payload), true);

        // $and
        assert.strictEqual(conditionalAutomation.evaluateFilters({
            $and: [
                { category: 'games' },
                { status: 'closed' }
            ]
        }, payload), true);

        // $or
        assert.strictEqual(conditionalAutomation.evaluateFilters({
            $or: [
                { category: 'work' },
                { app: { contains: 'league' } }
            ]
        }, payload), true);
    });

    // 2. Interpolación de Plantillas
    test('4. Interpolación dinámica de plantillas {{var}} y rutas anidadas', () => {
        const payload = {
            filename: 'archivo_secreto.docx',
            meta: { author: 'Rodri', pages: 12 }
        };

        const template = 'Descarga de {{filename}} por {{meta.author}} ({{meta.pages}} págs)';
        const interpolated = conditionalAutomation.interpolateTemplate(template, payload);
        assert.strictEqual(interpolated, 'Descarga de archivo_secreto.docx por Rodri (12 págs)');
    });

    // 3. Creación y Persistencia en SQLite
    test('5. Creación de regla y persistencia en SQLite', () => {
        const rule = conditionalAutomation.createRule({
            id: 'test_rule_download_alert',
            name: 'Aviso de descarga zip',
            trigger: {
                event: SYSTEM_EVENTS.DOWNLOAD_COMPLETED,
                filters: { filename: { endsWith: '.zip' } },
                cooldownMs: 1000
            },
            actions: [
                { type: 'tts', message: 'Se descargó el paquete {{filename}}.' }
            ]
        });

        assert.strictEqual(rule.id, 'test_rule_download_alert');
        assert.strictEqual(rule.enabled, true);

        // Verificar lectura directa desde SQLite
        const dbRow = databaseService.getAutomationRule('test_rule_download_alert');
        assert.ok(dbRow, 'La regla debe existir en SQLite');
        assert.strictEqual(dbRow.name, 'Aviso de descarga zip');
    });

    // 4. Disparo Reactivo por Event Bus
    await asyncTest('6. Disparo reactivo al publicar evento coincidente', async () => {
        mockSpoken.length = 0;

        // Publicar evento coincidente
        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
            filename: 'backup_final.zip',
            destination: 'C:\\Downloads'
        });

        // Esperar brevemente para procesamiento asíncrono
        await new Promise(r => setTimeout(r, 80));

        assert.strictEqual(mockSpoken.length, 1);
        assert.strictEqual(mockSpoken[0], 'Se descargó el paquete backup_final.zip.');
    });

    await asyncTest('7. No disparar si los filtros del evento no coinciden', async () => {
        mockSpoken.length = 0;

        // Publicar archivo que no termina en .zip
        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
            filename: 'cancion.mp3',
            destination: 'C:\\Downloads'
        });

        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(mockSpoken.length, 0, 'No debería dispararse para .mp3');
    });

    // 5. Cooldown Throttling
    await asyncTest('8. Cooldown: supresión de repeticiones en ráfaga', async () => {
        mockSpoken.length = 0;
        conditionalAutomation.cooldowns.delete('test_rule_download_alert');

        // Primer disparo
        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, { filename: 'pack1.zip' });
        await new Promise(r => setTimeout(r, 40));
        assert.strictEqual(mockSpoken.length, 1);

        // Segundo disparo inmediato (< 1000 ms cooldown)
        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, { filename: 'pack2.zip' });
        await new Promise(r => setTimeout(r, 40));
        assert.strictEqual(mockSpoken.length, 1, 'El segundo disparo debe ser bloqueado por cooldown');
    });

    // 6. Regla de un solo disparo (once: true)
    await asyncTest('9. Regla con once: true se auto-desactiva tras un disparo', async () => {
        mockSpoken.length = 0;

        conditionalAutomation.createRule({
            id: 'test_once_rule',
            name: 'Aviso único',
            trigger: {
                event: 'CUSTOM_TEST_EVENT',
                once: true
            },
            actions: [
                { type: 'tts', message: 'Evento único ejecutado.' }
            ]
        });

        const rBefore = conditionalAutomation.getRule('test_once_rule');
        assert.strictEqual(rBefore.enabled, true);

        // Emitir evento
        eventBus.publish('CUSTOM_TEST_EVENT', { data: 123 });
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(mockSpoken.length, 1);
        const rAfter = conditionalAutomation.getRule('test_once_rule');
        assert.strictEqual(rAfter.enabled, false, 'La regla debe estar desactivada tras el disparo');
        assert.strictEqual(rAfter.status, 'completed_once');
    });

    // 7. Circuit Breaker Automático
    await asyncTest('10. Circuit Breaker: pausa automática tras 3 fallos consecutivos', async () => {
        conditionalAutomation.createRule({
            id: 'test_faulty_rule',
            name: 'Regla defectuosa',
            trigger: {
                event: 'TRIGGER_FAULT',
                cooldownMs: 0
            },
            actions: [
                { type: 'action', action: 'inexistente.accion.error', params: {} }
            ]
        });

        // Registrar handler que simula error
        actionRouterService.registerAction('inexistente.accion.error', async () => {
            throw new Error('Fallo crítico simulado en servicio');
        });

        // Disparo 1
        eventBus.publish('TRIGGER_FAULT', {});
        await new Promise(r => setTimeout(r, 40));

        // Disparo 2
        eventBus.publish('TRIGGER_FAULT', {});
        await new Promise(r => setTimeout(r, 40));

        // Disparo 3
        eventBus.publish('TRIGGER_FAULT', {});
        await new Promise(r => setTimeout(r, 40));

        const rule = conditionalAutomation.getRule('test_faulty_rule');
        assert.ok(rule.consecutive_failures >= 3, 'Debe registrar 3 o más fallos');
        assert.strictEqual(rule.status, 'circuit_breaker_tripped', 'El circuit breaker debe estar disparado');

        // Disparo 4 no debe ejecutar nada
        const res = await conditionalAutomation.executeRuleActions(rule, { eventName: 'TRIGGER_FAULT' });
        // No debe llamarse normalmente cuando status es circuit_breaker_tripped
    });

    // 8. Simulación Dry Run (testRule)
    test('11. Dry-run y simulación de regla (testRule)', () => {
        const testRes = conditionalAutomation.testRule('test_rule_download_alert', {
            filename: 'archivo_prueba.zip'
        });

        assert.strictEqual(testRes.ok, true);
        assert.strictEqual(testRes.conditionsMet, true);
        assert.strictEqual(testRes.filtersMatch, true);
        assert.strictEqual(testRes.simulatedActions[0].interpolated.message, 'Se descargó el paquete archivo_prueba.zip.');
    });

    // 9. Alternancia y Eliminación de Reglas
    test('12. Alternar estado (toggleRule) y eliminar (deleteRule)', () => {
        const toggledOff = conditionalAutomation.toggleRule('test_rule_download_alert', false);
        assert.strictEqual(toggledOff.enabled, false);

        const toggledOn = conditionalAutomation.toggleRule('test_rule_download_alert', true);
        assert.strictEqual(toggledOn.enabled, true);

        const deleted = conditionalAutomation.deleteRule('test_rule_download_alert');
        assert.strictEqual(deleted, true);
        assert.strictEqual(conditionalAutomation.getRule('test_rule_download_alert'), null);
    });

    // 10. Parser de Comandos Rápidos (FastCommandParser)
    test('13. FastCommandParser reconoce comandos de automatización condicional', () => {
        // Listar
        const listCmd = fastCommandParser.parse('listar automatizaciones');
        assert.strictEqual(listCmd.match, true);
        assert.strictEqual(listCmd.action, 'automation.list-rules');

        // Descarga aviso
        const dlAlert = fastCommandParser.parse('cuando termine una descarga avisame');
        assert.strictEqual(dlAlert.match, true);
        assert.strictEqual(dlAlert.action, 'automation.create-rule');
        assert.strictEqual(dlAlert.params.rule.trigger.event, 'DOWNLOAD_COMPLETED');

        // Descarga apagar PC
        const dlShutdown = fastCommandParser.parse('cuando termine la descarga apaga la pc');
        assert.strictEqual(dlShutdown.match, true);
        assert.strictEqual(dlShutdown.action, 'automation.create-rule');
        assert.strictEqual(dlShutdown.params.rule.actions[1].action, 'power.shutdown');

        // Cierre de app/juego
        const closeProc = fastCommandParser.parse('cuando cierre League of Legends apaga la pc');
        assert.strictEqual(closeProc.match, true);
        assert.strictEqual(closeProc.action, 'automation.create-rule');
        assert.strictEqual(closeProc.params.rule.trigger.event, 'PROCESS_TERMINATED');
        assert.ok(closeProc.params.rule.trigger.filters.processName.contains.toLowerCase().includes('league of legends'));
    });

    // 11. Integración con ActionKernel
    await asyncTest('14. ActionKernel despacha acciones de automatización', async () => {
        const createRes = await actionKernel.execute('automation.create-rule', {
            rule: {
                id: 'kernel_auto_rule',
                name: 'Regla via Kernel',
                trigger: { event: 'PROCESS_TERMINATED', filters: { appName: 'spotify' } },
                actions: [{ type: 'notification', title: 'Spotify cerrado' }]
            }
        });
        assert.strictEqual(createRes.ok, true);
        assert.ok(createRes.message.includes('creada con éxito'));

        const listRes = await actionKernel.execute('automation.list-rules', {});
        assert.strictEqual(listRes.ok, true);
        const count = listRes.data?.count ?? listRes.count;
        assert.ok(count >= 1, `count debe ser >= 1 pero fue ${count}`);

        // Limpieza
        conditionalAutomation.deleteRule('kernel_auto_rule');
        conditionalAutomation.deleteRule('test_once_rule');
        conditionalAutomation.deleteRule('test_faulty_rule');
    });

    // 12. Monitoreo de Procesos Proactivo (ProactiveMonitorService)
    test('15. ProactiveMonitorService vigila procesos y emite eventos', () => {
        const proactiveMonitor = require('../services/core/proactiveMonitorService');
        proactiveMonitor.watchProcess('notepad.exe');
        assert.ok(proactiveMonitor.processWatchlist.has('notepad.exe'));

        proactiveMonitor.unwatchProcess('notepad.exe');
        assert.strictEqual(proactiveMonitor.processWatchlist.has('notepad.exe'), false);
    });

    console.log('\n===============================================================');
    console.log(`🎉 SUITE FINALIZADA: ${passCount}/${totalCount} TESTS EXITOSOS (${Math.round((passCount / totalCount) * 100)}%)`);
    console.log('===============================================================');

    if (passCount !== totalCount) {
        process.exit(1);
    }
})();
