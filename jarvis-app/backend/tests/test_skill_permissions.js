/**
 * Test Suite para el Ítem 12: Permisos por Skill (skillPermissionService.js)
 * Verifica:
 *   1. Normalización canónica de esquemas de permisos (PoLP Default-Deny).
 *   2. Detección y bloqueo estático preventivo (red, filesystem, subprocess, registry).
 *   3. Confinamiento dinámico en tiempo de ejecución (Runtime Interceptor/Jail).
 *   4. Ejecución exitosa de habilidad matemática pura (cero privilegios).
 *   5. Bloqueo en runtime de intento de red sin permiso.
 *   6. Bloqueo en runtime de intento de escritura no autorizada (Directory Traversal / C:\Windows).
 *   7. Escritura permitida dentro del ámbito acotado (scratch_only).
 *   8. Integración completa con hardenedCodeActService y registro en skillManager.
 */

const path = require('path');
const fs = require('fs');
const skillPermissionService = require('../services/sandbox/skillPermissionService');
const hardenedCodeActService = require('../services/sandbox/hardenedCodeActService');
const skillManager = require('../services/sandbox/skillManager');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 12 - PERMISOS POR SKILL ===\n');
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

    // 1. Normalización de Permisos
    console.log('--- Test 1: Normalización de Esquema de Permisos (Default-Deny) ---');
    const defaultPerms = skillPermissionService.normalizePermissions({});
    assert(defaultPerms.network === false, 'Por defecto network es false');
    assert(defaultPerms.filesystem_write === 'none', 'Por defecto filesystem_write es none');
    assert(defaultPerms.filesystem_read === 'none', 'Por defecto filesystem_read es none');
    assert(defaultPerms.powershell === false, 'Por defecto powershell es false');

    const downloadPerms = skillPermissionService.normalizePermissions({
        network: true,
        filesystem_write: 'downloads_only'
    });
    assert(downloadPerms.network === true, 'Habilita network explícito');
    assert(downloadPerms.filesystem_write === 'downloads_only', 'Habilita ámbito downloads_only');

    // 2. Verificación Estática Preventiva
    console.log('\n--- Test 2: Verificación Estática Preventiva ---');
    const matrixCode = `
def multiply_matrices(a, b):
    return [[sum(x * y for x, y in zip(row, col)) for col in zip(*b)] for row in a]

m1 = [[1, 2], [3, 4]]
m2 = [[5, 6], [7, 8]]
print("RESULT:", multiply_matrices(m1, m2))
`;
    const staticCheckMatrix = skillPermissionService.verifyCodePermissions(matrixCode, defaultPerms);
    assert(staticCheckMatrix.allowed === true, 'Código matemático puro pasa con cero permisos');

    const networkExploitCode = `
import requests
res = requests.get('https://example.com')
print(res.status_code)
`;
    const staticCheckNetwork = skillPermissionService.verifyCodePermissions(networkExploitCode, defaultPerms);
    assert(staticCheckNetwork.allowed === false, 'Código con requests es bloqueado estáticamente cuando network=false');
    assert(staticCheckNetwork.violations[0].permission === 'network', 'Informa violación de network');

    const writeExploitCode = `
with open('c:/windows/system32/malware.exe', 'w') as f:
    f.write('bad')
`;
    const staticCheckWrite = skillPermissionService.verifyCodePermissions(writeExploitCode, defaultPerms);
    assert(staticCheckWrite.allowed === false, 'Código con escritura en disco es bloqueado estáticamente cuando filesystem_write=none');

    // 3. Ejecución Dinámica en Sandbox: Habilidad de Matrices (Cero Permisos)
    console.log('\n--- Test 3: Ejecución de Skill Matemática (Cero Privilegios) ---');
    const matrixManifest = {
        name: 'matrix_calc',
        permissions: defaultPerms
    };
    const matrixExec = await hardenedCodeActService.executeSkillWithPermissions(matrixManifest, matrixCode, {
        language: 'python'
    });
    assert(matrixExec.ok === true, 'Habilidad matemática ejecuta con éxito con cero permisos');
    assert(matrixExec.output.includes('RESULT: [[19, 22], [43, 50]]'), 'Produce el resultado algebraico exacto');

    // 4. Confinamiento Dinámico en Runtime: Bloqueo de Red (Jail Interceptor)
    console.log('\n--- Test 4: Confinamiento Dinámico en Runtime (Bloqueo de Red) ---');
    const stealthNetworkCode = `
import socket
s = socket.socket()
s.connect(("8.8.8.8", 53))
`;
    // Forzamos saltar análisis estático inyectando guarda para verificar el interceptor de runtime
    const guardedNetworkScript = skillPermissionService.wrapCodeWithGuard(stealthNetworkCode, defaultPerms);
    const networkRun = await hardenedCodeActService.runInSandbox(guardedNetworkScript, { language: 'python' });
    assert(networkRun.ok === false, 'Ejecución con intento de socket en runtime falla');
    assert(networkRun.output.includes('PermissionError') && networkRun.output.includes('network=False'), 'El interceptor de runtime lanzó PermissionError por red');

    // 5. Confinamiento Dinámico en Runtime: Bloqueo de Escritura Fuera de Ámbito
    console.log('\n--- Test 5: Confinamiento Dinámico en Runtime (Bloqueo de Escritura en Rutas Críticas) ---');
    const exploitWriteCode = `
with open(r'c:\\windows\\test_exploit.txt', 'w') as f:
    f.write("exploit")
`;
    const guardedWriteScript = skillPermissionService.wrapCodeWithGuard(exploitWriteCode, { filesystem_write: 'downloads_only' });
    const writeRun = await hardenedCodeActService.runInSandbox(guardedWriteScript, { language: 'python' });
    assert(writeRun.ok === false, 'Escritura en c:\\windows falla incluso con permisos parciales');
    assert(writeRun.output.includes('PermissionError') && writeRun.output.includes('Escritura no autorizada'), 'Interceptor bloquea escritura en ruta del sistema operativo');

    // 6. Confinamiento Dinámico: Escritura Permitida en Scratch
    console.log('\n--- Test 6: Confinamiento Dinámico (Escritura Permitida en Scratch) ---');
    const validScratchCode = `
import os
scratch_file = os.path.join(r"${skillPermissionService.scratchDir.replace(/\\/g, '\\\\')}", "valid_test.txt")
with open(scratch_file, 'w') as f:
    f.write("VALID DATA")

with open(scratch_file, 'r') as f:
    print("READBACK:", f.read())

if os.path.exists(scratch_file):
    os.remove(scratch_file)
    print("CLEANED: OK")
`;
    const scratchPerms = skillPermissionService.normalizePermissions({ filesystem_write: 'scratch_only' });
    const guardedScratchScript = skillPermissionService.wrapCodeWithGuard(validScratchCode, scratchPerms);
    const scratchRun = await hardenedCodeActService.runInSandbox(guardedScratchScript, { language: 'python' });
    assert(scratchRun.ok === true, 'Escritura y limpieza dentro de scratch permitida');
    assert(scratchRun.output.includes('READBACK: VALID DATA') && scratchRun.output.includes('CLEANED: OK'), 'Lectura y borrado en scratch operan limpiamente');

    // 7. Registro de Skill con Permisos Granulares y Recuperación
    console.log('\n--- Test 7: Registro en Manifiesto y Consulta de Permisos ---');
    const registered = skillManager.registerSkill({
        name: 'test_image_optimizer',
        version: '1.2.0',
        permissions: downloadPerms,
        networkAccess: false,
        fsAccess: 'downloads_only',
        entrypoint: 'optimizer.py',
        trustLevel: 'verified-sandboxed'
    });
    assert(registered.ok === true, 'Skill con permisos granulares registrada exitosamente');
    const retrieved = skillManager.getSkill(registered.skillId);
    assert(retrieved && retrieved.name === 'test_image_optimizer', 'Habilidad recuperada del manifiesto SQLite');
    const parsedStoredPerms = JSON.parse(retrieved.permissions_json);
    assert(parsedStoredPerms.filesystem_write === 'downloads_only', 'Permisos granulares persistidos y recuperados con fidelidad');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests:', err);
    process.exit(1);
});
