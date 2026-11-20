const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const jarvis = require('../services/jarvisActionService');
const kernel = require('../services/actionKernelService');
const files = require('../services/core/fileOperationsService');
const content = require('../services/desktopContentService');
const canonical = require('../services/ai/canonicalTools');
require('../services/tvService').isAvailable = async () => false;

async function main() {
    for (const [phrase, action] of [
        ['Jarvis, creame una carpeta llamada Prueba', 'folder.create'],
        ['leeme todo mi escritorio', 'directory.list'],
        ['explicame la fotosíntesis', 'assistant.respond'],
        ['Activá el observador', 'observer.set'],
        ['Desactivá el observador', 'observer.set'],
        ['Prende el enchufe', 'ha.command'],
        ['Borrar regla de automatización', 'automation.delete-rule'],
        ['Borrá todas tus correcciones', 'memory.clear'],
        ['Continuar tareas interrumpidas', 'task.recover'],
        ['Hacé clic en Aceptar', 'ui.click'],
        ['Abrí Netflix en la computadora', 'system.open'],
        ['Cuando diga trabajo, abrí Visual Studio Code', 'system.learn-command'],
        ['bajá el audio de https://example.com/video', 'download.url']
    ]) assert.equal((await jarvis.resolve(phrase)).id, action, phrase);

    const parsed = await jarvis.resolve('creame un txt llamado mi archivo que diga Hola mundo');
    assert.deepEqual(parsed.params, { fileName: 'mi archivo.txt', content: 'Hola mundo', format: 'txt' });
    const folder = await jarvis.resolve('creá una carpeta llamada Prueba en el escritorio');
    assert.equal(folder.params.folderName, 'Prueba');
    const createdFolder = await kernel.execute(folder.id, folder.params);
    assert.equal(createdFolder.ok, true, createdFolder.message);
    assert.ok(fs.statSync(createdFolder.data.folderPath).isDirectory());
    parsed.params.folderName = 'Prueba';
    const created = await kernel.execute(parsed.id, parsed.params);
    assert.equal(created.ok, true, created.message);
    assert.equal(fs.readFileSync(created.data.filePath, 'utf8'), 'Hola mundo');
    const read = await kernel.execute('file.read', { filePath: created.data.filePath });
    assert.equal(read.data.text, 'Hola mundo');
    const again = await kernel.execute(parsed.id, { ...parsed.params, content: 'NO sobrescribir' });
    assert.equal(again.ok, false);
    assert.equal(fs.readFileSync(created.data.filePath, 'utf8'), 'Hola mundo');
    const empty = await files.createFile({ fileName: 'vacio.txt', content: '' });
    assert.equal(fs.statSync(empty.filePath).size, 0);
    for (const format of ['docx', 'pdf', 'xlsx', 'pptx']) {
        const artifact = await files.createFile({ fileName: 'prueba-formato', content: 'Hola mundo', format });
        const readArtifact = await content.read({ filePath: artifact.filePath });
        assert.equal(readArtifact.ok, true, format + ': ' + readArtifact.message);
        assert.ok(readArtifact.data.text.includes('Hola mundo'), format + ' contiene el texto');
    }
    const copy = await kernel.execute('file.copy', { sourcePath: created.data.filePath, destinationPath: 'copia.txt' });
    assert.equal(copy.ok, true, copy.message);
    assert.equal(fs.readFileSync(copy.data.destination, 'utf8'), 'Hola mundo');
    const renamed = await kernel.execute('file.rename', { filePath: 'copia.txt', newName: 'renombrado.txt' });
    assert.equal(renamed.ok, true, renamed.message);
    const moved = await kernel.execute('file.move', { sourcePath: 'renombrado.txt', destinationPath: 'Prueba' });
    assert.equal(moved.ok, true, moved.message);
    assert.ok(fs.existsSync(path.join(createdFolder.data.folderPath, 'renombrado.txt')));
    assert.throws(() => files.createFolder({ folderName: '..' }));
    assert.throws(() => files.createFolder({ folderName: 'CON' }));
    assert.equal((await kernel.execute('automation.delete-rule', {})).status, 'needs_input');
    for (const action of kernel.catalog()) {
        for (const key of action.requiredParameters) assert.ok(key in action.parameters, `${action.id}: parámetro requerido ${key} ausente del catálogo`);
    }
    kernel.register({ id: 'test.nested-failure', execute: () => ({ ok: true, data: { ok: false } }) });
    assert.equal((await kernel.execute('test.nested-failure')).ok, false);
    kernel.register({ id: 'test.bad-verification', execute: () => ({ ok: true }), verifier: () => ({ verified: false }) });
    assert.equal((await kernel.execute('test.bad-verification')).ok, false);
    const tools = canonical.build('consultá el estado del repositorio git');
    assert.ok([...tools.byName.values()].some(a => a.id === 'git.status'));
    await assert.rejects(() => canonical.execute({ name: 'jarvis_git_status', arguments: { invented: true } }, tools.byName));
    console.log('PASS: rutas, archivos TXT/DOCX/PDF/XLSX/PPTX, lectura, copia, renombrado, traslado, validación y catálogo.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
