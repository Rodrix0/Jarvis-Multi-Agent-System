const assert = require('assert');
const path = require('path');
const researchService = require('../services/ai/researchService');
const actionKernel = require('../services/actionKernelService');
require('../services/jarvisActionService'); // ensure actions are registered

async function runResearchTests() {
    console.log('🧪 Iniciando batería de pruebas: Deep Web Research Service (Item 6)...\n');
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

    // 1. Subquery Generation Test
    test('generateSubQueries genera entre 3 y 5 subconsultas analíticas especializadas', () => {
        const hardwareQueries = researchService.generateSubQueries('investiga sobre rtx 4060 vs rx 7600');
        assert(Array.isArray(hardwareQueries), 'Debe retornar un array');
        assert(hardwareQueries.length >= 3 && hardwareQueries.length <= 5, `Longitud incorrecta: ${hardwareQueries.length}`);
        
        const bugQueries = researchService.generateSubQueries('error de conexión wifi no funciona');
        assert(bugQueries.length >= 3 && bugQueries.length <= 5, `Longitud incorrecta para bug: ${bugQueries.length}`);

        const generalQueries = researchService.generateSubQueries('mejores teclados mecanicos');
        assert(generalQueries.length >= 3 && generalQueries.length <= 5, `Longitud incorrecta para general: ${generalQueries.length}`);
    });

    // 2. Canonical Deduplication Test
    test('deduplicate normaliza URLs, remueve utm_params y elimina duplicados', () => {
        const rawResults = [
            { url: 'https://www.xataka.com/analisis-gpu?utm_source=twitter&utm_medium=social', title: 'Xataka 1' },
            { url: 'https://www.xataka.com/analisis-gpu/', title: 'Xataka 2' },
            { url: 'https://www.xataka.com/analisis-gpu?ref=share', title: 'Xataka 3' },
            { url: 'https://hardzone.es/review-gpu', title: 'Hardzone' }
        ];
        const deduplicated = researchService.deduplicate(rawResults);
        assert.strictEqual(deduplicated.length, 2, `Se esperaban 2 únicas pero hubo ${deduplicated.length}`);
        assert.strictEqual(deduplicated[0].title, 'Xataka 1');
        assert.strictEqual(deduplicated[1].title, 'Hardzone');
    });

    // 3. Confidence Scoring Test (0.0 to 1.0)
    test('extractAndScore pondera relevancia semántica y autoridad de dominio (0 a 1)', () => {
        const items = [
            {
                title: 'Nvidia RTX 4060 vs AMD Radeon RX 7600',
                content: 'Comparativa detallada de especificaciones y rendimiento en 1080p y consumo energético.',
                url: 'https://www.tomshardware.com/reviews/rtx-4060-vs-rx-7600',
                source: 'Bing'
            },
            {
                title: 'Comprar ropa y calzado deportivo online',
                content: 'Encontrá ofertas en zapatillas y ropa informal.',
                url: 'https://www.tienda-cualquiera.com/ofertas',
                source: 'DuckDuckGo'
            }
        ];

        const scored = researchService.extractAndScore(items, 'rtx 4060 vs rx 7600 rendimiento');
        assert.strictEqual(scored.length, 2);

        // Confianza debe estar acotada entre 0.50 y 0.98
        scored.forEach(s => {
            assert(typeof s.confidence === 'number', 'Confidence debe ser numérico');
            assert(s.confidence >= 0.0 && s.confidence <= 1.0, `Confidence fuera de rango: ${s.confidence}`);
        });

        // La fuente especializada con coincidencia debe tener mayor puntaje que la tienda no relacionada
        assert(scored[0].confidence > scored[1].confidence, `Se esperaba que ${scored[0].confidence} > ${scored[1].confidence}`);
        assert(scored[0].url.includes('tomshardware.com'), 'La fuente de mayor confianza debe ser la primera');
    });

    // 4. Comparative Synthesis Test
    test('synthesize estructura resumen analítico, consenso y promedio de confianza', () => {
        const scored = [
            { title: 'Fuente 1', content: 'La RTX 4060 consume menos.', confidence: 0.92 },
            { title: 'Fuente 2', content: 'La RX 7600 rinde parejo a menor precio.', confidence: 0.88 }
        ];
        const syn = researchService.synthesize(scored, 'RTX 4060 vs RX 7600');
        assert(syn.summary && syn.summary.includes('fuentes'), 'Debe incluir resumen');
        assert(syn.consensus && syn.consensus.includes('RTX 4060 consume menos'), 'Debe incluir consenso');
        assert.strictEqual(syn.topSources.length, 2);
        assert.strictEqual(syn.avgConfidence, 0.9);
    });

    // 5. ActionKernel Integration Test
    await testAsync('ActionKernel ejecuta la acción research.query correctamente', async () => {
        const result = await actionKernel.execute('research.query', {
            question: 'computadoras gamer',
            options: { timeoutMs: 3000, maxSources: 5 }
        });

        assert.strictEqual(result.ok, true, 'El kernel debe responder ok: true');
        assert(result.data, 'Debe contener objeto data con investigación');
        assert(result.data.topic === 'computadoras gamer');
        assert(Array.isArray(result.data.subQueries));
        assert(result.data.subQueries.length >= 3);
        assert(typeof result.data.totalSourcesFound === 'number');
        assert(typeof result.data.uniqueSources === 'number');
        assert(result.data.synthesis);
    });

    console.log(`\n🎉 Todas las pruebas de Deep Web Research (${passed}/${total}) pasaron satisfactoriamente.\n`);
}

runResearchTests().catch(err => {
    console.error('\n💥 Error en pruebas de investigación:', err);
    process.exit(1);
});
