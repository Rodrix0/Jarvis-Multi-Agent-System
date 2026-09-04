const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n======================================================');
console.log('  🧪 EJECUTANDO BATERÍA DE PRUEBAS DE RESILIENCIA Y CAOS');
console.log('======================================================\n');

// 1. Probar Base de Datos SQLite, Migraciones y Hash Chain
const databaseService = require('../services/persistence/databaseService');
console.log('[1/7] 📦 Verificando SQLite WAL y Hash-Chain Cryptographic Integrity...');
const isChainValid = databaseService.verifyAuditChainIntegrity();
assert.strictEqual(isChainValid, true, 'La cadena de auditoría SHA-256 debe ser íntegra.');
console.log('  ✅ Integridad de Hash-Chain verificada.');

// 2. Probar Security Policy y Denylist de Procesos/Rutas
const securityPolicyService = require('../services/core/securityPolicyService');
console.log('[2/7] 🛡️ Verificando Denylist de Procesos y Protección de Rutas...');
const procCheck = securityPolicyService.validateProcessKill('explorer.exe');
assert.strictEqual(procCheck.allowed, false, 'explorer.exe debe estar protegido por la Denylist.');
const pathCheck = securityPolicyService.validatePathAccess('C:\\Windows\\System32\\test.dll', true);
assert.strictEqual(pathCheck.allowed, false, 'C:\\Windows debe estar protegido de operaciones destructivas.');
console.log('  ✅ Denylist de procesos y protección de rutas críticas validadas.');

// 3. Probar Emergency Stop y Latencia (<250ms)
const emergencyService = require('../services/core/emergencyService');
console.log('[3/7] 🚨 Verificando Emergency Stop y Latencia de Señal (<250ms)...');
const emergencyResult = emergencyService.triggerEmergencyStop('CHAOS_TEST');
assert.strictEqual(emergencyResult.ok, true);
assert.strictEqual(emergencyResult.cancelSignalLatencyMs < 250, true, `La latencia (${emergencyResult.cancelSignalLatencyMs}ms) debe ser < 250ms.`);
console.log(`  ✅ Emergency Stop ejecutado con latencia: ${emergencyResult.cancelSignalLatencyMs}ms (<250ms OK).`);

// 4. Probar JarvisTrash con Rollback
const trashService = require('../services/core/trashService');
console.log('[4/7] 🗑️ Verificando JarvisTrash y Rollback Seguro...');
const testFilePath = path.join(os.tmpdir(), `test_jarvis_${Date.now()}.txt`);
fs.writeFileSync(testFilePath, 'Contenido de prueba de Jarvis OS', 'utf8');

const trashResult = trashService.moveToTrash(testFilePath);
assert.strictEqual(trashResult.ok, true);
assert.strictEqual(fs.existsSync(testFilePath), false, 'El archivo original debe haber sido movido a la papelera.');

const restoreResult = trashService.restoreFromTrash(trashResult.trashId);
assert.strictEqual(restoreResult.ok, true);
assert.strictEqual(fs.existsSync(testFilePath), true, 'El archivo debe haber sido restaurado con éxito.');
fs.unlinkSync(testFilePath);
console.log('  ✅ Mover a papelera y restauración con rollback completados.');

// 5. Probar Tokens de Autorización Ligados (Single-Use, 30s)
const authorizationManager = require('../services/core/authorizationManager');
console.log('[5/7] 🔑 Verificando Tokens de Autorización Ligados a Acción...');
const tokenObj = authorizationManager.createToken({ action: 'file.delete', params: { file: 'doc.pdf' } });
const validUse = authorizationManager.validateAndConsumeToken(tokenObj.token, 'file.delete', { file: 'doc.pdf' });
assert.strictEqual(validUse.valid, true);

// Segundo uso debe fallar (Single Use)
const replayUse = authorizationManager.validateAndConsumeToken(tokenObj.token, 'file.delete', { file: 'doc.pdf' });
assert.strictEqual(replayUse.valid, false, 'El token no debe poder ser reutilizado.');
console.log('  ✅ Tokens criptográficos de un solo uso validados.');

// 6. Probar Goal Manager y Schema Validator
const goalManagerService = require('../services/goals/goalManagerService');
const planValidatorService = require('../services/ai/planValidatorService');
console.log('[6/7] 🎯 Verificando Goal Manager y Plan Schema Validator...');
const goal = goalManagerService.createGoal({
    title: 'Prueba de Meta Compleja',
    priority: 'HIGH',
    subgoals: ['Paso A', 'Paso B']
});
assert.strictEqual(goal.status, 'IN_PROGRESS');
assert.strictEqual(goal.subgoals.length, 2);

const invalidPlanCheck = planValidatorService.validatePlanSchema({ goal: 'Invalido', steps: [{ id: '1', tool: 'herramienta_inexistente' }] });
assert.strictEqual(invalidPlanCheck.valid, false, 'Plan con herramientas no registradas debe ser rechazado.');
console.log('  ✅ Goal Manager y Plan Validator validados.');

// 7. Probar Memoria con Cifrado At-Rest
const memoryService = require('../services/memory/memoryService');
console.log('[7/7] 🧠 Verificando Memoria con Cifrado At-Rest...');
memoryService.addMemory({
    type: 'PREFERENCE',
    tier: 'SENSITIVE',
    key: 'api_key_test',
    value: 'CLAVE_SUPER_SECRETA_123',
    source: 'explicit_user_statement'
});
const memUnauthorized = memoryService.queryMemory('api_key_test', false);
assert.strictEqual(memUnauthorized[0].value, '[ENCRYPTED_SENSITIVE_DATA]', 'Sin autorización debe permanecer cifrado.');
const memAuthorized = memoryService.queryMemory('api_key_test', true);
assert.strictEqual(memAuthorized[0].value, 'CLAVE_SUPER_SECRETA_123', 'Con autorización debe descifrarse correctamente.');
console.log('  ✅ Cifrado at-rest y descifrado on-demand de memoria validados.');

console.log('\n======================================================');
console.log('  🎉 TODAS LAS 7 PRUEBAS DE CAOS PASARON CON ÉXITO (100%)');
console.log('======================================================\n');
