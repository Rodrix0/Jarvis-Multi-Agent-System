/**
 * Test Suite para Response Formatter (Ítem 24)
 * Verifica:
 *  1. Desdoble de respuestas en Canal Pantalla y Canal Voz.
 *  2. Caso del usuario: 8 resultados de búsqueda (resumen oral en voz, lista completa en pantalla).
 *  3. Bloques de código: código visible en pantalla, voz sintetiza solo aviso sin leer sintaxis.
 *  4. Tablas Markdown: tabla preservada en pantalla, voz indica tabla comparativa.
 *  5. Respuestas cortas: identidad de contenido y naturalidad conversacional.
 *  6. Preservación estricta de preguntas de seguimiento en el canal de voz.
 *  7. Sanitización fonética: remoción de URLs crudas, rutas de Windows y expansión de $, %.
 *  8. Objetos con canales predefinidos y métricas de ahorro de palabras.
 */

const assert = require('assert');
const responseFormatter = require('../services/responseFormatterService');

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${description}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
    }
}

console.log('===============================================================');
console.log('🗣️  INICIANDO SUITE DE TESTS: FORMATEADOR DUAL VOZ/PANTALLA (ÍTEM 24)');
console.log('===============================================================');

console.log('\n--- BLOQUE 1: Caso Central del Usuario (Búsquedas y Listas Extensas) ---');

runTest('Búsqueda con 8 resultados desdobla resumen oral y lista en pantalla', () => {
    const raw = `Encontré 8 resultados para tu búsqueda:
1. Jarvis Multi-Agent Core - Sistema autónomo de agentes
2. BroadLink TV Controller - Integración domótica por infrarrojo
3. Whisper Audio Pipeline - Transcripción neuronal local
4. Vosk KWS - Detección de palabra de activación
5. SQLite Database - Persistencia local transaccional
6. Ollama Local LLM - Razonamiento sin conexión a internet
7. Windows UI Automation - Automatización de ventanas y accesibilidad
8. Token Budget Manager - Memoria eficiente de 20.000 tokens`;

    const formatted = responseFormatter.format(raw);

    // Pantalla debe contener la lista completa con los 8 ítems
    assert.strictEqual(formatted.screen.includes('8. Token Budget Manager'), true);
    assert.strictEqual(formatted.screen.includes('1. Jarvis Multi-Agent Core'), true);

    // Voz debe ser concisa, mencionar ocho resultados y no recitar toda la lista
    assert.strictEqual(formatted.voice.includes('ocho resultados'), true);
    assert.strictEqual(formatted.voice.includes('pantalla'), true);
    assert.strictEqual(formatted.voice.includes('Token Budget Manager'), false, 'Voz no debe recitar la lista técnica');
    assert.strictEqual(formatted.isTruncatedForVoice, true);
    assert.ok(formatted.stats.wordSavings > 20);
});

console.log('\n--- BLOQUE 2: Bloques de Código ---');

runTest('Bloque de código no se lee en voz pero se preserva en pantalla', () => {
    const raw = `Aquí tenés el script de automatización:
\`\`\`javascript
function reiniciarServicio() {
    const proceso = spawn('node', ['server.js']);
    console.log('Iniciado con PID:', proceso.pid);
    return proceso;
}
reiniciarServicio();
\`\`\`
Podés probarlo directamente en tu terminal.`;

    const formatted = responseFormatter.format(raw);

    // Pantalla preserva bloque con triple tilde
    assert.strictEqual(formatted.screen.includes('```javascript'), true);
    assert.strictEqual(formatted.screen.includes('const proceso = spawn'), true);

    // Voz no lee sintaxis de código
    assert.strictEqual(formatted.voice.includes('```'), false);
    assert.strictEqual(formatted.voice.includes('spawn'), false);
    assert.strictEqual(formatted.voice.includes('pantalla'), true);
});

console.log('\n--- BLOQUE 3: Tablas Markdown ---');

runTest('Tablas Markdown se mantienen en pantalla y se resumen para voz', () => {
    const raw = `Comparativa de cotizaciones:
| Tipo | Compra | Venta |
|---|---|---|
| Dólar Blue | $1320 | $1340 |
| Dólar Oficial | $980 | $1020 |
| Dólar MEP | $1290 | $1300 |`;

    const formatted = responseFormatter.format(raw);

    // Pantalla mantiene tabla completa
    assert.strictEqual(formatted.screen.includes('| Tipo | Compra |'), true);

    // Voz resume que hay una tabla comparativa en pantalla
    assert.strictEqual(formatted.voice.includes('|'), false);
    assert.strictEqual(formatted.voice.includes('tabla'), true);
    assert.strictEqual(formatted.voice.includes('pantalla'), true);
});

console.log('\n--- BLOQUE 4: Respuestas Cortas y Directas ---');

runTest('Respuesta corta permanece directa y natural sin truncamiento forzado', () => {
    const raw = 'Listo, subí el volumen al 50%.';
    const formatted = responseFormatter.format(raw);

    assert.strictEqual(formatted.screen, 'Listo, subí el volumen al 50%.');
    assert.strictEqual(formatted.voice, 'Listo, subí el volumen al 50 por ciento.');
    assert.strictEqual(formatted.isTruncatedForVoice, false);
});

runTest('Respuesta de confirmación simple no sufre alteraciones indebidas', () => {
    const raw = 'Cerré la ventana de Google Chrome.';
    const formatted = responseFormatter.format(raw);

    assert.strictEqual(formatted.screen, 'Cerré la ventana de Google Chrome.');
    assert.strictEqual(formatted.voice, 'Cerré la ventana de Google Chrome.');
    assert.strictEqual(formatted.isTruncatedForVoice, false);
});

console.log('\n--- BLOQUE 5: Preservación de Preguntas de Seguimiento ---');

runTest('Pregunta interactiva se conserva obligatoriamente en el canal de voz', () => {
    const raw = `Encontré 12 películas de misterio disponibles en streaming con excelentes calificaciones del público:
1. Película Uno
2. Película Dos
3. Película Tres
4. Película Cuatro
5. Película Cinco
¿Querés que reproduzca la primera o preferís ver la lista completa?`;

    const formatted = responseFormatter.format(raw);

    // La pregunta debe estar intacta al final de la voz
    assert.strictEqual(formatted.voice.includes('¿Querés que reproduzca la primera o preferís ver la lista completa?'), true);
});

console.log('\n--- BLOQUE 6: Limpieza Fonética y Sanitización para TTS ---');

runTest('Elimina URLs crudas y rutas locales de Windows en la voz', () => {
    const raw = 'Podés descargar la actualización desde https://github.com/Rodrix0/jarvis-core/releases/tag/v2.0 o revisar C:\\Users\\Rodrigo\\Desktop\\IA\\docs\\readme.md.';
    const voiceClean = responseFormatter.sanitizeForTts(raw);

    assert.strictEqual(voiceClean.includes('https://'), false);
    assert.strictEqual(voiceClean.includes('el enlace'), true);
    assert.strictEqual(voiceClean.includes('C:\\Users'), false);
    assert.strictEqual(voiceClean.includes('tu archivo'), true);
});

runTest('Expande símbolos monetarios y porcentajes para habla fluida', () => {
    const raw = 'El incremento fue de 15% y el precio total es $450.';
    const voiceClean = responseFormatter.sanitizeForTts(raw);

    assert.strictEqual(voiceClean.includes('15 por ciento'), true);
    assert.strictEqual(voiceClean.includes('450 pesos'), true);
});

console.log('\n--- BLOQUE 7: Objetos con Canales Predefinidos y Estadísticas ---');

runTest('Respeta objeto que ya define canal de voz y de pantalla explícitos', () => {
    const input = {
        voice: 'Hecho señor, orden ejecutada.',
        screen: '### Reporte de Ejecución\n- Estado: OK\n- Código: 200'
    };

    const formatted = responseFormatter.format(input);

    assert.strictEqual(formatted.voice, 'Hecho señor, orden ejecutada.');
    assert.strictEqual(formatted.screen.includes('### Reporte de Ejecución'), true);
});

runTest('Cálculo de estadísticas de ahorro de palabras', () => {
    const longText = 'Palabra '.repeat(100);
    const formatted = responseFormatter.format(longText);

    assert.ok(formatted.stats.screenWords >= 100);
    assert.ok(formatted.stats.voiceWords <= 40);
    assert.ok(formatted.stats.wordSavings > 50);
});

console.log('===============================================================');
console.log(`🏁 TESTS FINALIZADOS: ${passedTests}/${totalTests} EXITOSOS (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('===============================================================');

if (passedTests !== totalTests) {
    process.exit(1);
}
