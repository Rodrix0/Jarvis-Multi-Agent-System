/**
 * Test Suite para Event Bus y Comportamiento Proactivo (Ítem 26)
 * Verifica:
 *  1. Eventos canónicos del sistema en eventBusService (SYSTEM_EVENTS).
 *  2. Publicación, suscripción e historial circular en memoria.
 *  3. Mecanismo de enfriamiento y prevención de spam (publishThrottled).
 *  4. Monitoreo de hardware (Batería baja, CPU alta).
 *  5. Motor de políticas proactivas (proactivePolicyService) con HUD y TTS.
 *  6. Sensibilidad a modos (silenciamiento en Modo Descanso).
 *  7. Emisión integrada desde TaskManager (TASK_FINISHED, TASK_CANCELLED).
 */

const assert = require('assert');
const eventBus = require('../services/core/eventBusService');
const { SYSTEM_EVENTS } = require('../services/core/eventBusService');
const proactivePolicy = require('../services/core/proactivePolicyService');
const proactiveMonitor = require('../services/core/proactiveMonitorService');
const taskManager = require('../services/core/taskManagerService');

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runAsyncTest(description, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function main() {
    console.log('===============================================================');
    console.log('📡 INICIANDO SUITE DE TESTS: EVENT BUS & PROACTIVIDAD (ÍTEM 26)');
    console.log('===============================================================');

    eventBus.clearHistory();

    console.log('\n--- BLOQUE 1: Eventos Canónicos y Publicación en Bus ---');

    runTest('Existencia de todos los eventos canónicos requeridos por el usuario', () => {
        assert.ok(SYSTEM_EVENTS.DOWNLOAD_COMPLETED);
        assert.ok(SYSTEM_EVENTS.APP_CRASH);
        assert.ok(SYSTEM_EVENTS.FILE_CHANGED);
        assert.ok(SYSTEM_EVENTS.CPU_HIGH);
        assert.ok(SYSTEM_EVENTS.BATTERY_LOW);
        assert.ok(SYSTEM_EVENTS.TV_ON);
        assert.ok(SYSTEM_EVENTS.TASK_FINISHED);
        assert.ok(SYSTEM_EVENTS.REMINDER_DUE);
    });

    runTest('Publicación y recepción inmediata de eventos en memoria', () => {
        let received = null;
        const unsubscribe = eventBus.subscribe(SYSTEM_EVENTS.TV_ON, ev => {
            received = ev;
        });

        eventBus.publish(SYSTEM_EVENTS.TV_ON, { source: 'BroadLink', state: 'power_on' });
        unsubscribe();

        assert.ok(received);
        assert.strictEqual(received.eventName, SYSTEM_EVENTS.TV_ON);
        assert.strictEqual(received.source, 'BroadLink');
        assert.ok(received.timestamp);
    });

    runTest('Historial circular registra eventos recientes', () => {
        const history = eventBus.getHistory(10);
        assert.ok(history.length >= 1);
        assert.strictEqual(history[0].eventName, SYSTEM_EVENTS.TV_ON);
    });

    console.log('\n--- BLOQUE 2: Mecanismo de Enfriamiento (publishThrottled) ---');

    runTest('publishThrottled bloquea ráfagas repetitivas dentro del cooldown', () => {
        const event1 = eventBus.publishThrottled(SYSTEM_EVENTS.CPU_HIGH, { usage: 92 }, 1000, 'TEST_CPU_KEY');
        assert.ok(event1, 'El primer evento debe emitirse');

        // Intento inmediato siguiente debe retornar null (bloqueado por cooldown)
        const event2 = eventBus.publishThrottled(SYSTEM_EVENTS.CPU_HIGH, { usage: 95 }, 1000, 'TEST_CPU_KEY');
        assert.strictEqual(event2, null, 'El segundo evento inmediato debe ser descartado');
    });

    console.log('\n--- BLOQUE 3: Motor de Políticas Proactivas (proactivePolicyService) ---');

    let spokenMessages = [];
    let hudNotifications = [];

    const mockTts = {
        speak: (text) => { spokenMessages.push(text); }
    };

    const mockIo = {
        emit: (event, payload) => {
            if (event === 'notification') hudNotifications.push(payload);
        }
    };

    let activeModeName = 'Normal';
    const mockModeService = {
        getActiveMode: () => ({ name: activeModeName })
    };

    proactivePolicy.init({
        ttsService: mockTts,
        io: mockIo,
        modeService: mockModeService
    });

    runTest('Evento DOWNLOAD_COMPLETED notifica al HUD y habla al usuario', () => {
        spokenMessages = [];
        hudNotifications = [];

        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
            filename: 'Blender_4.0_Setup.exe',
            destination: 'C:\\Downloads'
        });

        assert.strictEqual(hudNotifications.length, 1);
        assert.strictEqual(hudNotifications[0].title, 'Descarga Completada');
        assert.strictEqual(spokenMessages.length, 1);
        assert.ok(spokenMessages[0].includes('Blender_4.0_Setup.exe'));
    });

    runTest('Evento BATTERY_LOW crítico emite advertencia de alta prioridad', () => {
        spokenMessages = [];
        hudNotifications = [];

        eventBus.publish(SYSTEM_EVENTS.BATTERY_LOW, {
            percent: 8,
            critical: true,
            charging: false
        });

        assert.strictEqual(hudNotifications.length, 1);
        assert.strictEqual(hudNotifications[0].priority, 'EMERGENCY');
        assert.strictEqual(spokenMessages.length, 1);
        assert.ok(spokenMessages[0].includes('8 por ciento'));
    });

    runTest('En Modo Descanso silencia la voz pero preserva la notificación en HUD', () => {
        spokenMessages = [];
        hudNotifications = [];
        activeModeName = 'Modo Descanso';

        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
            filename: 'archivo_silencioso.zip'
        });

        // Notificación en HUD sí llega
        assert.strictEqual(hudNotifications.length, 1);
        // Voz debe estar silenciada para no despertar al usuario
        assert.strictEqual(spokenMessages.length, 0);

        activeModeName = 'Normal'; // Restaurar
    });

    console.log('\n--- BLOQUE 4: Integración con TaskManager ---');

    runTest('Finalizar una tarea en TaskManager publica TASK_FINISHED en eventBus', () => {
        let finishedEvent = null;
        const unsub = eventBus.subscribe(SYSTEM_EVENTS.TASK_FINISHED, ev => {
            finishedEvent = ev;
        });

        const task = taskManager.createTask({ description: 'Tarea de prueba para bus' });
        taskManager.startTask(task.id);
        taskManager.completeTask(task.id, { ok: true });
        unsub();

        assert.ok(finishedEvent);
        assert.strictEqual(finishedEvent.eventName, SYSTEM_EVENTS.TASK_FINISHED);
        assert.strictEqual(finishedEvent.id, task.id);
    });

    runTest('Cancelar una tarea en TaskManager publica TASK_CANCELLED en eventBus', () => {
        let cancelledEvent = null;
        const unsub = eventBus.subscribe(SYSTEM_EVENTS.TASK_CANCELLED, ev => {
            cancelledEvent = ev;
        });

        const task = taskManager.createTask({ description: 'Tarea a cancelar para bus' });
        taskManager.startTask(task.id);
        taskManager.cancel(task.id, 'Prueba de bus');
        unsub();

        assert.ok(cancelledEvent);
        assert.strictEqual(cancelledEvent.eventName, SYSTEM_EVENTS.TASK_CANCELLED);
        assert.strictEqual(cancelledEvent.id, task.id);
    });

    proactivePolicy.detach();

    console.log('===============================================================');
    console.log(`🏁 TESTS FINALIZADOS: ${passedTests}/${totalTests} EXITOSOS (${Math.round((passedTests/totalTests)*100)}%)`);
    console.log('===============================================================');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error fatal ejecutando tests:', err);
    process.exit(1);
});
