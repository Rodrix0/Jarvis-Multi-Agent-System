/**
 * test_fallback_engine.js
 * 
 * Suite de pruebas unitarias para el Ítem 36:
 * Fallbacks Inteligentes (Degradación Elegante Multi-Tier con Fast-Skip por Circuit Breaker).
 */

const assert = require('assert');
const { FallbackChain, FallbackEngine, fallbackEngine } = require('../services/resilience/fallbackEngine');
const { circuitBreakerManager } = require('../services/resilience/circuitBreakerService');
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
    console.log('🔄 INICIANDO SUITE DE PRUEBAS: ÍTEM 36 - FALLBACKS INTELIGENTES');
    console.log('===============================================================\n');

    // Test 1: Registro de Cadenas Canónicas Requeridas
    test('FallbackEngine tiene registradas las cadenas esenciales (spotify, tv, web_search)', () => {
        const statuses = fallbackEngine.getChainsStatus();
        assert.ok(statuses.spotify, 'Cadena spotify debe estar registrada');
        assert.ok(statuses.tv, 'Cadena tv debe estar registrada');
        assert.ok(statuses.web_search, 'Cadena web_search debe estar registrada');

        assert.strictEqual(statuses.spotify.tiers.length, 3, 'Spotify debe tener 3 tiers');
        assert.strictEqual(statuses.tv.tiers.length, 2, 'TV debe tener 2 tiers');
        assert.strictEqual(statuses.web_search.tiers.length, 3, 'Web search debe tener 3 tiers');
    });

    // Test 2: Tier 1 Exitoso (No degradado)
    await testAsync('Tier 1 exitoso resuelve inmediatamente sin degradación', async () => {
        const chain = new FallbackChain('test_success', 'Cadena Exitosa');
        let tier2Called = false;

        chain.addTier({
            name: 'primary_api',
            execute: async () => 'DATA_FROM_PRIMARY'
        });
        chain.addTier({
            name: 'secondary_fallback',
            execute: async () => { tier2Called = true; return 'FALLBACK'; }
        });

        const res = await chain.execute();
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.result, 'DATA_FROM_PRIMARY');
        assert.strictEqual(res.isDegraded, false);
        assert.strictEqual(res.tierIndex, 1);
        assert.strictEqual(res.tierUsed, 'primary_api');
        assert.strictEqual(tier2Called, false, 'Tier 2 no debe haber sido llamado');
    });

    // Test 3: Falla en Tier 1 Escala Automáticamente a Tier 2
    await testAsync('Falla en Tier 1 conmuta automáticamente a Tier 2 (Degradación Elegante)', async () => {
        const chain = new FallbackChain('test_degrade', 'Cadena Degradación');
        chain.addTier({
            name: 'failing_primary',
            execute: async () => { throw new Error('API 503 Service Unavailable'); }
        });
        chain.addTier({
            name: 'working_secondary',
            execute: async () => 'RECOVERED_FROM_SECONDARY'
        });

        const res = await chain.execute();
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.result, 'RECOVERED_FROM_SECONDARY');
        assert.strictEqual(res.isDegraded, true);
        assert.strictEqual(res.tierIndex, 2);
        assert.strictEqual(res.tierUsed, 'working_secondary');
        assert.strictEqual(res.tiersAttempted.length, 1);
        assert.strictEqual(res.tiersAttempted[0].tier, 'failing_primary');
    });

    // Test 4: Escalamiento a Tier 3 (Último Recurso)
    await testAsync('Fallas en Tier 1 y Tier 2 escalan con éxito a Tier 3 (Último Recurso)', async () => {
        const chain = new FallbackChain('test_tier3', 'Cadena 3 Tiers');
        chain.addTier({
            name: 'tier1',
            execute: async () => { throw new Error('Tier 1 error'); }
        });
        chain.addTier({
            name: 'tier2',
            execute: async () => { throw new Error('Tier 2 error'); }
        });
        chain.addTier({
            name: 'tier3_last_resort',
            execute: async () => 'LAST_RESORT_SUCCESS'
        });

        const res = await chain.execute();
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.result, 'LAST_RESORT_SUCCESS');
        assert.strictEqual(res.tierIndex, 3);
        assert.strictEqual(res.tiersAttempted.length, 2);
    });

    // Test 5: Fast-Skip Inmediato por Circuit Breaker OPEN
    await testAsync('Si el Circuit Breaker de Tier 1 está OPEN, salta directamente a Tier 2 en <1ms', async () => {
        const breakerResource = `cb_fast_skip_${Date.now()}`;
        const breaker = circuitBreakerManager.getBreaker(breakerResource, { failureThreshold: 1, cooldownPeriodMs: 120000 });
        breaker.recordFailure(); // Abrir circuito

        assert.strictEqual(breaker.isOpen(), true);

        const chain = new FallbackChain('test_fast_skip', 'Prueba Fast Skip');
        let tier1Executed = false;

        chain.addTier({
            name: 'open_breaker_tier',
            circuitBreakerResource: breakerResource,
            execute: async () => { tier1Executed = true; return 'NO'; }
        });
        chain.addTier({
            name: 'fallback_tier',
            execute: async () => 'FAST_FALLBACK_OK'
        });

        const start = Date.now();
        const res = await chain.execute();
        const duration = Date.now() - start;

        assert.strictEqual(tier1Executed, false, 'Tier 1 con circuito abierto NUNCA debe ejecutarse');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.result, 'FAST_FALLBACK_OK');
        assert.strictEqual(res.tierIndex, 2);
        assert.ok(duration < 20, `Debe haber realizado Fast-Skip en <20ms (tomó ${duration}ms)`);
        assert.strictEqual(res.tiersAttempted[0].status, 'skipped_circuit_open');
    });

    // Test 6: Cadena de Spotify (Simulación de Cascada API -> App -> Media Key)
    await testAsync('Cadena Spotify conmuta correctamente ante indisponibilidad de la API', async () => {
        const chain = new FallbackChain('spotify_mock', 'Spotify Mock');
        
        // Simular Tier 1 (API sin token)
        chain.addTier({
            name: 'spotify_api',
            execute: async () => { throw new Error('No autenticado con Spotify.'); }
        });
        // Simular Tier 2 (App Windows no disponible o fallo de foco)
        chain.addTier({
            name: 'windows_app_search',
            execute: async () => { throw new Error('Proceso de Spotify no encontrado en Windows'); }
        });
        // Simular Tier 3 (Atajo multimedia global)
        chain.addTier({
            name: 'global_media_key',
            execute: async () => 'Enviado atajo multimedia Play a Windows.'
        });

        const res = await chain.execute({ query: 'Queen' });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.tierIndex, 3);
        assert.strictEqual(res.tierUsed, 'global_media_key');
        assert.strictEqual(res.isDegraded, true);
        assert.strictEqual(res.tiersAttempted.length, 2);
    });

    // Test 7: Cadena de TV (LAN -> BroadLink IR)
    await testAsync('Cadena TV conmuta de LAN API a BroadLink Infrarrojo', async () => {
        const chain = new FallbackChain('tv_mock', 'TV Mock');
        chain.addTier({
            name: 'tv_lan_api',
            execute: async () => { throw new Error('TV no tiene IP LAN configurada.'); }
        });
        chain.addTier({
            name: 'broadlink_ir',
            execute: async () => ({ ok: true, method: 'broadlink_ir', command: 'vol_up' })
        });

        const res = await chain.execute({ command: 'vol_up' });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.tierIndex, 2);
        assert.strictEqual(res.tierUsed, 'broadlink_ir');
        assert.strictEqual(res.result.method, 'broadlink_ir');
    });

    // Test 8: Cadena de Búsqueda Web (SearXNG -> DuckDuckGo -> Bing)
    await testAsync('Cadena Web conmuta de SearXNG a DuckDuckGo y finalmente a Bing', async () => {
        const chain = new FallbackChain('web_mock', 'Web Mock');
        chain.addTier({
            name: 'searxng',
            execute: async () => { throw new Error('SearXNG local instance offline (connection refused :8888)'); }
        });
        chain.addTier({
            name: 'duckduckgo',
            execute: async () => { throw new Error('DuckDuckGo rate limited HTTP 429'); }
        });
        chain.addTier({
            name: 'bing',
            execute: async (params) => ({ source: 'bing', query: params.query })
        });

        const res = await chain.execute({ query: 'clima buenos aires' });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.tierIndex, 3);
        assert.strictEqual(res.tierUsed, 'bing');
        assert.strictEqual(res.result.source, 'bing');
    });

    // Test 9: Manejo de Falla Total cuando todos los Tiers fallan
    await testAsync('Retorna error informativo cuando todos los tiers fallan', async () => {
        const chain = new FallbackChain('all_fail', 'Cadena Rota');
        chain.addTier({ name: 't1', execute: async () => { throw new Error('e1'); } });
        chain.addTier({ name: 't2', execute: async () => { throw new Error('e2'); } });

        const res = await chain.execute();
        assert.strictEqual(res.ok, false);
        assert.ok(res.error.includes('Todos los niveles de fallback (2) fallaron'));
        assert.strictEqual(res.tiersAttempted.length, 2);
    });

    // Test 10: Auditoría en Structured Logs de Intentos y Resolución
    await testAsync('Cada intento y resolución queda auditada en structured_logs', async () => {
        const testId = `audit_chain_${Date.now()}`;
        const chain = new FallbackChain(testId, 'Audit Chain');
        chain.addTier({ name: 'fail_t1', execute: async () => { throw new Error('fail t1'); } });
        chain.addTier({ name: 'ok_t2', execute: async () => 'RESOLVED' });

        await chain.execute();

        const logsResolved = structuredLogger.query({ module: 'fallbackEngine', action: `tier_resolved_${testId}` });
        assert.ok(logsResolved.length > 0, 'Debe registrar la resolución en structured_logs');

        const logsFailed = structuredLogger.query({ module: 'fallbackEngine', action: `tier_failed_${testId}` });
        assert.ok(logsFailed.length > 0, 'Debe registrar el fallo del tier 1 en structured_logs');
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 36 PASARON EXITOSAMENTE.\n');
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
