/**
 * MASTER REGRESSION & SAFETY SUITE FOR JARVIS
 * 
 * Este conjunto de pruebas garantiza que ninguna modificación futura rompa
 * las funciones fundamentales de Jarvis:
 * 1. Control de volumen (PC & TV / BroadLink IR delta y absoluto)
 * 2. Despertar / Dormir (Aislamiento de estado y no conflicto con TV/luces)
 * 3. Ventanas y Pestañas (Minimizar, Maximizar, Cerrar, Siguiente/Anterior, Pestañas 1-9)
 * 4. Envío directo de WhatsApp (Filtros de nombres, acentos, repeticiones)
 * 5. Consultas de Cotización de Dólar y Finanzas
 * 6. Archivos y Carpetas (Creación de TXT, Word, Carpetas compuestas y borrado)
 * 7. Inmunidad contra falsos positivos (Apertura indebida de YouTube, Stable Diffusion, cortes prematuros)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fastCommandParser = require('../services/ai/fastCommandParser');
const jarvisActionService = require('../services/jarvisActionService');
const systemService = require('../services/systemService');
const windowTabService = require('../services/windows/windowTabService');
const financeService = require('../services/financeService');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (error) {
        console.error(`  ❌ [FAIL] ${name}: ${error.message}`);
        throw error;
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (error) {
        console.error(`  ❌ [FAIL] ${name}: ${error.message}`);
        throw error;
    }
}

async function main() {
    console.log('===============================================================');
    console.log('🛡️  INICIANDO SUITE MAESTRA DE SEGURIDAD Y REGRESIÓN DE JARVIS');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // BLOQUE 1: VOLUMEN Y AUDIO (PC & TV)
    // -------------------------------------------------------------
    console.log('--- BLOQUE 1: Control de Audio y Volumen (PC y TV) ---');
    
    runTest('Audio PC absoluto al 50%', () => {
        const res = fastCommandParser.parse('pone el volumen al 50%');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'audio.set-volume');
        assert.strictEqual(res.params.percent, 50);
    });

    runTest('Mute / Silencio en PC', () => {
        const res = fastCommandParser.parse('silencia la computadora');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'audio.toggle-mute');
    });

    runTest('Volumen TV delta positivo', () => {
        const res = fastCommandParser.parse('subi el volumen a la tele un 20%');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'tv.adjust-volume');
        assert.strictEqual(res.params.delta, 20);
    });

    runTest('Volumen TV delta negativo', () => {
        const res = fastCommandParser.parse('bajale 10 puntos a la tele');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'tv.adjust-volume');
        assert.strictEqual(res.params.delta, -10);
    });

    runTest('Volumen TV absoluto', () => {
        const res = fastCommandParser.parse('volumen de la tele al 40%');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'tv.set-volume');
        assert.strictEqual(res.params.percent, 40);
    });

    runTest('Consulta de volumen de TV', () => {
        const res = fastCommandParser.parse('cuanto esta el volumen de la tele');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'tv.get-volume');
    });

    // -------------------------------------------------------------
    // BLOQUE 2: DESPERTAR / DORMIR Y AISLAMIENTO DE ESTADO
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 2: Wake / Sleep y Aislamiento de Dispositivos Externos ---');

    runTest('Comando despertar: "jarvis prendete"', () => {
        const res = fastCommandParser.parse('jarvis prendete');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'voice.wake');
    });

    runTest('Comando dormir: "jarvis apagate"', () => {
        const res = fastCommandParser.parse('jarvis apagate');
        assert.strictEqual(res.match, true);
        assert.strictEqual(res.action, 'voice.sleep');
    });

    runTest('No apagar Jarvis al pedir apagar la tele', () => {
        const res = fastCommandParser.parse('apaga la tele');
        assert.notStrictEqual(res.action, 'voice.sleep', 'No debe apagar la escucha de Jarvis al apagar la tele');
    });

    runTest('No apagar Jarvis al pedir apagar las luces', () => {
        const res = fastCommandParser.parse('apaga la luz');
        assert.notStrictEqual(res.action, 'voice.sleep', 'No debe apagar la escucha de Jarvis al apagar la luz');
    });

    await runAsyncTest('ActionService resuelve voice.wake y voice.sleep sin errores', async () => {
        const wakePlan = await jarvisActionService.resolve('prendete');
        assert.strictEqual(wakePlan.id, 'voice.wake');
        const sleepPlan = await jarvisActionService.resolve('apagate');
        assert.strictEqual(sleepPlan.id, 'voice.sleep');
    });

    // -------------------------------------------------------------
    // BLOQUE 3: CONTROL DE VENTANAS Y PESTAÑAS
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 3: Control de Ventanas y Pestañas ---');

    const windowVariations = [
        { text: 'minimiza', expected: 'window.minimize' },
        { text: 'minimisa', expected: 'window.minimize' },
        { text: 'mini misa', expected: 'window.minimize' },
        { text: 'achica la ventana', expected: 'window.minimize' },
        { text: 'oculta la ventana', expected: 'window.minimize' },
        { text: 'minimiza todo', expected: 'window.minimize-all' },
        { text: 'mostrar escritorio', expected: 'window.minimize-all' },
        { text: 'maximiza', expected: 'window.maximize' },
        { text: 'maximisa', expected: 'window.maximize' },
        { text: 'maxi misa', expected: 'window.maximize' },
        { text: 'agranda la ventana', expected: 'window.maximize' },
        { text: 'pantalla completa', expected: 'window.maximize' },
        { text: 'cerrar ventana', expected: 'window.close' },
        { text: 'cerra la ventana', expected: 'window.close' },
        { text: 'cambia de ventana', expected: 'window.next' },
        { text: 'siguiente pestaña', expected: 'tab.next' },
        { text: 'pestaña anterior', expected: 'tab.prev' },
        { text: 'nueva pestaña', expected: 'tab.new' },
        { text: 'cerrar pestaña', expected: 'tab.close' },
        { text: 'cerra', expected: 'tab.close' },
        { text: 'anda a la pestaña 4', expected: 'tab.go-to', params: { index: 4 } },
        { text: 'a la pestaña 2', expected: 'tab.go-to', params: { index: 2 } },
        { text: 'primera pestaña', expected: 'tab.go-to', params: { index: 1 } },
        { text: 'pestaña cinco', expected: 'tab.go-to', params: { index: 5 } },
        { text: 'ultima pestaña', expected: 'tab.go-to', params: { index: 9 } }
    ];

    for (const item of windowVariations) {
        runTest(`Parser Ventanas/Pestañas: "${item.text}"`, () => {
            const res = fastCommandParser.parse(item.text);
            assert.strictEqual(res.match, true);
            assert.strictEqual(res.action, item.expected);
            if (item.params) {
                assert.deepStrictEqual(res.params, item.params);
            }
        });
    }

    runTest('Integridad de métodos en WindowTabService', () => {
        const requiredMethods = [
            'minimizeActive', 'minimizeAll', 'maximizeActive',
            'goToTab', 'nextTab', 'prevTab', 'closeTab', 'newTab',
            'closeWindow', 'nextWindow'
        ];
        for (const m of requiredMethods) {
            assert.strictEqual(typeof windowTabService[m], 'function', `Falta el método ${m}`);
        }
    });

    // -------------------------------------------------------------
    // BLOQUE 4: ENVÍO DIRECTO DE MENSAJES POR WHATSAPP
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 4: Envío Directo de WhatsApp ---');

    const whatsappCases = [
        {
            text: 'un mensaje a color cartón que diga te amo',
            expectedContact: 'color cartón',
            expectedMessage: 'te amo'
        },
        {
            text: 'mandale un mensaje a color cartón que diga te amo',
            expectedContact: 'color cartón',
            expectedMessage: 'te amo'
        },
        {
            text: "enviá un mensaje al contacto 'color cartón' que diga 'te amo'",
            expectedContact: 'color cartón',
            expectedMessage: 'te amo'
        },
        {
            text: "WhatsApp, entrá en el historial de pedidos y enviá un mensaje al contacto 'color cartón' que diga 'te amo'",
            expectedContact: 'color cartón',
            expectedMessage: 'te amo'
        },
        {
            text: "gale un mensaje a color cartón que diga un mensaja color carton que digas te amo",
            expectedContact: 'color cartón',
            expectedMessage: 'te amo'
        },
        {
            text: 'enviá un mensaje a mamá que diga llego en 10',
            expectedContact: 'mamá',
            expectedMessage: 'llego en 10'
        },
        {
            text: 'mandale un whatsapp a juan diciendo hola amigo como andas',
            expectedContact: 'juan',
            expectedMessage: 'hola amigo como andas'
        }
    ];

    for (const c of whatsappCases) {
        runTest(`WhatsApp Parser: "${c.text.slice(0, 45)}..."`, () => {
            const res = fastCommandParser.parse(c.text);
            assert.strictEqual(res.match, true);
            assert.strictEqual(res.action, 'whatsapp.send');
            assert.strictEqual(res.params.contact.toLowerCase(), c.expectedContact.toLowerCase());
            assert.strictEqual(res.params.message.toLowerCase(), c.expectedMessage.toLowerCase());
        });
    }

    // -------------------------------------------------------------
    // BLOQUE 5: COTIZACIÓN DE DÓLAR Y FINANZAS
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 5: Cotización de Dólar y Finanzas ---');

    await runAsyncTest('Resolución de Dólar Blue', async () => {
        const plan = await jarvisActionService.resolve('cuanto esta el dolar blue');
        assert.strictEqual(plan.id, 'information.dollar');
        assert.strictEqual(plan.params.type, 'blue');
    });

    await runAsyncTest('Resolución de Dólar Oficial', async () => {
        const plan = await jarvisActionService.resolve('precio del dolar oficial');
        assert.strictEqual(plan.id, 'information.dollar');
        assert.strictEqual(plan.params.type, 'oficial');
    });

    await runAsyncTest('Resolución de Dólar MEP / Bolsa', async () => {
        const plan = await jarvisActionService.resolve('cotizacion del dolar mep');
        assert.strictEqual(plan.id, 'information.dollar');
        assert.strictEqual(plan.params.type, 'bolsa');
    });

    runTest('FinanceService requestedDollarType parser', () => {
        assert.strictEqual(financeService.requestedDollarType('dolar blue hoy'), 'blue');
        assert.strictEqual(financeService.requestedDollarType('dolar tarjeta'), 'tarjeta');
        assert.strictEqual(financeService.requestedDollarType('dolar oficial'), 'oficial');
    });

    // -------------------------------------------------------------
    // BLOQUE 6: ARCHIVOS Y CARPETAS
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 6: Archivos y Carpetas ---');

    await runAsyncTest('Creación de carpeta sola', async () => {
        const plan = await jarvisActionService.resolve('crea una carpeta llamada Proyectos');
        assert.strictEqual(plan.id, 'folder.create');
        assert.strictEqual(plan.params.folderName, 'Proyectos');
    });

    await runAsyncTest('Borrado de carpeta', async () => {
        const plan = await jarvisActionService.resolve('borra la carpeta llamada Proyectos');
        assert.strictEqual(plan.id, 'folder.delete');
        assert.strictEqual(plan.params.folderName, 'Proyectos');
    });

    await runAsyncTest('Creación de archivo TXT explícito', async () => {
        const plan = await jarvisActionService.resolve('crea un txt llamado notas que diga reunion importante');
        assert.strictEqual(plan.id, 'file.create');
        assert.strictEqual(plan.params.format, 'txt');
        assert.strictEqual(plan.params.fileName, 'notas.txt');
        assert.strictEqual(plan.params.content, 'reunion importante');
    });

    await runAsyncTest('Creación de documento Word (.docx) explícito', async () => {
        const plan = await jarvisActionService.resolve('crea un word llamado reporte con el contenido balance anual');
        assert.strictEqual(plan.id, 'file.create');
        assert.strictEqual(plan.params.format, 'docx');
        assert.strictEqual(plan.params.fileName, 'reporte.docx');
        assert.strictEqual(plan.params.content, 'balance anual');
    });

    await runAsyncTest('Creación compuesta: Carpeta y Word adentro', async () => {
        const plan = await jarvisActionService.resolve('crea una carpeta llamada Finanzas y adentro un word llamado Balance que diga ingresos y egresos');
        assert.strictEqual(plan.id, 'file.create');
        assert.strictEqual(plan.params.folderName, 'Finanzas');
        assert.strictEqual(plan.params.fileName, 'Balance.docx');
        assert.strictEqual(plan.params.format, 'docx');
        assert.strictEqual(plan.params.content, 'ingresos y egresos');
    });

    // -------------------------------------------------------------
    // BLOQUE 7: INMUNIDAD CONTRA FALSOS POSITIVOS Y PACIENCIA
    // -------------------------------------------------------------
    console.log('\n--- BLOQUE 7: Inmunidad contra Falsos Positivos y Configuración de Paciencia ---');

    const falsePositives = [
        'mini misa yutubime el volumen sugi yutube minimisa',
        'yutubime el volumen sugi yutube la carpeta',
        'un mensaje a color cartón que diga te amo',
        'minimiza la ventana',
        'subi el volumen'
    ];

    for (const phrase of falsePositives) {
        runTest(`Prevenir falso positivo de YouTube en: "${phrase}"`, () => {
            const res = systemService.handleSystemCommand(phrase);
            assert.strictEqual(res.isSystemCommand, false);
        });
    }

    runTest('Abrir YouTube genuino sigue funcionando', () => {
        const res = systemService.handleSystemCommand('abrí youtube');
        assert.strictEqual(res.isSystemCommand, true);
        assert.strictEqual(res.appName.toLowerCase(), 'youtube');
    });

    runTest('Configuración de silencio compatible con una respuesta ágil', () => {
        const settingsPath = path.join(__dirname, '..', 'data', 'voice_settings.json');
        assert.ok(fs.existsSync(settingsPath), 'voice_settings.json debe existir');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(settings.endSilenceMs >= 800 && settings.endSilenceMs <= 3000, `endSilenceMs fuera del intervalo admitido (actual: ${settings.endSilenceMs})`);
    });

    runTest('Frontend app.js tiene protección contra micrófono dual simultáneo', () => {
        const appJsPath = path.join(__dirname, '..', '..', 'frontend', 'app.js');
        assert.ok(fs.existsSync(appJsPath), 'app.js debe existir');
        const appJsContent = fs.readFileSync(appJsPath, 'utf8');
        assert.ok(appJsContent.includes('localVoiceOnline'), 'app.js debe verificar localVoiceOnline');
        assert.ok(appJsContent.includes('abort()') || appJsContent.includes('recognition.stop()'), 'app.js debe abortar reconocimiento del navegador si localVoiceOnline es true');
    });

    console.log('\n===============================================================');
    console.log(`🎉 SUITE MAESTRA FINALIZADA: ${passedTests}/${totalTests} TESTS EXITOSOS (100%)`);
    console.log('🛡️  LA BARRERA DE SEGURIDAD Y PREVENCIÓN DE REGRESIONES ESTÁ ACTIVA.');
    console.log('===============================================================\n');
}

main().catch(err => {
    console.error('\n💥 FALLO CRÍTICO EN SUITE MAESTRA:', err);
    process.exit(1);
});
