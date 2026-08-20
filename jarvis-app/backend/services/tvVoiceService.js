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
    if (/^(?:jarvis\s+)?(?:abri|abre|abra|pone|poneme)\s+netflix$/.test(normalized)) {
        awaitingDestinationUntil = Date.now() + 20000;
        return { action: 'choose_device' };
    }
    if (/^(?:jarvis\s+)?netflix$/.test(normalized)) {
        if (isSessionActive()) {
            return { action: 'netflix', title: '', useDefaultSeries: false, powerOn: false };
        }
        awaitingDestinationUntil = Date.now() + 20000;
        return { action: 'choose_device' };
    }

    if (switchesAwayFromTv(normalized)) {
        deactivateSession();
        return null;
    }

    const mentionsTv = /\b(netflix|tele|television|tv|mi lista|mi serie|mi contenido|continuar viendo|continua viendo|segui viendo|serie que estoy viendo)\b/.test(normalized);
    const inTvContext = mentionsTv || isSessionActive();
    if (!inTvContext) return null;

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

    const powerOn = /(prende|prenda|prender|encende|encienda|encender).*(tele|television|tv)/.test(normalized);
    if (/(?:continua|segui|sigue|siga|reproduce|pone|poneme).*(?:mi contenido|mi serie|continuar viendo|viendo|lo que estaba viendo)/.test(normalized)) {
        return { action: 'continue_watching', powerOn };
    }

    const explicitNamedSeries = normalized.match(/(?:serie\s+que\s+estoy\s+viendo|mi\s+lista).*?\bque\s+es\s+(.+?)(?:\s+y\s+reprodu\w*)?$/);
    if (explicitNamedSeries) {
        const title = cleanQuery(explicitNamedSeries[1]);
        const playFirst = /\breprodu\w*\b/.test(normalized);
        if (!sessionContext.netflixReady) {
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
    const namedTitle = beforeNetflix?.[1] || afterNetflix?.[1];
    if (namedTitle) {
        const playFirst = /\b(pone|poneme|ponelo|ponela|reproduc\w*|quiero ver)\b/.test(normalized);
        const explicitlyOpensNetflix = /\b(abri|abrir|abre|abra|entra)\b.*\bnetflix\b/.test(normalized);
        if (powerOn || explicitlyOpensNetflix || !sessionContext.netflixReady) {
            return {
                action: 'netflix',
                title: cleanQuery(namedTitle),
                useDefaultSeries: false,
                powerOn,
                playFirst
            };
        }
        return { action: 'search', title: cleanQuery(namedTitle), playFirst };
    }

    const searchMatch = normalized.match(/(?:quiero\s+)?(?:busca|buscame|buscar)\s+(.+)$/);
    if (searchMatch) {
        const title = cleanQuery(searchMatch[1]);
        const playFirst = /\breprodu\w*\b/.test(normalized);
        if (wantsTelevision || !sessionContext.netflixReady) {
            return { action: 'netflix', title, useDefaultSeries: false, powerOn, playFirst };
        }
        return { action: 'search', title, playFirst };
    }

    const playNamed = normalized.match(/(?:reproduce|reproducir|poneme|pone|ponelo|ponela|continua|quiero ver)\s+(.+)$/);
    if (playNamed && !/^netflix$/.test(playNamed[1])) {
        const title = cleanQuery(playNamed[1]);
        if (wantsTelevision || !sessionContext.netflixReady) {
            return { action: 'netflix', title, useDefaultSeries: false, powerOn, playFirst: true };
        }
        return { action: 'search', title, playFirst: true };
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
