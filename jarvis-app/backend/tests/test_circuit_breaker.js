/**
 * test_circuit_breaker.js
 * 
 * Suite de pruebas unitarias para el Ítem 35:
 * Circuit Breakers (CLOSED, OPEN, HALF-OPEN con Cooldown de 2 Minutos y Fast-Fail Protegido en ActionKernel).
 */

const assert = require('assert');
const { CircuitBreaker, CircuitBreakerOpenError, circuitBreakerManager } = require('../services/resilience/circuitBreakerService');
const actionKernel = require('../services/actionKernelService');
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
    console.log('⚡ INICIANDO SUITE DE PRUEBAS: ÍTEM 35 - CIRCUIT BREAKERS');
    console.log('===============================================================\n');

    // Test 1: Estado Inicial CLOSED
    test('Un circuito nuevo se inicializa en estado CLOSED con 0 fallos', () => {
        const breaker = new CircuitBreaker('test_initial', { failureThreshold: 5, cooldownPeriodMs: 120000 });
        assert.strictEqual(breaker.getState(), 'CLOSED');
        assert.strictEqual(breaker.isClosed(), true);
        assert.strictEqual(breaker.isOpen(), false);
        assert.strictEqual(breaker.consecutiveFailures, 0);
        assert.strictEqual(breaker.failureThreshold, 5);
    });

    // Test 2: Operación Normal en CLOSED
    await testAsync('Ejecución normal en CLOSED permite el paso y resetea fallos', async () => {
        const breaker = new CircuitBreaker('test_normal', { failureThreshold: 5 });
        breaker.recordFailure(new Error('fail1'));
        assert.strictEqual(breaker.consecutiveFailures, 1);

        const result = await breaker.execute(async () => 'OK_SUCCESS');
        assert.strictEqual(result, 'OK_SUCCESS');
        assert.strictEqual(breaker.consecutiveFailures, 0);
        assert.strictEqual(breaker.getState(), 'CLOSED');
    });

    // Test 3: Apertura tras 5 Fallos Consecutivos (Umbral Especificado por el Usuario)
    await testAsync('5 fallos consecutivos abren el circuito a estado OPEN', async () => {
        const breaker = new CircuitBreaker('spotify_test_open', { failureThreshold: 5, cooldownPeriodMs: 120000 });

        for (let i = 1; i <= 4; i++) {
            await assert.rejects(
                () => breaker.execute(async () => { throw new Error(`Error ${i}`); }),
                /Error/
            );
            assert.strictEqual(breaker.getState(), 'CLOSED');
            assert.strictEqual(breaker.consecutiveFailures, i);
        }

        // 5to fallo -> dispara apertura
        await assert.rejects(
            () => breaker.execute(async () => { throw new Error('Error 5'); }),
            /Error/
        );
        assert.strictEqual(breaker.getState(), 'OPEN');
        assert.strictEqual(breaker.isOpen(), true);
        assert.ok(breaker.getRemainingCooldownSeconds() > 115, 'Cooldown inicial debe ser cercano a 120s');
    });

    // Test 4: Fast-Fail Inmediato en Estado OPEN sin Invocar la Función
    await testAsync('En estado OPEN, las llamadas son rechazadas en <1ms (Fast-Fail) sin ejecutar la función', async () => {
        const breaker = new CircuitBreaker('fast_fail_test', { failureThreshold: 2, cooldownPeriodMs: 120000 });
        breaker.recordFailure();
        breaker.recordFailure();
        assert.strictEqual(breaker.isOpen(), true);

        let underlyingFunctionCalled = false;
        const start = Date.now();

        try {
            await breaker.execute(async () => {
                underlyingFunctionCalled = true;
                return 'SHOULD_NOT_EXECUTE';
            });
            assert.fail('Debería haber lanzado CircuitBreakerOpenError');
        } catch (err) {
            const duration = Date.now() - start;
            assert.strictEqual(underlyingFunctionCalled, false, 'La función subyacente NUNCA debe ser llamada');
            assert.strictEqual(err.code, 'CIRCUIT_BREAKER_OPEN');
            assert.strictEqual(err.name, 'CircuitBreakerOpenError');
            assert.ok(duration < 10, `La respuesta rápida debe tardar <10ms (tomó ${duration}ms)`);
        }
    });

    // Test 5: Transición Automática a HALF-OPEN tras Expirar Cooldown (2 min)
    test('Transición reactiva a HALF-OPEN cuando transcurre el tiempo de cooldown', () => {
        const breaker = new CircuitBreaker('cooldown_test', { failureThreshold: 1, cooldownPeriodMs: 120000 });
        breaker.recordFailure();
        assert.strictEqual(breaker.state, 'OPEN');

        // Simular que pasaron los 120 segundos (2 minutos)
        breaker.lastFailureTime = Date.now() - 121000;

        assert.strictEqual(breaker.getState(), 'HALF-OPEN');
        assert.strictEqual(breaker.isHalfOpen(), true);
    });

    // Test 6: Llamada Canario Exitosa en HALF-OPEN Cierra el Circuito
    await testAsync('Llamada canario exitosa en HALF-OPEN restablece el circuito a CLOSED', async () => {
        const breaker = new CircuitBreaker('canary_success_test', { failureThreshold: 1, cooldownPeriodMs: 50 });
        breaker.recordFailure();
        assert.strictEqual(breaker.isOpen(), true);

        // Esperar cooldown breve
        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(breaker.getState(), 'HALF-OPEN');

        // Llamada canario exitosa
        const res = await breaker.execute(async () => 'CANARY_RECOVERED');
        assert.strictEqual(res, 'CANARY_RECOVERED');
        assert.strictEqual(breaker.getState(), 'CLOSED');
        assert.strictEqual(breaker.consecutiveFailures, 0);
    });

    // Test 7: Llamada Canario Fallida en HALF-OPEN Reabre el Circuito
    await testAsync('Llamada canario fallida en HALF-OPEN reabre inmediatamente el circuito a OPEN', async () => {
        const breaker = new CircuitBreaker('canary_fail_test', { failureThreshold: 1, cooldownPeriodMs: 50 });
        breaker.recordFailure();

        // Esperar cooldown breve
        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(breaker.getState(), 'HALF-OPEN');

        // Llamada canario que falla
        await assert.rejects(
            () => breaker.execute(async () => { throw new Error('Canary failed'); }),
            /Canary failed/
        );

        assert.strictEqual(breaker.getState(), 'OPEN');
        assert.strictEqual(breaker.isOpen(), true);
    });

    // Test 8: Integración con ActionKernelService (Fast-Fail Protegido)
    await testAsync('ActionKernelService cortocircuita herramientas cuyo circuito está OPEN', async () => {
        const resource = `mock_resource_${Date.now()}`;
        const actionId = `mock_act_${Date.now()}`;

        const breaker = circuitBreakerManager.getBreaker(resource, { failureThreshold: 2, cooldownPeriodMs: 120000 });

        let executionCount = 0;
        actionKernel.register({
            id: actionId,
            name: 'Herramienta Protegida por Breaker',
            permission: 'READ_ONLY',
            circuitBreakerResource: resource,
            execute: async () => {
                executionCount++;
                throw new Error('Falla de conexión simulada');
            }
        });

        // Ejecución 1: Falla y cuenta
        const res1 = await actionKernel.execute(actionId, {});
        assert.strictEqual(res1.ok, false);
        assert.strictEqual(executionCount, 1);
        assert.strictEqual(breaker.getState(), 'CLOSED');

        // Ejecución 2: Falla y abre circuito
        const res2 = await actionKernel.execute(actionId, {});
        assert.strictEqual(res2.ok, false);
        assert.strictEqual(executionCount, 2);
        assert.strictEqual(breaker.getState(), 'OPEN');

        // Ejecución 3: CORTOCIRCUITO INMEDIATO (No debe llamar execute)
        const res3 = await actionKernel.execute(actionId, {});
        assert.strictEqual(res3.ok, false);
        assert.strictEqual(res3.status, 'circuit_breaker_open');
        assert.strictEqual(executionCount, 2, 'No se debió volver a ejecutar el comando físico');
        assert.ok(res3.message.includes('se encuentra temporalmente suspendido'));
    });

    // Test 9: Reset Manual forzado vía circuitBreakerManager
    test('resetBreaker() cierra manualmente el circuito y restablece métricas', () => {
        const breakerName = `reset_test_${Date.now()}`;
        const breaker = circuitBreakerManager.getBreaker(breakerName, { failureThreshold: 1 });
        breaker.recordFailure();
        assert.strictEqual(breaker.isOpen(), true);

        const ok = circuitBreakerManager.resetBreaker(breakerName);
        assert.strictEqual(ok, true);
        assert.strictEqual(breaker.getState(), 'CLOSED');
        assert.strictEqual(breaker.consecutiveFailures, 0);
    });

    // Test 10: Auditoría en Structured Logs de Transiciones de Estado
    test('Las transiciones de estado del Circuit Breaker quedan registradas en structured_logs', () => {
        const auditedBreakerName = `audit_cb_${Date.now()}`;
        const breaker = new CircuitBreaker(auditedBreakerName, { failureThreshold: 1 });
        breaker.recordFailure();

        assert.strictEqual(breaker.isOpen(), true);

        const logs = structuredLogger.query({ module: 'circuitBreaker', action: 'state_transition' });
        assert.ok(logs.length > 0, 'Debe haber logs de transición');
        const match = logs.find(l => l.metadata && l.metadata.breaker === auditedBreakerName);
        assert.ok(match, 'Debe existir log con el nombre del breaker');
        assert.strictEqual(match.metadata.to, 'OPEN');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 35 PASARON EXITOSAMENTE.\n');
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
