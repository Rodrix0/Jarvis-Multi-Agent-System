const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const fast = require('../services/ai/fastCommandParser');
const reminder = require('../services/agenda/reminderParser');
const scheduler = require('../services/agenda/schedulerService');
clearTimeout(scheduler.startupTimer);
clearInterval(scheduler.pollInterval);
const actions = require('../services/jarvisActionService');
const tv = require('../services/tvService');
const tvVoice = require('../services/tvVoiceService');

async function run() {
    const voice = require('../services/voiceInputService');
    const literal = 'abrir C:\\Users\\Rodrigo\\Desktop\\Mi Informe.pdf';
    assert.equal(voice.normalizeVoiceTranscript(literal), literal);
    assert.equal(voice.normalizeVoiceTranscript('recordame llamar mañana a las 18:30'), 'recordame llamar mañana a las 18:30');
    assert.match(voice.normalizeVoiceTranscript('abrir Netflix en el navegador'), /en el navegador/);
    assert.equal((await actions.resolve(voice.normalizeVoiceTranscript(literal))).params.appName, 'C:\\Users\\Rodrigo\\Desktop\\Mi Informe.pdf');
    for (const [text, action, params] of [
        ['bajame el volumen', 'audio.adjust-volume', { delta: -10 }],
        ['subime el brillo', 'display.adjust-brightness', { delta: 10 }],
        ['subí el volumen hasta el 70%', 'audio.set-volume', { percent: 70 }],
        ['bajá el volumen de la tele', 'tv.adjust-volume', { delta: -10 }],
        ['subile el volumen 20 puntos', 'audio.adjust-volume', { delta: 20 }],
        ['brillo al 0', 'display.set-brightness', { percent: 0 }],
        ['volumen al 0', 'audio.set-volume', { percent: 0 }],
        ['qué volumen tiene la pc', 'audio.get-volume', {}],
        ['subí el brillo al 75', 'display.set-brightness', { percent: 75 }]
    ]) {
        assert.deepEqual(fast.parse(text), { match: true, action, params }, text);
        assert.deepEqual(await actions.resolve(text), { id: action, params }, text);
    }
    for (const text of ['abrí FIFA 26', 'poné Netflix 2025', 'recordame llamar en 10 minutos']) {
        assert.notEqual(fast.parse(text).action, 'audio.set-volume', text);
    }
    const now = new Date(2026, 8, 8, 23, 55, 0);
    const parsed = reminder.parse('recordame tomar agua en diez minutos', now);
    assert.deepEqual(parsed.params, { title: 'tomar agua', targetDate: '2026-09-09', targetTime: '00:05', recurrence: 'none' });
    assert.equal(reminder.parse('recordame llamar mañana a las 18:30', now).params.targetTime, '18:30');
    assert.equal(reminder.parse('recordame llamar', now).id, 'agenda.clarify');
    assert.equal(reminder.parse('recordame llamar a las 99:90', now).id, 'agenda.clarify');
    assert.equal((await actions.resolve('recordame llamar en 10 minutos')).id, 'agenda.add');
    assert.equal((await actions.resolve('qué tareas tengo')).id, 'agenda.list');
    assert.equal((await actions.resolve('abrir WhatsApp')).id, 'system.open');
    const originalAvailable = tv.isAvailable;
    try {
        tvVoice.deactivateSession();
        tv.isAvailable = async () => false;
        for (const text of ['abrir Netflix', 'abrime Netflix', 'abrí Netflix']) {
            assert.deepEqual(await actions.resolve(text), { id: 'system.open', params: { appName: 'Netflix' } }, text);
        }
        tv.isAvailable = async () => true;
        const online = await actions.resolve('abrir Netflix');
        assert.equal(online.id, 'tv.control');
        assert.equal(online.params.intent.powerOn, true);
        assert.equal((await actions.resolve('abrir Netflix en el navegador')).id, 'system.open');
    } finally { tv.isAvailable = originalAvailable; }

    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE agenda (id TEXT, title TEXT, target_date TEXT, target_time TEXT, status TEXT, recurrence TEXT, last_triggered TEXT)');
    const add = db.prepare("INSERT INTO agenda VALUES (?, ?, ?, ?, 'pending', ?, NULL)");
    add.run('late', 'Missed reminder', '2026-09-08', '22:00', 'none');
    add.run('daily', 'Daily reminder', '2026-09-08', '23:00', 'daily');
    add.run('future', 'Future reminder', '2026-09-09', '00:30', 'none');
    const sent = [];
    const isolated = new scheduler.SchedulerService({ db, start: false, notifications: { notify: data => sent.push(data.message) } });
    isolated.checkDueReminders(now);
    isolated.checkDueReminders(now);
    assert.deepEqual(sent, ['Missed reminder', 'Daily reminder']);
    assert.equal(db.prepare("SELECT target_date FROM agenda WHERE id = 'daily'").get().target_date, '2026-09-09');
    isolated.checkDueReminders(new Date(2026, 8, 9, 23, 55));
    assert.equal(sent.filter(value => value === 'Daily reminder').length, 2);
    db.close();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-files-'));
    fs.mkdirSync(path.join(root, 'subfolder'));
    const file = path.join(root, 'subfolder', 'Mi Informe.pdf');
    fs.writeFileSync(file, 'test fixture');
    assert.equal(await require('../services/localFileSearch').find('mi informe.pdf', { roots: [root] }), file);
    assert.equal(await require('../services/localFileSearch').find('mi informe', { roots: [root] }), file);
    fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); fs.rmdirSync(root);
    console.log('OK: daily commands, relative controls, Netflix online/offline, reminder dates, catch-up, deduplication and nested files.');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
