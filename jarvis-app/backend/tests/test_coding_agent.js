/**
 * test_coding_agent.js
 * 
 * Suite de pruebas unitarias para el Ítem 41:
 * Coding Agent Real (Agente Autónomo de Ingeniería de Software de Proyecto Completo).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { codingAgentService } = require('../services/developer/codingAgentService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService');

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
    console.log('💻 INICIANDO SUITE DE PRUEBAS: ÍTEM 41 - CODING AGENT REAL');
    console.log('===============================================================\n');

    const tempTestDir = path.join(__dirname, 'temp_mock_projects');
    if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true });

    // ── Setup: Mock Project Unity ──
    const unityDir = path.join(tempTestDir, 'MockUnityProject');
    fs.mkdirSync(path.join(unityDir, 'ProjectSettings'), { recursive: true });
    fs.mkdirSync(path.join(unityDir, 'Assets', 'Scripts', 'Inventory'), { recursive: true });
    fs.mkdirSync(path.join(unityDir, 'Assets', 'Scripts', 'Player'), { recursive: true });
    fs.mkdirSync(path.join(unityDir, 'Library', 'Artifacts'), { recursive: true }); // Carpeta pesada a ignorar

    fs.writeFileSync(path.join(unityDir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.10f1');
    fs.writeFileSync(
        path.join(unityDir, 'Assets', 'Scripts', 'Inventory', 'InventoryManager.cs'),
        'using System;\npublic class InventoryManager {\n    public int capacity = 20;\n    public void AddItem(string item) { }\n}'
    );
    fs.writeFileSync(
        path.join(unityDir, 'Assets', 'Scripts', 'Inventory', 'ItemSlot.cs'),
        'public class ItemSlot { public string itemName; }'
    );
    fs.writeFileSync(
        path.join(unityDir, 'Assets', 'Scripts', 'Player', 'PlayerMovement.cs'),
        'public class PlayerMovement { public float speed = 5.0f; }'
    );
    fs.writeFileSync(
        path.join(unityDir, 'Library', 'Artifacts', 'ignored_cache.cs'),
        'public class Ignored { }'
    );

    // ── Setup: Mock Project Node ──
    const nodeDir = path.join(tempTestDir, 'MockNodeProject');
    fs.mkdirSync(path.join(nodeDir, 'src', 'controllers'), { recursive: true });
    fs.mkdirSync(path.join(nodeDir, 'node_modules', 'express'), { recursive: true }); // A ignorar

    fs.writeFileSync(path.join(nodeDir, 'package.json'), JSON.stringify({ name: 'mock-api', version: '1.0.0' }));
    fs.writeFileSync(path.join(nodeDir, 'src', 'controllers', 'userController.js'), 'function getUser() { return { id: 1 }; }\nmodule.exports = { getUser };');
    fs.writeFileSync(path.join(nodeDir, 'node_modules', 'express', 'index.js'), '// Ignored module');

    // Test 1: Detección Automática de Stack Unity (C#)
    test('detectProjectStack identifica correctamente proyecto Unity (C#)', () => {
        const stack = codingAgentService.detectProjectStack(unityDir);
        assert.strictEqual(stack.stack, 'unity_csharp');
        assert.strictEqual(stack.name, 'Unity (C#)');
        assert.ok(stack.sourceDir.includes('Assets'));
    });

    // Test 2: Detección Automática de Stack Node.js
    test('detectProjectStack identifica correctamente proyecto Node.js', () => {
        const stack = codingAgentService.detectProjectStack(nodeDir);
        assert.strictEqual(stack.stack, 'javascript_node');
        assert.strictEqual(stack.name, 'Node.js (JavaScript)');
    });

    // Test 3: Mapeo de Estructura Excluyendo Carpetas Pesadas (Library, node_modules)
    test('mapProjectStructure excluye carpetas de build/caché como Library y node_modules', () => {
        const unityFiles = codingAgentService.mapProjectStructure(unityDir);
        assert.ok(unityFiles.some(f => f.name === 'InventoryManager.cs'));
        assert.ok(unityFiles.some(f => f.name === 'PlayerMovement.cs'));
        assert.strictEqual(unityFiles.some(f => f.name === 'ignored_cache.cs'), false, 'Library/ debe ser excluido');

        const nodeFiles = codingAgentService.mapProjectStructure(nodeDir);
        assert.ok(nodeFiles.some(f => f.name === 'userController.js'));
        assert.strictEqual(nodeFiles.some(f => f.path.includes('node_modules')), false, 'node_modules/ debe ser excluido');
    });

    // Test 4: Localización Semántica de Archivos Clave
    test('locateRelevantFiles clasifica y prioriza archivos relevantes a la consigna', () => {
        const unityFiles = codingAgentService.mapProjectStructure(unityDir);
        const relevant = codingAgentService.locateRelevantFiles(
            unityDir,
            'Jarvis arreglá el sistema de inventario de mi Unity',
            unityFiles
        );

        assert.ok(relevant.length > 0);
        // Debe priorizar InventoryManager.cs e ItemSlot.cs antes que PlayerMovement.cs
        assert.strictEqual(relevant[0].name, 'InventoryManager.cs');
        assert.strictEqual(relevant[1].name, 'ItemSlot.cs');
    });

    // Test 5: Compilación y Detección de Sintaxis Limpia vs Rota
    test('compileProject verifica sintaxis y reporta errores cuando las llaves están rotas', () => {
        const cleanCheck = codingAgentService.compileProject(unityDir);
        assert.strictEqual(cleanCheck.success, true);

        // Romper un archivo C# deliberadamente
        const brokenPath = path.join(unityDir, 'Assets', 'Scripts', 'Inventory', 'Broken.cs');
        fs.writeFileSync(brokenPath, 'public class Broken { void Test() { }'); // Falta una llave de cierre '}'

        const brokenCheck = codingAgentService.compileProject(unityDir);
        assert.strictEqual(brokenCheck.success, false);
        assert.ok(brokenCheck.errors.length > 0);
        assert.ok(brokenCheck.errors[0].message.includes('Llaves desbalanceadas'));

        // Limpiar archivo roto
        fs.unlinkSync(brokenPath);
    });

    // Test 6: Generador Nativo de Unified Diff
    test('generateUnifiedDiff genera formato de diff estándar entre dos versiones', () => {
        const original = 'linea1\nlinea2\nlinea3';
        const modified = 'linea1\nlinea2_modificada\nlinea3\nlinea4_nueva';

        const diff = codingAgentService.generateUnifiedDiff(original, modified, 'test.cs');
        assert.ok(diff.includes('--- a/test.cs'));
        assert.ok(diff.includes('+++ b/test.cs'));
        assert.ok(diff.includes('-linea2'));
        assert.ok(diff.includes('+linea2_modificada'));
        assert.ok(diff.includes('+linea4_nueva'));
    });

    // Test 7: Bucle Autónomo de Reparación con Auto-Fix Exitoso
    await testAsync('executeAutonomousFix repara un error de código, compila y genera diff', async () => {
        const targetPath = path.join(unityDir, 'Assets', 'Scripts', 'Inventory', 'InventoryManager.cs');
        const originalCode = fs.readFileSync(targetPath, 'utf8');

        const result = await codingAgentService.executeAutonomousFix({
            projectPath: unityDir,
            instruction: 'arreglar el sistema de inventario',
            maxIterations: 2,
            applyFixFn: async ({ currentContent, iteration }) => {
                if (iteration === 1) {
                    // Iteración 1: introduce error de sintaxis
                    return currentContent + '\npublic void BrokenMethod() {';
                } else {
                    // Iteración 2: corrige el error y balancea llaves
                    return currentContent.replace('\npublic void BrokenMethod() {', '') + '\n    // Corregido por Jarvis Coding Agent\n    public bool HasItem(string item) => true;\n';
                }
            }
        });

        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.iterations, 2);
        assert.ok(result.diff.includes('HasItem'));
        assert.ok(result.report.includes('Reparado'));

        // Restaurar estado original
        fs.writeFileSync(targetPath, originalCode);
    });

    // Test 8: Rollback al Snapshot si se Agotan las Iteraciones sin Compilar
    await testAsync('executeAutonomousFix aplica rollback automático si la compilación no tiene éxito', async () => {
        const targetPath = path.join(unityDir, 'Assets', 'Scripts', 'Inventory', 'InventoryManager.cs');
        const originalCode = fs.readFileSync(targetPath, 'utf8');

        const result = await codingAgentService.executeAutonomousFix({
            projectPath: unityDir,
            instruction: 'inventario',
            maxIterations: 2,
            applyFixFn: async () => 'public class Invalida { // Nunca compila'
        });

        assert.strictEqual(result.ok, false);
        assert.ok(result.error.includes('Rollback aplicado'));

        // Verificar que el contenido fue restaurado exactamente
        const afterRollback = fs.readFileSync(targetPath, 'utf8');
        assert.strictEqual(afterRollback, originalCode);
    });

    // Test 9: Integración en ActionKernel (code.autonomous_fix)
    await testAsync('ActionKernel ejecuta la herramienta code.autonomous_fix sobre el proyecto', async () => {
        const execRes = await actionKernel.execute('code.autonomous_fix', {
            projectPath: unityDir,
            instruction: 'mejorar sistema de inventario'
        });

        assert.strictEqual(execRes.ok, true);
        assert.strictEqual(execRes.actionId, 'code.autonomous_fix');
        assert.ok(execRes.data);
        assert.ok(execRes.data.targetFile.includes('InventoryManager.cs'));
    });

    // Limpieza de proyectos temporales de prueba
    try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch (e) {}

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 41 PASARON EXITOSAMENTE.\n');
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
