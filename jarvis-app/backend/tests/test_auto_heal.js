/**
 * test_auto_heal.js
 * 
 * Suite de pruebas unitarias para el Ítem 34:
 * JARVIS Autorepara Servicios (Auto-Heal, Detección de Caídas y Regla de 3 Reintentos con Notificación Proactiva).
 */

const assert = require('assert');
const autoHealService = require('../services/resilience/autoHealService');
const notificationService = require('../services/core/notificationService');
const structuredLogger = require('../services/diagnostics/structuredLoggerService');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${totalTests}. ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${totalTests}. ${name}`);
        console.error(`     Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

async function runSuite() {
    console.log('===============================================================');
    console.log('🛡️  INICIANDO SUITE DE PRUEBAS: ÍTEM 34 - JARVIS AUTOREPARA SERVICIOS');
    console.log('===============================================================\n');

    // Test 1: Registro de Servicios Satélite por Defecto
    test('autoHealService tiene registrados los servicios satélite principales', () => {
        const statuses = autoHealService.getServicesStatus();
        assert.ok(statuses.python_engine, 'python_engine debe estar registrado');
        assert.ok(statuses.ollama, 'ollama debe estar registrado');
        assert.ok(statuses.comfyui, 'comfyui debe estar registrado');
        assert.ok(statuses.broadlink, 'broadlink debe estar registrado');
        assert.strictEqual(statuses.python_engine.maxRetries, 3);
    });

    // Test 2: Servicio Sano Permanece HEALTHY
    await testAsync('checkService confirma estado HEALTHY cuando el probe responde ok', async () => {
        const testId = `svc_healthy_${Date.now()}`;
        autoHealService.registerService({
            id: testId,
            name: 'Servicio Saludable Test',
            check: async () => ({ ok: true })
        });

        const res = await autoHealService.checkService(testId);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.status, 'HEALTHY');

        const svc = autoHealService.getService(testId);
        assert.strictEqual(svc.consecutiveFailures, 0);
    });

    // Test 3: Detección de Caída e Intento de Auto-Reparación
    await testAsync('Detecta servicio DOWN y ejecuta rutina de reinicio automático', async () => {
        const testId = `svc_heal_once_${Date.now()}`;
        let restartCalled = false;
        let isHealthy = false;

        autoHealService.registerService({
            id: testId,
            name: 'Servicio AutoHeal Test',
            check: async () => ({ ok: isHealthy }),
            restart: async () => {
                restartCalled = true;
                isHealthy = true; // Simula que el reinicio levantó el servicio
                return { ok: true };
            }
        });

        const res = await autoHealService.checkService(testId);
        assert.strictEqual(restartCalled, true, 'Debe haber invocado restart()');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.status, 'HEALTHY');

        const svc = autoHealService.getService(testId);
        assert.strictEqual(svc.consecutiveFailures, 0, 'Debe haber reseteado fallos');
    });

    // Test 4: Incremento Gradual de Fallos Consecutivos
    await testAsync('Incrementa contador de fallos cuando el reinicio no logra levantar el servicio', async () => {
        const testId = `svc_fail_once_${Date.now()}`;
        autoHealService.registerService({
            id: testId,
            name: 'Servicio Roto Test',
            maxRetries: 3,
            check: async () => ({ ok: false, error: 'Process crashed' }),
            restart: async () => ({ ok: false, error: 'Spawn error' })
        });

        const res1 = await autoHealService.checkService(testId);
        assert.strictEqual(res1.ok, false);
        assert.strictEqual(res1.status, 'DEGRADED');

        const svc = autoHealService.getService(testId);
        assert.strictEqual(svc.consecutiveFailures, 1);
    });

    // Test 5: Regla Estricta de 3 Reintentos para python_engine con Notificación Crítica
    await testAsync('Al fallar 3 veces consecutivas, transiciona a FAILED y emite notificación crítica', async () => {
        const testId = 'python_engine_simulated';
        let notificationIntercepted = null;

        // Espiar el método notify de notificationService
        const originalNotify = notificationService.notify.bind(notificationService);
        notificationService.notify = (payload) => {
            notificationIntercepted = payload;
            originalNotify(payload);
        };

        try {
            autoHealService.registerService({
                id: testId,
                name: 'Python Engine Simulado',
                maxRetries: 3,
                failureMessage: 'Python engine caído, no puedo usar Whisper local',
                check: async () => ({ ok: false, error: 'Connection refused on port' }),
                restart: async () => ({ ok: false, error: 'Failed to restart process' })
            });

            // Intento 1
            await autoHealService.checkService(testId);
            assert.strictEqual(autoHealService.getService(testId).consecutiveFailures, 1);

            // Intento 2
            await autoHealService.checkService(testId);
            assert.strictEqual(autoHealService.getService(testId).consecutiveFailures, 2);

            // Intento 3 (Alcanza el límite de 3)
            const res3 = await autoHealService.checkService(testId);
            assert.strictEqual(res3.status, 'FAILED');
            assert.strictEqual(autoHealService.getService(testId).status, 'FAILED');

            // Verificar la notificación proactiva requerida
            assert.ok(notificationIntercepted, 'Debe haberse disparado una notificación');
            assert.strictEqual(
                notificationIntercepted.message,
                'Python engine caído, no puedo usar Whisper local',
                'El mensaje de notificación debe ser exactamente el especificado en los requerimientos'
            );
            assert.strictEqual(notificationIntercepted.priority, 'HIGH');
        } finally {
            notificationService.notify = originalNotify;
        }
    });

    // Test 6: Protección Anti-Flapping (Evitar bucle infinito de reinicios)
    await testAsync('Protección Anti-Flapping congela servicio en COOLDOWN ante más de 5 reinicios rápidos', async () => {
        const testId = `flapping_svc_${Date.now()}`;
        const svcConfig = {
            id: testId,
            name: 'Servicio Inestable Flapping',
            maxRetries: 10,
            check: async () => ({ ok: false, error: 'Instacrash' }),
            restart: async () => ({ ok: true })
        };
        autoHealService.registerService(svcConfig);

        const svc = autoHealService.getService(testId);
        // Simular 5 reinicios en los últimos segundos
        const now = Date.now();
        svc.restartHistory = [now - 10000, now - 8000, now - 6000, now - 4000, now - 2000];

        const res = await autoHealService.checkService(testId);
        assert.strictEqual(res.status, 'COOLDOWN');
        assert.strictEqual(svc.status, 'COOLDOWN');
    });

    // Test 7: Reinicio Manual Forzado (forceRestart)
    await testAsync('forceRestart permite reiniciar manualmente un servicio en cualquier estado', async () => {
        const testId = `force_restart_${Date.now()}`;
        let didRestart = false;

        autoHealService.registerService({
            id: testId,
            name: 'Servicio Manual Test',
            check: async () => ({ ok: true }),
            restart: async () => {
                didRestart = true;
                return { ok: true };
            }
        });

        const res = await autoHealService.forceRestart(testId);
        assert.strictEqual(didRestart, true);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.status, 'HEALTHY');
    });

    // Test 8: Trazabilidad en Logs Estructurados
    await testAsync('Cada intento de reinicio queda auditado en structured_logs', async () => {
        const testId = `audit_heal_${Date.now()}`;
        autoHealService.registerService({
            id: testId,
            name: 'Servicio Audit Test',
            check: async () => ({ ok: false, error: 'Probe down' }),
            restart: async () => ({ ok: true })
        });

        await autoHealService.checkService(testId);

        const logs = structuredLogger.query({ module: 'autoHealService', action: 'restart_service' });
        assert.ok(logs.length > 0, 'Debe haber registrado logs de reinicio');
        const relevant = logs.find(l => l.metadata && l.metadata.serviceId === testId);
        assert.ok(relevant, 'El log estructurado debe contener el serviceId');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 34 PASARON EXITOSAMENTE.\n');
        process.exit(0);
    } else {
        console.error(`💥 FALLARON ${totalTests - passedTests} TESTS.\n`);
        process.exit(1);
    }
}

runSuite().catch(e => {
    console.error('Excepción fatal en suite de pruebas:', e);
    process.exit(1);
});
