const fs = require('node:fs');
const path = require('node:path');

const locationCache = new Map();
const forecastCache = new Map();
const DEFAULT_CITY = process.env.JARVIS_WEATHER_CITY || 'Corrientes Capital, Argentina';
const LOCATION_PATH = process.env.JARVIS_WEATHER_LOCATION_PATH || path.join(__dirname, '..', 'data', 'weather_location.json');

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalCity(city) {
    const clean = normalize(city);
    if (/^(?:(?:la )?provincia de )?misiones(?: argentina)?$/.test(clean)) return { city: 'Posadas, Misiones, Argentina', provinceOnly: true };
    if (/^posadas(?: misiones)?(?: argentina)?$/.test(clean)) return { city: 'Posadas, Misiones, Argentina', provinceOnly: false };
    if (/^(?:corrientes|corrientes capital|capital de corrientes)(?: argentina)?$/.test(clean)) return { city: 'Corrientes Capital, Argentina', provinceOnly: false };
    return { city: String(city || '').trim(), provinceOnly: false };
}

function savedLocation() {
    try {
        const value = JSON.parse(fs.readFileSync(LOCATION_PATH, 'utf8'));
        if (typeof value.city === 'string' && typeof value.label === 'string'
            && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) return value;
    } catch (_) { /* Todavía no se eligió una ubicación. */ }
    return null;
}

function preferredCity() {
    return savedLocation()?.city || DEFAULT_CITY;
}

function parseLocationUpdate(text) {
    const clean = normalize(text)
        .replace(/^(?:(?:hola|che)\s+)?jarvis\s+/, '')
        .replace(/^(?:(?:bueno|mira|okey|ok)\s+)+/, '');
    const patterns = [
        /^(?:ahora\s+)?(?:yo\s+)?(?:estoy|me encuentro|vivo|ando)\s+en\s+(.+)$/,
        /^(?:ahora\s+)?(?:me mude|me fui)\s+a\s+(.+)$/,
        /^(?:pone|poneme|fija|fijame|cambia|cambiame|configura|configurame)\s+(?:mi\s+)?(?:ubicacion|ciudad)(?:\s+(?:del|para el)\s+clima)?\s+(?:en|a|como)\s+(.+)$/,
        /^(?:usa|toma)\s+(.+?)\s+(?:como\s+)?(?:mi\s+)?(?:ubicacion|ciudad)(?:\s+(?:del|para el)\s+clima)?$/,
        /^(?:de ahora en mas|desde ahora)\s+(?:dame|decime|consulta|busca)?\s*(?:el\s+)?clima\s+(?:de|en|para)\s+(.+)$/
    ];
    for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match) return { city: match[1].replace(/\s+(?:por favor|ahora)$/, '').trim() };
    }
    return null;
}

function parseRequest(text) {
    const clean = normalize(text);
    const weatherWords = /\b(?:clima|tiempo|pronostico|temperatura|llueve|llover|lluvia)\b/;
    const question = /^(?:que|como|cuanto|cual|decime|dime|contame|consulta|consultame|busca|buscame|pronostico|clima|tiempo|temperatura|va a|llueve|llovera)\b/;
    if (!weatherWords.test(clean) || !question.test(clean)) return null;
    if (/\btiempo\b/.test(clean) && !/\b(?:clima|pronostico|temperatura|llueve|llover|lluvia)\b/.test(clean)
        && !/\btiempo\s+(?:hace|hara|va a hacer)\b/.test(clean)) return null;
    if (/\b(?:aire acondicionado|calefaccion|termostato|tele|television|tv|computadora|notebook|cpu|gpu|procesador|netflix|youtube)\b/.test(clean)) return null;
    const match = clean.match(/\b(?:en|para|de)\s+([a-z\s-]{3,70})$/);
    let city = match?.[1]?.trim().replace(/\s+(?:hoy|manana|ahora)$/, '') || '';
    if (/^(?:hoy|manana|este momento|ahora|mi ciudad|la ciudad|mi zona|el dia|la semana|aca|aqui|donde estoy)$/.test(city)) city = '';
    return { city: city ? canonicalCity(city).city : preferredCity(), tomorrow: /\bmanana\b/.test(clean) };
}

function condition(code) {
    if (code === 0) return 'despejado';
    if ([1, 2, 3].includes(code)) return 'parcialmente nublado';
    if ([45, 48].includes(code)) return 'con niebla';
    if ([51, 53, 55, 56, 57].includes(code)) return 'con llovizna';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'con lluvia';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'con nieve';
    if ([95, 96, 99].includes(code)) return 'con tormentas';
    return 'con condiciones variables';
}

async function json(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Servicio meteorológico HTTP ${response.status}`);
    return response.json();
}

async function locate(city) {
    const key = normalize(city);
    const cached = locationCache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const saved = savedLocation();
    if (saved && normalize(saved.city) === key) return saved;
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', /^corrientes capital\b/i.test(city) ? 'Corrientes' : String(city).split(',')[0].trim());
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'es');
    url.searchParams.set('format', 'json');
    if (/\bargentina\b/i.test(city)) url.searchParams.set('countryCode', 'AR');
    const result = (await json(url)).results?.[0];
    if (!result) throw new Error(`No encontré la ciudad ${city}. Decime otra ubicación.`);
    const label = /^corrientes capital\b/i.test(city) ? 'Corrientes Capital, Argentina'
        : [result.name, result.admin1, result.country].filter(Boolean).join(', ');
    const value = { latitude: result.latitude, longitude: result.longitude, label };
    locationCache.set(key, { value, until: Date.now() + 86400000 });
    return value;
}

async function setPreferredLocation({ city } = {}) {
    const requested = String(city || '').trim();
    if (!requested || requested.length > 80 || !/^[\p{L}\s,.-]+$/u.test(requested)) {
        return { ok: false, message: 'Decime una ciudad o provincia válida para el clima.' };
    }
    const canonical = canonicalCity(requested);
    try {
        const place = await locate(canonical.city);
        const value = { city: canonical.city, ...place };
        fs.mkdirSync(path.dirname(LOCATION_PATH), { recursive: true });
        const temporary = `${LOCATION_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(temporary, LOCATION_PATH);
        return {
            ok: true,
            message: `Listo. Desde ahora consultaré el clima de ${place.label} hasta que me indiques otra ubicación.${canonical.provinceOnly ? ' Como dijiste Misiones sin ciudad, tomé Posadas como referencia.' : ''}`,
            data: { city: place.label, persistent: true }
        };
    } catch (error) {
        return { ok: false, message: `No pude guardar la ubicación: ${error.message}` };
    }
}

async function getWeather({ city = preferredCity(), tomorrow = false } = {}) {
    try {
        const place = await locate(canonicalCity(city).city);
        const key = `${place.latitude},${place.longitude}`;
        let data = forecastCache.get(key);
        if (!data || data.until <= Date.now()) {
            const url = new URL('https://api.open-meteo.com/v1/forecast');
            url.searchParams.set('latitude', String(place.latitude));
            url.searchParams.set('longitude', String(place.longitude));
            url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code');
            url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code');
            url.searchParams.set('forecast_days', '2');
            url.searchParams.set('timezone', 'auto');
            data = { value: await json(url), until: Date.now() + 600000, url: url.toString() };
            forecastCache.set(key, data);
        }
        const forecast = data.value;
        const day = tomorrow ? 1 : 0;
        const daily = forecast.daily || {};
        const max = daily.temperature_2m_max?.[day];
        const min = daily.temperature_2m_min?.[day];
        const rain = daily.precipitation_probability_max?.[day];
        if (!Number.isFinite(max) || !Number.isFinite(min)) throw new Error('El pronóstico recibido está incompleto.');
        const period = tomorrow ? 'Mañana' : 'Hoy';
        const current = !tomorrow && Number.isFinite(forecast.current?.temperature_2m)
            ? `Ahora hay ${Math.round(forecast.current.temperature_2m)} grados y está ${condition(forecast.current.weather_code)}. ` : '';
        const message = `${period} en ${place.label}: ${current}Mínima de ${Math.round(min)} y máxima de ${Math.round(max)} grados${Number.isFinite(rain) ? `, con ${Math.round(rain)} por ciento de probabilidad máxima de lluvia` : ''}. Fuente: Open-Meteo.`;
        return { ok: true, message, data: { city: place.label, source: 'Open-Meteo', sourceUrl: data.url, observedAt: forecast.current?.time || null } };
    } catch (error) {
        return { ok: false, message: `No pude consultar el clima ahora: ${error.message}`, data: { city, source: 'Open-Meteo' } };
    }
}

module.exports = { parseRequest, parseLocationUpdate, getWeather, setPreferredLocation, preferredCity };
