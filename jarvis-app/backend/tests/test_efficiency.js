const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function run() {
    const dashboard = require('../services/diagnostics/dashboardService');
    dashboard.stopLiveStreaming();
    const originalSnapshot = dashboard.getDashboardData;
    dashboard.getDashboardData = async () => ({ title: 'JARVIS STATUS' });

    let connectionHandler;
    let emissions = 0;
    const io = {
        on(event, handler) { if (event === 'connection') connectionHandler = handler; },
        emit(event) { if (event === 'dashboard_telemetry') emissions++; }
    };
    dashboard.startLiveStreaming(io, 50);
    assert.equal(dashboard.streamInterval, null, 'No debe sondear telemetría sin panel conectado');

    let disconnectHandler;
    const socket = {
        id: 'efficiency-test',
        emit(event) { if (event === 'dashboard_telemetry') emissions++; },
        once(event, handler) { if (event === 'disconnect') disconnectHandler = handler; }
    };
    connectionHandler(socket);
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.ok(emissions >= 2, 'Debe transmitir mientras el panel está conectado');
    disconnectHandler();
    assert.equal(dashboard.streamInterval, null, 'Debe detener el sondeo al cerrar el último panel');
    dashboard.stopLiveStreaming();
    dashboard.getDashboardData = originalSnapshot;

    const scheduler = require('../services/agenda/schedulerService');
    clearTimeout(scheduler.startupTimer);
    clearInterval(scheduler.pollInterval);
    const isolated = new scheduler.SchedulerService({ start: false });
    assert.equal(isolated.pollIntervalMs, 5000, 'El planificador debe evitar consultas cada segundo');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-efficiency-'));
    fs.mkdirSync(path.join(root, 'nested'));
    const fileSearch = require('../services/localFileSearch');
    fileSearch.clearCache();
    const originalReaddir = fs.promises.readdir;
    let diskReads = 0;
    fs.promises.readdir = async (...args) => {
        diskReads++;
        return originalReaddir.apply(fs.promises, args);
    };
    try {
        assert.equal(await fileSearch.find('archivo inexistente', { roots: [root] }), null);
        const readsAfterFirstSearch = diskReads;
        assert.ok(readsAfterFirstSearch > 0);
        assert.equal(await fileSearch.find('archivo inexistente', { roots: [root] }), null);
        assert.equal(diskReads, readsAfterFirstSearch, 'Una búsqueda repetida no debe recorrer el disco otra vez');
    } finally {
        fs.promises.readdir = originalReaddir;
        fs.rmSync(root, { recursive: true, force: true });
    }

    const imageService = require('../services/imageService');
    assert.equal(
        imageService.publicImageUrl('C:\\temp\\jarvis_img_123.png'),
        '/api/generated-images/jarvis_img_123.png'
    );
    assert.throws(() => imageService.publicImageUrl('C:\\temp\\archivo.png'));
    const originalFetchForPrompt = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ response: 'a horse under the Moon' }) });
    try {
        assert.equal(
            await imageService.preparePrompt('una foto de un caballo en la luna'),
            'a horse on the surface of the Moon'
        );
    } finally {
        global.fetch = originalFetchForPrompt;
    }
    const photoProfile = imageService.buildGenerationProfile('una foto realista de un caballo');
    assert.equal(photoProfile.photographic, true);
    assert.equal(photoProfile.quality, 'quality');
    assert.equal(photoProfile.width, 768);
    assert.equal(photoProfile.steps, 24);
    assert.equal(photoProfile.outputWidth, 1024);
    assert.match(photoProfile.negativePrompt, /oversaturated colors/i);
    const artProfile = imageService.buildGenerationProfile('una ilustración estilo acuarela');
    assert.equal(artProfile.photographic, false);
    assert.doesNotMatch(artProfile.negativePrompt, /illustration/i);
    const maximumProfile = imageService.buildGenerationProfile('una foto 4K de un caballo');
    assert.equal(maximumProfile.quality, 'maximum');
    assert.equal(maximumProfile.width, 1024);
    assert.equal(maximumProfile.steps, 30);
    const fastProfile = imageService.buildGenerationProfile('un borrador rápido de un caballo');
    assert.equal(fastProfile.quality, 'fast');
    assert.equal(fastProfile.width, 512);
    assert.equal(fastProfile.steps, 12);

    console.log('OK: telemetría bajo demanda, recordatorios eficientes y búsquedas con caché.');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
