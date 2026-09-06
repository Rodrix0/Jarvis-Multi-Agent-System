/**
 * test_secret_vault.js
 * 
 * Suite de pruebas unitarias para el Ítem 39:
 * Secret Manager (Bóveda Criptográfica AES-256-GCM, Aislamiento del LLM y Tokens Ciegos Efímeros).
 */

const assert = require('assert');
const fs = require('fs');
const { secretVaultService } = require('../services/security/secretVaultService');
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
    console.log('🔐 INICIANDO SUITE DE PRUEBAS: ÍTEM 39 - SECRET MANAGER');
    console.log('===============================================================\n');

    const testKey = `spotify_pass_${Date.now()}`;
    const testSecret = 'SuperSecretP@ssw0rd!2026';

    // Test 1: Almacenamiento y Cifrado de Secreto
    test('storeSecret cifra y almacena un secreto exitosamente', () => {
        const res = secretVaultService.storeSecret(testKey, testSecret, { description: 'Contraseña de Spotify' });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.key, testKey);

        const retrieved = secretVaultService.getSecret(testKey);
        assert.strictEqual(retrieved, testSecret, 'El secreto descifrado debe coincidir exactamente');
    });

    // Test 2: Inviolabilidad en Disco (El archivo vault.enc no contiene texto plano)
    test('El archivo vault.enc en disco está 100% cifrado y no contiene el secreto en texto plano', () => {
        assert.ok(fs.existsSync(secretVaultService.vaultFile), 'vault.enc debe existir');
        const rawContent = fs.readFileSync(secretVaultService.vaultFile, 'utf8');

        assert.strictEqual(rawContent.includes(testSecret), false, 'El secreto NUNCA debe estar en texto plano en disco');
    });

    // Test 3: listSecrets() NUNCA expone contraseñas ni hashes
    test('listSecrets() devuelve metadatos seguros sin revelar valores ni hashes', () => {
        const list = secretVaultService.listSecrets();
        assert.ok(Array.isArray(list));

        const item = list.find(s => s.key === testKey);
        assert.ok(item, 'Debe listar la clave guardada');
        assert.strictEqual(item.key, testKey);
        assert.strictEqual(item.description, 'Contraseña de Spotify');
        assert.ok(item.createdAt);
        assert.ok(item.updatedAt);

        // Verificar que no existan campos sensibles
        assert.strictEqual('value' in item, false, 'No debe contener campo value');
        assert.strictEqual('secret' in item, false, 'No debe contener campo secret');
        assert.strictEqual('hash' in item, false, 'No debe contener campo hash');
    });

    // Test 4: Emisión de Token Ciego Efímero para el LLM
    test('getSecretToken() emite un token opaco efímero sec_tok_... para el LLM', () => {
        const tokenData = secretVaultService.getSecretToken(testKey, 300, true);

        assert.ok(tokenData.token, 'Debe generar un token');
        assert.ok(tokenData.token.startsWith('sec_tok_'), 'El token debe comenzar con sec_tok_');
        assert.strictEqual(tokenData.key, testKey);
        assert.strictEqual(tokenData.ttlSeconds, 300);
        assert.ok(tokenData.expiresAt);
        assert.strictEqual(tokenData.token.includes(testSecret), false, 'El token no debe contener el secreto');
    });

    // Test 5: Resolución de Token Efímero en Memoria Privada
    test('resolveToken() resuelve el secreto real en memoria volátil de ejecución', () => {
        const tokenData = secretVaultService.getSecretToken(testKey, 300, true);
        const resolved = secretVaultService.resolveToken(tokenData.token);

        assert.strictEqual(resolved, testSecret, 'Debe devolver el secreto correspondiente');
    });

    // Test 6: Protección de Un Solo Uso (Single-Use Token Consumption)
    test('Los tokens de un solo uso (single-use) son purgados inmediatamente al ser resueltos', () => {
        const tokenData = secretVaultService.getSecretToken(testKey, 300, true);

        // Primer uso: Resuelve
        const firstUse = secretVaultService.resolveToken(tokenData.token);
        assert.strictEqual(firstUse, testSecret);

        // Segundo uso: Debe fallar / retornar null
        const secondUse = secretVaultService.resolveToken(tokenData.token);
        assert.strictEqual(secondUse, null, 'Un token consumido no puede volver a ser utilizado');
    });

    // Test 7: Rechazo de Tokens Expirados
    test('resolveToken() rechaza tokens cuya vigencia TTL haya expirado', () => {
        // Token con 0 segundos de TTL
        const tokenData = secretVaultService.getSecretToken(testKey, -1, false);
        const resolved = secretVaultService.resolveToken(tokenData.token);

        assert.strictEqual(resolved, null, 'Tokens con TTL vencido deben ser rechazados');
    });

    // Test 8: Eliminación de Secreto Revoca Tokens Activos
    test('deleteSecret() elimina el secreto y revoca automáticamente tokens existentes', () => {
        const ephemeralKey = `temp_del_${Date.now()}`;
        secretVaultService.storeSecret(ephemeralKey, 'TempValue123');
        const tokenData = secretVaultService.getSecretToken(ephemeralKey, 300, false);

        // Eliminar secreto
        const deleted = secretVaultService.deleteSecret(ephemeralKey);
        assert.strictEqual(deleted, true);

        // El secreto ya no existe
        assert.strictEqual(secretVaultService.getSecret(ephemeralKey), null);

        // El token queda revocado
        assert.strictEqual(secretVaultService.resolveToken(tokenData.token), null);
    });

    // Test 9: Sanitización Absoluta en Structured Logs
    test('StructuredLogger redacta automáticamente cualquier campo de secreto o token', () => {
        const logEntry = structuredLogger.log({
            module: 'authTest',
            action: 'authenticate',
            metadata: {
                username: 'jarvis_user',
                password: testSecret,
                token: 'sec_tok_1234567890',
                client_secret: 'ABC_XYZ_SECRET'
            }
        });

        assert.strictEqual(logEntry.metadata.password, '***REDACTED***');
        assert.strictEqual(logEntry.metadata.token, '***REDACTED***');
        assert.strictEqual(logEntry.metadata.client_secret, '***REDACTED***');
        assert.strictEqual(logEntry.metadata.username, 'jarvis_user');
    });

    // Limpieza
    secretVaultService.deleteSecret(testKey);

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 39 PASARON EXITOSAMENTE.\n');
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
