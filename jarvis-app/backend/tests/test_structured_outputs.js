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
        const schemaNames = ['AppAction', 'TVAction', 'FileAction', 'BrowserAction', 'MemoryAction', 'ResearchAction', 'UnifiedAction', 'Intent', 'Planner', 'ToolCall', 'Verification', 'Memory'];
        for (const name of schemaNames) {
            const s = structuredOutputService.getSchema(name);
            assert.strictEqual(s.type, 'object', `${name} debe ser type object`);
            assert(typeof s.properties === 'object', `${name} debe tener properties`);
            assert(Array.isArray(s.required), `${name} debe tener array required`);
        }
    });

    // 9. JARVIS 3.0: Esquema canónico de Intent
    test('JARVIS 3.0 Intent: Valida {"intent": "open_application", "target": "spotify", "confidence": 0.97, "risk": "LOW"}', () => {
        const payload = {
            intent: 'open_application',
            target: 'spotify',
            confidence: 0.97,
            risk: 'LOW',
            requiresLLM: false
        };
        const res = structuredOutputService.validate(payload, 'Intent');
        assert.strictEqual(res.ok, true, `Errores: ${res.errors.join(', ')}`);
        assert.strictEqual(res.sanitized.intent, 'open_application');
        assert.strictEqual(res.sanitized.risk, 'LOW');
    });

    // 10. JARVIS 3.0: Esquema canónico de Planner y Verification
    test('JARVIS 3.0 Planner & Verification: Valida planes jerárquicos y evidencias de verificación', () => {
        const plannerPayload = {
            goal: 'install_application',
            risk: 'MEDIUM',
            steps: [
                { id: 'step_1', action: 'browser_search', status: 'pending' }
            ]
        };
        const resPlanner = structuredOutputService.validate(plannerPayload, 'Planner');
        assert.strictEqual(resPlanner.ok, true, `Errores: ${resPlanner.errors.join(', ')}`);

        const verifPayload = {
            success: true,
            confidence: 0.96,
            evidence: ['window_found', 'expected_element_visible']
        };
        const resVerif = structuredOutputService.validate(verifPayload, 'Verification');
        assert.strictEqual(resVerif.ok, true, `Errores: ${resVerif.errors.join(', ')}`);
    });

    // 11. JARVIS 3.0: Esquema canónico de Memoria Universal
    test('JARVIS 3.0 Memory: Valida esquema de memoria semántica con entidades y hechos', () => {
        const memoryPayload = {
            shouldPersist: true,
            memoryType: 'semantic',
            importance: 0.82,
            entities: ['Unity', 'C#'],
            facts: ['El usuario programa en Unity con C#']
        };
        const res = structuredOutputService.validate(memoryPayload, 'Memory');
        assert.strictEqual(res.ok, true, `Errores: ${res.errors.join(', ')}`);
    });

    // 12. Bucle de autoreparación controlado (repairAndValidate)
    await (async () => {
        total++;
        try {
            const invalidJson = '{"intent": "open_application"}'; // Falta confidence requerido
            const res = await structuredOutputService.repairAndValidate(
                invalidJson,
                'Intent',
                async (raw, errors) => {
                    assert.ok(errors.some(e => e.includes('confidence')), 'Debe pasar el feedback del error');
                    return '{"intent": "open_application", "target": "spotify", "confidence": 0.95}';
                }
            );
            assert.strictEqual(res.ok, true);
            assert.strictEqual(res.repairs, 1);
            assert.strictEqual(res.repaired, true);
            assert.strictEqual(res.data.confidence, 0.95);
            console.log('  ✅ [PASS] repairAndValidate: Repara salida inválida en exactamente 1 ciclo controlado');
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] repairAndValidate: ${err.message}`);
            throw err;
        }
    })();

    // 13. Métricas de observabilidad de salidas estructuradas
    test('Observabilidad: Métricas en tiempo real estructuradas', () => {
        const metrics = structuredOutputService.getMetrics();
        assert.ok(metrics.total_validations > 0);
        assert.ok(metrics.structured_output_success_rate > 0 && metrics.structured_output_success_rate <= 1.0);
        assert.ok(metrics.schema_repair_count >= 1);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE STRUCTURED OUTPUTS PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Structured Outputs:', err);
    process.exit(1);
});
