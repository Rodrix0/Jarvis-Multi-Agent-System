const SESSION_MS = 30 * 60 * 1000;

let activeUntil = 0;
let awaitingDestinationUntil = 0;
let sessionContext = { topic: '', lastAction: '', lastTitle: '', lastDirection: '', netflixReady: false };

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!,.;:]/g, ' ')
        .replace(/\bpon\b/g, 'pone')
        .replace(/\s+/g, ' ')
        .trim();
}

function activateSession() {
    activeUntil = Date.now() + SESSION_MS;
    sessionContext.topic = 'netflix_tv';
}

function deactivateSession() {
    activeUntil = 0;
    sessionContext = { topic: '', lastAction: '', lastTitle: '', lastDirection: '', netflixReady: false };
}

function isSessionActive() {
    return Date.now() < activeUntil;
}

function switchesAwayFromTv(text) {
    const normalized = normalize(text);
    if (!isSessionActive() || /\bnetflix\b/.test(normalized)) return false;
    return /\b(spotify|youtube|google|chrome|whatsapp|correo|email|calculadora|computadora|pc|recordatorio|clima|noticias|internet|otra cosa|cambiando de tema)\b/.test(normalized)
        || /^(?:que|quien|cuando|donde|por que|explicame|contame)\b/.test(normalized);
}

function clearDestinationPrompt() {
    awaitingDestinationUntil = 0;
}

function rememberIntent(intent = {}) {
    if (!intent.action) return;
    activateSession();
    sessionContext.lastAction = intent.action;
    if (intent.action === 'netflix') sessionContext.netflixReady = true;
    if (intent.title) sessionContext.lastTitle = String(intent.title).slice(0, 120);
    if (intent.button) sessionContext.lastDirection = intent.button;
}

function getSessionContext() {
    return { ...sessionContext, active: isSessionActive() };
}

function movementCount(text) {
    const digit = text.match(/\b(10|[1-9])\b/);
    if (digit) return Number(digit[1]);
    const words = {
        una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
        seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
    };
    for (const [word, count] of Object.entries(words)) {
        if (new RegExp(`\\b${word}\\b`).test(text)) return count;
    }
    return 1;
}

function cleanQuery(query) {
    let clean = normalize(query)
        .replace(/\s+y\s+(?:reproduci(?:rla|rlo)?|reproduce(?:la|lo)?|pon(?:ela|elo))\b.*$/, '')
        .replace(/^(?:en\s+)?(?:mi\s+lista\s+)?/, '')
        .replace(/^(?:la\s+)?serie\s+que\s+estoy\s+viendo\s+(?:que\s+es\s+)?/, '')
        .trim();

    const genre = clean.match(/^(?:una?\s+)?(?:pelicula|serie)s?\s+de\s+(.+)$/);
    if (genre) clean = genre[1].trim();
    return clean;
}

function parseTvIntent(text) {
    const raw = String(text || '').trim();
    const normalized = normalize(raw);

    if (/(cancela|detene|para).*(tele|netflix)/.test(normalized)) {
        return { action: 'cancel' };
    }

    const wantsComputer = /\b(compu|computadora|pc|navegador)\b/.test(normalized);
    const wantsTelevision = /\b(tele|television|tv)\b/.test(normalized);
    const computerOnly = /^(?:jarvis\s+)?(?:en\s+)?(?:la\s+)?(?:compu|computadora|pc|navegador)$/.test(normalized);
    const televisionOnly = /^(?:jarvis\s+)?(?:en\s+)?(?:la\s+)?(?:tele|television|tv)$/.test(normalized);
    if (Date.now() < awaitingDestinationUntil && computerOnly) {
        awaitingDestinationUntil = 0;
        return { action: 'open_pc' };
    }
    if (Date.now() < awaitingDestinationUntil && televisionOnly) {
        awaitingDestinationUntil = 0;
        return { action: 'netflix', title: '', useDefaultSeries: false, powerOn: false };
    }
    if (/\bnetflix\b/.test(normalized) && wantsComputer) {
        awaitingDestinationUntil = 0;
        return { action: 'open_pc' };
    }

    // Apertura directa de cuenta / perfil Rodri en Netflix
    if (/\b(?:ingresa|ingresar|entra|entrar|accede|acceder|selecciona|elegir?)\s+(?:a\s+)?(?:mi\s+cuenta|mi\s+perfil|perfil(?:\s+de)?\s+rodri)\b/i.test(normalized)
        || /^(?:jarvis\s+)?(?:ingresa|entra|abrir?|pone)\s+(?:a\s+)?netflix(?:\s+(?:en|a)\s+(?:la\s+)?tele)?$/i.test(normalized)) {
        return { action: 'enter_netflix' };
    }

    // Navegar directamente a la búsqueda de Netflix
    if (/\b(?:ir\s+a\s+(?:la\s+)?b[uú]squeda|anda\s+a\s+(?:la\s+)?b[uú]squeda|abrir?\s+(?:el\s+)?buscador|abrir?\s+(?:la\s+)?b[uú]squeda|pone\s+el\s+buscador)\b/i.test(normalized)) {
        return { action: 'open_search' };
    }

    if (/^(?:jarvis\s+)?netflix$/.test(normalized)) {
        return { action: 'enter_netflix' };
    }

    // --- 0. Volumen y Silencio de la Televisión ---
    const isTvAudio = /\b(?:tele|television|tv)\b/i.test(normalized);

    // 0.0 Calibración explícita
    const tvVolCalibMatch = normalized.match(/(?:calibr(?:a|ar)|sincroniz(?:a|ar))\s+(?:el\s+)?(?:volumen\s+)?(?:de\s+la\s+|en\s+la\s+)?(?:tele|television|tv)?\s*(?:a|al|en)?\s*(\d{1,3})/i)
        || normalized.match(/(?:este\s+es\s+el\s+|el\s+)?volumen\s+(?:actual\s+)?(?:de\s+la\s+|en\s+la\s+)?(?:tele|television|tv)?\s*(?:actual\s+|actualmente\s+)?(?:es\s+de|es|esta\s+en)\s*(\d{1,3})/i)
        || normalized.match(/(?:este\s+es\s+el\s+volumen\s+(?:actual\s+|actualmente\s+)?)(?:de\s+)?(\d{1,3})/i)
        || normalized.match(/(?:la\s+tele|television|tv)\s+(?:esta\s+en|tiene|quedo\s+en)\s+(?:volumen\s+)?(\d{1,3})/i);
    if (tvVolCalibMatch) {
        return { action: 'calibrate_volume', level: parseInt(tvVolCalibMatch[1], 10) };
    }

    // 0.1 Delta relativo
    const isHasta = /\bhasta\b/i.test(normalized);
    const tvVolDeltaMatch = normalized.match(/(?:subi|subile|subir|aumenta|aumentale|aumentar)\s+(?:el\s+)?(?:volumen\s+)?(?:de\s+la\s+|a\s+la\s+)?(?:tele|television|tv)?\s*(?:un\s+|en\s+)?(\d{1,2})\s*(?:%|por ciento|puntos)?/i)
        || normalized.match(/(?:baja|bajale|bajar|disminui|disminuile|disminuir)\s+(?:el\s+)?(?:volumen\s+)?(?:de\s+la\s+|a\s+la\s+)?(?:tele|television|tv)?\s*(?:un\s+|en\s+)?(\d{1,2})\s*(?:%|por ciento|puntos)?/i);
    if (tvVolDeltaMatch && !isHasta && (isTvAudio || /\b(subile|bajale|aumentale|disminuile|un \d|puntos)\b/i.test(normalized))) {
        const isUp = /subi|aument/i.test(tvVolDeltaMatch[0]);
        const deltaValue = parseInt(tvVolDeltaMatch[1] || '10', 10);
        return { action: 'adjust_volume', delta: isUp ? deltaValue : -deltaValue };
    }

    // 0.2 Consulta de volumen
    if (/\b(?:que|cuanto|cuanta|a que|a cuanto|nivel de|estado del?)\s+(?:esta\s+el\s+)?(?:volumen|sonido|audio)\b/i.test(normalized) || normalized === 'volumen de la tele' || normalized === 'volumen tele') {
        return { action: 'get_volume' };
    }

    // 0.3 Target absoluto
    if (isTvAudio || isHasta) {
        const tvVolSetMatch = normalized.match(/(?:hasta\s+(?:el\s+)?|a|al|en)\s*(\d{1,3})\s*(?:%|por ciento)?/i)
            || normalized.match(/(?:volumen|sonido|audio)\s*(?:a|al|en)?\s*(\d{1,3})\s*(?:%|por ciento)?/i)
            || normalized.match(/(?:pon|pone|subi|subir|baja|bajar|ajusta|cambia|coloca|sete(?:a|ar)).*?\b(\d{1,3})\s*(?:%|por ciento)?\b/i);
        if (tvVolSetMatch) {
            return { action: 'set_volume', percent: parseInt(tvVolSetMatch[1], 10) };
        }
    }

    // Aprendizaje de botones por voz
    const learnMatch = normalized.match(/aprend[eé]\s+(?:el\s+bot[oó]n\s+(?:de\s+)?)?(subir\s+volumen|bajar\s+volumen|volup|voldown|power|netflix|ok|arriba|abajo|izquierda|derecha|mute|silencio)/i);
    if (learnMatch) {
        const key = learnMatch[1].toLowerCase();
        let button = 'volup';
        if (key.includes('bajar')) button = 'voldown';
        else if (key.includes('subir')) button = 'volup';
        else if (key.includes('power') || key.includes('prender') || key.includes('apagar')) button = 'power';
        else if (key.includes('netflix')) button = 'netflix';
        else if (key.includes('ok')) button = 'ok';
        else if (key.includes('arriba')) button = 'up';
        else if (key.includes('abajo')) button = 'down';
        else if (key.includes('izquierda')) button = 'left';
        else if (key.includes('derecha')) button = 'right';
        else if (key.includes('mute') || key.includes('silencio')) button = 'mute';
        return { action: 'learn_button', button };
    }

    if (/\b(?:mute|silenci(?:a|ar|ate)|mutear|desmutear|pon(?:e)? en silencio|sac(?:a)? el silencio)\b.*(?:tele|television|tv)/i.test(normalized)
        || /\b(?:silenci(?:a|ar)\s+(?:la\s+)?(?:tele|television|tv))\b/i.test(normalized)) {
        return { action: 'toggle_mute' };
    }

    if (switchesAwayFromTv(normalized)) {
        deactivateSession();
        return null;
    }

    const mentionsTv = /\b(netflix|tele|television|tv|mi lista|mi serie|mi contenido|continuar viendo|continua viendo|segui viendo|serie que estoy viendo)\b/.test(normalized);
    const inTvContext = mentionsTv || isSessionActive();
    if (!inTvContext) return null;

    const powerOn = /(prende|prenda|prender|encende|encienda|encender).*(tele|television|tv)/.test(normalized);

    // Detección directa de apertura de Netflix (sin película)
    if (/^(?:prende|prenda|prender|encende|encienda|encender)\s+(?:la\s+)?(?:tele|television|tv)\s+(?:y\s+)?(?:pone|poneme|abrir|abri|abre|entra|entrar)?\s*netflix$/i.test(normalized)
        || /^(?:pone|poneme|abrir|abri|abre|entra|entrar)\s+netflix\s+(?:en\s+)?(?:la\s+)?(?:tele|television|tv)$/i.test(normalized)
        || /^(?:prende|prenda|encende|encienda)\s+(?:la\s+)?(?:tele|television|tv)$/i.test(normalized)) {
        return { action: 'netflix', title: '', useDefaultSeries: false, powerOn: powerOn || true };
    }

    if (/\b(reproduce|reproduci|pone|poneme|ponelo|ponela|ponlo|selecciona|elegi|entra)(?:\s+(?:eso|esa|ese|esto|esta|seleccionado|seleccionada|ahi))?\s*$/.test(normalized)) {
        return { action: 'navigate', button: 'ok', count: 1, label: 'reproducir lo seleccionado' };
    }
    if (/\b(pausa|pausa eso|play)\b/.test(normalized)) {
        return { action: 'navigate', button: 'ok', count: 1, label: 'aceptar' };
    }
    if (/\b(atras|volve|volver|regresa)\b/.test(normalized)) {
        return { action: 'navigate', button: 'back', count: movementCount(normalized), label: 'volver' };
    }

    const ordinalWords = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
    const ordinalMatch = normalized.match(/\b(?:pone|poneme|reproduce|elegi|selecciona|quiero ver)\s+(?:la|el)?\s*(primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto)\b/);
    if (ordinalMatch) {
        return { action: 'select', index: ordinalWords[ordinalMatch[1]] };
    }

    const movements = [
        { pattern: /\b(derecha|siguiente|avanza)\b/, button: 'right', label: 'derecha' },
        { pattern: /\b(izquierda|anterior|retrocede)\b/, button: 'left', label: 'izquierda' },
        { pattern: /\b(baja|bajando|abajo|mostrame mas|muestra mas)\b/, button: 'down', label: 'abajo' },
        { pattern: /\b(sube|subiendo|arriba)\b/, button: 'up', label: 'arriba' }
    ];
    for (const movement of movements) {
        if (movement.pattern.test(normalized)) {
            return {
                action: 'navigate',
                button: movement.button,
                count: movementCount(normalized),
                label: movement.label
            };
        }
    }

    if (/(?:continua|segui|sigue|siga|reproduce|pone|poneme).*(?:mi contenido|mi serie|continuar viendo|viendo|lo que estaba viendo)/.test(normalized)) {
        return { action: 'continue_watching', powerOn };
    }

    const explicitNamedSeries = normalized.match(/(?:serie\s+que\s+estoy\s+viendo|mi\s+lista).*?\bque\s+es\s+(.+?)(?:\s+y\s+reprodu\w*)?$/);
    if (explicitNamedSeries) {
        let title = cleanQuery(explicitNamedSeries[1]);
        if (/^(?:netflix|la tele|television|tv)$/i.test(title)) title = '';
        const playFirst = /\breprodu\w*\b/.test(normalized);
        if (!sessionContext.netflixReady || !title) {
            return { action: 'netflix', title, useDefaultSeries: false, powerOn, playFirst };
        }
        return {
            action: 'search',
            title,
            playFirst
        };
    }

    const beforeNetflix = normalized.match(/(?:pone|poneme|ponelo|ponela|busca|buscame|buscar|reproduce|reproducir|quiero ver)\s+(.+?)\s+en\s+netflix/);
    const afterNetflix = normalized.match(/netflix(?:\s+y)?\s+(?:pone|poneme|ponelo|ponela|busca|buscame|buscar|reproduce|reproducir)\s+(.+)$/);
    let namedTitle = beforeNetflix?.[1] || afterNetflix?.[1];
    if (namedTitle) {
        namedTitle = cleanQuery(namedTitle);
        if (/^(?:la tele|television|tv|netflix|abrir|entra)$/i.test(namedTitle)) namedTitle = '';
        const playFirst = /\b(pone|poneme|ponelo|ponela|reproduc\w*|quiero ver)\b/.test(normalized);
        const explicitlyOpensNetflix = /\b(abri|abrir|abre|abra|entra)\b.*\bnetflix\b/.test(normalized);
        if (powerOn || explicitlyOpensNetflix || !sessionContext.netflixReady || !namedTitle) {
            return {
                action: 'netflix',
                title: namedTitle,
                useDefaultSeries: false,
                powerOn,
                playFirst
            };
        }
        return { action: 'search', title: namedTitle, playFirst };
    }

    const searchMatch = normalized.match(/(?:quiero\s+)?(?:busca|buscame|buscar)\s+(.+)$/);
    if (searchMatch) {
        let title = cleanQuery(searchMatch[1]);
        if (/^(?:netflix|la tele|television|tv)$/i.test(title)) title = '';
        const playFirst = /\breprodu\w*\b/.test(normalized);
        if (wantsTelevision || !sessionContext.netflixReady || !title) {
            return { action: 'netflix', title, useDefaultSeries: false, powerOn, playFirst };
        }
        return { action: 'search', title, playFirst };
    }

    const playNamed = normalized.match(/(?:reproduce|reproducir|poneme|pone|ponelo|ponela|continua|quiero ver)\s+(.+)$/);
    if (playNamed) {
        let title = cleanQuery(playNamed[1]);
        if (/^(?:netflix|la tele|la tele y pone netflix|la tele y poneme netflix|television|tv)$/i.test(title)) title = '';
        if (title) {
            if (wantsTelevision || !sessionContext.netflixReady) {
                return { action: 'netflix', title, useDefaultSeries: false, powerOn, playFirst: true };
            }
            return { action: 'search', title, playFirst: true };
        }
    }

    const mentionsNetflix = /\bnetflix\b/.test(normalized);
    const opensNetflix = /(pone|poneme|ponelo|ponela|abri|abrir|abra|abre|prende|prenda|encende|encienda|entra)/.test(normalized);
    if (mentionsNetflix && opensNetflix) {
        return { action: 'netflix', title: '', useDefaultSeries: false, powerOn };
    }

    return null;
}

module.exports = {
    activateSession,
    deactivateSession,
    clearDestinationPrompt,
    rememberIntent,
    getSessionContext,
    isSessionActive,
    switchesAwayFromTv,
    parseTvIntent
};
