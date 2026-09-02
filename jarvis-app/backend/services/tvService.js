const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'broadlink.json');
const BRIDGE_PATH = path.join(__dirname, '..', '..', 'python_engine', 'broadlink_remote.py');
const VENV_PYTHON = path.join(__dirname, '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
const ALLOWED_BUTTONS = ['power', 'up', 'down', 'left', 'right', 'ok', 'back', 'netflix'];
const KEYBOARD_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];

const DEFAULT_CONFIG = {
    device: {},
    codes: {},
    netflix: {
        bootWaitMs: 45000,
        appWaitMs: 12000,
        profileLoadMs: 8000,
        searchLoadMs: 2200,
        resultLoadMs: 3000,
        keyDelayMs: 350,
        keyboardKeyDelayMs: 1100,
        profileDownPresses: 0,
        continueWatchingDownPresses: 1,
        continueWatchingRightPresses: 0,
        pressNetflixAfterBoot: false,
        pressPlayAfterResult: true
    }
};

let currentJob = null;
let activeBridgeProcess = null;
let availabilityCache = { value: false, checkedAt: 0 };

function getConfig() {
    let saved = {};
    try {
        if (fs.existsSync(CONFIG_PATH)) saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        console.error('[TV] Configuración inválida:', error.message);
    }
    return {
        ...DEFAULT_CONFIG,
        ...saved,
        device: { ...DEFAULT_CONFIG.device, ...(saved.device || {}) },
        codes: { ...DEFAULT_CONFIG.codes, ...(saved.codes || {}) },
        netflix: { ...DEFAULT_CONFIG.netflix, ...(saved.netflix || {}) }
    };
}

function saveSettings(settings = {}) {
    const config = getConfig();
    const boundedNumber = (value, fallback, min, max) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };
    if (settings.deviceHost !== undefined) {
        const host = String(settings.deviceHost).trim();
        const parts = host.split('.').map(Number);
        if (host && (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))) {
            throw new Error('La IP del BroadLink no es válida. Ejemplo: 192.168.1.50');
        }
        if (host) config.device = { ...config.device, host };
    }
    config.netflix = {
        ...config.netflix,
        bootWaitMs: boundedNumber(settings.bootWaitMs, config.netflix.bootWaitMs, 1000, 120000),
        appWaitMs: boundedNumber(settings.appWaitMs, config.netflix.appWaitMs, 1000, 60000),
        profileLoadMs: boundedNumber(settings.profileLoadMs, config.netflix.profileLoadMs, 1000, 30000),
        searchLoadMs: boundedNumber(settings.searchLoadMs, config.netflix.searchLoadMs, 500, 15000),
        resultLoadMs: boundedNumber(settings.resultLoadMs, config.netflix.resultLoadMs, 500, 15000),
        keyDelayMs: boundedNumber(settings.keyDelayMs, config.netflix.keyDelayMs, 100, 1500),
        keyboardKeyDelayMs: boundedNumber(settings.keyboardKeyDelayMs, config.netflix.keyboardKeyDelayMs, 300, 2000),
        profileDownPresses: boundedNumber(settings.profileDownPresses, config.netflix.profileDownPresses, 0, 10),
        continueWatchingDownPresses: boundedNumber(settings.continueWatchingDownPresses, config.netflix.continueWatchingDownPresses, 0, 10),
        continueWatchingRightPresses: boundedNumber(settings.continueWatchingRightPresses, config.netflix.continueWatchingRightPresses, 0, 10),
        pressNetflixAfterBoot: settings.pressNetflixAfterBoot === true,
        pressPlayAfterResult: settings.pressPlayAfterResult !== false
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return getPublicStatus();
}

function getPublicStatus() {
    const config = getConfig();
    return {
        configured: Boolean(config.device.host),
        device: config.device,
        learnedButtons: Object.keys(config.codes).sort(),
        netflix: config.netflix,
        busy: Boolean(currentJob)
    };
}

function runBridge(args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const pythonExe = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';
        const child = spawn(pythonExe, [BRIDGE_PATH, ...args], { windowsHide: true });
        activeBridgeProcess = child;
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('El BroadLink no respondió dentro del tiempo esperado.'));
        }, timeoutMs);

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', error => {
            clearTimeout(timer);
            activeBridgeProcess = null;
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            activeBridgeProcess = null;
            const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
            let payload = null;
            try { payload = JSON.parse(lines.at(-1) || '{}'); } catch (error) {}
            if (code === 0 && payload?.ok) return resolve(payload);
            reject(new Error(payload?.error || stderr.trim() || 'Falló el puente BroadLink.'));
        });
    });
}

async function discover() {
    const result = await runBridge(['discover', '--timeout', '8'], 15000);
    if (!result.devices?.length) {
        throw new Error('No encontré un BroadLink. Verificá que esté en la misma red Wi-Fi y desbloqueado para control local.');
    }
    if (result.devices[0].authenticated === false) {
        throw new Error(`Encontré el BroadLink en ${result.devices[0].host}, pero está bloqueado. Desactivá “Lock device/Bloquear dispositivo” en la app BroadLink y buscá otra vez.`);
    }
    return getPublicStatus();
}

async function isAvailable() {
    const config = getConfig();
    if (!config.device.host) return false;
    if (Date.now() - availabilityCache.checkedAt < 4000) return availabilityCache.value;
    try {
        const result = await runBridge(['check'], 3000);
        availabilityCache = { value: result.available === true, checkedAt: Date.now() };
        return availabilityCache.value;
    } catch (error) {
        availabilityCache = { value: false, checkedAt: Date.now() };
        return false;
    }
}

async function learnButton(button) {
    if (!ALLOWED_BUTTONS.includes(button)) throw new Error('Botón IR no permitido.');
    await runBridge(['learn', button, '--timeout', '20'], 28000);
    return getPublicStatus();
}

async function sendButtons(buttons, delayMs) {
    if (!buttons.length) return;
    const invalid = buttons.filter(button => !ALLOWED_BUTTONS.includes(button));
    if (invalid.length) throw new Error(`Secuencia IR inválida: ${invalid.join(', ')}`);
    await runBridge(
        ['send-sequence', JSON.stringify(buttons), '--delay-ms', String(delayMs)],
        Math.max(15000, buttons.length * (delayMs + 300) + 10000)
    );
}

function repeat(button, count) {
    return Array.from({ length: Math.max(0, count) }, () => button);
}

function normalizeSearchTitle(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function keyboardPosition(character) {
    for (let row = 0; row < KEYBOARD_ROWS.length; row++) {
        const column = KEYBOARD_ROWS[row].indexOf(character);
        if (column !== -1) return { row, column };
    }
    return null;
}

function buildNetflixSearchSequence(title, selectFirstResult = true) {
    const normalizedTitle = normalizeSearchTitle(title);
    if (!normalizedTitle) throw new Error('El título no contiene caracteres compatibles con el teclado de Netflix.');

    const sequence = [];

    // RESET: Forzar cursor a posición 'a' (0,0) mandando suficientes up y left
    // Esto garantiza que partimos de una posición conocida sin importar dónde
    // esté el cursor al abrir el buscador.
    for (let i = 0; i < 6; i++) sequence.push('up');
    for (let i = 0; i < 6; i++) sequence.push('left');

    let cursor = { row: 0, column: 0 };
    for (const character of normalizedTitle) {
        const target = keyboardPosition(character);
        if (!target) continue;
        // Navegar al caracter
        sequence.push(...repeat(target.row > cursor.row ? 'down' : 'up', Math.abs(target.row - cursor.row)));
        sequence.push(...repeat(target.column > cursor.column ? 'right' : 'left', Math.abs(target.column - cursor.column)));
        // Presionar OK para seleccionar la letra
        sequence.push('ok');
        // Pausa extra: insertar un 'ok' dummy que luego filtramos, 
        // o mejor, usamos un marcador. En su lugar, simplemente dejamos
        // que el delay natural entre botones haga su trabajo.
        cursor = target;
    }

    // Subir a la primera fila y cruzar al panel de resultados
    sequence.push(...repeat('up', cursor.row));
    sequence.push(...repeat('right', KEYBOARD_ROWS[0].length - cursor.column));
    if (selectFirstResult) sequence.push('ok');
    return sequence;
}

function sleep(ms, job) {
    return new Promise((resolve, reject) => {
        const finish = () => {
            job.cancelWait = null;
            if (job.cancelled) reject(new Error('Automatización cancelada.'));
            else resolve();
        };
        const timer = setTimeout(finish, ms);
        job.cancelWait = () => {
            clearTimeout(timer);
            job.cancelWait = null;
            reject(new Error('Automatización cancelada.'));
        };
        timer.unref?.();
    });
}

function assertConfigured(config, { powerOn, needsSearch }) {
    if (!config.device.host) throw new Error('Primero descubrí el BroadLink desde Configurar TV.');
    const required = ['ok'];
    if (powerOn) required.push('power');
    if (needsSearch) required.push('up', 'down', 'left', 'right');
    if (config.netflix.pressNetflixAfterBoot) required.push('netflix');
    const missing = [...new Set(required)].filter(button => !config.codes[button]);
    if (missing.length) throw new Error(`Enseñale estas teclas al BroadLink: ${missing.join(', ')}.`);
}

async function playNetflix(options = {}, onProgress = () => {}) {
    if (currentJob) throw new Error('Ya hay una automatización de TV en curso.');
    const config = getConfig();
    // POWER es una tecla de alternancia: un valor ausente jamás debe enviarla.
    // Solo una orden explícita de encendido puede establecer exactamente `true`.
    const powerOn = options.powerOn === true;
    const selectProfile = options.selectProfile ?? (powerOn || config.netflix.pressNetflixAfterBoot);
    let title = String(options.title || '').trim();
    assertConfigured(config, { powerOn, needsSearch: Boolean(title) });

    const job = { cancelled: false };
    currentJob = job;
    const progress = (stage, message) => onProgress({ stage, message });
    try {
        if (powerOn) {
            progress('power', 'Encendiendo la televisión…');
            await sendButtons(['power'], config.netflix.keyDelayMs);
            progress('boot', `Esperando ${Math.round(config.netflix.bootWaitMs / 1000)} segundos a que inicie la TV…`);
            await sleep(config.netflix.bootWaitMs, job);
        }

        if (config.netflix.pressNetflixAfterBoot) {
            progress('netflix', 'Abriendo Netflix…');
            await sendButtons(['netflix'], config.netflix.keyDelayMs);
            await sleep(config.netflix.appWaitMs, job);
        }

        if (selectProfile) {
            progress('profile', 'Seleccionando el perfil de Rodri…');
            await sendButtons([
                ...repeat('down', config.netflix.profileDownPresses),
                'ok'
            ], config.netflix.keyDelayMs);
            await sleep(config.netflix.profileLoadMs, job);
        }

        if (options.continueWatching === true) {
            progress('continue', 'Abriendo el primer título de Continuar viendo…');
            await sendButtons([
                ...repeat('down', config.netflix.continueWatchingDownPresses),
                ...repeat('right', config.netflix.continueWatchingRightPresses),
                'ok'
            ], config.netflix.keyDelayMs);
            return { title: '', message: 'Listo, continuando el primer contenido de la fila.' };
        }

        if (!title) {
            progress('ready', 'Netflix está listo.');
            return { title: '', message: 'La televisión quedó encendida con Netflix listo.' };
        }

        progress('search', `Buscando “${title}” en Netflix…`);
        await sendButtons(['left', 'up', 'ok'], config.netflix.keyDelayMs);
        await sleep(config.netflix.searchLoadMs, job);
        const playFirst = options.playFirst !== false;
        await sendButtons(buildNetflixSearchSequence(title, playFirst), config.netflix.keyboardKeyDelayMs);
        await sleep(config.netflix.resultLoadMs, job);

        if (playFirst && config.netflix.pressPlayAfterResult) {
            progress('play', `Reproduciendo “${title}”…`);
            await sendButtons(['ok'], config.netflix.keyDelayMs);
        }
        return playFirst
            ? { title, message: `Listo, puse ${title} en Netflix.` }
            : { title, message: `Te muestro los resultados de ${title}.` };
    } finally {
        currentJob = null;
    }
}

async function searchNetflix(title, options = {}, onProgress = () => {}) {
    if (currentJob) throw new Error('Ya hay una automatización de TV en curso.');
    const config = getConfig();
    const query = String(title || '').trim();
    if (!query) throw new Error('Decime qué querés buscar en Netflix.');
    assertConfigured(config, { powerOn: false, needsSearch: true });

    const job = { cancelled: false };
    currentJob = job;
    const progress = (stage, message) => onProgress({ stage, message });
    try {
        progress('search', `Buscando “${query}” en Netflix…`);
        await sendButtons(['left', 'up', 'ok'], config.netflix.keyDelayMs);
        await sleep(config.netflix.searchLoadMs, job);
        await sendButtons(
            buildNetflixSearchSequence(query, options.playFirst === true),
            config.netflix.keyboardKeyDelayMs
        );
        await sleep(config.netflix.resultLoadMs, job);

        if (options.playFirst === true && config.netflix.pressPlayAfterResult) {
            progress('play', `Reproduciendo el primer resultado de “${query}”…`);
            await sendButtons(['ok'], config.netflix.keyDelayMs);
            return { message: `Listo, reproduciendo el primer resultado de ${query}.` };
        }

        return { message: `Te muestro los resultados de ${query}. Podés decir derecha, izquierda, bajá o reproducí eso.` };
    } finally {
        currentJob = null;
    }
}

async function navigate(button, count = 1) {
    if (currentJob) throw new Error('Esperá a que termine la operación actual o decí “cancelá Netflix”.');
    if (!ALLOWED_BUTTONS.includes(button)) throw new Error('Movimiento de TV no permitido.');
    const config = getConfig();
    const presses = Math.min(10, Math.max(1, Number(count) || 1));
    await sendButtons(repeat(button, presses), config.netflix.keyDelayMs);
    return { button, count: presses };
}

function cancel() {
    if (!currentJob) return false;
    currentJob.cancelled = true;
    currentJob.cancelWait?.();
    if (activeBridgeProcess) activeBridgeProcess.kill();
    return true;
}

module.exports = {
    ALLOWED_BUTTONS,
    getPublicStatus,
    saveSettings,
    discover,
    isAvailable,
    learnButton,
    sendButtons,
    playNetflix,
    searchNetflix,
    navigate,
    cancel,
    buildNetflixSearchSequence
};
