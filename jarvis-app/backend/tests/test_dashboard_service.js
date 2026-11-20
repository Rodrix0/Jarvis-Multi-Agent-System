/**
 * Suite de Pruebas Automatizadas - Ítem 31: Dashboard de JARVIS
 * Verifica recolección de telemetría de hardware (CPU, RAM, VRAM GPU),
 * sondeo no bloqueante de servicios satélite, métricas de operación y latencia,
 * hook automático con ActionKernel y streaming por WebSocket.
 */

const assert = require('assert');
const dashboardService = require('../services/diagnostics/dashboardService');
const actionKernel = require('../services/actionKernelService');

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
    console.log('📊 INICIANDO SUITE DE PRUEBAS: ÍTEM 31 - DASHBOARD DE JARVIS');
    console.log('===============================================================\n');

    // 1. Sondeo de servicios satélite
    await testAsync('1. Sondeo de servicios satélite (Core, Ollama, Python, Whisper, etc.)', async () => {
        const services = await dashboardService.checkServices();
        assert.ok(services, 'Debe retornar un objeto de servicios');
        assert.ok(services.Core, 'Debe incluir estado de Core');
        assert.ok(['ONLINE', 'SLEEP', 'OFFLINE', 'DEGRADED'].includes(services.Core));
        assert.ok(services.Ollama !== undefined);
        assert.ok(services['Python Engine'] !== undefined);
        assert.ok(services.Whisper !== undefined);
        assert.ok(services.ComfyUI !== undefined);
        assert.ok(services.BroadLink !== undefined);
        assert.ok(services.HomeAssistant !== undefined);
    });

    // 2. Métricas de CPU
    test('2. Cálculo de métricas de CPU del sistema', () => {
        const cpu = dashboardService.getCpuUsage();
        assert.strictEqual(typeof cpu, 'number');
        assert.ok(cpu >= 0 && cpu <= 100, `CPU debe estar entre 0 y 100%, valor actual: ${cpu}`);
    });

    // 3. Métricas de RAM
    test('3. Cálculo de memoria RAM (usada, total y porcentaje)', () => {
        const ram = dashboardService.getRamUsage();
        assert.ok(ram.totalGB > 0);
        assert.ok(ram.usedGB >= 0);
        assert.ok(ram.usedGB <= ram.totalGB);
        assert.ok(ram.percent >= 0 && ram.percent <= 100);
    });

    // 4. Métricas de VRAM GPU NVIDIA
    await testAsync('4. Extracción de VRAM con nvidia-smi o fallback tolerante', async () => {
        const vram = await dashboardService.getVramUsage();
        assert.ok(vram);
        assert.strictEqual(typeof vram.usedGB, 'number');
        assert.strictEqual(typeof vram.totalGB, 'number');
        assert.strictEqual(typeof vram.percent, 'number');
    });

    // 5. Registro manual de acciones y latencias
    test('5. Registro de acción y latencia en el dashboard', () => {
        dashboardService.recordActionExecution('open_spotify', 41, 'success');
        assert.strictEqual(dashboardService.lastAction.name, 'open_spotify');
        assert.strictEqual(dashboardService.lastAction.latencyMs, 41);
        assert.strictEqual(dashboardService.lastAction.status, 'success');
        assert.ok(dashboardService.latencyHistory.includes(41));
    });

    // 6. Actualización del modelo actual
    test('6. Cambio y reporte de modelo activo', () => {
        dashboardService.setCurrentModel('Qwen 2.5 Coder');
        assert.strictEqual(dashboardService.currentModel, 'Qwen 2.5 Coder');
    });

    // 7. Generación de snapshot completo JSON
    await testAsync('7. getDashboardData() genera snapshot con estructura requerida', async () => {
        const data = await dashboardService.getDashboardData();
        assert.strictEqual(data.title, 'JARVIS STATUS');
        assert.ok(data.timestamp);
        assert.ok(data.services);
        assert.ok(data.hardware);
        assert.ok(data.operation);

        assert.strictEqual(typeof data.hardware.cpuPercent, 'number');
        assert.strictEqual(typeof data.hardware.ramUsedGB, 'number');
        assert.strictEqual(typeof data.hardware.ramTotalGB, 'number');
        assert.strictEqual(typeof data.hardware.vramUsedGB, 'number');
        assert.strictEqual(typeof data.hardware.vramTotalGB, 'number');

        assert.strictEqual(data.operation.currentModel, 'Qwen 2.5 Coder');
        assert.strictEqual(data.operation.lastAction, 'open_spotify');
        assert.strictEqual(data.operation.latencyMs, 41);
    });

    // 8. Hook automático desde ActionKernel
    await testAsync('8. ActionKernel actualiza automáticamente el Dashboard al ejecutar acciones', async () => {
        // Registramos una acción de prueba
        actionKernel.register({
            id: 'test.dashboard_action',
            name: 'Acción de prueba dashboard',
            execute: async () => {
                // Simular 20ms de trabajo
                await new Promise(r => setTimeout(r, 20));
                return { ok: true, message: 'Listo' };
            }
        });

        await actionKernel.execute('test.dashboard_action', {});

        assert.strictEqual(dashboardService.lastAction.actionId, 'test.dashboard_action');
        assert.strictEqual(dashboardService.lastAction.status, 'success');
        assert.ok(dashboardService.lastAction.latencyMs >= 10, `Latencia registrada: ${dashboardService.lastAction.latencyMs}ms`);
    });

    // 9. Transmisión continua por WebSocket (Socket.IO)
    await testAsync('9. startLiveStreaming() emite eventos dashboard_telemetry', async () => {
        let emittedEvent = null;
        let emittedData = null;

        const mockIo = {
            emit: (event, data) => {
                emittedEvent = event;
                emittedData = data;
            }
        };

        dashboardService.startLiveStreaming(mockIo, 100);
        await new Promise(r => setTimeout(r, 250));
        dashboardService.stopLiveStreaming();

        assert.strictEqual(emittedEvent, 'dashboard_telemetry');
        assert.ok(emittedData);
        assert.strictEqual(emittedData.title, 'JARVIS STATUS');
        assert.ok(emittedData.services);
        assert.ok(emittedData.hardware);
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 31 PASARON EXITOSAMENTE.');
    } else {
        console.error('❌ HUBO FALLOS EN LA SUITE DE DASHBOARD.');
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en suite:', err);
    process.exit(1);
});
