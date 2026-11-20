const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fastCommandParser = require('../services/ai/fastCommandParser');
const jarvisActionService = require('../services/jarvisActionService');

const STATE_FILE = path.join(__dirname, '..', 'data', 'local_voice_state.json');

async function runTests() {
    console.log('=== TEST 1: FastCommandParser Wake & Sleep Detection ===');

    const wakeQueries = [
        'prendete',
        'jarvis prendete',
        'prendete jarvis',
        'despertate',
        'despierta',
        'reactivate',
        'activa',
        'activate',
        'hola jarvis',
        'jarvis'
    ];

    for (const q of wakeQueries) {
        const res = fastCommandParser.parse(q);
        console.log(`[Parser Wake] "${q}" -> ${res.action}`);
        assert.strictEqual(res.match, true, `Debe reconocer wake: "${q}"`);
        assert.strictEqual(res.action, 'voice.wake', `Acción debe ser voice.wake para "${q}"`);
    }

    const sleepQueries = [
        'apagate',
        'apágate',
        'jarvis apagate',
        'apagate jarvis',
        'dormite',
        'duermete',
        'modo descanso',
        'entra en modo descanso',
        'ponete en reposo',
        'ponete a dormir',
        'a dormir',
        'a descansar'
    ];

    for (const q of sleepQueries) {
        const res = fastCommandParser.parse(q);
        console.log(`[Parser Sleep] "${q}" -> ${res.action}`);
        assert.strictEqual(res.match, true, `Debe reconocer sleep: "${q}"`);
        assert.strictEqual(res.action, 'voice.sleep', `Acción debe ser voice.sleep para "${q}"`);
    }

    console.log('\n=== TEST 2: Device Control Isolation (Tele/Luz no deben alterar estado de voz) ===');
    const deviceQueries = [
        'apaga la tele',
        'apagar la tele',
        'prende la tele',
        'prender la tele',
        'apaga la television',
        'prende la tv'
    ];

    for (const q of deviceQueries) {
        const res = fastCommandParser.parse(q);
        const action = res.match ? res.action : 'no-fast-match';
        console.log(`[Parser Device] "${q}" -> ${action}`);
        assert.notStrictEqual(action, 'voice.wake', `"${q}" NO debe ser voice.wake`);
        assert.notStrictEqual(action, 'voice.sleep', `"${q}" NO debe ser voice.sleep`);
    }

    console.log('\n=== TEST 3: JarvisActionService Full Resolution & State Persistence ===');
    
    // Test Wake
    const wakePlan = await jarvisActionService.resolve('Jarvis, prendete');
    assert.strictEqual(wakePlan.id, 'voice.wake');
    const wakeResult = await jarvisActionService.process('prendete');
    assert.strictEqual(wakeResult.actionId, 'voice.wake');
    assert.strictEqual(wakeResult.data?.voiceState, 'awake');
    
    let stateOnDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    console.log('[Disk State after Wake]:', stateOnDisk);
    assert.strictEqual(stateOnDisk.state, 'awake', 'El archivo debe persistir awake');

    // Test Sleep
    const sleepPlan = await jarvisActionService.resolve('apagate');
    assert.strictEqual(sleepPlan.id, 'voice.sleep');
    const sleepResult = await jarvisActionService.process('apagate');
    assert.strictEqual(sleepResult.actionId, 'voice.sleep');
    assert.strictEqual(sleepResult.data?.voiceState, 'dormant');

    stateOnDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    console.log('[Disk State after Sleep]:', stateOnDisk);
    assert.strictEqual(stateOnDisk.state, 'dormant', 'El archivo debe persistir dormant');

    console.log('\n🎉 ALL WAKE & SLEEP STATE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('❌ Error en test de wake/sleep:', err);
    process.exit(1);
});
