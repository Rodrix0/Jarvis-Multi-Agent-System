const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-weather-message-'));
process.env.JARVIS_MEMORY_PATH = path.join(sandbox, 'memory.json');
process.env.JARVIS_ACTION_AUDIT_PATH = path.join(sandbox, 'audit.jsonl');
process.env.JARVIS_WEATHER_LOCATION_PATH = path.join(sandbox, 'weather_location.json');

async function run() {
    const weather = require('../services/weatherService');
    assert.deepEqual(weather.parseRequest('¿Va a llover mañana en Córdoba?'), { city: 'cordoba', tomorrow: true });
    assert.deepEqual(weather.parseRequest('¿Qué clima hace?'), { city: 'Corrientes Capital, Argentina', tomorrow: false });
    assert.deepEqual(weather.parseLocationUpdate('Jarvis, me encuentro en Misiones'), { city: 'misiones' });
    assert.deepEqual(weather.parseLocationUpdate('Bueno, me encuentro en Misiones'), { city: 'misiones' });
    assert.deepEqual(weather.parseLocationUpdate('Estoy en Posadas'), { city: 'posadas' });
    assert.equal(weather.parseLocationUpdate('¿Qué clima hace en Misiones?'), null);
    assert.equal(weather.parseRequest('Poné el aire acondicionado en 24 grados'), null);
    assert.equal(weather.parseRequest('Buscá la película Calor'), null);
    assert.equal(weather.parseRequest('¿Qué tiempo tarda Netflix?'), null);
    assert.equal(weather.parseRequest('¿Qué temperatura tiene la CPU?'), null);

    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        const target = String(url);
        calls.push(target);
        if (target.includes('geocoding-api.open-meteo.com')) {
            const name = new URL(target).searchParams.get('name');
            const place = name === 'Posadas'
                ? { name: 'Posadas', admin1: 'Misiones', country: 'Argentina', latitude: -27.36, longitude: -55.90 }
                : name === 'Corrientes'
                    ? { name: 'Corrientes', admin1: 'Corrientes', country: 'Argentina', latitude: -27.47, longitude: -58.83 }
                    : { name: 'Córdoba', country: 'Argentina', latitude: -31.4, longitude: -64.2 };
            return { ok: true, json: async () => ({ results: [place] }) };
        }
        if (target.includes('api.open-meteo.com')) return { ok: true, json: async () => ({
            current: { temperature_2m: 22, weather_code: 1, time: '2026-09-30T12:00' },
            daily: { temperature_2m_max: [25, 27], temperature_2m_min: [13, 15], precipitation_probability_max: [10, 40], weather_code: [1, 3] }
        }) };
        if (target.includes('127.0.0.1:11434/api/generate')) return { ok: true, json: async () => ({ response: JSON.stringify({ message: 'Voy a llegar tarde.' }) }) };
        throw new Error(`Solicitud inesperada: ${target}`);
    };
    try {
        const forecast = await weather.getWeather({ city: 'Córdoba', tomorrow: true });
        assert.equal(forecast.ok, true);
        assert.match(forecast.message, /Mañana en Córdoba, Argentina/);
        assert.match(forecast.message, /40 por ciento/);
        const cached = await weather.getWeather({ city: 'Córdoba', tomorrow: true });
        assert.equal(cached.ok, true);
        assert.equal(calls.filter(url => url.startsWith('https://api.open-meteo.com/')).length, 1, 'cache breve para no repetir consultas');

        const draft = require('../services/communication/whatsappDraftService');
        assert.equal(draft.isIndirect('Mandale a mamá que le diga que estoy llegando', 'que estoy llegando'), true);
        assert.equal(draft.isIndirect('Mandale a mamá que diga “Que tengas buen día”', 'Que tengas buen día'), false);
        const modelDraft = await draft.prepare({ contact: 'mamá', message: 'Rodrigo va a llegar tarde' }, { userText: 'Avisale a mamá que Rodrigo va a llegar tarde' });
        assert.equal(modelDraft.message, 'Voy a llegar tarde.');
        assert.equal(modelDraft.reviewRequired, true);
        const actions = require('../services/jarvisActionService');
        assert.equal((await actions.resolve('¿Qué clima hace hoy en Córdoba?')).id, 'information.weather');
        assert.equal((await actions.resolve('Jarvis, me encuentro en Misiones')).id, 'information.weather-location.set');
        const moved = await actions.execute('information.weather-location.set', { city: 'Misiones' });
        assert.equal(moved.ok, true, moved.message);
        assert.match(moved.message, /Posadas como referencia/);
        assert.deepEqual(weather.parseRequest('¿Qué clima hace mañana?'), { city: 'Posadas, Misiones, Argentina', tomorrow: true });
        const afterMove = await weather.getWeather();
        assert.match(afterMove.message, /Posadas, Misiones, Argentina/);
        assert.equal(calls.filter(url => url.includes('geocoding-api.open-meteo.com') && url.includes('Posadas')).length, 1,
            'la ubicación guardada evita geocodificarla de nuevo');
        delete require.cache[require.resolve('../services/weatherService')];
        assert.equal(require('../services/weatherService').preferredCity(), 'Posadas, Misiones, Argentina',
            'la ubicación persiste después de reiniciar el servicio');
        assert.deepEqual(weather.parseRequest('¿Qué clima hace en Corrientes hoy?'), { city: 'Corrientes Capital, Argentina', tomorrow: false });
        const backHome = await weather.setPreferredLocation({ city: 'Corrientes' });
        assert.equal(backHome.ok, true, backHome.message);
        assert.deepEqual(weather.parseRequest('¿Qué clima hace?'), { city: 'Corrientes Capital, Argentina', tomorrow: false });
        const resolved = await actions.resolve('Mandale un mensaje a mamá que le diga que estoy llegando');
        assert.equal(resolved.id, 'whatsapp.send');
        const whatsapp = require('../services/windowsControlService').whatsapp;
        const originalSend = whatsapp.sendMessage;
        let sent = null;
        whatsapp.sendMessage = async (contact, message) => { sent = { contact, message }; return { ok: true, message: 'Enviado.' }; };
        try {
            const pending = await actions.execute('whatsapp.send', resolved.params, { originalUtterance: 'Mandale un mensaje a mamá que le diga que estoy llegando' });
            assert.equal(pending.status, 'awaiting_confirmation');
            assert.match(pending.message, /Estoy llegando/);
            assert.equal(sent, null, 'nunca se envía sin aprobar el borrador');
            const approved = await actions.confirm(pending.confirmationToken);
            assert.equal(approved.ok, true);
            assert.deepEqual(sent, { contact: 'mamá', message: 'Estoy llegando' });
            sent = null;
            const exact = 'Mandale un mensaje a mamá que diga “Que tengas buen día”';
            const exactAction = await actions.resolve(exact);
            assert.equal(exactAction.id, 'whatsapp.send');
            const exactResult = await actions.execute('whatsapp.send', exactAction.params, { originalUtterance: exact });
            assert.equal(exactResult.status, 'completed');
            assert.deepEqual(sent, { contact: 'mamá', message: 'Que tengas buen día' });
        } finally { whatsapp.sendMessage = originalSend; }
    } finally { globalThis.fetch = originalFetch; }
    console.log('PASS: clima local persistente con fuente y caché; WhatsApp indirecto con vista previa y autorización.');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
