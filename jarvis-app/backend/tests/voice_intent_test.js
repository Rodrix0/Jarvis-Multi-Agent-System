const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('\n===============================================================');
console.log('  🧪 PRUEBAS UNITARIAS DE RESOLUCIÓN Y EJECUCIÓN DE COMANDOS');
console.log('===============================================================\n');

const jarvisActionService = require('../services/jarvisActionService');
const fastCommandParser = require('../services/ai/fastCommandParser');

async function testAll() {
    // 1. Pruebas de FastCommandParser y Resolución de Audio
    console.log('[1/7] 🔊 Probando Comandos de Audio y Silencio...');
    const audio1 = await jarvisActionService.resolve('poné el volumen al 20%');
    assert.strictEqual(audio1.id, 'audio.set-volume', 'Debe resolver a audio.set-volume');
    assert.strictEqual(audio1.params.percent, 20);

    const audio2 = await jarvisActionService.resolve('volumen al 30');
    assert.strictEqual(audio2.id, 'audio.set-volume');
    assert.strictEqual(audio2.params.percent, 30);

    const mute = await jarvisActionService.resolve('silenciá la computadora');
    assert.strictEqual(mute.id, 'audio.toggle-mute');
    console.log('  ✅ Comandos de audio resueltos con precisión.');

    // 2. Pruebas de Monitoreo de RAM y Recursos
    console.log('[2/7] 📊 Probando Consulta de Consumo de RAM...');
    const ram1 = await jarvisActionService.resolve('¿qué está consumiendo tanta RAM?');
    assert.strictEqual(ram1.id, 'system.get-top-consumers', 'Debe resolver a system.get-top-consumers');

    const ram2 = await jarvisActionService.resolve('recursos que está consumiendo de RAM');
    assert.strictEqual(ram2.id, 'system.get-top-consumers', 'Debe resolver a system.get-top-consumers');
    
    // Ejecución real de la acción
    const ramExec = await jarvisActionService.process('qué está consumiendo tanta RAM');
    assert.strictEqual(ramExec.ok, true);
    assert.strictEqual(typeof ramExec.message, 'string');
    console.log('  ✅ Monitoreo de RAM ejecutado:', ramExec.message.split('\n')[0]);

    // 3. Pruebas de Captura de Pantalla
    console.log('[3/7] 📸 Probando Captura de Pantalla...');
    const cap = await jarvisActionService.resolve('sacá una captura de pantalla');
    assert.strictEqual(cap.id, 'display.screenshot', 'Debe resolver a display.screenshot');
    console.log('  ✅ Captura de pantalla resuelta con precisión.');

    // 4. Pruebas de Batería y Espacio en Disco
    console.log('[4/7] 🔋 Probando Batería y Almacenamiento...');
    const bat = await jarvisActionService.resolve('¿cuánta batería tengo?');
    assert.strictEqual(bat.id, 'system.get-battery');
    const disk = await jarvisActionService.resolve('¿cuánto espacio tengo en el disco?');
    assert.strictEqual(disk.id, 'system.get-disk-space');
    console.log('  ✅ Batería y espacio en disco resueltos con precisión.');

    // 5. Pruebas de Deshacer (Undo) y Parada de Emergencia (Emergency Stop)
    console.log('[5/7] 🚨 Probando Deshacer y Parada de Emergencia...');
    const undo = await jarvisActionService.resolve('deshacé lo último');
    assert.strictEqual(undo.id, 'undo.last');
    const stop = await jarvisActionService.resolve('Jarvis, detener todo');
    assert.strictEqual(stop.id, 'emergency.stop');
    console.log('  ✅ Deshacer y Parada de Emergencia resueltos con precisión.');

    // 6. Pruebas de Memoria V6 (Consultar y Olvidar)
    console.log('[6/7] 🧠 Probando Consultas de Memoria...');
    const memQuery = await jarvisActionService.resolve('¿qué recordás sobre mi trabajo?');
    assert.strictEqual(memQuery.id, 'memory.query-v6');
    assert.strictEqual(memQuery.params.topic, 'mi trabajo');
    const memForget = await jarvisActionService.resolve('olvidá mi trabajo');
    assert.strictEqual(memForget.id, 'memory.forget-v6');
    console.log('  ✅ Comandos de memoria resueltos con precisión.');

    // 7. Pruebas de Papelera Segura
    console.log('[7/7] 🗑️ Probando Papelera Segura (Borrar y Recuperar)...');
    const del = await jarvisActionService.resolve('borrá prueba.txt');
    assert.strictEqual(del.id, 'file.delete');
    assert.strictEqual(del.params.filePath, 'prueba.txt');

    const res = await jarvisActionService.resolve('recuperá prueba.txt');
    assert.strictEqual(res.id, 'file.restore');
    assert.strictEqual(res.params.identifier, 'prueba.txt');
    console.log('  ✅ Papelera y restauración resueltas con precisión.');

    console.log('\n===============================================================');
    console.log('  🎉 TODAS LAS 7 BATERÍAS DE PRUEBAS PASARON AL 100%');
    console.log('===============================================================\n');
}

testAll().catch(err => {
    console.error('❌ Error en pruebas:', err);
    process.exit(1);
});
