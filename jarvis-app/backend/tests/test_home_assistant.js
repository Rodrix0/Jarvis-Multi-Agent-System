/**
 * Suite de Pruebas Automatizadas - Ítem 29: Home Assistant (Domótica Universal)
 * Verifica inicialización offline resiliente, resolución semántica, despacho de servicios,
 * retransmisión al EventBus, puente con Conditional Automation, ActionKernel y FastCommandParser.
 */

const assert = require('assert');
const homeAssistantService = require('../services/homeassistant/homeAssistantService');
const eventBus = require('../services/core/eventBusService');
const { SYSTEM_EVENTS } = require('../services/core/eventBusService');
const actionKernel = require('../services/actionKernelService');
const fastCommandParser = require('../services/ai/fastCommandParser');
const jarvisActionService = require('../services/jarvisActionService');
const conditionalAutomation = require('../services/automation/conditionalAutomationService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runTests() {
    console.log('===============================================================');
    console.log('🏠 INICIANDO SUITE DE PRUEBAS: ÍTEM 29 - HOME ASSISTANT');
    console.log('===============================================================\n');

    // 1. Inicialización y tolerancia offline (Mock Mode)
    await testAsync('1. Inicialización en modo tolerancia offline / virtual', async () => {
        const res = await homeAssistantService.init({ forceMock: true });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.mode, 'mock');
        assert.ok(res.entityCount >= 6, 'Debe registrar al menos 6 entidades virtuales');
        const status = homeAssistantService.getPublicStatus();
        assert.strictEqual(status.isMockMode, true);
        assert.ok(status.domains.includes('light'));
        assert.ok(status.domains.includes('climate'));
    });

    // 2. Inventario y filtrado de dispositivos
    test('2. Listado de dispositivos por dominio', () => {
        const allDevices = homeAssistantService.listDevices();
        assert.ok(allDevices.length >= 6);

        const lights = homeAssistantService.listDevices('light');
        assert.ok(lights.length >= 2, 'Debe haber al menos 2 luces registradas');
        assert.ok(lights.some(l => l.entity_id === 'light.living_room'));

        const climates = homeAssistantService.listDevices('climate');
        assert.strictEqual(climates.length, 1);
        assert.strictEqual(climates[0].entity_id, 'climate.aire_acondicionado');
    });

    // 3. Consulta de estado puntual
    test('3. Consulta de estado directo de entidades', () => {
        const light = homeAssistantService.getState('light.living_room');
        assert.ok(light);
        assert.strictEqual(light.state, 'off');

        const tempSensor = homeAssistantService.getState('sensor.temperatura_living');
        assert.ok(tempSensor);
        assert.ok(tempSensor.state.includes('.'));
    });

    // 4. Resolución semántica en lenguaje natural
    test('4. Resolución semántica de alias en español', () => {
        assert.strictEqual(homeAssistantService.resolveEntity('luz del living'), 'light.living_room');
        assert.strictEqual(homeAssistantService.resolveEntity('luz de la pieza'), 'light.dormitorio');
        assert.strictEqual(homeAssistantService.resolveEntity('aire'), 'climate.aire_acondicionado');
        assert.strictEqual(homeAssistantService.resolveEntity('el aire acondicionado'), 'climate.aire_acondicionado');
        assert.strictEqual(homeAssistantService.resolveEntity('enchufe de la pc'), 'switch.enchufe_pc');
        assert.strictEqual(homeAssistantService.resolveEntity('temperatura'), 'sensor.temperatura_living');
        assert.strictEqual(homeAssistantService.resolveEntity('puerta principal'), 'binary_sensor.puerta_principal');
    });

    // 5. Despacho y cambio de estado de servicios
    await testAsync('5. Despacho de servicios (turn_on, turn_off, set_temperature)', async () => {
        // Prender luz
        const resOn = await homeAssistantService.turnOn('light.living_room', { brightness: 180 });
        assert.strictEqual(resOn.success, true);
        assert.strictEqual(homeAssistantService.getState('light.living_room').state, 'on');

        // Apagar luz
        const resOff = await homeAssistantService.turnOff('light.living_room');
        assert.strictEqual(resOff.success, true);
        assert.strictEqual(homeAssistantService.getState('light.living_room').state, 'off');

        // Setear temperatura de aire
        const resTemp = await homeAssistantService.setTemperature('climate.aire_acondicionado', 22);
        assert.strictEqual(resTemp.success, true);
        assert.strictEqual(homeAssistantService.getState('climate.aire_acondicionado').attributes.temperature, 22);
    });

    // 6. Ejecución de comandos completos en lenguaje natural
    await testAsync('6. Ejecución de comandos en lenguaje natural con respuestas conversacionales', async () => {
        // Prender luz
        const r1 = await homeAssistantService.executeCommand('prende la luz del living');
        assert.strictEqual(r1.success, true);
        assert.ok(r1.message.includes('Encendí'));
        assert.strictEqual(homeAssistantService.getState('light.living_room').state, 'on');

        // Clima con grados
        const r2 = await homeAssistantService.executeCommand('pone el aire en 23 grados');
        assert.strictEqual(r2.success, true);
        assert.ok(r2.message.includes('23 grados'));

        // Consulta de temperatura
        const r3 = await homeAssistantService.executeCommand('cuanta temperatura hace');
        assert.strictEqual(r3.success, true);
        assert.ok(r3.message.includes('temperatura'));

        // Apagar todas las luces
        const r4 = await homeAssistantService.executeCommand('apaga todas las luces');
        assert.strictEqual(r4.success, true);
        assert.ok(r4.message.includes('Apagué'));
        assert.strictEqual(homeAssistantService.getState('light.living_room').state, 'off');
    });

    // 7. Retransmisión de eventos hacia EventBus de Jarvis
    await testAsync('7. Emisión de evento canónico HA_STATE_CHANGED en EventBus', async () => {
        let eventReceived = null;
        const unsubscribe = eventBus.subscribe(SYSTEM_EVENTS.HA_STATE_CHANGED, (ev) => {
            eventReceived = ev;
        });

        await homeAssistantService.turnOn('light.dormitorio');
        unsubscribe();

        assert.ok(eventReceived, 'Debe haber recibido el evento HA_STATE_CHANGED');
        assert.strictEqual(eventReceived.entityId, 'light.dormitorio');
        assert.strictEqual(eventReceived.newState, 'on');
        assert.strictEqual(eventReceived.domain, 'light');
    });

    // 8. Integración reactiva con Conditional Automation (Ítem 27)
    await testAsync('8. Evento de Home Assistant dispara regla en ConditionalAutomation', async () => {
        conditionalAutomation.init();

        let automationFired = false;
        // Creamos una regla que escucha cuando la puerta se abra
        const testRule = conditionalAutomation.createRule({
            name: 'Aviso de puerta abierta',
            trigger: {
                event: SYSTEM_EVENTS.HA_STATE_CHANGED,
                filters: {
                    entityId: { eq: 'binary_sensor.puerta_principal' },
                    newState: { eq: 'on' }
                },
                once: true
            },
            actions: [
                { type: 'tts', message: 'Atención: la puerta principal se abrió.' }
            ]
        });

        assert.ok(testRule && testRule.id);

        // Simulamos apertura de puerta desde Home Assistant
        await homeAssistantService.turnOn('binary_sensor.puerta_principal');

        // Verificar que la regla se ejecutó (once: true la desactiva o la marca ejecutada)
        const updatedRule = conditionalAutomation.getRule(testRule.id);
        assert.ok(updatedRule, 'La regla debe existir');
        assert.strictEqual(updatedRule.trigger_count, 1, 'La regla debió ejecutarse exactamente 1 vez');

        // Limpiar regla de prueba
        conditionalAutomation.deleteRule(testRule.id);
    });

    // 9. Integración con ActionKernel
    await testAsync('9. Ejecución de acciones ha.* vía ActionKernel', async () => {
        // ha.command
        const cmdRes = await actionKernel.execute('ha.command', { text: 'prende el enchufe de la pc' });
        assert.strictEqual(cmdRes.ok, true);
        assert.strictEqual(cmdRes.data.success, true);
        assert.strictEqual(homeAssistantService.getState('switch.enchufe_pc').state, 'on');

        // ha.get-state
        const stateRes = await actionKernel.execute('ha.get-state', { entity_id: 'switch.enchufe_pc' });
        assert.strictEqual(stateRes.ok, true);
        assert.strictEqual(stateRes.data.state, 'on');

        // ha.list-devices
        const listRes = await actionKernel.execute('ha.list-devices', { domain: 'light' });
        assert.strictEqual(listRes.ok, true);
        assert.ok(listRes.data.count >= 2);

        // ha.sync
        const syncRes = await actionKernel.execute('ha.sync', {});
        assert.strictEqual(syncRes.ok, true);
    });

    // 10. Integración con FastCommandParser
    test('10. FastCommandParser interpreta intenciones domóticas correctamente', () => {
        // Luces
        const pLightOn = fastCommandParser.parse('prende la luz del living');
        assert.strictEqual(pLightOn.match, true);
        assert.strictEqual(pLightOn.action, 'ha.command');

        const pLightOff = fastCommandParser.parse('apaga la luz');
        assert.strictEqual(pLightOff.match, true);
        assert.strictEqual(pLightOff.action, 'ha.command');

        // Clima
        const pClimate = fastCommandParser.parse('pone el aire en 24 grados');
        assert.strictEqual(pClimate.match, true);
        assert.strictEqual(pClimate.action, 'ha.command');

        // Temperatura
        const pTemp = fastCommandParser.parse('cuanta temperatura hace');
        assert.strictEqual(pTemp.match, true);
        assert.strictEqual(pTemp.action, 'ha.command');

        // Enchufe
        const pPlug = fastCommandParser.parse('prende el ventilador');
        assert.strictEqual(pPlug.match, true);
        assert.strictEqual(pPlug.action, 'ha.command');

        // Listar
        const pList = fastCommandParser.parse('listar dispositivos inteligentes');
        assert.strictEqual(pList.match, true);
        assert.strictEqual(pList.action, 'ha.list-devices');
    });

    // 11. Preservación estricta de barrera de seguridad de voz y volumen
    test('11. Comandos de sistema y descanso no son interferidos por domótica', () => {
        // Dormir a Jarvis sigue siendo voice.sleep
        const sleepCmd = fastCommandParser.parse('jarvis apagate');
        assert.strictEqual(sleepCmd.match, true);
        assert.strictEqual(sleepCmd.action, 'voice.sleep');

        // Despertar sigue siendo voice.wake
        const wakeCmd = fastCommandParser.parse('jarvis prendete');
        assert.strictEqual(wakeCmd.match, true);
        assert.strictEqual(wakeCmd.action, 'voice.wake');

        // Volumen de PC al 50% sigue siendo audio.set-volume
        const volCmd = fastCommandParser.parse('pone el volumen al 50%');
        assert.strictEqual(volCmd.match, true);
        assert.strictEqual(volCmd.action, 'audio.set-volume');
        assert.strictEqual(volCmd.params.percent, 50);

        // Apagar la tele NO apaga Jarvis
        const tvCmd = fastCommandParser.parse('apaga la tele');
        assert.notStrictEqual(tvCmd.action, 'voice.sleep');

        // Apagar la luz NO apaga Jarvis
        const lightCmd = fastCommandParser.parse('apaga la luz');
        assert.notStrictEqual(lightCmd.action, 'voice.sleep');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 29 PASARON EXITOSAMENTE.');
    } else {
        console.error('❌ HUBO FALLOS EN LA SUITE DE HOME ASSISTANT.');
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en suite:', err);
    process.exit(1);
});
