/**
 * TEST SUITE: Hardened Code-Act Service (Ítem 11)
 * Verifica la pipeline completa de 7 fases de endurecimiento de Code-Act:
 * análisis estático, sandbox con timeout, tests automáticos, permisos,
 * sellado criptográfico SHA-256 y registro en el manifiesto.
 */

const assert = require('assert');
const hardenedCodeAct = require('../services/sandbox/hardenedCodeActService');
const skillManager = require('../services/sandbox/skillManager');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Hardened Code-Act Pipeline (Ítem 11)');
    console.log('===============================================================\n');

    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    async function testAsync(name, fn) {
        total++;
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
            throw err;
        }
    }

    // 1. Análisis Estático: Bloqueo inmediato de código peligroso
    test('Análisis Estático: Bloquea intentos de manipulación de registro y borrado destructivo', () => {
        const maliciousCode1 = `import winreg\nkey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "Software")`;
        const res1 = hardenedCodeAct.analyzeCodeSecurity(maliciousCode1);
        assert.strictEqual(res1.ok, false);
        assert.strictEqual(res1.status, 'BLOCKED');
        assert(res1.violations.some(v => v.reason.includes('Registro de Windows')));

        const maliciousCode2 = `import shutil\nshutil.rmtree('/')`;
        const res2 = hardenedCodeAct.analyzeCodeSecurity(maliciousCode2);
        assert.strictEqual(res2.ok, false);
        assert.strictEqual(res2.status, 'BLOCKED');
    });

    // 2. Sandbox: Protección contra bucles infinitos por timeout estricto
    await testAsync('Sandbox: Detecta y aborta bucle infinito con timeout controlado', async () => {
        const infiniteLoopCode = `
import time
while True:
    time.sleep(0.1)
`;
        const start = Date.now();
        const res = await hardenedCodeAct.runInSandbox(infiniteLoopCode, { timeoutMs: 1200 });
        const elapsed = Date.now() - start;

        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.timedOut, true);
        assert(res.error.includes('Tiempo límite'));
        assert(elapsed >= 1000 && elapsed <= 2500, `Timeout tomó ${elapsed}ms`);
        console.log(`     Bucle infinito abortado en ${elapsed}ms con SIGKILL limpio.`);
    });

    // 3. Tests Unitarios Automatizados en Sandbox
    await testAsync('Sandbox & Tests: Ejecuta y valida tests unitarios antes de aprobar', async () => {
        const validCode = `
def multiply(a, b):
    return a * b
`;
        const validTest = `
assert multiply(3, 4) == 12, "Fallo 3*4"
assert multiply(0, 10) == 0, "Fallo 0*10"
print("TESTS_OK")
`;
        const testRes = await hardenedCodeAct.runAutomatedTests(validCode, validTest);
        assert.strictEqual(testRes.passed, true);
        assert(testRes.details.includes('TESTS_OK'));

        // Test que falla deliberadamente
        const failingTest = `assert multiply(2, 2) == 5, "2*2 no es 5"`;
        const failRes = await hardenedCodeAct.runAutomatedTests(validCode, failingTest);
        assert.strictEqual(failRes.passed, false);
    });

    // 4. Auditoría de Permisos Requeridos
    test('Auditoría de Permisos: Detecta recursos requeridos (red, disco, powershell)', () => {
        const networkCode = `import requests\nr = requests.get("https://api.github.com")`;
        const permsNet = hardenedCodeAct.auditRequiredPermissions(networkCode);
        assert.strictEqual(permsNet.network, true);
        assert.strictEqual(permsNet.filesystem_write, false);

        const fsCode = `with open("resultado.txt", "w") as f:\n    f.write("listo")`;
        const permsFs = hardenedCodeAct.auditRequiredPermissions(fsCode);
        assert.strictEqual(permsFs.filesystem_write, true);
        assert.strictEqual(permsFs.network, false);

        const pureMathCode = `def fib(n): return n if n <= 1 else fib(n-1) + fib(n-2)`;
        const permsMath = hardenedCodeAct.auditRequiredPermissions(pureMathCode);
        assert.strictEqual(permsMath.network, false);
        assert.strictEqual(permsMath.filesystem_write, false);
        assert.strictEqual(permsMath.powershell, false);
    });

    // 5. Aprobación y Sellado Criptográfico SHA-256
    test('Aprobación: Genera sello criptográfico inmutable SHA-256', () => {
        const code = `def saludar(nombre): return f"Hola {nombre}"`;
        const sealed = hardenedCodeAct.approveAndSeal('saludo_skill', '1.0.0', code, { network: false });

        assert.strictEqual(sealed.approved, true);
        assert.strictEqual(sealed.name, 'saludo_skill');
        assert.strictEqual(typeof sealed.sha256, 'string');
        assert.strictEqual(sealed.sha256.length, 64);
        assert.strictEqual(sealed.trustLevel, 'verified-sandboxed');
    });

    // 6. Pipeline Completa End-to-End (7 Fases)
    await testAsync('Pipeline Completa: Ejecuta las 7 fases y registra formalmente en el manifiesto', async () => {
        const skillReq = {
            name: 'matriz_determinante_demo',
            version: '1.0.0',
            code: `
def calcular_determinante_2x2(a, b, c, d):
    return (a * d) - (b * c)
`,
            testCode: `
assert calcular_determinante_2x2(1, 2, 3, 4) == -2, "Error det"
assert calcular_determinante_2x2(2, 0, 0, 2) == 4, "Error det ident"
print("DETERMINANTE_VERIFICADO")
`
        };

        const result = await hardenedCodeAct.processCodeActPipeline(skillReq);
        assert.strictEqual(result.ok, true, `Fallo en pipeline: ${JSON.stringify(result)}`);
        assert.ok(result.skillId, 'Debe retornar un ID de skill');
        assert.strictEqual(result.name, 'matriz_determinante_demo');
        assert.strictEqual(result.trustLevel, 'verified-sandboxed');
        assert.strictEqual(result.auditLog.length, 6); // 6 hitos de auditoría registrados

        // Comprobar que quedó persistida en SQLite
        const list = skillManager.listSkills();
        const found = list.find(s => s.name === 'matriz_determinante_demo');
        assert.ok(found, 'La skill debe figurar en el manifiesto SQLite de Jarvis');
        assert.strictEqual(found.status, 'enabled');
        console.log(`     Skill registrada con éxito: [ID: ${result.skillId}] SHA: ${result.hash.slice(0, 16)}...`);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE HARDENED CODE-ACT PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Hardened Code-Act:', err);
    process.exit(1);
});
