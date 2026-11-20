/**
 * Test Suite para el Ítem 15: Versionado de Skills (skillVersionService.js)
 * Verifica:
 *   1. Motor de comparación SemVer.
 *   2. Registro secuencial de versiones (1.0.0 -> 1.1.0 -> 1.2.0).
 *   3. Auditoría de metadatos: fechas (created_at, updated_at), tests (12/12) y errores.
 *   4. Seguimiento y acumulación de errores en ejecución.
 *   5. Rollback en Caliente (Hot-Swap) a la versión previa estable (1.1.0).
 *   6. Rollback a versión específica (1.0.0).
 *   7. Consulta de historial genealógico completo (SemVer Descending).
 */

const skillVersionService = require('../services/sandbox/skillVersionService');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 15 - VERSIONADO DE SKILLS ===\n');
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

    // 1. Motor de Comparación SemVer
    console.log('--- Test 1: Motor SemVer ---');
    assert(skillVersionService.compareSemver('1.1.0', '1.0.0') === 1, '1.1.0 es mayor que 1.0.0');
    assert(skillVersionService.compareSemver('1.0.0', '1.2.0') === -1, '1.0.0 es menor que 1.2.0');
    assert(skillVersionService.compareSemver('1.2.0', '1.2.0') === 0, '1.2.0 es igual a 1.2.0');
    assert(skillVersionService.compareSemver('1.10.0', '1.2.0') === 1, '1.10.0 es mayor que 1.2.0 (comparación numérica)');

    // 2. Registro Secuencial de Versiones (convert_webp)
    console.log('\n--- Test 2: Registro Secuencial de Versiones (1.0.0 -> 1.1.0 -> 1.2.0) ---');
    const skillName = `convert_webp_${Date.now()}`;

    const v1 = skillVersionService.registerNewVersion({
        name: skillName,
        version: '1.0.0',
        code: 'def convert_v1(): return "v1.0.0"',
        testsSummary: '12/12',
        errorsCount: 0,
        createdAt: '2026-09-01T10:00:00Z',
        activate: true
    });
    assert(v1.ok === true && v1.version === '1.0.0', 'Versión 1.0.0 registrada y activa');

    const v2 = skillVersionService.registerNewVersion({
        name: skillName,
        version: '1.1.0',
        code: 'def convert_v2(): return "v2.1.0"',
        testsSummary: '12/12',
        errorsCount: 0,
        createdAt: '2026-09-03T12:00:00Z',
        activate: true
    });
    assert(v2.ok === true && v2.version === '1.1.0', 'Versión 1.1.0 registrada y activa');

    const v3 = skillVersionService.registerNewVersion({
        name: skillName,
        version: '1.2.0',
        code: 'def convert_v3(): return "v3.2.0_with_bug"',
        testsSummary: '10/12',
        errorsCount: 0,
        createdAt: '2026-09-06T15:00:00Z',
        activate: true
    });
    assert(v3.ok === true && v3.version === '1.2.0', 'Versión 1.2.0 registrada y activa');

    // Verificar que la versión activa actual en producción es 1.2.0
    const activeSkill = skillVersionService.getActiveSkill(skillName);
    assert(activeSkill && activeSkill.version === '1.2.0', 'La versión 1.2.0 es la activa en el sistema');
    assert(activeSkill.tests_summary === '10/12', 'Metadato de tests guardado: 10/12');

    // 3. Simulación y Registro de Errores en Producción
    console.log('\n--- Test 3: Seguimiento y Acumulación de Errores ---');
    skillVersionService.recordExecutionError(skillName); // 1er error
    skillVersionService.recordExecutionError(skillName); // 2do error

    const activeWithError = skillVersionService.getActiveSkill(skillName);
    assert(activeWithError.errors_count === 2, 'Contador de errores acumuló exactamente 2 fallos en 1.2.0');

    // 4. Rollback en Caliente a la Versión Previa Estable (1.1.0)
    console.log('\n--- Test 4: Rollback en Caliente a la Versión Previa (1.1.0) ---');
    const rollbackRes = skillVersionService.rollbackSkill(skillName);
    assert(rollbackRes.ok === true, 'Operación de rollback exitosa');
    assert(rollbackRes.rolledBackFrom === '1.2.0', 'Reconoce que se hizo rollback desde 1.2.0');
    assert(rollbackRes.activeVersion === '1.1.0', 'Restaura automáticamente 1.1.0 como activa');

    const activeAfterRollback = skillVersionService.getActiveSkill(skillName);
    assert(activeAfterRollback.version === '1.1.0', 'El sistema ahora sirve en caliente la versión 1.1.0');
    assert(activeAfterRollback.errors_count === 0, 'La versión 1.1.0 mantiene 0 errores');
    assert(activeAfterRollback.tests_summary === '12/12', 'La versión 1.1.0 tiene tests 12/12');

    // 5. Rollback Específico a 1.0.0
    console.log('\n--- Test 5: Rollback a Versión Específica (1.0.0) ---');
    const specificRollback = skillVersionService.rollbackSkill(skillName, '1.0.0');
    assert(specificRollback.ok === true && specificRollback.activeVersion === '1.0.0', 'Rollback específico a 1.0.0 ejecutado');
    const activeV1 = skillVersionService.getActiveSkill(skillName);
    assert(activeV1.version === '1.0.0', 'La versión activa ahora es 1.0.0');

    // 6. Consulta de Historial Genealógico Completo
    console.log('\n--- Test 6: Consulta de Historial Genealógico ---');
    const history = skillVersionService.getSkillHistory(skillName);
    assert(history.length >= 3, 'Historial contiene todas las versiones');
    assert(history[0].version === '1.2.0', 'Historial ordenado por SemVer descendente (primero 1.2.0)');
    assert(history[1].version === '1.1.0', 'Segundo 1.1.0');
    assert(history[2].version === '1.0.0', 'Tercero 1.0.0');
    assert(history.find(h => h.version === '1.0.0').isActive === true, '1.0.0 marcada como activa');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de versionado:', err);
    process.exit(1);
});
