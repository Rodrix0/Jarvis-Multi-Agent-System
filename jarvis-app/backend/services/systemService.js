const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const appDiscoveryService = require('./appDiscoveryService');

// --- 0. Sistema de Comandos de Entrenamiento ---
const customCommandsFile = path.join(__dirname, '..', 'data', 'comandos.json');

function saveCustomCommand(triggerPhrase, targetApp) {
    let commands = {};
    if (!fs.existsSync(path.dirname(customCommandsFile))) {
        fs.mkdirSync(path.dirname(customCommandsFile), { recursive: true });
    }
    if (fs.existsSync(customCommandsFile)) {
        try {
            commands = JSON.parse(fs.readFileSync(customCommandsFile, 'utf8'));
        } catch (e) { console.error("Error leyendo comandos.json:", e); }
    }

    // Limpiar puntuación del trigger para coincidencias más fáciles
    let cleanTrigger = triggerPhrase.toLowerCase().replace(/['".,?!]/g, '').trim();
    let cleanTarget = targetApp.toLowerCase().trim();

    commands[cleanTrigger] = cleanTarget;
    fs.writeFileSync(customCommandsFile, JSON.stringify(commands, null, 2));
}


// --- 1. Scraper Dinámico ---
async function buscarEnYoutube(query) {
    const queryFormateado = encodeURIComponent(query);
    const urlBusqueda = `https://www.youtube.com/results?search_query=${queryFormateado}`;

    try {
        const respuesta = await fetch(urlBusqueda);
        // Simplemente devolvemos la URL de búsqueda en vez de forzar a abrir el primer video
        return urlBusqueda;
    } catch (error) {
        console.error("Falló la búsqueda:", error);
    }
    return "https://www.youtube.com"; // Fallback general
}

// --- 2. Sistema de Memoria Persistente ---
async function procesarMemoriaDinamica(busqueda, modeId) {
    const archivoMemoria = path.join(__dirname, '..', 'data', 'memoria.json');
    let memoria = {};

    // Nos aseguramos de que el sistema de memoria exista
    if (!fs.existsSync(path.dirname(archivoMemoria))) {
        fs.mkdirSync(path.dirname(archivoMemoria), { recursive: true });
    }

    // Leemos la memoria si el archivo ya existe
    if (fs.existsSync(archivoMemoria)) {
        try {
            memoria = JSON.parse(fs.readFileSync(archivoMemoria, 'utf8'));
        } catch (e) {
            console.error("Error leyendo memoria.json:", e);
        }
    }

    // Revisamos si ya conocemos la búsqueda y NO interfiere con el contexto
    // Para evitar que "chat gpt" guardado abra youtube si antes falló, usamos claves con prefijo de modo
    const claveMemoria = `${modeId}_${busqueda}`;

    if (memoria[claveMemoria]) {
        console.log(`[Memoria Local]: Recordando link para "${busqueda}". Abriendo...`);
        return memoria[claveMemoria];
    } else {
        console.log(`[Búsqueda Dinámica]: Navegando en internet para aprender "${busqueda}"...`);

        let nuevoLink;

        // Enrutador inteligente avanzado (con consciencia de MODO):
        // 1. Si pide ChatGPT o Gemini EXPLÍCITAMENTE
        if (busqueda.includes('chat gpt') || busqueda.includes('chatgpt') || busqueda.includes('en chat') || busqueda.includes('con chat') || busqueda.includes('chat')) {
            let promptBase = busqueda.replace(/chat|chat gpt|chatgpt|en chat|con chat|busca en|buscar|busca|y me busque sobre|y busca sobre|y busca|la palabra|información|informacion/gi, '').trim();
            if (promptBase.length > 2) {
                nuevoLink = `https://chat.openai.com/?q=${encodeURIComponent(promptBase)}`;
            } else {
                nuevoLink = 'https://chat.openai.com';
            }
        } else if (busqueda.includes('gemini')) {
            nuevoLink = 'https://gemini.google.com';
        }
        // 2. Si estamos en modo ESTUDIO o pide INFORMACION
        else if (modeId === 'estudio' || busqueda.includes('información') || busqueda.includes('informacion') || busqueda.includes('google')) {
            let queryLimpio = busqueda
                .replace(/información sobre|informacion sobre|información de|informacion de|información|informacion|en google/gi, '')
                .trim();

            // Si el query quedó super corto y estamos en estudio, los mandamos a ChatGPT por defecto
            if (queryLimpio.length < 3 && modeId === 'estudio') {
                nuevoLink = 'https://chat.openai.com';
            } else {
                nuevoLink = `https://www.google.com/search?q=${encodeURIComponent(queryLimpio)}`;
            }
        }
        // 3. Default: Youtube, limpiando la palabra clave previamente (Ideal para modo productividad o juego)
        else {
            let queryYoutube = busqueda
                .replace(/youtube|en youtube|buscar|busca|pon|el canal de|el video de/gi, '')
                .trim();
            nuevoLink = await buscarEnYoutube(queryYoutube);
        }

        // Lo guardamos en el JSON para no tener que buscarlo nunca más
        memoria[claveMemoria] = nuevoLink;
        fs.writeFileSync(archivoMemoria, JSON.stringify(memoria, null, 2));

        return nuevoLink;
    }
}

// --- 3. Ejecutor Central ---
async function openApp(appName, modeId = 'productividad') {
    const platform = os.platform();
    let command = '';
    // Limpieza mega estricta para quitar variaciones que el cerebro haya dejado pasar
    let lowerApp = appName.toLowerCase().trim();
    lowerApp = lowerApp.replace(/^(abrir|abre|abrí|abr[ií]me|iniciar|inici[aá]|arrancar|arranc[aá]|lanza|ejecutar|ejecut[aá]|entrar a|entr[aá] a|entrar|entr[aá]|met[eé]te en|ir a|ve a|buscar|busca|buscar en|pon|pon[eé]|reproduce|abrirme el|abrime el|el|la|los|las|un|una)\s+/gi, '').trim();

    // 1. Cargar links personalizados (ignorado en Git por estar en /data/)
    const customLinksFile = path.join(__dirname, '..', 'data', 'custom_links.json');
    let customLinks = {};
    if (fs.existsSync(customLinksFile)) {
        try {
            customLinks = JSON.parse(fs.readFileSync(customLinksFile, 'utf8'));
        } catch (e) {
            console.error("Error leyendo custom_links.json:", e);
        }
    }

    const defaultWebsiteMap = {
        'youtube': 'https://www.youtube.com',
        'google': 'https://www.google.com',
        'netflix': 'https://www.netflix.com',
        'crunchy': 'https://www.crunchyroll.com',
        'crunchyroll': 'https://www.crunchyroll.com',
        'chat gpt': 'https://chat.openai.com',
        'chatgpt': 'https://chat.openai.com',
        'chat': 'https://chat.openai.com',
        'gemini': 'https://gemini.google.com',
        'whatsapp': 'https://web.whatsapp.com',
        'whatsapp web': 'https://web.whatsapp.com',
        'gmail': 'https://mail.google.com',
        'correo': 'https://mail.google.com',
        'hotmail': 'https://outlook.live.com',
        'outlook': 'https://outlook.live.com',
        'facebook': 'https://www.facebook.com',
        'instagram': 'https://www.instagram.com',
        'twitter': 'https://twitter.com',
        'twitch': 'https://www.twitch.tv',
        'github': 'https://github.com'
    };

    // Combinar los links por defecto con los personalizados del usuario
    const websiteMap = { ...defaultWebsiteMap, ...customLinks };

    const pcGamesMap = {
        'steam': 'start steam://',
        'spotify': 'start spotify:',
        'discord': 'start discord:',
        'epic games': 'start com.epicgames.launcher://',
        'league of legends': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=league_of_legends --launch-patchline=live',
        'lol': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=league_of_legends --launch-patchline=live',
        'valorant': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live',
        'minecraft': 'start minecraft://'
    };

    // A. ¿Es un juego/programa nativo exacto?
    for (const [key, cmd] of Object.entries(pcGamesMap)) {
        if (lowerApp === key || lowerApp === `el ${key}`) {
            command = platform === 'win32' ? cmd : `open "${key}"`;
            break;
        } else if (lowerApp.includes(key)) {
            if (key === 'spotify') {
                let query = lowerApp.replace(key, '').replace(/reproduce|pon|busca|buscar|en|cancion|canciones|playlist|de|la|el|los|las/gi, '').trim();
                if (query.length > 0) {
                    // Usar Spotify Web API si está autenticado
                    const spotifyService = require('./spotifyService');
                    if (spotifyService.isAuthenticated()) {
                        try {
                            const result = await spotifyService.searchAndPlay(query);
                            console.log(`[Spotify API] ${result}`);
                            return true;
                        } catch (e) {
                            console.error('[Spotify API] Error:', e.message);
                            // Fallback: abrir Spotify normalmente
                            command = platform === 'win32' ? cmd : `open "${key}"`;
                        }
                    } else {
                        console.log('[Spotify] No autenticado. Abriendo app normalmente. Usa http://localhost:3000/api/spotify/login para conectar.');
                        command = platform === 'win32' ? cmd : `open "${key}"`;
                    }
                } else {
                    command = platform === 'win32' ? cmd : `open "${key}"`;
                }
            } else {
                command = platform === 'win32' ? cmd : `open "${key}"`;
            }
            break;
        }
    }

    // B. ¿Es una aplicación del núcleo de Windows puro? (Garantizadas globalmente)
    const localAppsMap = {
        'calculadora': 'calc',
        'calc': 'calc',
        'bloc de notas': 'notepad',
        'notepad': 'notepad',
        'paint': 'mspaint',
        'administrador de tareas': 'taskmgr'
    };

    if (!command) {
        for (const [key, cmd] of Object.entries(localAppsMap)) {
            if (lowerApp === key || lowerApp === `el ${key}` || lowerApp.includes(key)) {
                command = platform === 'win32' ? cmd : `open -a "${key}"`;
                break;
            }
        }
    }

    if (!command) {
        if (lowerApp.includes('chrome') || lowerApp.includes('google chrome')) {
            command = platform === 'win32' ? 'start chrome' : 'open -a "Google Chrome"';
            // Casos web exactos
        } else {
            for (const [siteName, url] of Object.entries(websiteMap)) {
                // Si la orden contiene la palabra, PERO el usuario no está pidiendo buscar un video o info extra (es corta)
                if (lowerApp.includes(siteName) && lowerApp.length <= siteName.length + 5) {
                    command = platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
                    break;
                }
            }
        }
    }

    if (!command) {
        const discovered = appDiscoveryService.getAppDictionary();
        // Palabras a ignorar al buscar
        const ignoreWords = ["el", "la", "los", "las", "un", "una", "del", "de", "pdf", "carpeta", "archivo", "documento", "foto", "imagen"];
        
        function normalizeText(text) {
            return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['".,?!\-]/g, ' ');
        }

        const userKeywords = normalizeText(lowerApp).split(/\s+/).filter(w => w.length > 1 && !ignoreWords.includes(w));

        for (const [key, appPath] of Object.entries(discovered)) {
            const normalizedKey = normalizeText(key);
            
            // Chequeo 1: Substring directo
            const cleanKey = key.replace(/['".,?!\-]/g, '').replace(/\s+/g, '').trim();
            const cleanUserQuery = lowerApp.replace(/['".,?!\-]/g, '').replace(/\s+/g, '').trim();
            let isMatch = false;

            if (cleanKey.includes(cleanUserQuery) || cleanUserQuery.includes(cleanKey) || cleanKey === cleanUserQuery) {
                isMatch = true;
            } else if (userKeywords.length > 0) {
                // Chequeo 2: ¿Todas las palabras clave del usuario están en el nombre del archivo?
                const allWordsMatch = userKeywords.every(kw => normalizedKey.includes(kw));
                if (allWordsMatch) isMatch = true;
            }

            if (isMatch) {
                if (appPath.startsWith("http")) {
                    command = platform === 'win32' ? `start "" "${appPath}"` : `open "${appPath}"`;
                } else {
                    command = platform === 'win32' ? `start "" "${appPath}"` : `open "${appPath}"`;
                }
                console.log(`\n[Jarvis HDD] 🎯 Encontré un programa/archivo en tu disco duro que coincide: ${key}\nLanzando: ${appPath}`);
                break;
            }
        }
    }

    // C. El núcleo: Si es una frase desconocida ("el canal de goncho") lo enviamos a memoria
    // A menos que sea una URL cruda aprendida
    if (!command) {
        if (lowerApp.startsWith("http")) {
            command = platform === 'win32' ? `start "" "${lowerApp}"` : platform === 'darwin' ? `open "${lowerApp}"` : `xdg-open "${lowerApp}"`;
        } else {
            const urlObtenida = await procesarMemoriaDinamica(lowerApp, modeId);
            command = platform === 'win32' ? `start "" "${urlObtenida}"` : platform === 'darwin' ? `open "${urlObtenida}"` : `xdg-open "${urlObtenida}"`;
        }
    }

    // Ejecutar orden en el Sistema Operativo
    return new Promise((resolve) => {
        exec(command, (error) => {
            if (error) {
                console.error(`Error al abrir app: ${error.message}`);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function handleSystemCommand(text) {
    let lowerText = text.toLowerCase().trim();
    let cleanText = lowerText.replace(/['".,?!]/g, '').trim();

    // --- BYPASS DE PROGRAMADOR ---
    // Si la frase es larguísima o detectamos explícitamente intención de código,
    // abortamos el escaneo de apps para no abrir "Node.js" por accidente.
    if (text.length > 300 || lowerText.includes("quiero que programes") || lowerText.includes("programá esto") || lowerText.includes("codeame")) {
        return { isSystemCommand: false, isTraining: false };
    }

    // 1. Detectar INTENCIÓN DE ENTRENAMIENTO
    // Ej: "cuando te diga hora de pelis quiero que abras netflix"
    const trainMatch = cleanText.match(/(?:cuando|si) te (?:diga|digo) (.+?) (?:quiero que|abre|abrir|ejecuta|ejecutes|ve a|vayas a|pongas) (.+)/i);
    if (trainMatch) {
        let trigger = trainMatch[1].trim();
        let app = trainMatch[2].trim();
        trigger = trigger.replace(/^jarvis /i, '');
        return { isTraining: true, trigger: trigger, appName: app };
    }

    // 3. Extracción estándar de comandos del sistema
    // NOTA: 'quiero ver', 'reproduce', 'busca' fueron REMOVIDOS de aquí
    // para que las solicitudes de películas/series lleguen al LLM y use search_streaming.
    const match = lowerText.match(/(?:abre|abrir|abri|abrí|abrime|abríme|abrirme|inicia|iniciar|inici[aá]|arranca|arrancar|lanza|ejecuta|ejecutar|ir a|ve a|pon|ponme)\s+(.+)/i);

    if (match) {
        let appToOpen = match[1].trim();
        if (appToOpen.endsWith('.')) {
            appToOpen = appToOpen.slice(0, -1);
        }

        // BYPASS STREAMING: Si lo que capturó parece una película/serie, dejamos que la IA lo maneje
        const streamingKeywords = /^(la |el |los |las |una? )?(pelicula|serie|anime|documental|capitulo|temporada|episodio)/i;
        const isNotApp = !/^(netflix|spotify|youtube|chrome|discord|steam|whatsapp|telegram|word|excel|powerpoint|visual studio|code|vscode|obs|lol|league|valorant|fortnite|epic games|stremio)/i.test(appToOpen);
        
        // Si NO es una app conocida y la frase original contiene "ver" o "poner", es streaming
        if (isNotApp && (lowerText.includes('quiero ver') || lowerText.includes('poneme') || lowerText.includes('reproduce'))) {
            return { isSystemCommand: false, isTraining: false };
        }

        // 2. Detectar si la orden concreta es un COMANDO YA ENTRENADO por la red neuronal
        if (fs.existsSync(customCommandsFile)) {
            try {
                const commands = JSON.parse(fs.readFileSync(customCommandsFile, 'utf8'));
                if (commands[appToOpen]) {
                    return { isSystemCommand: true, appName: commands[appToOpen], isLearned: true };
                }
            } catch (e) { console.error("Error leyendo cmds:", e); }
        }

        return { isSystemCommand: true, appName: appToOpen, isLearned: false };
    }

    // Comprobación secundaria: Por si dijo directo un comando entrenado y sin el verbo "Abre"
    if (fs.existsSync(customCommandsFile)) {
        try {
            const commands = JSON.parse(fs.readFileSync(customCommandsFile, 'utf8'));
            if (commands[cleanText]) {
                return { isSystemCommand: true, appName: commands[cleanText], isLearned: true };
            }
        } catch (e) { }
    }

    return { isSystemCommand: false, isTraining: false };
}


// --- 4. Python Router Handler ---
async function handlePythonRouterDecision(decisionJson) {
    if (decisionJson.action === 'reply') {
        const sourceTxt = decisionJson.source ? ' (Fuente: ' + decisionJson.source + ')' : '';
        return decisionJson.message + sourceTxt;
    } 
    else if (decisionJson.action === 'open_app') {
        console.log('Ejecutando: ' + decisionJson.target);
        exec('start "" "' + decisionJson.target + '"');
        return 'Ejecutando: ' + decisionJson.target;
    }
    else if (decisionJson.action === 'search_google') {
        const query = encodeURIComponent(decisionJson.target);
        exec('start "" "https://www.google.com/search?q=' + query + '"');
        return 'Buscando en Google: ' + decisionJson.target;
    }
    return "Comando desconocido";
}

module.exports = {
    handlePythonRouterDecision,
    openApp,
    handleSystemCommand,
    saveCustomCommand
};
