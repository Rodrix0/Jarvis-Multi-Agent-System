const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const originalSpawn = cp.spawn;
const originalExists = fs.existsSync;
const savedEnv = { ...process.env };
const calls = [];
process.env.JARVIS_TTS_LOCAL = '1';
process.env.JARVIS_TTS_ENGINE = 'supertonic3';
process.env.JARVIS_SUPERTONIC_PYTHON = path.resolve('test-runtime/python.exe');
process.env.JARVIS_SUPERTONIC_MODEL_DIR = path.resolve('test-runtime/model');
const runtimeFiles = [process.env.JARVIS_SUPERTONIC_PYTHON,
    path.join(process.env.JARVIS_SUPERTONIC_MODEL_DIR, 'onnx'),
    path.join(process.env.JARVIS_SUPERTONIC_MODEL_DIR, 'voice_styles/M3.json')];
fs.existsSync = filename => runtimeFiles.includes(filename) || originalExists(filename);
cp.spawn = (executable, args, options) => {
    const child = new EventEmitter();
    child.pid = 900000 + calls.length;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = text => { child.text = text; };
    child.kill = () => { child.directKill = true; setImmediate(() => child.emit('close', null)); };
    const call = { executable, args, options, child };
    calls.push(call);
    if (executable === 'taskkill.exe') setImmediate(() => {
        calls.find(c => String(c.child.pid) === args[1]).child.emit('close', null);
        child.emit('close', 0);
    });
    return child;
};
const servicePath = require.resolve('../services/ttsService');
delete require.cache[servicePath];
const tts = require(servicePath);
const tick = () => new Promise(resolve => setImmediate(resolve));

async function run() {
    const first = tts.speak('Información en español, sin cortes.');
    const queued = tts.speak('Segunda respuesta.');
    assert.equal(calls.length, 1, 'only one process runs at a time');
    assert.equal(path.basename(calls[0].args[0]), 'speakSupertonic.py');
    assert.equal(calls[0].options.env.HF_HUB_OFFLINE, '1');
    assert.equal(calls[0].child.text, 'Información en español, sin cortes.');
    calls[0].child.stdout.emit('data', Buffer.from('{"event": "playing"}\n'));
    calls[0].child.emit('close', 0);
    assert.deepEqual(await first, { spoken: true, engine: 'supertonic3', voice: 'M3' });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].child.emit('close', 0); await queued;
    assert.equal(tts.isPlaying(), false);

    const recovery = tts.speak('Respaldo sin duplicar.');
    calls.at(-1).child.stderr.emit('data', Buffer.from('model unavailable'));
    calls.at(-1).child.emit('close', 1);
    await tick();
    assert.equal(calls.at(-1).executable, 'powershell.exe');
    calls.at(-1).child.emit('close', 0);
    assert.equal((await recovery).engine, 'windows');

    const partial = tts.speak('No repetir audio parcial.');
    const partialFailure = assert.rejects(partial, /Falló/);
    const before = calls.length;
    calls.at(-1).child.stdout.emit('data', Buffer.from('{"event": "playing"}\n'));
    calls.at(-1).child.emit('close', 1);
    await partialFailure; await tick();
    assert.equal(calls.length, before, 'no fallback after audio starts');

    const interrupted = tts.speak('Interrumpir.');
    const neverPlayed = tts.speak('No debe empezar.');
    const active = calls.at(-1);
    assert.equal(tts.stop(), true);
    assert.equal(calls.at(-1).executable, 'taskkill.exe');
    assert.equal(active.child.directKill, undefined, 'keep root alive until tree kill');
    assert.equal((await interrupted).cancelled, true);
    assert.equal((await neverPlayed).cancelled, true);
    await tick();
    assert.equal(tts.isPlaying(), false);
    assert.equal(require('../services/bargeInService').isSpeaking, false);
    assert.ok(calls.every(c => !c.executable.includes('VoiceStudio.exe')));
    console.log('PASS: M3 offline, cola, respaldo previo al audio, interrupción y cierre de sesión.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    cp.spawn = originalSpawn;
    fs.existsSync = originalExists;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    delete require.cache[servicePath];
});
