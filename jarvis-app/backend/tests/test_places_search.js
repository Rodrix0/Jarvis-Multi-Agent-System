const assert = require('node:assert/strict');

async function run() {
    console.log('===============================================================');
    console.log('📍 INICIANDO SUITE DE TESTS: BÚSQUEDA DE COMERCIOS Y MAPS (PASO 2)');
    console.log('===============================================================');

    const placesService = require('../services/placesService');
    const actions = require('../services/jarvisActionService');

    // 1. Parsing determinista de intenciones
    console.log('\n--- TEST 1: Parsing de lenguaje natural ---');
    const t1 = placesService.parseRequest('búscame buenas cafeterías en Corrientes Capital y envíaselos por WhatsApp a Color Cartón');
    assert.deepEqual(t1, {
        category: 'cafeteria',
        categoryLabel: 'cafeterias',
        location: 'Corrientes Capital',
        contact: 'Color Cartón'
    });
    console.log('  ✅ [PASS] Cafeterías con destino WhatsApp a Color Cartón');

    const t2 = placesService.parseRequest('busca librerías cerca de mi zona');
    assert.equal(t2.category, 'libreria');
    assert.equal(t2.location, 'Corrientes Capital');
    assert.equal(t2.contact, null);
    console.log('  ✅ [PASS] Librerías cerca de mi zona (ubicación predeterminada)');

    const t3 = placesService.parseRequest('ah me olvidé, ya que estás JARVIS, búscame buenas cafeterías en Corrientes Capital y envíaselos por WhatsApp a Color Cartón');
    assert.equal(t3.category, 'cafeteria');
    assert.equal(t3.contact, 'Color Cartón');
    console.log('  ✅ [PASS] Frase conversacional con muletillas y contexto');

    const t4 = placesService.parseRequest('averiguame buenos restaurantes en Corrientes y mandáselos a Color Cartón');
    assert.equal(t4.category, 'restaurante');
    assert.equal(t4.contact, 'Color Cartón');
    console.log('  ✅ [PASS] Restaurantes con envío a contacto');

    // 2. Enrutamiento en ActionKernel
    console.log('\n--- TEST 2: Resolución en ActionKernel ---');
    const resolved = await actions.resolve('búscame buenas cafeterías en Corrientes Capital y envíaselos por WhatsApp a Color Cartón');
    assert.equal(resolved.id, 'places.search');
    assert.equal(resolved.params.contact, 'Color Cartón');
    console.log('  ✅ [PASS] ActionKernel resuelve id "places.search"');

    // 3. Ejecución de búsqueda y generación de Maps
    console.log('\n--- TEST 3: Búsqueda de lugares y URLs de Google Maps ---');
    const res = await placesService.searchPlaces({ category: 'cafeteria', location: 'Corrientes Capital' });
    assert.equal(res.ok, true);
    assert.ok(res.places.length >= 3);
    assert.ok(res.places[0].mapsUrl.includes('google.com/maps'));
    assert.ok(res.places[0].name.length > 0);
    assert.ok(res.places[0].rating.includes('★'));
    console.log(`  ✅ [PASS] ${res.places.length} cafeterías encontradas con rating y enlaces a Google Maps`);

    // 4. Verificación de formato para WhatsApp
    console.log('\n--- TEST 4: Simulación de despacho a WhatsApp ---');
    const whatsapp = require('../services/windowsControlService').whatsapp;
    const originalSend = whatsapp.sendMessage;
    let sentPayload = null;
    whatsapp.sendMessage = async (contact, message) => {
        sentPayload = { contact, message };
        return { ok: true, message: 'Enviado con éxito.' };
    };

    try {
        const sendTest = await placesService.searchPlaces({
            category: 'cafeteria',
            location: 'Corrientes Capital',
            contact: 'Color Cartón'
        });
        assert.equal(sendTest.whatsappSent, true);
        assert.equal(sentPayload.contact, 'Color Cartón');
        assert.match(sentPayload.message, /Recomendaciones de cafeteria en Corrientes Capital/);
        assert.match(sentPayload.message, /google\.com\/maps/);
        console.log('  ✅ [PASS] Mensaje formateado y despachado con éxito a Color Cartón con enlaces de Maps');
    } finally {
        whatsapp.sendMessage = originalSend;
    }

    console.log('\n===============================================================');
    console.log('🏁 SUITE DE COMERCIOS Y MAPS FINALIZADA CON ÉXITO: 4/4 PRUEBAS (100%)');
    console.log('===============================================================\n');
}

run().catch(err => {
    console.error('FAIL en suite de lugares:', err);
    process.exit(1);
});
