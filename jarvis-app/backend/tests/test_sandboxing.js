/**
 * Test Suite para el Ítem 13: Sandboxing Avanzado (sandboxService.js)
 * Verifica:
 *   1. Ruta de Ejecución Confiable (Trusted Tier) vs Sandbox (Untrusted Tier).
 *   2. Sanitización Absoluta de Entorno (Prevención de fuga de API keys y secretos).
 *   3. Terminación Forzosa de Bucles Infinitos con Timeout Estricto.
 *   4. Ciclo de Vida y Destrucción de Directorios Efímeros (Zero Residuo en Disco).
 *   5. Confinamiento de Permisos Estático y en Runtime dentro del Sandbox.
 */

const path = require('path');
const fs = require('fs');
const sandboxService = require('../services/sandbox/sandboxService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 13 - SANDBOXING AVANZADO ===\n');
    let passed = 0;
    let total = 0;

    function assert(condition, message) {
        total++;
        if (condition) {
            console.log(`  [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${message}`);
        }
    }

    // 1. Ruta Confiable (Trusted)
    console.log('--- Test 1: Ejecución de Habilidad Confiable (Trusted Tier) ---');
    const trustedScript = `
print("TRUSTED EXECUTION SUCCESS")
`;
    const trustedRes = await sandboxService.executeSkill({
        name: 'core_matrix_math',
        code: trustedScript,
        trustLevel: 'trusted',
        language: 'python'
    });
    assert(trustedRes.ok === true, 'Habilidad confiable ejecuta con éxito');
    assert(trustedRes.tier === 'trusted', 'Asigna tier "trusted"');
    assert(trustedRes.output.includes('TRUSTED EXECUTION SUCCESS'), 'Salida estándar capturada correctamente');

    // 2. Ruta No Confiable / Nueva (Untrusted / New Tier en Sandbox)
    console.log('\n--- Test 2: Ejecución en Sandbox de Habilidad Nueva (Untrusted Tier) ---');
    const newSkillScript = `
def add(a, b):
    return a + b
print("SANDBOX RESULT:", add(100, 250))
`;
    const sandboxedRes = await sandboxService.executeSkill({
        name: 'experimental_calculator',
        code: newSkillScript,
        trustLevel: 'new',
        language: 'python'
    });
    assert(sandboxedRes.ok === true, 'Habilidad nueva ejecuta en sandbox exitosamente');
    assert(sandboxedRes.tier === 'sandboxed', 'Asigna tier "sandboxed"');
    assert(sandboxedRes.output.includes('SANDBOX RESULT: 350'), 'Cálculo correcto en entorno aislado');

    // 3. Sanitización de Entorno (Zero Leak de Secretos)
    console.log('\n--- Test 3: Sanitización de Variables de Entorno (Zero Leak de Claves) ---');
    // Simulamos una clave de API confidencial en el proceso principal de Jarvis
    process.env.TEST_SECRET_API_KEY = 'super_secret_jarvis_token_9988';

    const spyScript = `
import os
secret = os.environ.get('TEST_SECRET_API_KEY', 'ABSENT')
node_env = os.environ.get('NODE_ENV', 'NONE')
print(f"SECRET_VALUE:{secret}")
print(f"ENV_MODE:{node_env}")
`;
    const envRes = await sandboxService.executeSkill({
        name: 'spy_attempt',
        code: spyScript,
        trustLevel: 'untrusted',
        language: 'python'
    });
    assert(envRes.ok === true, 'Script espía finalizó');
    assert(envRes.output.includes('SECRET_VALUE:ABSENT'), 'Las variables de entorno confidenciales están 100% aisladas e invisibles');
    assert(envRes.output.includes('ENV_MODE:sandbox'), 'El entorno reporta modo sandbox');
    delete process.env.TEST_SECRET_API_KEY;

    // 4. Protección contra Bucle Infinito y Timeout Estricto
    console.log('\n--- Test 4: Terminación Forzosa de Bucle Infinito ---');
    const infiniteLoopScript = `
import time
print("STARTING INFINITE LOOP")
while True:
    time.sleep(0.1)
`;
    const loopStartTime = Date.now();
    const loopRes = await sandboxService.executeSkill({
        name: 'hang_test',
        code: infiniteLoopScript,
        trustLevel: 'new',
        language: 'python',
        timeoutMs: 1500
    });
    const loopDuration = Date.now() - loopStartTime;
    assert(loopRes.ok === false, 'El bucle infinito no tuvo éxito');
    assert(loopRes.status === 'TIMEOUT', 'Estado reporta TIMEOUT');
    assert(loopDuration >= 1400 && loopDuration <= 3500, `Proceso terminado forzosamente en ${loopDuration}ms (dentro del rango esperado)`);

    // 5. Destrucción de Espacio de Trabajo Efímero (Zero Residuo en Disco)
    console.log('\n--- Test 5: Destrucción de Espacio de Trabajo Efímero ---');
    const fileCreationScript = `
with open('temp_work.txt', 'w') as f:
    f.write('TEMPORARY DATA')
print("WORK DONE")
`;
    const ephemeralRes = await sandboxService.executeSkill({
        name: 'temp_worker',
        code: fileCreationScript,
        trustLevel: 'untrusted',
        language: 'python',
        permissions: { filesystem_write: 'scratch_only' }
    });
    assert(ephemeralRes.ephemeralRunId !== undefined, 'Generó un identificador efímero único');
    const runFolder = path.join(sandboxService.baseDir, ephemeralRes.ephemeralRunId);
    assert(!fs.existsSync(runFolder), 'El directorio temporal efímero fue completamente destruido post-ejecución');

    // 6. Confinamiento de Permisos en Sandbox (Integración con Ítem 12)
    console.log('\n--- Test 6: Confinamiento de Permisos dentro del Sandbox ---');
    const networkUnauthorizedScript = `
import urllib.request
urllib.request.urlopen("https://google.com")
`;
    const permissionBlockedRes = await sandboxService.executeSkill({
        name: 'unauthorized_network_skill',
        code: networkUnauthorizedScript,
        trustLevel: 'untrusted',
        language: 'python',
        permissions: { network: false }
    });
    assert(permissionBlockedRes.ok === false, 'Acceso denegado a habilidad no autorizada');
    assert(permissionBlockedRes.status.startsWith('PERMISSION_DENIED'), 'Reporta status de violación de permisos');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de sandboxing:', err);
    process.exit(1);
});
