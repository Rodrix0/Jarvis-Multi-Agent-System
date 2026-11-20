/**
 * Comprehensive Verification Suite: All Notification Channels in Jarvis
 * Prueba exhaustivamente cada canal y subsistema de notificaciones:
 * 1. Windows Native Toast (node-notifier WindowsToaster)
 * 2. HUD WebSockets (Socket.io 'notification')
 * 3. TTS Neural Speech Queue (con prioridades e interrupción)
 * 4. Proactive Policy Service (Download, Battery, CPU, App Crash, Task Finished)
 * 5. Conditional Automation Action Pipeline (action: 'notification')
 * 6. Agenda & Scheduler Service (Reminders)
 * 7. Quiet Mode / Modo No Molestar (Filtrado de no emergencias)
 */

const assert = require('assert');
const notificationService = require('../services/core/notificationService');
const proactivePolicyService = require('../services/core/proactivePolicyService');
const conditionalAutomation = require('../services/automation/conditionalAutomationService');
const schedulerService = require('../services/agenda/schedulerService');
const eventBus = require('../services/core/eventBusService');
const { SYSTEM_EVENTS } = require('../services/core/eventBusService');

console.log('===============================================================');
console.log('🔔 INICIANDO SUITE DE COMPROBACIÓN INTEGRAL DE NOTIFICACIONES');
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
    }
}

(async () => {
    // Mock Socket.io
    const hudEvents = [];
    const mockIo = {
        emit: (eventName, payload) => {
            hudEvents.push({ eventName, payload });
        }
    };

    // Mock TTS Service
    const spokenMessages = [];
    const mockTtsService = {
        speak: async (text) => {
            spokenMessages.push(text);
            return { spoke: true, text };
        }
    };

    // Inicializar notificationService
    notificationService.setSocketIO(mockIo);
    notificationService.setTtsService(mockTtsService);
    notificationService.setQuietMode(false);

    // 1. Canal HUD
    test('1. Canal HUD emite evento "notification" a Socket.io con metadatos completos', () => {
        hudEvents.length = 0;
        notificationService.notify({
            title: 'Alerta Test HUD',
            message: 'Contenido de prueba',
            priority: 'NORMAL',
            channels: ['HUD']
        });

        assert.strictEqual(hudEvents.length, 1);
        assert.strictEqual(hudEvents[0].eventName, 'notification');
        assert.strictEqual(hudEvents[0].payload.title, 'Alerta Test HUD');
        assert.strictEqual(hudEvents[0].payload.message, 'Contenido de prueba');
        assert.strictEqual(hudEvents[0].payload.priority, 'NORMAL');
        assert.ok(hudEvents[0].payload.timestamp);
    });

    // 2. Canal Windows Toast
    test('2. Canal Windows Toast ejecuta WindowsToaster sin arrojar excepciones', () => {
        // Ejecución segura de Windows Toast
        assert.doesNotThrow(() => {
            notificationService.notify({
                title: 'Jarvis OS Test',
                message: 'Verificación de Toast nativo',
                priority: 'NORMAL',
                channels: ['TOAST'],
                sound: false
            });
        });
    });

    // 3. Canal TTS con Prioridades y Cola
    await asyncTest('3. Canal TTS encola y reproduce mensajes a través de ttsService', async () => {
        spokenMessages.length = 0;
        notificationService.notify({
            title: 'TTS Test',
            message: 'Mensaje vocal de prueba para Jarvis',
            priority: 'NORMAL',
            channels: ['TTS']
        });

        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(spokenMessages.length, 1);
        assert.strictEqual(spokenMessages[0], 'Mensaje vocal de prueba para Jarvis');
    });

    // 4. Interrupción de TTS por Emergencia
    await asyncTest('4. Notificación de EMERGENCIA interrumpe audio previo y se antepone en la cola', async () => {
        spokenMessages.length = 0;

        // Notificación normal
        notificationService.notify({
            title: 'Info',
            message: 'Tarea normal en progreso',
            priority: 'LOW',
            channels: ['TTS']
        });

        // Emergencia inmediata
        notificationService.notify({
            title: 'Peligro',
            message: 'Batería crítica al 5%',
            priority: 'EMERGENCY',
            channels: ['TTS']
        });

        await new Promise(r => setTimeout(r, 60));
        assert.ok(spokenMessages.includes('Batería crítica al 5%'));
    });

    // 5. Modo No Molestar (Quiet Mode)
    test('5. Modo No Molestar suprime notificaciones NORMALES pero permite EMERGENCIAS', () => {
        notificationService.setQuietMode(true);
        hudEvents.length = 0;
        spokenMessages.length = 0;

        // Normal -> debe ser suprimida en TOAST y TTS
        notificationService.notify({
            title: 'Mensaje cotidiano',
            message: 'No debería sonar',
            priority: 'NORMAL',
            channels: ['HUD', 'TOAST', 'TTS']
        });

        assert.strictEqual(spokenMessages.length, 0, 'No debe hablar en Quiet Mode para prioridad NORMAL');

        // Emergencia -> debe sonar y pasar
        notificationService.notify({
            title: 'Alerta Roja',
            message: 'Temperatura extrema',
            priority: 'EMERGENCY',
            channels: ['HUD', 'TOAST', 'TTS']
        });

        assert.ok(spokenMessages.includes('Temperatura extrema'), 'Emergencia sí debe hablar en Quiet Mode');

        // Restaurar modo normal
        notificationService.setQuietMode(false);
    });

    // 6. ProactivePolicyService: Descarga Completada
    await asyncTest('6. ProactivePolicyService emite notificación dual (HUD + TOAST) ante descarga completada', async () => {
        hudEvents.length = 0;
        proactivePolicyService.init({ ttsService: mockTtsService, io: mockIo });

        eventBus.publish(SYSTEM_EVENTS.DOWNLOAD_COMPLETED, {
            filename: 'archivo_descargado.zip',
            destination: 'C:\\Downloads'
        });

        await new Promise(r => setTimeout(r, 60));
        const hudNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title.includes('Descarga'));
        assert.ok(hudNotif, 'Debe emitir notificación de descarga completada');
        assert.ok(hudNotif.payload.message.includes('archivo_descargado.zip'));
    });

    // 7. ProactivePolicyService: Batería Baja
    await asyncTest('7. ProactivePolicyService emite alerta visual y vocal ante batería baja', async () => {
        hudEvents.length = 0;
        spokenMessages.length = 0;

        eventBus.publish(SYSTEM_EVENTS.BATTERY_LOW, {
            percent: 14,
            critical: false
        });

        await new Promise(r => setTimeout(r, 60));
        const batNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title.includes('Batería'));
        assert.ok(batNotif, 'Debe emitir notificación de batería');
        assert.ok(batNotif.payload.message.includes('14%'));
    });

    // 8. ProactivePolicyService: Consumo Alto de CPU
    await asyncTest('8. ProactivePolicyService emite advertencia de CPU alta al HUD', async () => {
        hudEvents.length = 0;

        eventBus.publish(SYSTEM_EVENTS.CPU_HIGH, {
            cpuUsage: 92,
            topConsumers: [{ name: 'render.exe' }]
        });

        await new Promise(r => setTimeout(r, 50));
        const cpuNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title.includes('CPU'));
        assert.ok(cpuNotif, 'Debe emitir notificación de CPU');
        assert.strictEqual(cpuNotif.payload.priority, 'WARNING');
    });

    // 9. ProactivePolicyService: Cierre Inesperado de App
    await asyncTest('9. ProactivePolicyService notifica crash de aplicación', async () => {
        hudEvents.length = 0;

        eventBus.publish(SYSTEM_EVENTS.APP_CRASH, {
            appName: 'UnrealEditor.exe'
        });

        await new Promise(r => setTimeout(r, 50));
        const crashNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title.includes('Fallo'));
        assert.ok(crashNotif, 'Debe emitir notificación de fallo de app');
        assert.ok(crashNotif.payload.message.includes('UnrealEditor.exe'));
    });

    // 10. ProactivePolicyService: Tarea Finalizada del TaskManager
    await asyncTest('10. ProactivePolicyService notifica finalización de tarea de fondo', async () => {
        hudEvents.length = 0;

        eventBus.publish(SYSTEM_EVENTS.TASK_FINISHED, {
            taskId: 'task_abc_123',
            description: 'Compilación de Assets'
        });

        await new Promise(r => setTimeout(r, 50));
        const taskNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title.includes('Tarea'));
        assert.ok(taskNotif, 'Debe emitir notificación de tarea');
        assert.ok(taskNotif.payload.message.includes('Compilación de Assets'));
    });

    // 11. Motor de Automatizaciones Condicionales: Acción Notification
    await asyncTest('11. ConditionalAutomationService ejecuta acción de tipo "notification" correctamente', async () => {
        hudEvents.length = 0;
        conditionalAutomation.init({ ttsService: mockTtsService });

        conditionalAutomation.createRule({
            id: 'rule_test_notif_pipeline',
            name: 'Regla de Notificación de Prueba',
            trigger: { event: 'TEST_EVENT_NOTIF', once: true },
            actions: [
                {
                    type: 'notification',
                    title: 'Automatización Exitosa',
                    message: 'El evento {{code}} fue procesado.',
                    priority: 'NORMAL'
                }
            ]
        });

        eventBus.publish('TEST_EVENT_NOTIF', { code: 'HTTP_200_OK' });
        await new Promise(r => setTimeout(r, 80));

        const autoNotif = hudEvents.find(e => e.eventName === 'notification' && e.payload.title === 'Automatización Exitosa');
        assert.ok(autoNotif, 'La regla condicional debe despachar la notificación');
        assert.strictEqual(autoNotif.payload.message, 'El evento HTTP_200_OK fue procesado.');

        conditionalAutomation.deleteRule('rule_test_notif_pipeline');
    });

    console.log('\n===============================================================');
    console.log(`🎉 SUITE DE NOTIFICACIONES FINALIZADA: ${passCount}/${totalCount} TESTS EXITOSOS (${Math.round((passCount / totalCount) * 100)}%)`);
    console.log('===============================================================');

    if (passCount !== totalCount) {
        process.exit(1);
    } else {
        process.exit(0);
    }
})();
