const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const fastCommandParser = require('../services/ai/fastCommandParser');
const { malwareScannerService } = require('../services/security/malwareScannerService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService');

async function runTests() {
    console.log('===============================================================');
    console.log('🛡️  INICIANDO SUITE: SISTEMA DE ANTIVIRUS Y SALUD DE PC (JARVIS)');
    console.log('===============================================================\n');

    // TEST 1: Enrutamiento ultra-rápido de comandos de seguridad
    console.log('--- TEST 1: Enrutamiento determinista de lenguaje natural ---');
    const cases = [
        ['analizá mi equipo', 'security.system-health'],
        ['fijate si tengo virus', 'security.system-health'],
        ['como esta la salud de mi pc', 'security.system-health'],
        ['mi pc esta sana', 'security.system-health'],
        ['escanea la ultima descarga', 'security.scan-latest-download'],
        ['fijate si lo que descargue tiene virus', 'security.scan-latest-download'],
        ['analiza el juego descargado', 'security.scan-latest-download'],
        ['mira si lo que baje es seguro', 'security.scan-latest-download'],
        ['hace un escaneo de virus', 'security.system-scan']
    ];

    for (const [phrase, expectedAction] of cases) {
        const parsed = fastCommandParser.parse(phrase);
        assert.strictEqual(parsed.match, true, `Debe coincidir con la frase: "${phrase}"`);
        assert.strictEqual(parsed.action, expectedAction, `Acción esperada: ${expectedAction} para "${phrase}"`);
        console.log(`  ✅ [PASS] "${phrase}" -> ${expectedAction}`);
    }

    // TEST 2: Cálculo criptográfico de SHA-256
    console.log('\n--- TEST 2: Cálculo criptográfico SHA-256 por streaming ---');
    const tempTestFile = path.join(os.tmpdir(), `jarvis_av_test_${Date.now()}.txt`);
    fs.writeFileSync(tempTestFile, 'JARVIS ANTIVIRUS TEST CONTENT 2026');
    const hash = await malwareScannerService.calculateSha256(tempTestFile);
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64, 'El hash SHA-256 debe tener 64 caracteres');
    console.log(`  ✅ [PASS] Hash calculado con éxito: ${hash.substring(0, 16)}...`);

    // TEST 3: Escaneo de archivo local con Windows Defender
    console.log('\n--- TEST 3: Escaneo de archivo local ---');
    const scanResult = await malwareScannerService.scanFile(tempTestFile);
    assert.strictEqual(scanResult.ok, true);
    assert.strictEqual(scanResult.status, 'CLEAN');
    assert.strictEqual(scanResult.isDangerous, false);
    console.log(`  ✅ [PASS] Archivo escaneado y reportado como limpio: ${scanResult.message}`);

    // TEST 4: Aislamiento en cuarentena y eliminación
    console.log('\n--- TEST 4: Flujo de cuarentena y neutralización de amenazas ---');
    const qResult = await malwareScannerService.quarantineFile(tempTestFile);
    assert.strictEqual(qResult.ok, true);
    assert.strictEqual(fs.existsSync(tempTestFile), false, 'El archivo original debe removerse del lugar original');
    assert.strictEqual(fs.existsSync(qResult.quarantinePath), true, 'El archivo debe existir en la carpeta de cuarentena');
    console.log(`  ✅ [PASS] Archivo aislado en cuarentena: ${path.basename(qResult.quarantinePath)}`);

    const delResult = await malwareScannerService.deleteFile(qResult.quarantinePath);
    assert.strictEqual(delResult.ok, true);
    assert.strictEqual(fs.existsSync(qResult.quarantinePath), false, 'El archivo debe eliminarse por completo');
    console.log(`  ✅ [PASS] Archivo eliminado permanentemente de la cuarentena.`);

    // TEST 5: Diagnóstico de salud general del equipo
    console.log('\n--- TEST 5: Diagnóstico de salud del PC (Windows Defender API) ---');
    const health = await malwareScannerService.getSystemHealth();
    assert.strictEqual(health.ok, true);
    assert.strictEqual(typeof health.isHealthy, 'boolean');
    assert.strictEqual(typeof health.realTimeProtection, 'boolean');
    assert.strictEqual(typeof health.activeThreatsCount, 'number');
    console.log(`  ✅ [PASS] Diagnóstico obtenido: Estado sano=${health.isHealthy}, Amenazas activas=${health.activeThreatsCount}, Protección tiempo real=${health.realTimeProtection}`);

    // TEST 6: Ejecución integrada vía ActionKernel
    console.log('\n--- TEST 6: Ejecución completa por ActionKernel ---');
    const kernelHealth = await actionKernel.execute('security.system-health', {});
    assert.strictEqual(kernelHealth.ok, true);
    assert.strictEqual(kernelHealth.status, 'completed');
    assert.strictEqual(kernelHealth.verified, true);
    console.log(`  ✅ [PASS] ActionKernel ejecutó security.system-health con éxito.`);

    console.log('\n===============================================================');
    console.log('🏁 SUITE DE ANTIVIRUS FINALIZADA CON ÉXITO: 6/6 PRUEBAS (100%)');
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ Error en tests de antivirus:', err);
    process.exit(1);
});
