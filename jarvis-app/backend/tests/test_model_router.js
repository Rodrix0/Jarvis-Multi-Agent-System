/**
 * TEST SUITE: Model Router Service (Ítem 7)
 * Verifica que Jarvis clasifique semánticamente cada tarea y asigne el modelo
 * óptimo de Ollama ahorrando VRAM y latencia (NONE, CONVERSATION, CODING, REASONING, VISION).
 */

const assert = require('assert');
const modelRouter = require('../services/ai/modelRouterService');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 TEST: Model Router Service (Ítem 7)');
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

    // 1. Clasificación NONE (0 ms, 0 VRAM para comandos deterministas)
    test('Clasifica comandos directos hacia NONE sin invocar LLM', () => {
        const c1 = modelRouter.classifyTask('subí el volumen al 50%');
        assert.strictEqual(c1.route, 'NONE');
        assert.strictEqual(c1.useLLM, false);

        const c2 = modelRouter.classifyTask('minimizá la ventana activa');
        assert.strictEqual(c2.route, 'NONE');
        assert.strictEqual(c2.useLLM, false);

        const c3 = modelRouter.classifyTask('mandale un whatsapp a color cartón que diga hola');
        assert.strictEqual(c3.route, 'NONE');
        assert.strictEqual(c3.useLLM, false);

        const c4 = modelRouter.classifyTask('cuánto está el dólar blue');
        assert.strictEqual(c4.route, 'NONE');
        assert.strictEqual(c4.useLLM, false);

        const c5 = modelRouter.classifyTask('', { actionId: 'system.open' });
        assert.strictEqual(c5.route, 'NONE');
        assert.strictEqual(c5.useLLM, false);
    });

    // 2. Clasificación CONVERSATION (qwen2.5:3b)
    await testAsync('Enruta diálogo casual a CONVERSATION con modelo pequeño y ágil', async () => {
        const res = await modelRouter.route('hola jarvis cómo estás hoy');
        assert.strictEqual(res.route, 'CONVERSATION');
        assert.strictEqual(res.useLLM, true);
        assert(res.model.includes('qwen2.5:3b') || res.model.includes('qwen'), `Modelo asignado: ${res.model}`);
        assert.strictEqual(res.temperature, 0.7);
        assert(res.maxTokens <= 1024);
    });

    // 3. Clasificación CODING (qwen2.5-coder)
    await testAsync('Enruta programación y depuración a CODING con modelo coder', async () => {
        const res1 = await modelRouter.route('escribeme una función en python para ordenar un array');
        assert.strictEqual(res1.route, 'CODING');
        assert.strictEqual(res1.useLLM, true);
        assert(res1.model.includes('coder') || res1.model.includes('hermes3'), `Modelo coder: ${res1.model}`);
        assert.strictEqual(res1.temperature, 0.2); // Precisión técnica

        const res2 = await modelRouter.route('cómo crear un script en javascript con regex para validar emails');
        assert.strictEqual(res2.route, 'CODING');
    });

    // 4. Clasificación REASONING (hermes3 / llama3.1)
    await testAsync('Enruta análisis profundo y comparativas a REASONING con modelo mediano/grande', async () => {
        const res = await modelRouter.route('cuál es la diferencia técnica entre arquitectura x86 y arm y cuáles son los pros y contras');
        assert.strictEqual(res.route, 'REASONING');
        assert.strictEqual(res.useLLM, true);
        assert(res.model.includes('hermes3') || res.model.includes('llama3.1'), `Modelo reasoning: ${res.model}`);
        assert.strictEqual(res.temperature, 0.4);
    });

    // 5. Clasificación VISION (pantalla / OCR)
    await testAsync('Enruta análisis de capturas y pantalla a VISION', async () => {
        const res = await modelRouter.route('fijate qué error sale en la pantalla ahora mismo');
        assert.strictEqual(res.route, 'VISION');
        assert.strictEqual(res.useLLM, true);
        assert.strictEqual(res.temperature, 0.3);
    });

    // 6. Detección y Fallback Dinámico en Ollama
    await testAsync('Detección dinámica de modelos en Ollama y resolución de fallbacks', async () => {
        const models = await modelRouter.getAvailableModels();
        assert(Array.isArray(models), 'Debe retornar lista de modelos');
        assert(models.length > 0, 'Debe haber al menos un modelo detectado');
        console.log(`     Modelos disponibles detectados en Ollama: [${models.join(', ')}]`);

        // Comprobar resolución con lista mockeada donde no está el coder
        const fallbackResolved = modelRouter.resolveModelForRoute('CODING', ['hermes3:latest', 'llama3.1:latest']);
        assert.strictEqual(fallbackResolved, 'hermes3:latest', 'Debe hacer fallback a hermes3 si no hay coder');
    });

    // 7. Métricas y Estadísticas
    test('getStats() registra la telemetría acumulada por categoría', () => {
        const stats = modelRouter.getStats();
        assert(typeof stats.totalRouted === 'number' && stats.totalRouted > 0);
        assert(stats.NONE > 0 || stats.CONVERSATION > 0);
        console.log('     Estadísticas de enrutamiento:', stats);
    });

    console.log(`\n===============================================================`);
    console.log(`🎉 TODOS LOS TESTS DE MODEL ROUTER PASARON EXITOSAMENTE: ${passed}/${total} (100%)`);
    console.log(`===============================================================\n`);
}

runTests().catch(err => {
    console.error('\n💥 Error fatal en pruebas de Model Router:', err);
    process.exit(1);
});
