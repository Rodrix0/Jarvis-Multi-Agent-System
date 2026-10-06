const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-reliability-'));
for (const [key, name] of Object.entries({ JARVIS_MEMORY_PATH: 'memory.json', JARVIS_ACTION_AUDIT_PATH: 'audit.jsonl', JARVIS_VOICE_LEARNING_PATH: 'learning.json', JARVIS_VOICE_LEXICON_PATH: 'lexicon.json' })) process.env[key] = path.join(testDir, name);
const SpeechQueue = require('../services/core/speechQueue');
const CommandGate = require('../services/core/commandGate');

async function run() {
    for (const text of ['seguí bajando', 'subí el volumen', 'siguiente', 'Jarvis, bajá más']) assert.equal(CommandGate.isRepeatableControl(text), true);
    for (const text of ['creame un documento', 'abrí Stremio', 'recordame comprar pan']) assert.equal(CommandGate.isRepeatableControl(text), false);
    let now = 0;
    const gate = new CommandGate({ now: () => now });
    const claim = gate.claim('create-document');
    now = 90000;
    assert.equal(gate.claim('create-document'), null, 'pending command stays protected');
    assert.ok(gate.claim('other-command'), 'different work is allowed');
    claim.finish();
    now += 5999;
    assert.equal(gate.claim('create-document'), null);
    now += 1;
    assert.ok(gate.claim('create-document'), 'a later intentional repetition is allowed');

    const starts = [], finishes = [];
    const q = new SpeechQueue((text, voice, signal) => new Promise(resolve => {
        starts.push(text);
        finishes.push(() => resolve({ spoken: true }));
        signal.addEventListener('abort', () => resolve({ cancelled: true }));
    }));
    const ack = q.speak('Trabajando');
    const done = q.speak('Terminé');
    const reminder = q.speak('Recordatorio');
    assert.deepEqual(starts, ['Trabajando']);
    finishes[0](); await ack;
    assert.deepEqual(starts, ['Trabajando', 'Terminé']);
    finishes[1](); await done;
    assert.deepEqual(starts, ['Trabajando', 'Terminé', 'Recordatorio']);
    finishes[2](); await reminder;
    const interrupted = q.speak('Interrumpible');
    const pending = q.speak('Pendiente');
    q.stop();
    assert.equal((await interrupted).cancelled, true);
    assert.equal((await pending).cancelled, true);
    assert.equal(starts.includes('Pendiente'), false);
    const last = q.speak('Después de parar');
    finishes.at(-1)(); await last;
    assert.equal(q.isPlaying(), false);

    const actions = require('../services/jarvisActionService');
    const system = require('../services/systemService');
    const original = system.openApp;
    let opens = 0, release;
    system.openApp = () => { opens++; return new Promise(resolve => { release = resolve; }); };
    const first = actions.process('Abrí aplicación de prueba única');
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const second = await actions.process('Abrí aplicación de prueba única');
    assert.equal(second.duplicate, true);
    release(true); await first;
    assert.equal(opens, 1);
    system.openApp = original;
    for (const phrase of ['Buscá la serie Dark en Stremio', 'Abrí Stremio y buscá Dark', 'Quiero ver Dark por Stremio']) {
        const parsed = await actions.resolve(phrase);
        assert.equal(parsed.id, 'system.media-search', phrase);
        assert.deepEqual(parsed.params, { platform: 'stremio', query: 'dark' });
    }
    assert.equal(system.mediaSearchUrl('stremio', 'Dark & Light'), 'stremio:///search?search=Dark%20%26%20Light');
    console.log('PASS: voz en orden, cancelación explícita, duplicados concurrentes y búsquedas Stremio.');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
