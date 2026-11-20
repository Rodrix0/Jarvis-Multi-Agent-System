// Explicit opt-in: sends one document command three times to the running server,
// opens one test document, and plays acknowledgement/completion through real TTS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.JARVIS_LIVE_RELIABILITY !== '1') throw new Error('Set JARVIS_LIVE_RELIABILITY=1 for this audible integration test.');
const base = 'http://127.0.0.1:3000';
async function post(route, data) {
    const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(60000) });
    const body = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(body));
    return body;
}
async function main() {
    const directory = path.resolve(__dirname, '../../logs/acceptance', String(Date.now()));
    fs.mkdirSync(directory, { recursive: true });
    const text = `Creame un documento sobre las películas de Spider-Man en la carpeta "${directory}"`;
    const started = Date.now();
    const responses = await Promise.all(Array.from({ length: 3 }, () => post('/api/process_speech_local', { text, source: 'verification', confidence: 0.99, confirmed: true })));
    const accepted = responses.filter(r => r.backgroundJobId);
    assert.equal(accepted.length, 1, 'exactly one task accepted');
    assert.equal(responses.filter(r => r.result?.status === 'ignored_duplicate').length, 2);
    const ackMs = Date.now() - started;
    const ackSpeech = post('/api/tts/speak', { text: accepted[0].response });
    let job;
    for (let i = 0; i < 240; i++) {
        job = await (await fetch(`${base}/api/voice/local/jobs/${accepted[0].backgroundJobId}`)).json();
        if (job.status !== 'working') break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(job.status, 'completed');
    assert.equal(job.result.ok, true);
    assert.equal(fs.readdirSync(directory).filter(f => f.endsWith('.docx')).length, 1);
    const workMs = Date.now() - started;
    const finalSpeech = post('/api/tts/speak', { text: 'Prueba terminada. Creé un solo documento y la respuesta se reproduce completa.' });
    const audio = await Promise.all([ackSpeech, finalSpeech]);
    assert.ok(audio.every(r => r.spoken === true && !r.cancelled), 'both sentences finish naturally');
    const report = { ackMs, workMs, duplicateRequestsIgnored: 2, documentsCreated: 1, filePath: job.result.data.filePath, launchAccepted: job.result.data.opened, audio, totalMs: Date.now() - started };
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
