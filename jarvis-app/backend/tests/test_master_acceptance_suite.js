/**
 * MASTER ACCEPTANCE TEST SUITE — JARVIS 3.1.1
 * (Independent Verification & Real-World Validation)
 *
 * Ejecuta y consolida la verificación integral de todas las dimensiones de JARVIS 3.1.1:
 *  - Distingue rigurosamente entre PASS, FAIL, SKIPPED y NOT_AVAILABLE.
 *  - SKIPPED nunca se contabiliza como PASS.
 *  - Requiere JARVIS_REAL_E2E=1 para validar Windows E2E.
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

const testSuites = [
    { name: '1. Memoria Permanente & Traceability', file: 'backend/tests/test_memory_long_term.js', env: {} },
    { name: '2. Windows Automation Bridge', file: 'backend/tests/test_windows_real_e2e.js', env: { JARVIS_REAL_E2E: '1' } },
    { name: '3. Browser Real Automation', file: 'backend/tests/test_browser_real_e2e.js', env: {} },
    { name: '4. Sandbox Hardening & Isolation', file: 'backend/tests/test_sandbox_hardening.js', env: {} },
    { name: '5. Restart Recovery & Idempotency', file: 'backend/tests/test_restart_recovery.js', env: {} },
    { name: '6. Chaos Engineering & Fast Path', file: 'backend/tests/test_chaos_engineering.js', env: { JARVIS_CHAOS_TEST: '1' } },
    { name: '7. Stress & Concurrency (SQLite WAL)', file: 'backend/tests/test_stress_concurrency.js', env: {} },
    { name: '8. Model Benchmarks & VRAM Lock', file: 'backend/tests/test_model_benchmarks.js', env: {} },
    { name: '9. Operational Learning V2 Canary', file: 'backend/tests/test_procedure_learning_v2.js', env: {} },
    { name: '10. Master Regression Safety Suite', file: 'backend/tests/regression_safety_suite.js', env: {} }
];

console.log('======================================================================');
console.log('🏆 EJECUTANDO SUITE MAESTRA DE ACEPTACIÓN — JARVIS 3.1.1 (VERIFICACIÓN REAL)');
console.log('======================================================================\n');

const suiteResults = [];

for (const suite of testSuites) {
    process.stdout.write(`⏳ Ejecutando ${suite.name}... `);
    const t0 = performance.now();
    
    const runRes = spawnSync('node', [suite.file], {
        cwd: ROOT_DIR,
        env: { ...process.env, ...suite.env },
        encoding: 'utf8'
    });

    const elapsed = (performance.now() - t0).toFixed(1);
    const code = runRes.status;
    const stdout = runRes.stdout || '';
    const stderr = runRes.stderr || '';

    let status = 'UNKNOWN';

    if (code === 0) {
        // Verificar si la salida stdout dice explícitamente SKIPPED
        if (stdout.includes('[SKIPPED]') && !stdout.includes('TODAS LAS PRUEBAS REALES')) {
            status = 'SKIPPED';
            console.log(`⚠️  OMITIDO / SKIPPED (${elapsed}ms)`);
        } else {
            status = 'PASS';
            console.log(`✅ APROBADO (${elapsed}ms)`);
        }
    } else if (code === 77) {
        status = 'SKIPPED';
        console.log(`⚠️  SKIPPED (${elapsed}ms)`);
    } else {
        status = 'FAIL';
        console.log(`❌ FALLÓ (${elapsed}ms, exit code: ${code})`);
        if (stderr) console.error(stderr.substring(0, 300));
        else if (stdout) console.error(stdout.substring(0, 300));
    }

    suiteResults.push({
        'Dimensión': suite.name,
        'Estado': status,
        'Duración (ms)': elapsed,
        'Código Salida': code
    });
}

console.log('\n======================================================================');
console.log('📋 CONSOLIDADO FINAL DE ACEPTACIÓN — JARVIS 3.1.1');
console.log('======================================================================');
console.table(suiteResults);

const totalExecuted = suiteResults.filter(r => r.Estado === 'PASS' || r.Estado === 'FAIL').length;
const totalPass = suiteResults.filter(r => r.Estado === 'PASS').length;
const totalFail = suiteResults.filter(r => r.Estado === 'FAIL').length;
const totalSkipped = suiteResults.filter(r => r.Estado === 'SKIPPED').length;

console.log(`\nRESUMEN DE VERIFICACIÓN:`);
console.log(`  TOTAL EJECUTADAS REALMENTE: ${totalExecuted}`);
console.log(`  TOTAL PASS:                 ${totalPass}`);
console.log(`  TOTAL FAIL:                 ${totalFail}`);
console.log(`  TOTAL SKIPPED:              ${totalSkipped}`);

if (totalFail > 0) {
    console.error(`\n❌ FALLOS EN LA SUITE MAESTRA (${totalFail}).`);
    process.exit(1);
} else {
    console.log(`\n🎉 SUITE MAESTRA VALIDADA CON ÉXITO: ${totalPass}/${totalExecuted} REAL PASS.`);
    process.exit(0);
}
