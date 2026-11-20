const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-authorization-'));
process.env.JARVIS_MEMORY_PATH = path.join(sandbox, 'memory.json');
process.env.JARVIS_ACTION_AUDIT_PATH = path.join(sandbox, 'audit.jsonl');
process.env.JARVIS_SECURITY_PIN = '6792';

async function run() {
    const actions = require('../services/jarvisActionService');
    const kernel = require('../services/actionKernelService');

    const pending = await actions.process('Borrá todas tus correcciones');
    assert.equal(pending.status, 'awaiting_confirmation');
    assert.ok(pending.confirmationToken);
    assert.equal(actions.pendingConfirmation().confirmationToken, pending.confirmationToken, 'el panel puede recuperar una autorización al recargar');
    const unrelated = await actions.process('¿Qué podés hacer?');
    assert.notEqual(unrelated.confirmationResolved, true);
    const approved = await actions.process('Sí, podés hacerlo');
    assert.equal(approved.status, 'completed');
    assert.equal(approved.confirmationResolved, true);
    assert.equal(actions.pendingConfirmation(), null);

    const again = await actions.process('Borrá todas tus correcciones');
    assert.ok(again.confirmationToken);
    const cancelled = await actions.process('No, cancelá eso');
    assert.equal(cancelled.confirmationResolved, true);
    assert.equal(cancelled.message, 'Cancelé la acción pendiente.');

    let executions = 0;
    kernel.register({ id: 'test.critical-pin', name: 'Prueba PIN', riskLevel: 'CRITICAL', execute: async () => { executions++; return { message: 'Prueba completada.' }; } });
    const pinPending = await actions.execute('test.critical-pin');
    assert.equal(pinPending.status, 'awaiting_pin_confirmation');
    const badPin = await actions.confirm(pinPending.confirmationToken, {}, { pin: '0000' });
    assert.equal(badPin.status, 'pin_verification_failed');
    assert.equal(badPin.confirmationToken, pinPending.confirmationToken);
    assert.equal(executions, 0);
    const withPin = await actions.confirm(pinPending.confirmationToken, {}, { pin: '6792' });
    assert.equal(withPin.status, 'completed');
    assert.equal(executions, 1);
    console.log('PASS: autorización conservada entre temas, cancelación y reintento seguro del PIN.');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
