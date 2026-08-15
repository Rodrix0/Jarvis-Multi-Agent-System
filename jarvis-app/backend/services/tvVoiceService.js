const SESSION_MS = 30 * 60 * 1000;

let activeUntil = 0;
let awaitingDestinationUntil = 0;

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!,.;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function activateSession() {
    activeUntil = Date.now() + SESSION_MS;
}

function deactivateSession() {
    activeUntil = 0;
}

function isSessionActive() {
    return Date.now() < activeUntil;
}

function clearDestinationPrompt() {
    awaitingDestinationUntil = 0;
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

    if (/(configura|prepara|vincula).*(control|broadlink).*(tele|tv)|configura.*(tele|tv)/.test(normalized)) {
        return { action: 'setup' };
    }
    if (/(cancela|detene|para).*(tele|netflix)/.test(normalized)) {
        return { action: 'cancel' };
    }

    const wantsComputer = /\b(compu|computadora|pc|navegador)\b/.test(normalized);
    const wantsTelevision = /\b(tele|television|tv)\b/.test(normalized);
    if (Date.now() < awaitingDestinationUntil && wantsComputer && !/\bnetflix\b/.test(normalized)) {
        awaitingDestinationUntil = 0;
        return { action: 'open_pc' };
    }
    if (Date.now() < awaitingDestinationUntil && wantsTelevision && !/\bnetflix\b/.test(normalized)) {
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

    const mentionsTv = /\b(netflix|tele|television|tv|mi lista|mi serie|mi contenido|continuar viendo|continua viendo|segui viendo|serie que estoy viendo)\b/.test(normalized);
    const inTvContext = mentionsTv || isSessionActive();
    if (!inTvContext) return null;

    if (/\b(reproduce|reproduci|pone|poneme|selecciona|elegi|entra)(?:\s+(?:eso|esa|ese|esto|esta|seleccionado|seleccionada|ahi))?\s*$/.test(normalized)) {
        return { action: 'navigate', button: 'ok', count: 1, label: 'reproducir lo seleccionado' };
    }
    if (/\b(pausa|pausa eso|play)\b/.test(normalized)) {
        return { action: 'navigate', button: 'ok', count: 1, label: 'aceptar' };
    }
    if (/\b(atras|volve|volver|regresa)\b/.test(normalized)) {
        return { action: 'navigate', button: 'back', count: movementCount(normalized), label: 'volver' };
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
        return {
            action: 'search',
            title: cleanQuery(explicitNamedSeries[1]),
            playFirst: /\breprodu\w*\b/.test(normalized)
        };
    }

    const beforeNetflix = normalized.match(/(?:pone|poneme|busca|buscame|reproduce|quiero ver)\s+(.+?)\s+en\s+netflix/);
    const afterNetflix = normalized.match(/netflix(?:\s+y)?\s+(?:pone|poneme|busca|buscame|reproduce)\s+(.+)$/);
    const namedTitle = beforeNetflix?.[1] || afterNetflix?.[1];
    if (namedTitle) {
        const playFirst = /\b(pone|poneme|reproduce|quiero ver)\b/.test(normalized);
        if (powerOn) {
            return { action: 'netflix', title: cleanQuery(namedTitle), useDefaultSeries: false, powerOn: true };
        }
        return { action: 'search', title: cleanQuery(namedTitle), playFirst };
    }

    const searchMatch = normalized.match(/(?:quiero\s+)?(?:busca|buscame|buscar)\s+(.+)$/);
    if (searchMatch) {
        return { action: 'search', title: cleanQuery(searchMatch[1]), playFirst: /\breprodu\w*\b/.test(normalized) };
    }

    const playNamed = normalized.match(/(?:reproduce|poneme|pone|continua)\s+(.+)$/);
    if (playNamed && !/^netflix$/.test(playNamed[1])) {
        return { action: 'search', title: cleanQuery(playNamed[1]), playFirst: true };
    }

    const mentionsNetflix = /\bnetflix\b/.test(normalized);
    const opensNetflix = /(pone|poneme|abri|abra|abre|prende|prenda|encende|encienda|entra)/.test(normalized);
    if (mentionsNetflix && opensNetflix) {
        return { action: 'netflix', title: '', useDefaultSeries: false, powerOn };
    }

    return null;
}

module.exports = {
    activateSession,
    deactivateSession,
    clearDestinationPrompt,
    isSessionActive,
    parseTvIntent
};
