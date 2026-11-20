/**
 * Test Suite para el Ítem 14: Tests Automáticos para Skills (skillTestingService.js)
 * Verifica:
 *   1. Ejecución de suite de 4 tests unitarios en sandbox aislado.
 *   2. Compuerta de Activación: 4/4 PASSED -> Habilidad ACTIVADA ('enabled').
 *   3. Compuerta de Cero Tolerancia: 3/4 PASSED -> Habilidad RECHAZADA ('rejected').
 *   4. Captura precisa de excepciones y diagnósticos de aserción.
 *   5. Persistencia y consulta de los resultados de testing en skills_manifest.
 */

const path = require('path');
const fs = require('fs');
const skillTestingService = require('../services/sandbox/skillTestingService');
const skillManager = require('../services/sandbox/skillManager');

async function runTests() {
    console.log('=== INICIANDO TEST SUITE: ITEM 14 - TESTS AUTOMATICOS PARA SKILLS ===\n');
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

    // Código de la habilidad (Convertidor simulado PNG a WebP)
    const pngToWebpSkillCode = `
class ImageConverter:
    @staticmethod
    def convert_to_webp(filename, width, height):
        if not filename.lower().endswith(".png"):
            raise ValueError("Formato de archivo no soportado. Se requiere .png")
        if width <= 0 or height <= 0:
            raise ValueError("Dimensiones invalidas")
        return {
            "output_file": filename.replace(".png", ".webp"),
            "format": "WEBP",
            "width": width,
            "height": height,
            "bytes_saved": 4500
        }
`;

    // 4 Tests Unitarios: test_valid_png, test_invalid_file, test_output_exists, test_preserve_size
    const perfectTestsCode = `
def test_valid_png():
    res = ImageConverter.convert_to_webp("avatar.png", 512, 512)
    assert res["format"] == "WEBP", "Debe convertir a formato WEBP"

def test_invalid_file():
    try:
        ImageConverter.convert_to_webp("document.pdf", 100, 100)
        assert False, "Debe rechazar archivos no PNG"
    except ValueError:
        pass # Excepcion esperada

def test_output_exists():
    res = ImageConverter.convert_to_webp("banner.png", 1920, 1080)
    assert res["output_file"] == "banner.webp", "El archivo de salida debe tener extension .webp"

def test_preserve_size():
    res = ImageConverter.convert_to_webp("icon.png", 64, 64)
    assert res["width"] == 64 and res["height"] == 64, "Las dimensiones deben preservarse"
`;

    // 1. Ejecución con 4/4 PASSED -> Activación Exitosa
    console.log('--- Test 1: Caso Exitoso (4/4 PASSED -> Habilidad Activada) ---');
    const activationResult = await skillTestingService.gatekeepAndRegisterSkill({
        name: 'convert_png_webp',
        version: '1.0.0',
        code: pngToWebpSkillCode,
        testsCode: perfectTestsCode,
        permissions: { filesystem_write: 'none' }
    });

    assert(activationResult.activated === true, 'Habilidad activada exitosamente');
    assert(activationResult.status === 'ACTIVATED', 'Estado es ACTIVATED');
    assert(activationResult.score === '4/4', 'Puntuación exacta: 4/4 PASSED');
    assert(activationResult.report.passRate === 1.0, 'Tasa de aprobación del 100%');
    assert(activationResult.report.tests.length === 4, 'Se registraron los 4 tests');

    // Verificar en Base de Datos que está 'enabled'
    const storedSkill = skillManager.getSkill(activationResult.skillId);
    assert(storedSkill && storedSkill.status === 'enabled', 'La habilidad está registrada como enabled en la base de datos');
    const parsedStoredResults = JSON.parse(storedSkill.test_results_json);
    assert(parsedStoredResults.score === '4/4', 'El reporte de tests está persistido en la base de datos');

    // 2. Ejecución con Fallo Intencional (3/4 PASSED -> Activación Rechazada)
    console.log('\n--- Test 2: Compuerta de Cero Tolerancia (3/4 PASSED -> Activación Rechazada) ---');
    const flawedSkillCode = `
class ImageConverter:
    @staticmethod
    def convert_to_webp(filename, width, height):
        if not filename.lower().endswith(".png"):
            raise ValueError("Formato invalido")
        # BUG INTENCIONAL: Altera las dimensiones
        return {
            "output_file": filename.replace(".png", ".webp"),
            "format": "WEBP",
            "width": 9999,
            "height": 9999
        }
`;

    const rejectedResult = await skillTestingService.gatekeepAndRegisterSkill({
        name: 'flawed_converter',
        version: '1.0.0',
        code: flawedSkillCode,
        testsCode: perfectTestsCode,
        permissions: { filesystem_write: 'none' }
    });

    assert(rejectedResult.activated === false, 'Activación bloqueada por compuerta de seguridad');
    assert(rejectedResult.status === 'REJECTED', 'Estado es REJECTED');
    assert(rejectedResult.score === '3/4', 'Puntuación exacta: 3/4 PASSED');
    assert(rejectedResult.failures.length === 1, 'Registra exactamente 1 test fallido');
    assert(rejectedResult.failures[0].name === 'test_preserve_size', 'Identifica el test fallido: test_preserve_size');
    assert(rejectedResult.failures[0].error.includes('dimensiones'), 'Detalle del error de aserción capturado');

    // 3. Verificación de Telemetría de Tiempos
    console.log('\n--- Test 3: Telemetría y Monitoreo de Tests Unitarios ---');
    const firstTest = activationResult.report.tests[0];
    assert(typeof firstTest.durationMs === 'number' && firstTest.durationMs >= 0, 'Registra duración de ejecución en milisegundos');
    assert(firstTest.status === 'PASSED', 'Test individual calificado como PASSED');

    console.log(`\n=== RESULTADO FINAL: ${passed}/${total} PRUEBAS APROBADAS ===`);
    if (passed !== total) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Error fatal en tests de testing service:', err);
    process.exit(1);
});
