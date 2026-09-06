/**
 * Skill Testing Service for Jarvis (Ítem 14)
 * Genera, ejecuta en sandbox aislado y audita tests unitarios para habilidades de IA.
 * Implementa una compuerta de activación estricta (Zero-Tolerance Gatekeeper):
 * Una habilidad SOLO puede activarse si supera el 100% de sus pruebas (ej. 4/4 PASSED).
 */

const sandboxService = require('./sandboxService');
const skillManager = require('./skillManager');

class SkillTestingService {
    /**
     * Construye el script completo combinando el código de la habilidad con el arnés de tests.
     */
    buildPythonTestHarness(skillCode, testFunctionsCode) {
        return `
${skillCode}

# ====================================================================
# ARNES DE PRUEBAS AUTOMATIZADO DE JARVIS (Ítem 14)
# ====================================================================
import time
import json
import traceback

${testFunctionsCode}

def _run_all_jarvis_tests():
    # Descubrimiento de funciones que inician con 'test_'
    test_funcs = [
        (name, func) for name, func in list(globals().items())
        if callable(func) and name.startswith("test_")
    ]
    
    results = []
    for name, func in test_funcs:
        start_t = time.perf_counter()
        try:
            func()
            duration_ms = round((time.perf_counter() - start_t) * 1000, 2)
            results.append({
                "name": name,
                "status": "PASSED",
                "durationMs": duration_ms,
                "error": None
            })
        except AssertionError as ae:
            duration_ms = round((time.perf_counter() - start_t) * 1000, 2)
            results.append({
                "name": name,
                "status": "FAILED",
                "durationMs": duration_ms,
                "error": str(ae) or "Asercion fallida (AssertionError)"
            })
        except Exception as e:
            duration_ms = round((time.perf_counter() - start_t) * 1000, 2)
            results.append({
                "name": name,
                "status": "FAILED",
                "durationMs": duration_ms,
                "error": f"{type(e).__name__}: {str(e)}"
            })
            
    passed_count = sum(1 for r in results if r["status"] == "PASSED")
    total_count = len(results)
    all_passed = (passed_count == total_count and total_count > 0)
    
    report = {
        "total": total_count,
        "passed": passed_count,
        "failed": total_count - passed_count,
        "score": f"{passed_count}/{total_count}",
        "passRate": round(passed_count / total_count, 2) if total_count > 0 else 0,
        "allPassed": all_passed,
        "tests": results
    }
    
    print("__JARVIS_TEST_REPORT_START__" + json.dumps(report) + "__JARVIS_TEST_REPORT_END__")

if __name__ == '__main__':
    _run_all_jarvis_tests()
`;
    }

    /**
     * Ejecuta el conjunto de tests en el sandbox aislado y procesa el reporte de resultados.
     */
    async runSkillTests({
        name = 'unnamed_skill',
        code,
        testsCode,
        language = 'python',
        permissions = {},
        timeoutMs = 8000
    }) {
        if (!code || !testsCode) {
            return {
                ok: false,
                allPassed: false,
                total: 0,
                passed: 0,
                failed: 0,
                score: '0/0',
                error: 'Código de habilidad o tests vacíos'
            };
        }

        const fullScript = this.buildPythonTestHarness(code, testsCode);

        const sandboxRes = await sandboxService.executeSandboxedSkill({
            name: `test_${name}`,
            code: fullScript,
            language,
            permissions,
            timeoutMs
        });

        // Parseo de la telemetría estructurada
        const rawOutput = sandboxRes.output || '';
        const match = rawOutput.match(/__JARVIS_TEST_REPORT_START__(.*?)__JARVIS_TEST_REPORT_END__/s);

        if (!match) {
            return {
                ok: false,
                allPassed: false,
                total: 0,
                passed: 0,
                failed: 1,
                score: '0/1',
                error: sandboxRes.error || sandboxRes.output || 'No se pudo generar el reporte de tests unitarios',
                sandboxStatus: sandboxRes.status
            };
        }

        try {
            const report = JSON.parse(match[1]);
            return {
                ok: true,
                ...report,
                executionTimeMs: sandboxRes.executionTimeMs
            };
        } catch (e) {
            return {
                ok: false,
                allPassed: false,
                total: 0,
                passed: 0,
                failed: 1,
                score: '0/1',
                error: `Error parseando reporte JSON: ${e.message}`
            };
        }
    }

    /**
     * COMPUERTA DE ACTIVACIÓN (Gatekeeper):
     * Evalúa los tests automáticos y SOLO activa la habilidad si 100% de los tests pasan.
     */
    async gatekeepAndRegisterSkill({
        name,
        version = '1.0.0',
        code,
        testsCode,
        language = 'python',
        permissions = {},
        entrypoint = null
    }) {
        // 1. Ejecución de pruebas automatizadas
        const testReport = await this.runSkillTests({
            name,
            code,
            testsCode,
            language,
            permissions
        });

        const entry = entrypoint || `${name}.${language === 'python' ? 'py' : 'js'}`;

        // 2. Compuerta de Cero Tolerancia
        if (testReport.allPassed) {
            // ACTIVACIÓN APROBADA
            const registerResult = skillManager.registerSkill({
                name,
                version,
                permissions,
                networkAccess: Boolean(permissions.network),
                fsAccess: permissions.filesystem_write || 'none',
                requiredLevel: 'L3',
                entrypoint: entry,
                trustLevel: 'verified-tested',
                testResults: testReport,
                status: 'enabled'
            });

            return {
                activated: true,
                status: 'ACTIVATED',
                message: `Habilidad '${name}' activada con éxito tras aprobar ${testReport.score} tests (${(testReport.passRate * 100).toFixed(0)}%).`,
                score: testReport.score,
                skillId: registerResult.skillId,
                report: testReport
            };
        } else {
            // ACTIVACIÓN RECHAZADA (No entra a producción)
            const failures = (testReport.tests || []).filter(t => t.status === 'FAILED');
            
            // Opcional: Registra en estado 'rejected' para auditoría de auto-aprendizaje
            const auditResult = skillManager.registerSkill({
                name,
                version,
                permissions,
                networkAccess: Boolean(permissions.network),
                fsAccess: permissions.filesystem_write || 'none',
                requiredLevel: 'L3',
                entrypoint: entry,
                trustLevel: 'untrusted',
                testResults: testReport,
                status: 'rejected'
            });

            return {
                activated: false,
                status: 'REJECTED',
                message: `Activación bloqueada para '${name}'. Fallaron ${testReport.failed} de ${testReport.total} tests (${testReport.score} PASSED).`,
                score: testReport.score,
                skillId: auditResult.skillId,
                failures,
                report: testReport
            };
        }
    }
}

const skillTestingService = new SkillTestingService();
module.exports = skillTestingService;
