const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-core-'));
process.env.JARVIS_MEMORY_PATH = path.join(testDir, 'memory.json');
process.env.JARVIS_VOICE_SETTINGS_PATH = path.join(testDir, 'voice.json');
process.env.JARVIS_ACTION_AUDIT_PATH = path.join(testDir, 'audit.jsonl');
process.env.JARVIS_VOICE_LEARNING_PATH = path.join(testDir, 'voice-learning.json');
process.env.JARVIS_VOICE_LEXICON_PATH = path.join(testDir, 'voice-lexicon.json');

const kernel = require('../services/actionKernelService');
const memory = require('../services/memoryService');
const voice = require('../services/voiceInputService');
const voiceSettings = require('../services/voiceSettingsService');
const jarvisActions = require('../services/jarvisActionService');
const systemService = require('../services/systemService');
const informationDocumentService = require('../services/informationDocumentService');
const tvService = require('../services/tvService');
const voiceLearning = require('../services/voiceLearningService');
const financeService = require('../services/financeService');

async function run() {
    kernel.register({
        id: 'test.confirmed', name: 'Acción de prueba', permission: 'destructive', confirmation: true,
        dependencies: [{ id: 'test-dependency', check: () => true }],
        execute: async ({ value }) => ({ message: 'ejecutada', data: { value }, evidence: { performed: true } })
    });
    const pending = await kernel.execute('test.confirmed', { value: 7 });
    assert.equal(pending.status, 'awaiting_confirmation');
    const completed = await kernel.confirm(pending.confirmationToken);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.data.value, 7);
    assert.equal(completed.evidence.performed, true);

    kernel.register({ id: 'test.offline', name: 'No disponible', dependencies: [{ id: 'missing', check: () => false }], execute: async () => ({}) });
    const offline = await kernel.execute('test.offline');
    assert.equal(offline.status, 'unavailable');

    memory.addTurn('user', 'Quiero ver una serie en Netflix');
    memory.addTurn('assistant', 'Abrí Netflix en la televisión');
    const reference = memory.resolveReferences('seguí con lo mismo');
    assert.equal(reference.resolved, true);
    assert.equal(reference.topic, 'television');
    memory.addPreference('destino netflix', 'televisión');
    memory.addCorrection('Lodo Hero', 'Dorohedoro');
    assert.equal(memory.applyCorrections('Buscá Lodo Hero'), 'Buscá Dorohedoro');
    const learnedCorrection = voiceLearning.snapshot().vocabulary.find(item => item.canonical === 'Dorohedoro');
    assert.equal(learnedCorrection.variants.includes('Lodo Hero'), true);

    voiceSettings.save({ confidenceThreshold: .7, agreementThreshold: .6, confirmUncertain: true });
    const uncertain = voice.chooseTranscript({ alternatives: [
        { transcript: 'abrí netflix', confidence: .42 },
        { transcript: 'abril net free', confidence: .4 }
    ] });
    assert.equal(uncertain.uncertain, true);
    const certain = voice.chooseTranscript({ alternatives: [
        { transcript: 'explicame la fotosíntesis', confidence: .92 },
        { transcript: 'explicame la fotosíntesis', confidence: .8 }
    ] });
    assert.equal(certain.uncertain, false);
    assert.equal(voice.normalizeVoiceTranscript('¡Abrin, Netflix!'), 'Abrí Netflix');
    assert.equal(voice.normalizeVoiceTranscript('Abrí Niscor.'), 'Abrí Discord');
    assert.equal(voice.normalizeVoiceTranscript("¿A verí? ¿What's up?"), 'Abrí WhatsApp');
    assert.equal(voice.normalizeVoiceTranscript('abrí WhatsApp. Abrí WhatsApp.'), 'Abrí WhatsApp');
    assert.equal(
        voice.normalizeVoiceTranscript('Jarvis, abrí Spotify, abrí Spotify, abrí Spotify, abrí Spotify'),
        'Abrí Spotify'
    );
    assert.equal(voice.normalizeVoiceTranscript('abrí Spotify, abrí'), 'Abrí Spotify');
    const safeLowConfidence = voice.chooseTranscript({
        source: 'local-whisper', alternatives: [{ transcript: 'abrí Spotify, abrí', confidence: .524 }]
    });
    assert.equal(safeLowConfidence.text, 'Abrí Spotify');
    assert.equal(safeLowConfidence.uncertain, false);
    assert.equal((await jarvisActions.resolve('Abrí WhatsApp')).id, 'system.open');
    assert.equal((await jarvisActions.resolve('Abrí YouTube')).id, 'system.open');

    const youtube = await jarvisActions.resolve('Buscá el canal de Kurzgesagt en YouTube');
    assert.equal(youtube.id, 'system.media-search');
    assert.equal(youtube.params.platform, 'youtube');
    assert.equal(youtube.params.query, 'kurzgesagt');
    const netflixPc = await jarvisActions.resolve('Buscá The Walking Dead en Netflix desde mi computadora');
    assert.equal(netflixPc.id, 'system.media-search');
    assert.equal(netflixPc.params.platform, 'netflix');
    assert.equal(netflixPc.params.query, 'the walking dead');
    const originalTvAvailability = tvService.isAvailable;
    tvService.isAvailable = async () => false;
    const netflixFallback = await jarvisActions.resolve('Abrí Netflix');
    assert.equal(netflixFallback.id, 'system.open');
    assert.equal(netflixFallback.params.appName, 'Netflix');
    const netflixSearchFallback = await jarvisActions.resolve('Buscá The Mentalist en Netflix');
    assert.equal(netflixSearchFallback.id, 'system.media-search');
    assert.equal(netflixSearchFallback.params.platform, 'netflix');
    assert.equal(netflixSearchFallback.params.query, 'the mentalist');
    tvService.isAvailable = originalTvAvailability;
    assert.equal(systemService.mediaSearchUrl('netflix', 'The Walking Dead'), 'https://www.netflix.com/search?q=The%20Walking%20Dead');
    const rubius = await jarvisActions.resolve('Abrí YouTube y buscá el Rubius');
    assert.equal(rubius.id, 'system.media-search');
    assert.equal(rubius.params.platform, 'youtube');
    assert.equal(rubius.params.query, 'el rubius');
    const rubiusUrl = systemService.mediaSearchUrl(rubius.params.platform, rubius.params.query);
    assert.equal(systemService.isWebUrl(rubiusUrl), true);
    assert.match(systemService.urlLaunchCommand(rubiusUrl, 'win32'), /^start "" "https:\/\/www\.youtube\.com\/results\?search_query=el%20rubius"$/);
    voiceLearning.recordVerifiedExecution({
        utterance: 'Mi canal favorito', actionId: 'system.media-search',
        params: { platform: 'youtube', query: 'El Rubius' },
        result: { status: 'completed', verified: true }
    });
    const learnedPhrase = voiceLearning.resolveVerifiedPhrase('mi canal favorito');
    assert.equal(learnedPhrase.id, 'system.media-search');
    assert.equal(learnedPhrase.params.query, 'El Rubius');
    assert.equal(await systemService.openApp('aplicación totalmente inexistente xyz'), false);
    const dollar = await jarvisActions.resolve('Jarvis, decime cuánto está el dólar blue');
    assert.equal(dollar.id, 'information.dollar');
    assert.equal(dollar.params.type, 'blue');
    const download = await jarvisActions.resolve('Descargame esto https://example.com/video');
    assert.equal(download.id, 'download.url');
    assert.equal(download.params.url, 'https://example.com/video');
    assert.equal(download.params.audioOnly, false);
    assert.equal(
        financeService.formatDollarResponse([{ casa: 'blue', nombre: 'Blue', compra: 1200, venta: 1220 }], 'blue'),
        'Dólar Blue: compra $1.200,00 y venta $1.220,00'
    );
    const discordCommand = systemService.discordLaunchCommand({ LOCALAPPDATA: process.env.LOCALAPPDATA });
    assert.match(discordCommand, /Discord\\Update\.exe" --processStart Discord\.exe|start discord:/i);

    const infoDocument = await jarvisActions.resolve('Dame información sobre computación cuántica');
    assert.equal(infoDocument.id, 'assistant.respond');
    const explicitDocument = await jarvisActions.resolve('Creame un informe sobre computación cuántica');
    assert.ok(['document.create-info', 'file.create'].includes(explicitDocument.id));
    const explicitSleep = await jarvisActions.resolve('Jarvis, apagate');
    assert.equal(explicitSleep.id, 'voice.sleep');
    const bareSleep = await jarvisActions.resolve('apagate');
    assert.ok(bareSleep.id === 'voice.sleep' || bareSleep.id === 'assistant.respond');
    const notSleep = await jarvisActions.resolve('Jarvis, no te apagues mientras buscás esto');
    assert.notEqual(notSleep.id, 'voice.sleep');

    const originalFetch = global.fetch;
    process.env.JARVIS_DESKTOP_DIR = testDir;
    global.fetch = async () => ({ ok: true, json: async () => ({ message: { content: 'Introducción\nInformación comprobable de prueba.\nConclusión' } }) });
    const generated = await informationDocumentService.createOnDesktop('tema de prueba');
    global.fetch = originalFetch;
    assert.equal(fs.existsSync(generated.filePath), true);
    assert.equal(path.extname(generated.filePath), '.docx');
    assert.equal(fs.readFileSync(generated.filePath).subarray(0, 2).toString(), 'PK');

    console.log('OK: núcleo, confirmaciones, memoria, voz, búsquedas rápidas, documentos y estado explícito.');
}

run().finally(() => fs.rmSync(testDir, { recursive: true, force: true })).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
