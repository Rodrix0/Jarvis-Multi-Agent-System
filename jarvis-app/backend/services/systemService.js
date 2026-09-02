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

    let cleanTrigger = triggerPhrase.toLowerCase().replace(/['".,?!]/g, '').trim();
    let cleanTarget = targetApp.toLowerCase().trim();

    commands[cleanTrigger] = cleanTarget;
    fs.writeFileSync(customCommandsFile, JSON.stringify(commands, null, 2));
}

// --- 1. Scraper Dinámico ---
async function buscarEnYoutube(query) {
    const queryFormateado = encodeURIComponent(query);
    return `https://www.youtube.com/results?search_query=${queryFormateado}`;
}

function mediaSearchUrl(platform, query) {
    const encoded = encodeURIComponent(String(query || '').trim());
    if (platform === 'youtube') return `https://www.youtube.com/results?search_query=${encoded}`;
    if (platform === 'netflix') return `https://www.netflix.com/search?q=${encoded}`;
    throw new Error(`Plataforma de búsqueda no admitida: ${platform}`);
}

function isWebUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function urlLaunchCommand(url, platform = os.platform()) {
    const target = String(url || '').trim();
    if (!isWebUrl(target)) throw new Error('La dirección web no es válida.');
    if (platform === 'win32') return `start "" "${target}"`;
    if (platform === 'darwin') return `open "${target}"`;
    return `xdg-open "${target}"`;
}

function discordLaunchCommand(environment = process.env) {
    const localAppData = environment.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const installations = [
        { folder: 'Discord', executable: 'Discord.exe' },
        { folder: 'DiscordPTB', executable: 'DiscordPTB.exe' },
        { folder: 'DiscordCanary', executable: 'DiscordCanary.exe' }
    ];
    for (const installation of installations) {
        const updater = path.join(localAppData, installation.folder, 'Update.exe');
        if (fs.existsSync(updater)) {
            return `start "" "${updater}" --processStart ${installation.executable}`;
        }
    }
    return 'start discord:';
}

async function openMediaSearch(platform, query) {
    const url = mediaSearchUrl(platform, query);
    return openApp(url);
}

// --- 2. Sistema de Memoria Persistente ---
async function procesarMemoriaDinamica(busqueda, modeId) {
    const archivoMemoria = path.join(__dirname, '..', 'data', 'memoria.json');
    let memoria = {};

    if (!fs.existsSync(path.dirname(archivoMemoria))) {
        fs.mkdirSync(path.dirname(archivoMemoria), { recursive: true });
    }

    if (fs.existsSync(archivoMemoria)) {
        try {
            memoria = JSON.parse(fs.readFileSync(archivoMemoria, 'utf8'));
        } catch (e) {
            console.error("Error leyendo memoria.json:", e);
        }
    }

    const claveMemoria = `${modeId}_${busqueda}`;

    if (memoria[claveMemoria]) {
        console.log(`[Memoria Local]: Recordando link para "${busqueda}". Abriendo...`);
        return memoria[claveMemoria];
    } else {
        console.log(`[Búsqueda Dinámica]: Navegando en internet para aprender "${busqueda}"...`);
        let nuevoLink;

        if (busqueda.includes('chat gpt') || busqueda.includes('chatgpt') || busqueda.includes('en chat') || busqueda.includes('con chat') || busqueda.includes('chat')) {
            let promptBase = busqueda.replace(/chat|chat gpt|chatgpt|en chat|con chat|busca en|buscar|busca|y me busque sobre|y busca sobre|y busca|la palabra|información|informacion/gi, '').trim();
            if (promptBase.length > 2) {
                nuevoLink = `https://chat.openai.com/?q=${encodeURIComponent(promptBase)}`;
            } else {
                nuevoLink = 'https://chat.openai.com';
            }
        } else if (busqueda.includes('gemini')) {
            nuevoLink = 'https://gemini.google.com';
        } else if (modeId === 'estudio' || busqueda.includes('información') || busqueda.includes('informacion') || busqueda.includes('google')) {
            let queryLimpio = busqueda.replace(/información sobre|informacion sobre|información de|informacion de|información|informacion|en google/gi, '').trim();
            if (queryLimpio.length < 3 && modeId === 'estudio') {
                nuevoLink = 'https://chat.openai.com';
            } else {
                nuevoLink = `https://www.google.com/search?q=${encodeURIComponent(queryLimpio)}`;
            }
        } else {
            let queryYoutube = busqueda.replace(/youtube|en youtube|buscar|busca|pon|el canal de|el video de/gi, '').trim();
            nuevoLink = await buscarEnYoutube(queryYoutube);
        }

        memoria[claveMemoria] = nuevoLink;
        fs.writeFileSync(archivoMemoria, JSON.stringify(memoria, null, 2));
        return nuevoLink;
    }
}

// --- 3. Ejecutor Central ---
async function openApp(appName, modeId = 'productividad') {
    const platform = os.platform();
    let command = '';
    let lowerApp = String(appName || '').toLowerCase().trim();
    lowerApp = lowerApp.replace(/^(abrir|abre|abrí|abr[ií]me|iniciar|inici[aá]|arrancar|arranc[aá]|lanza|ejecutar|ejecut[aá]|entrar a|entr[aá] a|entrar|entr[aá]|met[eé]te en|ir a|ve a|buscar|busca|buscar en|pon|pon[eé]|reproduce|abrirme el|abrime el|el|la|los|las|un|una)\s+/gi, '').trim();

    if (isWebUrl(lowerApp)) {
        command = urlLaunchCommand(lowerApp, platform);
    }

    const customLinksFile = path.join(__dirname, '..', 'data', 'custom_links.json');
    let customLinks = {};
    if (fs.existsSync(customLinksFile)) {
        try {
            customLinks = JSON.parse(fs.readFileSync(customLinksFile, 'utf8'));
        } catch (e) { console.error("Error leyendo custom_links.json:", e); }
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

    const websiteMap = { ...defaultWebsiteMap, ...customLinks };

    const pcGamesMap = {
        'steam': 'start steam://',
        'spotify': 'start spotify:',
        'discord': discordLaunchCommand(),
        'epic games': 'start com.epicgames.launcher://',
        'league of legends': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=league_of_legends --launch-patchline=live',
        'lol': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=league_of_legends --launch-patchline=live',
        'valorant': 'start "" "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live',
        'minecraft': 'start minecraft://',
        'visual studio code': 'code || start "" "C:\\Users\\' + (process.env.USERNAME || 'Rodrigo') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"',
        'vs code': 'code || start "" "C:\\Users\\' + (process.env.USERNAME || 'Rodrigo') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"',
        'vscode': 'code || start "" "C:\\Users\\' + (process.env.USERNAME || 'Rodrigo') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"',
        'visual studio': 'code || start "" "C:\\Users\\' + (process.env.USERNAME || 'Rodrigo') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"',
        'word': 'start winword',
        'excel': 'start excel',
        'powerpoint': 'start powerpnt',
        'power point': 'start powerpnt',
        'descargas': 'start "" "' + path.join(os.homedir(), 'Downloads') + '"',
        'escritorio': 'start "" "' + path.join(os.homedir(), 'Desktop') + '"',
        'explorador': 'start explorer',
        'archivos': 'start explorer'
    };

    // A. ¿Es un juego/programa nativo exacto?
    for (const [key, cmd] of Object.entries(pcGamesMap)) {
        if (command) break;
        if (lowerApp === key || lowerApp === `el ${key}`) {
            command = platform === 'win32' ? cmd : `open "${key}"`;
            break;
        } else if (lowerApp.includes(key)) {
            if (key === 'spotify') {
                let query = lowerApp.replace(key, '').replace(/reproduce|pon|busca|buscar|en|cancion|canciones|playlist|de|la|el|los|las/gi, '').trim();
                if (query.length > 0) {
                    const spotifyService = require('./spotifyService');
                    if (spotifyService.isAuthenticated()) {
                        try {
                            const result = await spotifyService.searchAndPlay(query);
                            console.log(`[Spotify API] ${result}`);
                            return true;
                        } catch (e) {
                            console.error('[Spotify API] Error:', e.message);
                            command = platform === 'win32' ? cmd : `open "${key}"`;
                        }
                    } else {
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

    // B. ¿Es una aplicación del núcleo de Windows?
    const localAppsMap = {
        'calculadora': 'calc',
        'calc': 'calc',
        'bloc de notas': 'notepad',
        'notepad': 'notepad',
        'notas': 'notepad',
        'paint': 'mspaint',
        'administrador de tareas': 'taskmgr',
        'cmd': 'start cmd',
        'terminal': 'start cmd',
        'consola': 'start cmd'
    };

    if (!command) {
        for (const [key, cmd] of Object.entries(localAppsMap)) {
            if (lowerApp === key || lowerApp === `el ${key}` || lowerApp.includes(key)) {
                command = platform === 'win32' ? cmd : `open -a "${key}"`;
                break;
            }
        }
    }

    // C. ¿Es una web conocida?
    if (!command) {
        if (lowerApp.includes('chrome') || lowerApp.includes('google chrome')) {
            command = platform === 'win32' ? 'start chrome' : 'open -a "Google Chrome"';
        } else {
            for (const [siteName, url] of Object.entries(websiteMap)) {
                if (lowerApp.includes(siteName) && lowerApp.length <= siteName.length + 8) {
                    command = platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
                    break;
                }
            }
        }
    }

    // D. Búsqueda en aplicaciones indexadas y archivos/carpetas del Escritorio
    if (!command) {
        const discovered = appDiscoveryService.getAppDictionary();
        const ignoreWords = ["el", "la", "los", "las", "un", "una", "del", "de", "carpeta", "archivo", "documento", "programa", "app"];
        
        function normalizeText(text) {
            return String(text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['".,?!\-_]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        const cleanAppQuery = normalizeText(lowerApp);
        const userKeywords = cleanAppQuery.split(/\s+/).filter(w => w.length > 1 && !ignoreWords.includes(w));

        // 1. Buscar en el diccionario indexado
        for (const [key, appPath] of Object.entries(discovered)) {
            const normalizedKey = normalizeText(key);
            let isMatch = false;

            if (normalizedKey === cleanAppQuery) {
                isMatch = true;
            } else if (cleanAppQuery.length >= 3 && (normalizedKey.includes(cleanAppQuery) || cleanAppQuery.includes(normalizedKey))) {
                isMatch = true;
            } else if (userKeywords.length > 0 && userKeywords.every(kw => normalizedKey.includes(kw))) {
                isMatch = true;
            }

            if (isMatch && appPath) {
                console.log(`\n[Jarvis HDD] 🎯 Encontré aplicación/archivo indexado: ${key} -> ${appPath}`);
                command = platform === 'win32' ? `start "" "${appPath}"` : `open "${appPath}"`;
                break;
            }
        }

        // 2. Si todavía no se encontró, escanear directamente el Escritorio en tiempo real
        if (!command && platform === 'win32') {
            const desktopDirs = [path.join(os.homedir(), 'Desktop'), 'C:\\Users\\Public\\Desktop'];
            for (const dDir of desktopDirs) {
                if (command) break;
                if (!fs.existsSync(dDir)) continue;
                try {
                    const files = fs.readdirSync(dDir);
                    for (const file of files) {
                        const baseName = path.parse(file).name;
                        const normFile = normalizeText(baseName);
                        if (normFile === cleanAppQuery || (userKeywords.length > 0 && userKeywords.every(kw => normFile.includes(kw)))) {
                            const fullPath = path.join(dDir, file);
                            console.log(`\n[Jarvis Escritorio] 🎯 Encontré elemento directo en el Escritorio: ${file} -> ${fullPath}`);
                            command = `start "" "${fullPath}"`;
                            break;
                        }
                    }
                } catch (e) {}
            }
        }
    }

    if (!command) {
        if (isWebUrl(lowerApp)) {
            command = urlLaunchCommand(lowerApp, platform);
        } else {
            console.warn(`[Jarvis] No encontré una aplicación o archivo seguro para: ${lowerApp}`);
            return false;
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

    if (text.length > 300 || lowerText.includes("quiero que programes") || lowerText.includes("programá esto") || lowerText.includes("codeame")) {
        return { isSystemCommand: false, isTraining: false };
    }

    // 1. Detectar intención de entrenamiento
    const trainMatch = cleanText.match(/(?:cuando|si) te (?:diga|digo) (.+?) (?:quiero que|abre|abrir|ejecuta|ejecutes|ve a|vayas a|pongas) (.+)/i);
    if (trainMatch) {
        let trigger = trainMatch[1].trim();
        let app = trainMatch[2].trim();
        trigger = trigger.replace(/^jarvis /i, '');
        return { isTraining: true, trigger: trigger, appName: app };
    }

    // 2. Extracción estándar de comandos del sistema
    const match = lowerText.match(/(?:abre|abrir|abri|abrí|abrime|abríme|abrirme|inicia|iniciar|inici[aá]|arranca|arrancar|lanza|ejecuta|ejecutar|ir a|ve a|pon|ponme)\s+(.+)/i);

    if (match) {
        let appToOpen = match[1].trim();
        if (appToOpen.endsWith('.')) {
            appToOpen = appToOpen.slice(0, -1);
        }

        const isNotApp = !/^(netflix|spotify|youtube|chrome|discord|steam|whatsapp|telegram|word|excel|powerpoint|visual studio|code|vscode|obs|lol|league|valorant|fortnite|epic games|stremio)/i.test(appToOpen);
        
        if (isNotApp && (lowerText.includes('quiero ver') || lowerText.includes('poneme') || lowerText.includes('reproduce'))) {
            return { isSystemCommand: false, isTraining: false };
        }

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
    isWebUrl,
    urlLaunchCommand,
    openMediaSearch,
    mediaSearchUrl,
    discordLaunchCommand,
    handleSystemCommand,
    saveCustomCommand
};
