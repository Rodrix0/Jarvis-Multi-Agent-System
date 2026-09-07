/**
 * Sandbox Hardening & Offensive Isolation Test Suite (JARVIS 3.1)
 *
 * Ejecuta vectores de ataque ofensivos para certificar la contención del sandbox:
 * 1. Path Traversal Escape (Intentos de escritura y lectura con ../ hacia rutas del OS).
 * 2. Subprocess Denial (Intentos de ejecución de powershell.exe, cmd.exe, spawn sin permiso).
 * 3. Network Isolation (Intentos de apertura de sockets o peticiones HTTP locales/remotas).
 * 4. Secret Isolation (Garantía de cero fuga de credenciales o variables de entorno del host).
 * 5. Process Tree Kill (Terminación forzosa de procesos y subprocesos hijos ante timeout/ataques).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sandboxService = require('../services/sandbox/sandboxService');

const securityReport = [];

function recordSecurityResult({ vector, permission, expected, outcome, status }) {
    securityReport.push({
        'Vector de Ataque': vector,
        'Permiso': permission,
        'Comportamiento Esperado': expected,
        'Resultado Real': outcome,
        'Estado': status
    });
    const icon = status === 'SECURE' ? '🛡️ [SECURE]' : '🚨 [VULNERABLE]';
    console.log(`  ${icon} ${vector}: ${outcome}`);
}

async function runOffensiveTests() {
    console.log('\n===============================================================');
    console.log('🔒 INICIANDO SUITE DE HARDENING Y AISLAMIENTO OFENSIVO (JARVIS 3.1)');
    console.log('===============================================================\n');

    const escapeTargetFile = path.resolve(__dirname, '..', '..', 'data', 'sandbox_escape_test.txt');
    if (fs.existsSync(escapeTargetFile)) {
        try { fs.unlinkSync(escapeTargetFile); } catch (_) {}
    }

    // -------------------------------------------------------------
    // VECTOR 1: Path Traversal Escape (Directory Traversal)
    // -------------------------------------------------------------
    console.log('--- VECTOR 1: Path Traversal Escape ---');
    try {
        const attackCode = `
# Intento de escape por path traversal hacia directorio superior
with open("../../data/sandbox_escape_test.txt", "w") as f:
    f.write("ESCAPE_SUCCESSFUL")
print("PWNED")
`;
        const res = await sandboxService.executeSkill({
            name: 'attack_path_traversal',
            code: attackCode,
            trustLevel: 'untrusted',
            language: 'python',
            permissions: { filesystem_write: 'none' }
        });

        const fileEscaped = fs.existsSync(escapeTargetFile);
        assert.strictEqual(fileEscaped, false, 'El archivo no debió crearse fuera del sandbox');
        assert.ok(
            res.status === 'PERMISSION_DENIED_STATIC' ||
            res.status === 'PERMISSION_DENIED_RUNTIME' ||
            !res.ok,
            'La ejecución debe ser bloqueada'
        );

        recordSecurityResult({
            vector: 'Path Traversal (../../ escape)',
            permission: 'filesystem_write=none',
            expected: 'Bloqueo estático o runtime, archivo no creado',
            outcome: res.status,
            status: 'SECURE'
        });
    } catch (err) {
        recordSecurityResult({
            vector: 'Path Traversal',
            permission: 'filesystem_write=none',
            expected: 'Bloqueo',
            outcome: err.message,
            status: 'VULNERABLE'
        });
    }

    // -------------------------------------------------------------
    // VECTOR 2: Subprocess Denial (Powershell & Shell Execution)
    // -------------------------------------------------------------
    console.log('\n--- VECTOR 2: Subprocess Denial (Powershell / Cmd) ---');
    try {
        const attackCode = `
import subprocess
subprocess.run(["powershell.exe", "-Command", "Write-Host 'PWNED_BY_POWERSHELL'"])
`;
        const res = await sandboxService.executeSkill({
            name: 'attack_subprocess',
            code: attackCode,
            trustLevel: 'untrusted',
            language: 'python',
            permissions: { powershell: false, process_spawn: false }
        });

        assert.ok(!res.output || !res.output.includes('PWNED_BY_POWERSHELL'), 'No debió ejecutar PowerShell');
        assert.ok(
            res.status === 'PERMISSION_DENIED_STATIC' ||
            res.status === 'PERMISSION_DENIED_RUNTIME' ||
            !res.ok,
            'Subproceso debe ser denegado'
        );

        recordSecurityResult({
            vector: 'Subprocess Invocation (powershell.exe)',
            permission: 'powershell=false',
            expected: 'Denegación antes de invocar subproceso',
            outcome: res.status,
            status: 'SECURE'
        });
    } catch (err) {
        recordSecurityResult({
            vector: 'Subprocess Invocation',
            permission: 'powershell=false',
            expected: 'Denegación',
            outcome: err.message,
            status: 'VULNERABLE'
        });
    }

    // -------------------------------------------------------------
    // VECTOR 3: Network Connection Denial (Socket & HTTP)
    // -------------------------------------------------------------
    console.log('\n--- VECTOR 3: Network Connection Denial ---');
    try {
        const attackCode = `
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
s.connect(("127.0.0.1", 80))
print("SOCKET_CONNECTED")
`;
        const res = await sandboxService.executeSkill({
            name: 'attack_network_socket',
            code: attackCode,
            trustLevel: 'untrusted',
            language: 'python',
            permissions: { network: false }
        });

        assert.ok(!res.output || !res.output.includes('SOCKET_CONNECTED'), 'El socket no debió conectar');
        assert.ok(
            res.status === 'PERMISSION_DENIED_STATIC' ||
            res.status === 'PERMISSION_DENIED_RUNTIME' ||
            !res.ok,
            'Conexión de red debe ser bloqueada'
        );

        recordSecurityResult({
            vector: 'Network Socket Outbound (127.0.0.1)',
            permission: 'network=false',
            expected: 'Socket interdictado en análisis o runtime',
            outcome: res.status,
            status: 'SECURE'
        });
    } catch (err) {
        recordSecurityResult({
            vector: 'Network Socket Outbound',
            permission: 'network=false',
            expected: 'Bloqueo',
            outcome: err.message,
            status: 'VULNERABLE'
        });
    }

    // -------------------------------------------------------------
    // VECTOR 4: Secret Isolation (Credential Extraction Attack)
    // -------------------------------------------------------------
    console.log('\n--- VECTOR 4: Secret Isolation (Credential Leaks) ---');
    try {
        process.env.JARVIS_TEST_SECRET = 'CRITICAL_LEAK_JARVIS_API_KEY_12345';
        process.env.OPENAI_API_KEY = 'sk-live-secret-never-expose-token';

        const attackCode = `
import os
found_secrets = []
for k, v in os.environ.items():
    if "JARVIS" in k or "API_KEY" in k or "SECRET" in k:
        found_secrets.append(f"{k}={v}")
print("DISCOVERED_SECRETS:", ",".join(found_secrets) if found_secrets else "NONE")
`;
        const res = await sandboxService.executeSkill({
            name: 'attack_secret_stealing',
            code: attackCode,
            trustLevel: 'untrusted',
            language: 'python'
        });

        assert.ok(!res.output.includes('CRITICAL_LEAK_JARVIS_API_KEY_12345'), 'El secreto JARVIS_TEST_SECRET no debe estar accesible');
        assert.ok(!res.output.includes('sk-live-secret'), 'La clave OPENAI_API_KEY no debe estar accesible');
        assert.ok(res.output.includes('DISCOVERED_SECRETS: NONE'), 'El sandbox debe tener cero credenciales');

        recordSecurityResult({
            vector: 'Environment Secret Harvesting',
            permission: 'env_read=none',
            expected: 'Variables de entorno limpias sin secretos del host',
            outcome: 'DISCOVERED_SECRETS: NONE',
            status: 'SECURE'
        });
    } catch (err) {
        recordSecurityResult({
            vector: 'Environment Secret Harvesting',
            permission: 'env_read=none',
            expected: 'Aislamiento de secretos',
            outcome: err.message,
            status: 'VULNERABLE'
        });
    } finally {
        delete process.env.JARVIS_TEST_SECRET;
        delete process.env.OPENAI_API_KEY;
    }

    // -------------------------------------------------------------
    // VECTOR 5: Process Tree Kill & Anti-Hanging (No Zombies)
    // -------------------------------------------------------------
    console.log('\n--- VECTOR 5: Process Tree Kill & Anti-Hanging ---');
    try {
        const attackCode = `
import time
print("DAEMON_SPAWNED")
while True:
    time.sleep(0.1)
`;
        const t0 = Date.now();
        const res = await sandboxService.executeSkill({
            name: 'attack_infinite_hang',
            code: attackCode,
            trustLevel: 'untrusted',
            language: 'python',
            timeoutMs: 1200
        });

        const elapsed = Date.now() - t0;
        assert.strictEqual(res.status, 'TIMEOUT', 'Debe abortar por TIMEOUT');
        assert.ok(elapsed >= 1100 && elapsed <= 3500, `El timeout debe cumplirse de forma estricta (tomo ${elapsed}ms)`);
        assert.ok(res.error.includes('Tiempo límite de sandbox excedido'), 'Mensaje de error claro de timeout');

        recordSecurityResult({
            vector: 'Process Hanging / Tree Kill',
            permission: 'timeoutMs=1200',
            expected: 'Terminación forzosa de árbol de procesos y cero zombies',
            outcome: `TIMEOUT abortado en ${elapsed}ms`,
            status: 'SECURE'
        });
    } catch (err) {
        recordSecurityResult({
            vector: 'Process Hanging / Tree Kill',
            permission: 'timeoutMs=1200',
            expected: 'Timeout forzoso',
            outcome: err.message,
            status: 'VULNERABLE'
        });
    }

    // -------------------------------------------------------------
    // REPORTE DE SEGURIDAD FINAL
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log('🛡️  REPORTE DE AUDITORÍA DE SEGURIDAD DEL SANDBOX (JARVIS 3.1)');
    console.log('===============================================================');
    console.table(securityReport);

    const isVulnerable = securityReport.some(r => r.Estado === 'VULNERABLE');
    if (isVulnerable) {
        console.error('🚨 Se detectaron vulnerabilidades en el aislamiento del sandbox.');
        process.exit(1);
    } else {
        console.log('🎉 TODOS LOS VECTORES DE ATAQUE FUERON CONTENIDOS Y BLOQUEADOS (100% SECURE).');
        process.exit(0);
    }
}

runOffensiveTests().catch(err => {
    console.error('Fatal error en suite de sandbox hardening:', err);
    process.exit(1);
});
