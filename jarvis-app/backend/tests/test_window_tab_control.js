const assert = require('assert');
const fastCommandParser = require('../services/ai/fastCommandParser');
const jarvisActionService = require('../services/jarvisActionService');
const windowTabService = require('../services/windows/windowTabService');

async function runTests() {
    console.log('=== TEST 1: FastCommandParser Window & Tab Regex Matching ===');

    const expectations = [
        { text: 'minimiza', expected: 'window.minimize' },
        { text: 'minimizar la ventana', expected: 'window.minimize' },
        { text: 'minimiza todo', expected: 'window.minimize-all' },
        { text: 'mostrar escritorio', expected: 'window.minimize-all' },
        { text: 'maximiza', expected: 'window.maximize' },
        { text: 'pantalla completa', expected: 'window.maximize' },
        { text: 'siguiente pestaña', expected: 'tab.next' },
        { text: 'cambia de pestaña', expected: 'tab.next' },
        { text: 'otra pestaña', expected: 'tab.next' },
        { text: 'pestaña anterior', expected: 'tab.prev' },
        { text: 'anterior pestaña', expected: 'tab.prev' },
        { text: 'nueva pestaña', expected: 'tab.new' },
        { text: 'cerrar pestaña', expected: 'tab.close' },
        { text: 'cerra la pestaña', expected: 'tab.close' },
        { text: 'cerra', expected: 'tab.close' },
        { text: 'cerrar ventana', expected: 'window.close' },
        { text: 'cerra la ventana', expected: 'window.close' },
        { text: 'cerra la app', expected: 'window.close' },
        { text: 'cambia de ventana', expected: 'window.next' },
        { text: 'siguiente ventana', expected: 'window.next' },
        { text: 'anda a la pestaña 4', expected: 'tab.go-to', params: { index: 4 } },
        { text: 'a la pestaña 5', expected: 'tab.go-to', params: { index: 5 } },
        { text: 'pestaña 1', expected: 'tab.go-to', params: { index: 1 } },
        { text: 'pestaña 4', expected: 'tab.go-to', params: { index: 4 } },
        { text: 'pestaña cinco', expected: 'tab.go-to', params: { index: 5 } },
        { text: 'primera pestaña', expected: 'tab.go-to', params: { index: 1 } },
        { text: 'ultima pestaña', expected: 'tab.go-to', params: { index: 9 } }
    ];

    for (const item of expectations) {
        const res = fastCommandParser.parse(item.text);
        console.log(`[Parser] "${item.text}" -> ${res.action}`, res.params || {});
        assert.strictEqual(res.match, true, `Debe matchear "${item.text}"`);
        assert.strictEqual(res.action, item.expected, `Acción esperada: ${item.expected}`);
        if (item.params) {
            assert.deepStrictEqual(res.params, item.params, `Parámetros incorrectos para "${item.text}"`);
        }
    }

    console.log('\n=== TEST 2: JarvisActionService Full Resolution ===');
    for (const item of expectations) {
        const plan = await jarvisActionService.resolve(item.text);
        assert.ok(plan, `Plan debe existir para "${item.text}"`);
        assert.strictEqual(plan.id, item.expected, `Plan ID incorrecto para "${item.text}"`);
        if (item.params) {
            assert.deepStrictEqual(plan.params, item.params, `Plan params incorrectos para "${item.text}"`);
        }
    }
    console.log('Todos los planes de ventana y pestaña resueltos con éxito en ActionKernel.');

    console.log('\n=== TEST 3: WindowTabService Methods Integrity ===');
    assert.strictEqual(typeof windowTabService.minimizeActive, 'function');
    assert.strictEqual(typeof windowTabService.minimizeAll, 'function');
    assert.strictEqual(typeof windowTabService.maximizeActive, 'function');
    assert.strictEqual(typeof windowTabService.goToTab, 'function');
    assert.strictEqual(typeof windowTabService.nextTab, 'function');
    assert.strictEqual(typeof windowTabService.prevTab, 'function');
    assert.strictEqual(typeof windowTabService.closeTab, 'function');
    assert.strictEqual(typeof windowTabService.newTab, 'function');
    assert.strictEqual(typeof windowTabService.closeWindow, 'function');
    assert.strictEqual(typeof windowTabService.nextWindow, 'function');

    console.log('WindowTabService cuenta con todos los métodos requeridos.');
    console.log('\n✅ ALL WINDOW & TAB TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('❌ Error en test de ventanas/pestañas:', err);
    process.exit(1);
});
