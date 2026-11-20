/**
 * test_git_integration.js
 * 
 * Suite de pruebas unitarias para el Ítem 42:
 * Integración Git con Gobernanza de Ramas Protegidas, Commits Seguros, Rollback y Resumen de Cambios.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { gitIntegrationService } = require('../services/developer/gitIntegrationService');
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
    console.log('🌿 INICIANDO SUITE DE PRUEBAS: ÍTEM 42 - INTEGRACIÓN GIT');
    console.log('===============================================================');

    // Directorio temporal aislado para pruebas de Git
    const tempRepoDir = path.join(__dirname, 'temp_test_git_repo');
    const nonGitDir = path.join(__dirname, 'temp_test_non_git');

    try {
        fs.rmSync(tempRepoDir, { recursive: true, force: true });
        fs.rmSync(nonGitDir, { recursive: true, force: true });
    } catch (e) {}

    fs.mkdirSync(tempRepoDir, { recursive: true });
    fs.mkdirSync(nonGitDir, { recursive: true });

    // Inicializar repositorio Git de prueba
    execSync('git init -b main', { cwd: tempRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test Runner"', { cwd: tempRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@jarvis.local"', { cwd: tempRepoDir, stdio: 'pipe' });
    execSync('git config core.autocrlf false', { cwd: tempRepoDir, stdio: 'pipe' });

    // Commit inicial en main
    fs.writeFileSync(path.join(tempRepoDir, 'README.md'), '# Proyecto Base\n', 'utf8');
    fs.writeFileSync(path.join(tempRepoDir, 'PlayerController.cs'), 'public class PlayerController {}\n', 'utf8');
    execSync('git add .', { cwd: tempRepoDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempRepoDir, stdio: 'pipe' });

    // Test 1: Identificación de repositorios Git
    test('isGitRepo identifica correctamente repositorios Git y directorios no-Git', () => {
        assert.strictEqual(gitIntegrationService.isGitRepo(tempRepoDir), true);
        assert.strictEqual(gitIntegrationService.isGitRepo(nonGitDir), false);
    });

    // Test 2: Diagnóstico de estado limpio vs archivos modificados
    test('getStatus reporta correctamente estado limpio y detecta cambios modificados/untracked', () => {
        let status = gitIntegrationService.getStatus(tempRepoDir);
        assert.strictEqual(status.isGit, true);
        assert.strictEqual(status.isClean, true);
        assert.strictEqual(status.branch, 'main');
        assert.strictEqual(status.isProtected, true);

        // Crear archivo untracked y modificar archivo existente
        fs.appendFileSync(path.join(tempRepoDir, 'PlayerController.cs'), '// Modificación\n');
        fs.writeFileSync(path.join(tempRepoDir, 'NewItem.cs'), 'public class NewItem {}\n');

        status = gitIntegrationService.getStatus(tempRepoDir);
        assert.strictEqual(status.isClean, false);
        assert.ok(status.modified.some(f => f.includes('PlayerController.cs')));
        assert.ok(status.untracked.some(f => f.includes('NewItem.cs')));
        assert.strictEqual(status.totalChanges, 2);

        // Limpiar para siguientes tests
        execSync('git checkout -- .', { cwd: tempRepoDir, stdio: 'pipe' });
        fs.unlinkSync(path.join(tempRepoDir, 'NewItem.cs'));
    });

    // Test 3: Política de Gobernanza de Ramas Protegidas (Rechazo en main)
    test('commit rechaza modificaciones directas sobre ramas protegidas (main/master)', () => {
        fs.appendFileSync(path.join(tempRepoDir, 'PlayerController.cs'), '// Cambio prohibido en main\n');

        const commitRes = gitIntegrationService.commit(tempRepoDir, 'Fix directo en main');
        assert.strictEqual(commitRes.ok, false);
        assert.strictEqual(commitRes.code, 'PROTECTED_BRANCH_VIOLATION');
        assert.ok(commitRes.error.includes('Violación de política de seguridad'));

        // Descartar cambios
        execSync('git checkout -- .', { cwd: tempRepoDir, stdio: 'pipe' });
    });

    // Test 4: ensureSafeBranch aprovisiona y conmuta a rama jarvis/<slug>
    test('ensureSafeBranch crea y conmuta automáticamente a rama jarvis/fix-player-controller', () => {
        const branchRes = gitIntegrationService.ensureSafeBranch(tempRepoDir, 'fix player controller');
        assert.strictEqual(branchRes.ok, true);
        assert.strictEqual(branchRes.wasSwitched, true);
        assert.strictEqual(branchRes.branch, 'jarvis/fix-player-controller');

        const current = gitIntegrationService.getCurrentBranch(tempRepoDir);
        assert.strictEqual(current, 'jarvis/fix-player-controller');
        assert.strictEqual(gitIntegrationService.isProtectedBranch(current), false);
    });

    // Test 5: Commit seguro en rama Jarvis con firma de auditoría
    test('commit realiza el commit exitosamente en la rama jarvis y firma la auditoría', () => {
        fs.appendFileSync(path.join(tempRepoDir, 'PlayerController.cs'), '    public void Move() {}\n');
        fs.writeFileSync(path.join(tempRepoDir, 'MovementTest.cs'), 'public class MovementTest {}\n');

        const commitRes = gitIntegrationService.commit(tempRepoDir, 'Arreglar controlador de jugador y test');
        assert.strictEqual(commitRes.ok, true);
        assert.ok(commitRes.commitHash);
        assert.strictEqual(commitRes.branch, 'jarvis/fix-player-controller');
        assert.strictEqual(commitRes.filesCommitted.length, 2);

        // Verificar log en Git para confirmar firma
        const lastLog = execSync('git log -n 1', { cwd: tempRepoDir, encoding: 'utf8' });
        assert.ok(lastLog.includes('Signed-off-by: Jarvis AI Assistant <jarvis@local>'));
    });

    // Test 6: getDiff calcula diferencias unificadas
    test('getDiff devuelve cambios unificados formateados adecuadamente', () => {
        fs.appendFileSync(path.join(tempRepoDir, 'PlayerController.cs'), '    public void Jump() {}\n');

        const diffRes = gitIntegrationService.getDiff(tempRepoDir);
        assert.strictEqual(diffRes.ok, true);
        assert.strictEqual(diffRes.hasChanges, true);
        assert.ok(diffRes.diff.includes('+    public void Jump() {}'));
    });

    // Test 7: Rollback seguro del working tree
    test('rollback restaura el estado limpio descartando modificaciones no confirmadas', () => {
        fs.writeFileSync(path.join(tempRepoDir, 'GarbageFile.tmp'), 'basura');

        const rollbackRes = gitIntegrationService.rollback(tempRepoDir, 'working_tree');
        assert.strictEqual(rollbackRes.ok, true);

        const status = gitIntegrationService.getStatus(tempRepoDir);
        assert.strictEqual(status.isClean, true);
        assert.strictEqual(fs.existsSync(path.join(tempRepoDir, 'GarbageFile.tmp')), false);
    });

    // Test 8: summarizeWork genera resumen estructurado y mensaje para el usuario
    test('summarizeWork compara con la base (main) y genera el resumen formateado', () => {
        const summaryRes = gitIntegrationService.summarizeWork(tempRepoDir, 'main');
        assert.strictEqual(summaryRes.ok, true);
        assert.strictEqual(summaryRes.branch, 'jarvis/fix-player-controller');
        assert.strictEqual(summaryRes.baseBranch, 'main');
        assert.strictEqual(summaryRes.commitsCount, 1);
        assert.strictEqual(summaryRes.filesTouched, 2);
        assert.ok(summaryRes.summary.includes('Hice 2 cambios en la rama jarvis/fix-player-controller. Los tests pasaron.'));
    });

    // Test 9: Integración en ActionKernel (git.status y git.safe_commit)
    await testAsync('ActionKernel ejecuta git.status y git.safe_branch', async () => {
        const statusAction = await actionKernel.execute('git.status', { projectPath: tempRepoDir });
        assert.strictEqual(statusAction.ok, true);
        assert.strictEqual(statusAction.data.branch, 'jarvis/fix-player-controller');

        const branchAction = await actionKernel.execute('git.safe_branch', {
            projectPath: tempRepoDir,
            taskName: 'inventario-refactor'
        });
        assert.strictEqual(branchAction.ok, true);
        assert.strictEqual(branchAction.data.branch, 'jarvis/inventario-refactor');
    });

    // Limpieza
    try {
        fs.rmSync(tempRepoDir, { recursive: true, force: true });
        fs.rmSync(nonGitDir, { recursive: true, force: true });
    } catch (e) {}

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 42 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_git_integration:', err);
    process.exit(1);
});
