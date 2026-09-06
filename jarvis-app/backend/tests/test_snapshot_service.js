/**
 * test_snapshot_service.js
 * 
 * Suite de pruebas unitarias para el Ítem 43:
 * Snapshots Universales antes de Modificar Proyectos (Dual Provider: Git & Manifest con Rollback Atómico).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { snapshotService } = require('../services/developer/snapshotService');
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
    console.log('📸 INICIANDO SUITE DE PRUEBAS: ÍTEM 43 - SNAPSHOTS DE PROYECTOS');
    console.log('===============================================================');

    const tempDir = path.join(__dirname, 'temp_snapshot_tests');
    const nonGitProject = path.join(tempDir, 'plain_project');
    const gitProject = path.join(tempDir, 'git_project');

    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}

    fs.mkdirSync(nonGitProject, { recursive: true });
    fs.mkdirSync(gitProject, { recursive: true });

    // 1. Preparar proyecto No-Git
    fs.writeFileSync(path.join(nonGitProject, 'config.json'), JSON.stringify({ version: '1.0' }), 'utf8');
    fs.writeFileSync(path.join(nonGitProject, 'script.py'), 'print("original")\n', 'utf8');
    // Crear carpeta excluida (node_modules) para verificar exclusiones
    const excludedDir = path.join(nonGitProject, 'node_modules', 'dummy_pkg');
    fs.mkdirSync(excludedDir, { recursive: true });
    fs.writeFileSync(path.join(excludedDir, 'package.json'), '{}', 'utf8');

    // 2. Preparar proyecto Git
    execSync('git init -b main', { cwd: gitProject, stdio: 'pipe' });
    execSync('git config user.name "Jarvis Tester"', { cwd: gitProject, stdio: 'pipe' });
    execSync('git config user.email "tester@jarvis.local"', { cwd: gitProject, stdio: 'pipe' });
    execSync('git config core.autocrlf false', { cwd: gitProject, stdio: 'pipe' });

    fs.writeFileSync(path.join(gitProject, 'Main.cs'), 'public class Main {}\n', 'utf8');
    execSync('git add .', { cwd: gitProject, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: gitProject, stdio: 'pipe' });

    let manifestSnapshotId = null;
    let gitSnapshotId = null;

    // Test 1: Creación de Snapshot en carpeta ordinaria (Manifest Provider)
    await testAsync('createSnapshot en carpeta No-Git usa el proveedor manifest y excluye node_modules', async () => {
        const snap = await snapshotService.createSnapshot(nonGitProject, 'backup-inicial');
        assert.ok(snap.id.startsWith('snp_man_'));
        assert.strictEqual(snap.provider, 'manifest');
        assert.strictEqual(snap.filesCount, 2); // Solo config.json y script.py (node_modules excluido)
        manifestSnapshotId = snap.id;
    });

    // Test 2: Rollback atómico en carpeta ordinaria (restaura alterados y elimina creados)
    await testAsync('restoreSnapshot en carpeta No-Git restaura modificaciones y elimina archivos intrusos', async () => {
        // Alterar archivo original
        fs.writeFileSync(path.join(nonGitProject, 'script.py'), 'print("CORROMPIDO")\n', 'utf8');
        // Crear archivo intruso no deseado
        fs.writeFileSync(path.join(nonGitProject, 'malware.tmp'), 'intruso\n', 'utf8');

        const restoreRes = await snapshotService.restoreSnapshot(manifestSnapshotId);
        assert.strictEqual(restoreRes.ok, true);
        assert.strictEqual(restoreRes.provider, 'manifest');

        // Verificar restauración exacta
        const restoredContent = fs.readFileSync(path.join(nonGitProject, 'script.py'), 'utf8');
        assert.strictEqual(restoredContent, 'print("original")\n');
        assert.strictEqual(fs.existsSync(path.join(nonGitProject, 'malware.tmp')), false);
    });

    // Test 3: Creación de Snapshot en repositorio Git (Git Provider)
    await testAsync('createSnapshot en repositorio Git usa el proveedor git', async () => {
        // Modificar archivo en git y agregar archivo untracked
        fs.appendFileSync(path.join(gitProject, 'Main.cs'), '// Cambio temporal antes de snap\n');
        fs.writeFileSync(path.join(gitProject, 'Untracked.cs'), '// Untracked\n');

        const snap = await snapshotService.createSnapshot(gitProject, 'snap-git-feature');
        assert.ok(snap.id.startsWith('snp_git_'));
        assert.strictEqual(snap.provider, 'git');
        assert.strictEqual(snap.git.branch, 'main');
        assert.ok(snap.git.untracked.includes('Untracked.cs'));
        gitSnapshotId = snap.id;
    });

    // Test 4: Rollback atómico en repositorio Git
    await testAsync('restoreSnapshot en repositorio Git restaura el estado exacto del snapshot', async () => {
        // Provocar cambios destructivos adicionales
        fs.writeFileSync(path.join(gitProject, 'Main.cs'), '// TOTALMENTE ROTO\n');
        fs.writeFileSync(path.join(gitProject, 'ExtraFile.cs'), '// Basura\n');

        const restoreRes = await snapshotService.restoreSnapshot(gitSnapshotId);
        assert.strictEqual(restoreRes.ok, true);
        assert.strictEqual(restoreRes.provider, 'git');

        // Main.cs debe volver a tener el cambio temporal previo al snapshot
        const mainContent = fs.readFileSync(path.join(gitProject, 'Main.cs'), 'utf8');
        assert.ok(mainContent.includes('Cambio temporal antes de snap'));
        assert.ok(!mainContent.includes('TOTALMENTE ROTO'));
        assert.strictEqual(fs.existsSync(path.join(gitProject, 'ExtraFile.cs')), false);
        assert.strictEqual(fs.existsSync(path.join(gitProject, 'Untracked.cs')), true);
    });

    // Test 5: wrapTransaction exitoso sella el snapshot como COMMITTED
    await testAsync('wrapTransaction ejecuta acción exitosa y sella el snapshot como COMMITTED', async () => {
        const txResult = await snapshotService.wrapTransaction({
            projectPath: nonGitProject,
            label: 'refactor-exitoso',
            actionFn: async (snap) => {
                fs.appendFileSync(path.join(nonGitProject, 'script.py'), 'print("linea 2")\n');
                return { ok: true, message: 'Refactor aplicado' };
            }
        });

        assert.strictEqual(txResult.ok, true);
        const list = snapshotService.listSnapshots(nonGitProject);
        const snap = list.find(s => s.id === txResult.snapshotId);
        assert.strictEqual(snap.status, 'COMMITTED');
        assert.ok(fs.readFileSync(path.join(nonGitProject, 'script.py'), 'utf8').includes('linea 2'));
    });

    // Test 6: wrapTransaction fallido aplica auto-rollback inmediato
    await testAsync('wrapTransaction con error en acción aplica auto-rollback inmediato', async () => {
        const beforeContent = fs.readFileSync(path.join(nonGitProject, 'script.py'), 'utf8');

        const txFailResult = await snapshotService.wrapTransaction({
            projectPath: nonGitProject,
            label: 'refactor-fallido',
            actionFn: async () => {
                fs.appendFileSync(path.join(nonGitProject, 'script.py'), 'print("ERROR FATAL")\n');
                return { ok: false, error: 'Compilación fallida' };
            }
        });

        assert.strictEqual(txFailResult.ok, false);
        assert.strictEqual(txFailResult.rolledBack, true);

        // El archivo debe haber sido restaurado
        const afterContent = fs.readFileSync(path.join(nonGitProject, 'script.py'), 'utf8');
        assert.strictEqual(afterContent, beforeContent);
    });

    // Test 7: listSnapshots lista las capturas filtradas por ruta
    test('listSnapshots devuelve los snapshots registrados para la ruta solicitada', () => {
        const nonGitList = snapshotService.listSnapshots(nonGitProject);
        assert.ok(nonGitList.length >= 2);
        assert.ok(nonGitList.every(s => path.resolve(s.projectPath) === path.resolve(nonGitProject)));
    });

    // Test 8: pruneOldSnapshots ejecuta la poda según retención
    test('pruneOldSnapshots purga snapshots que exceden la cantidad máxima configurada', () => {
        const pruneRes = snapshotService.pruneOldSnapshots(0, 1); // Forzar poda conservando max 1
        assert.ok(pruneRes.prunedCount >= 1);
        assert.ok(pruneRes.remainingCount > 0);
    });

    // Test 9: Integración en ActionKernel (snapshot.create y snapshot.restore)
    await testAsync('ActionKernel ejecuta snapshot.create y snapshot.list', async () => {
        const createRes = await actionKernel.execute('snapshot.create', {
            projectPath: nonGitProject,
            label: 'kernel-test-snapshot'
        });

        assert.strictEqual(createRes.ok, true);
        assert.ok(createRes.data.id);

        const listRes = await actionKernel.execute('snapshot.list', {
            projectPath: nonGitProject
        });
        assert.strictEqual(listRes.ok, true);
        assert.ok(Array.isArray(listRes.data));
    });

    // Limpieza de directorios temporales
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}

    console.log('\n===============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} TESTS EXITOSOS`);
    console.log('===============================================================');

    if (passedTests === totalTests) {
        console.log('🎉 TODOS LOS TESTS DEL ÍTEM 43 PASARON EXITOSAMENTE.\n');
    } else {
        process.exit(1);
    }
}

runSuite().catch(err => {
    console.error('Fatal error en test_snapshot_service:', err);
    process.exit(1);
});
