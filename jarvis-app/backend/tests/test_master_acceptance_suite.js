/**
 * MASTER ACCEPTANCE TEST SUITE — JARVIS 3.1
 * (Fase 10 - End-to-End Holistic Hardening & Regression Verification)
 *
 * Ejecuta y consolida la verificación integral de todas las dimensiones de JARVIS 3.1:
 *  1. Memoria Permanente & FTS5 Temporal (test_memory_long_term.js)
 *  2. Windows Real Automation Bridge (test_windows_real_e2e.js)
 *  3. Browser Real E2E & Form / Download Integrity (test_browser_real_e2e.js)
 *  4. Offensive Sandbox Isolation & PoLP Guard (test_sandbox_hardening.js)
 *  5. Restart Recovery, Checkpoints & Idempotency (test_restart_recovery.js)
 *  6. Chaos Engineering & Fast Path Resilience (test_chaos_engineering.js)
 *  7. Stress Testing & SQLite WAL Concurrency (test_stress_concurrency.js)
 *  8. Model Benchmarks & VRAM Locking (test_model_benchmarks.js)
 *  9. Operational Learning V2 Canary & Rollback (test_procedure_learning_v2.js)
 * 10. Master Regression Safety Suite (regression_safety_suite.js - 61/61 PASS)
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

const testSuites = [
    { name: '1. Memoria Permanente & Traceability', file: 'backend/tests/test_memory_long_term.js', env: {} },
    { name: '2. Windows Automation Bridge', file: 'backend/tests/test_windows_real_e2e.js', env: {} },
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
console.log('🏆 EJECUTANDO SUITE MAESTRA DE ACEPTACIÓN — JARVIS 3.1 HARDENING');
console.log('======================================================================\n');

const suiteResults = [];

for (const suite of testSuites) {
    process.stdout.write(`⏳ Ejecutando ${suite.name}... `);
    const t0 = performance.now();
    try {
        execSync(`node ${suite.file}`, {
            cwd: ROOT_DIR,
            env: { ...process.env, ...suite.env },
            stdio: 'pipe'
        });
        const elapsed = (performance.now() - t0).toFixed(1);
        console.log(`✅ APROBADO (${elapsed}ms)`);
        suiteResults.push({ 'Dimensión': suite.name, 'Duración (ms)': elapsed, 'Resultado': 'PASS' });
    } catch (err) {
        const elapsed = (performance.now() - t0).toFixed(1);
        console.log(`❌ FALLÓ (${elapsed}ms)`);
        console.error(err.stdout ? err.stdout.toString() : err.message);
        suiteResults.push({ 'Dimensión': suite.name, 'Duración (ms)': elapsed, 'Resultado': 'FAIL' });
    }
}

console.log('\n======================================================================');
console.log('📋 CONSOLIDADO FINAL DE ACEPTACIÓN — JARVIS 3.1');
console.log('======================================================================');
console.table(suiteResults);

const failed = suiteResults.filter(r => r.Resultado === 'FAIL');
if (failed.length > 0) {
    console.error(`\n❌ SE DETECTARON ${failed.length} SUITES FALLIDAS.`);
    process.exit(1);
} else {
    console.log('\n🎉 TODAS LAS SUITES (10/10) COMPLETADAS CON ÉXITO. JARVIS 3.1 VALIDADO AL 100%.');
}
