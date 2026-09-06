/**
 * TEST SUITE: Structured Outputs (Ítem 8)
 * Verifica que el sistema obligue a generar y validar esquemas tipados estrictos
 * para cada operación (AppAction, TVAction, FileAction, BrowserAction, MemoryAction, ResearchAction).
 */

const assert = require('assert');
const structuredOutputService = require('../services/ai/structuredOutputService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Structured Outputs Service (Ítem 8)');
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

    // 1. AppActionSchema: Caso de éxito exacto según la especificación del usuario
    test('AppAction: Valida esquema canónico {"action": "open_app", "target": "spotify", "confidence": 0.98}', () => {
        const payload = {
            action: 'open_app',
            target: 'spotify',
            confidence: 0.98
        };
        const res = structuredOutputService.validate(payload, 'AppAction');
        assert.strictEqual(res.ok, true, `Errores: ${res.errors.join(', ')}`);
        assert.strictEqual(res.sanitized.action, 'open_app');
        assert.strictEqual(res.sanitized.target, 'spotify');
        assert.strictEqual(res.sanitized.confidence, 0.98);
    });

    // 2. AppActionSchema: Rechazo por acción desconocida o campo ausente
    test('AppAction: Rechaza acciones inválidas o campos requeridos ausentes', () => {
        const badAction = { action: 'hacer_cafe', target: 'cafetera', confidence: 0.9 };
        const res1 = structuredOutputService.validate(badAction, 'AppAction');
        assert.strictEqual(res1.ok, false);
        assert(res1.errors.some(e => e.includes('no es válido')));

        const missingTarget = { action: 'open_app', confidence: 0.9 };
        const res2 = structuredOutputService.validate(missingTarget, 'AppAction');
        assert.strictEqual(res2.ok, false);
        assert(res2.errors.some(e => e.includes('target')));
    });

    // 3. TVActionSchema: Validación de rangos y operaciones
    test('TVAction: Valida volumen y rechaza valores fuera de rango 0-100', () => {
        const validTv = { action: 'tv_set_volume', percent: 45, confidence: 0.95 };
        const resValid = structuredOutputService.validate(validTv, 'TVAction');
        assert.strictEqual(resValid.ok, true);

        const invalidTv = { action: 'tv_set_volume', percent: 180, confidence: 0.95 };
        const resInvalid = structuredOutputService.validate(invalidTv, 'TVAction');
        assert.strictEqual(resInvalid.ok, false);
        assert(resInvalid.errors.some(e => e.includes('mayor al máximo')));
    });

    // 4. FileActionSchema: Formatos permitidos y nombres de archivo
    test('FileAction: Valida formatos soportados (txt, docx, pdf) y rechaza no autorizados', () => {
        const validFile = { action: 'file_create', fileName: 'informe.docx', format: 'docx', confidence: 0.9 };
        const res1 = structuredOutputService.validate(validFile, 'FileAction');
        assert.strictEqual(res1.ok, true);

        const invalidFormat = { action: 'file_create', fileName: 'script.bat', format: 'bat', confidence: 0.9 };
        const res2 = structuredOutputService.validate(invalidFormat, 'FileAction');
        assert.strictEqual(res2.ok, false);
        assert(res2.errors.some(e => e.includes('no es válido para "format"')));
    });

    // 5. BrowserActionSchema: Navegación, selectores y direcciones de scroll
    test('BrowserAction: Valida direcciones de scroll y URLs', () => {
        const validScroll = { action: 'browser_scroll', direction: 'down', amount: 400, confidence: 0.92 };
        const res1 = structuredOutputService.validate(validScroll, 'BrowserAction');
        assert.strictEqual(res1.ok, true);

        const invalidDir = { action: 'browser_scroll', direction: 'diagonal', confidence: 0.92 };
        const res2 = structuredOutputService.validate(invalidDir, 'BrowserAction');
        assert.strictEqual(res2.ok, false);
    });

    // 6. MemoryAction y ResearchAction
    test('MemoryAction y ResearchAction: Valida tópicos y campos requeridos', () => {
        const mem = { action: 'memory_store', topic: 'música favorita', content: 'rock clásico', confidence: 0.88 };
        const resMem = structuredOutputService.validate(mem, 'MemoryAction');
        assert.strictEqual(resMem.ok, true);

        const res = { action: 'research_query', topic: 'comparativa ryzen 7', depth: 'comparative', confidence: 0.94 };
        const resResearch = structuredOutputService.validate(res, 'ResearchAction');
        assert.strictEqual(resResearch.ok, true);
    });

    // 7. parseAndValidate: Extracción desde cadenas JSON y bloques Markdown
    test('parseAndValidate: Extrae y valida correctamente desde bloques de texto y markdown', () => {
        const rawJsonMarkdown = "Aquí tienes la acción solicitada:\n```json\n{\n  \"action\": \"open_app\",\n  \"target\": \"spotify\",\n  \"confidence\": 0.99\n}\n```";
        const res = structuredOutputService.parseAndValidate(rawJsonMarkdown, 'AppAction');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.sanitized.target, 'spotify');
        assert.strictEqual(res.sanitized.confidence, 0.99);

        const broken = "Texto sin formato JSON";
        const resBroken = structuredOutputService.parseAndValidate(broken, 'AppAction');
        assert.strictEqual(resBroken.ok, false);
    });

    // 8. Compatibilidad de Esquemas con Ollama JSON Schema
    test('getSchema: Retorna definiciones conformes a JSON Schema (type, properties, required)', () => {
        const schemaNames = ['AppAction', 'TVAction', 'FileAction', 'BrowserAction', 'MemoryAction', 'ResearchAction', 'UnifiedAction'];
        for (const name of schemaNames) {
            const s = structuredOutputService.getSchema(name);
            assert.strictEqual(s.type, 'object', `${name} debe ser type object`);
            assert(typeof s.properties === 'object', `${name} debe tener properties`);
            assert(Array.isArray(s.required), `${name} debe tener array required`);
            assert(s.properties.confidence, `${name} DEBE obligatoriamente incluir property confidence`);
        }
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE STRUCTURED OUTPUTS PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Structured Outputs:', err);
    process.exit(1);
});
