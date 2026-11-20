/**
 * test_structured_logger.js
 * 
 * Suite de pruebas unitarias para el Ítem 33:
 * Logs Estructurados, Persistencia Dual (JSONL + SQLite) y Motor Forense de Diagnóstico.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const structuredLogger = require('../services/diagnostics/structuredLoggerService');
const databaseService = require('../services/persistence/databaseService');
const actionKernel = require('../services/actionKernelService');

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
    console.log('📝 INICIANDO SUITE DE PRUEBAS: ÍTEM 33 - LOGS ESTRUCTURADOS');
    console.log('===============================================================\n');

    // Test 1: Esquema Canónico
    test('Entrada estructurada contiene todos los campos canónicos requeridos', () => {
        const entry = structuredLogger.log({
            module: 'testModule',
            action: 'testAction',
            result: 'success',
            duration: 120,
            metadata: { user: 'Rodrigo' }
        });

        assert.ok(entry.id, 'Debe tener un ID único');
        assert.ok(entry.timestamp, 'Debe tener timestamp ISO');
        assert.strictEqual(entry.module, 'testModule');
        assert.strictEqual(entry.action, 'testAction');
        assert.strictEqual(entry.result, 'success');
        assert.strictEqual(entry.duration, 120);
        assert.strictEqual(entry.level, 'INFO');
        assert.strictEqual(entry.metadata.user, 'Rodrigo');
    });

    // Test 2: Sanitización de Secretos y Credenciales
    test('Sanitización automática de contraseñas, tokens y claves secretas', () => {
        const entry = structuredLogger.log({
            module: 'authService',
            action: 'login',
            metadata: {
                username: 'admin',
                password: 'superSecretPassword123!',
                api_token: 'Bearer eyJhbGciOi...',
                nested: {
                    apiKey: 'XYZ987654321',
                    safeData: 42
                }
            }
        });

        assert.strictEqual(entry.metadata.password, '***REDACTED***');
        assert.strictEqual(entry.metadata.api_token, '***REDACTED***');
        assert.strictEqual(entry.metadata.nested.apiKey, '***REDACTED***');
        assert.strictEqual(entry.metadata.nested.safeData, 42);
    });

    // Test 3: Persistencia en Archivo Rotativo JSONL
    await testAsync('Persistencia asíncrona en archivo .jsonl diario', async () => {
        const testActionName = `jsonl_test_${Date.now()}`;
        structuredLogger.info('testModule', testActionName, { check: true });

        // Dar un pequeño margen para el flush en disco
        await new Promise(r => setTimeout(r, 100));

        const logFile = structuredLogger.getDailyLogFilePath();
        assert.ok(fs.existsSync(logFile), 'El archivo de logs diario .jsonl debe existir');

        const content = fs.readFileSync(logFile, 'utf8');
        assert.ok(content.includes(testActionName), 'El archivo debe contener el registro guardado');
    });

    // Test 4: Persistencia e Indexación en SQLite
    test('Persistencia indexada en tabla structured_logs de SQLite', () => {
        const uniqueAction = `sqlite_act_${Date.now()}`;
        structuredLogger.log({
            module: 'spotifyService',
            action: uniqueAction,
            result: 'error',
            duration: 431,
            error: {
                code: 'window_not_found',
                message: 'No se encontró la ventana de Spotify'
            },
            metadata: { track: 'Bohemian Rhapsody' }
        });

        const results = structuredLogger.query({ module: 'spotifyService', action: uniqueAction });
        assert.ok(results.length > 0, 'Debe encontrar el registro en SQLite');
        const retrieved = results[0];
        assert.strictEqual(retrieved.result, 'error');
        assert.strictEqual(retrieved.duration, 431);
        assert.strictEqual(retrieved.error.code, 'window_not_found');
        assert.strictEqual(retrieved.metadata.track, 'Bohemian Rhapsody');
    });

    // Test 5: Helper time() con éxito cronometrado
    await testAsync('Wrapper time() cronometra operaciones asíncronas exitosas', async () => {
        const uniqueAction = `time_success_${Date.now()}`;
        const output = await structuredLogger.time('databaseService', uniqueAction, async () => {
            await new Promise(r => setTimeout(r, 60));
            return 'OK_DONE';
        }, { tag: 'unit_test' });

        assert.strictEqual(output, 'OK_DONE');

        const logs = structuredLogger.query({ module: 'databaseService', action: uniqueAction });
        assert.ok(logs.length > 0, 'Debe haber registrado el log con time()');
        assert.strictEqual(logs[0].result, 'success');
        assert.ok(logs[0].duration >= 50, `Duración registrada (${logs[0].duration}ms) debe ser >= 50ms`);
    });

    // Test 6: Helper time() capturando excepciones y re-lanzando limpiamente
    await testAsync('Wrapper time() captura errores, registra estado error y re-lanza excepción', async () => {
        const uniqueAction = `time_error_${Date.now()}`;
        let caught = false;

        try {
            await structuredLogger.time('spotifyService', uniqueAction, async () => {
                await new Promise(r => setTimeout(r, 30));
                const err = new Error('Spotify API 404');
                err.code = 'api_not_found';
                throw err;
            });
        } catch (e) {
            caught = true;
            assert.strictEqual(e.code, 'api_not_found');
        }

        assert.ok(caught, 'La excepción debe haber sido re-lanzada');

        const logs = structuredLogger.query({ module: 'spotifyService', action: uniqueAction });
        assert.ok(logs.length > 0, 'Debe haberse guardado el log de error');
        assert.strictEqual(logs[0].result, 'error');
        assert.strictEqual(logs[0].error.code, 'api_not_found');
        assert.strictEqual(logs[0].level, 'ERROR');
    });

    // Test 7: Query con filtros combinados en SQLite
    test('query() soporta filtros por module, result, level y límite', () => {
        const tag = `batch_${Date.now()}`;
        structuredLogger.info('searchModule', 'search', { tag });
        structuredLogger.warn('searchModule', 'search', 'Slow query warning', { tag });
        structuredLogger.error('searchModule', 'search', new Error('Timeout'), { tag });

        const errorsOnly = structuredLogger.query({ module: 'searchModule', result: 'error', limit: 10 });
        assert.ok(errorsOnly.length >= 1, 'Debe filtrar únicamente errores');
        assert.ok(errorsOnly.every(e => e.result === 'error'));

        const warnsOnly = structuredLogger.query({ module: 'searchModule', level: 'WARN', limit: 10 });
        assert.ok(warnsOnly.length >= 1);
        assert.ok(warnsOnly.every(w => w.level === 'WARN'));
    });

    // Test 8: Motor Forense de Diagnóstico Autónomo ante fallas recurrentes
    test('Motor Forense sintetiza incidentes y provee explicaciones contextuales y recomendaciones', () => {
        // Inyectar errores conocidos para evaluación forense
        const mod = `spotifyService_forensic_${Date.now()}`;
        for (let i = 0; i < 3; i++) {
            structuredLogger.log({
                module: mod,
                action: 'play',
                result: 'error',
                duration: 200 + i * 50,
                error: { code: 'window_not_found', message: 'No se encontró la ventana' }
            });
        }

        const diagnosis = structuredLogger.diagnose(1);
        assert.strictEqual(diagnosis.status, 'DEGRADED');
        assert.ok(diagnosis.totalDistinctErrors >= 1);
        
        // Verificar reporte descriptivo
        const relevantReport = diagnosis.diagnosticReports.find(r => r.includes(mod));
        assert.ok(relevantReport, 'Debe haber un reporte diagnóstico que mencione el módulo fallido');
        assert.ok(relevantReport.includes('window_not_found'));
        assert.ok(relevantReport.includes('Causa probable: La aplicación de Spotify no está iniciada'));

        // Verificar recomendaciones generadas
        assert.ok(diagnosis.recommendations.some(r => r.includes('Spotify')));
    });

    // Test 9: Integración de ActionKernel con StructuredLogger
    await testAsync('actionKernelService registra automáticamente cada ejecución en structured_logs', async () => {
        // Ejecutar una acción registrada en actionKernel
        const testActionId = `test_action_${Date.now()}`;
        actionKernel.register({
            id: testActionId,
            name: 'Prueba de Kernel Estructurado',
            permission: 'READ_ONLY',
            execute: async () => ({ ok: true, message: 'Operación simulada completada' })
        });

        const execResult = await actionKernel.execute(testActionId, { test: 123 });
        assert.ok(execResult.ok);

        const logs = structuredLogger.query({ module: 'actionKernel', action: testActionId });
        assert.ok(logs.length > 0, 'actionKernel debe haber emitido el log estructurado');
        assert.strictEqual(logs[0].result, 'success');
        assert.strictEqual(logs[0].module, 'actionKernel');
    });

    // Test 10: Integración de fallos en ActionKernel
    await testAsync('actionKernelService registra errores con detalles en structured_logs cuando falla una acción', async () => {
        const failActionId = `test_fail_${Date.now()}`;
        actionKernel.register({
            id: failActionId,
            name: 'Prueba de Kernel con Fallo',
            permission: 'READ_ONLY',
            execute: async () => { throw new Error('Dispositivo no conectado'); }
        });

        const execResult = await actionKernel.execute(failActionId, {});
        assert.strictEqual(execResult.ok, false);

        const logs = structuredLogger.query({ module: 'actionKernel', action: failActionId });
        assert.ok(logs.length > 0, 'Debe existir log de fallo registrado');
        assert.strictEqual(logs[0].result, 'error');
        assert.ok(logs[0].error.message.includes('Dispositivo no conectado'));
    });

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 33 PASARON EXITOSAMENTE.\n');
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
