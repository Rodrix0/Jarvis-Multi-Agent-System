const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'broadlink.json');
const TV_STATE_PATH = path.join(__dirname, '..', 'data', 'tv_state.json');
const BRIDGE_PATH = path.join(__dirname, '..', '..', 'python_engine', 'broadlink_remote.py');
const VENV_PYTHON = path.join(__dirname, '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
const executionManager = require('./core/executionManager');
const ALLOWED_BUTTONS = ['power', 'up', 'down', 'left', 'right', 'ok', 'back', 'netflix', 'volup', 'voldown', 'vol_up', 'vol_down', 'mute', 'home'];
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
        executionManager.registerChildProcess(child);

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            executionManager.unregisterChildProcess(child);
            reject(new Error('El BroadLink no respondió dentro del tiempo esperado.'));
        }, timeoutMs);

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', error => {
            clearTimeout(timer);
            activeBridgeProcess = null;
            executionManager.unregisterChildProcess(child);
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            activeBridgeProcess = null;
            executionManager.unregisterChildProcess(child);
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
    if (Date.now() - availabilityCache.checkedAt < (availabilityCache.value ? 4000 : 15000)) return availabilityCache.value;
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
    let normalizedBtn = button.replace('_', '').toLowerCase();
    if (button === 'home') normalizedBtn = 'power';
    if (!ALLOWED_BUTTONS.includes(button) && !ALLOWED_BUTTONS.includes(normalizedBtn)) throw new Error('Botón IR no permitido.');
    
    await runBridge(['learn', normalizedBtn, '--timeout', '20'], 28000);
    
    // Duplicar en config para compatibilidad con vol_up / volup
    try {
        const config = getConfig();
        if (config.codes[normalizedBtn]) {
            if (normalizedBtn === 'volup') config.codes['vol_up'] = config.codes['volup'];
            if (normalizedBtn === 'voldown') config.codes['vol_down'] = config.codes['voldown'];
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        }
    } catch (e) {}

    return getPublicStatus();
}

async function sendButtons(buttons, delayMs = 180) {
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
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10);
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
    // En la app de Netflix en pantalla de búsqueda, el teclado abre directamente enfocado en la 'a' (fila 0, col 0).
    // NO enviar 'left' desde aquí porque saldría del teclado hacia las categorías laterales.
    let cursor = { row: 0, column: 0 };
    for (const character of normalizedTitle) {
        const target = keyboardPosition(character);
        if (!target) continue;

        const rowDiff = target.row - cursor.row;
        const colDiff = target.column - cursor.column;

        if (rowDiff > 0) sequence.push(...repeat('down', rowDiff));
        if (rowDiff < 0) sequence.push(...repeat('up', -rowDiff));
        if (colDiff > 0) sequence.push(...repeat('right', colDiff));
        if (colDiff < 0) sequence.push(...repeat('left', -colDiff));

        // Presionar OK para seleccionar la letra
        sequence.push('ok');
        cursor = target;
    }

    // Subir a la primera fila y cruzar al panel de resultados situado a la derecha
    if (cursor.row > 0) sequence.push(...repeat('up', cursor.row));
    const exitRight = KEYBOARD_ROWS[0].length - cursor.column;
    if (exitRight > 0) sequence.push(...repeat('right', exitRight));

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

async function enterNetflixProfile(onProgress = () => {}) {
    if (currentJob) throw new Error('Ya hay una automatización de TV en curso.');
    const config = getConfig();
    assertConfigured(config, { powerOn: false, needsSearch: false });
    const job = { cancelled: false };
    currentJob = job;
    const progress = (stage, message) => onProgress({ stage, message });
    try {
        progress('profile', 'Ingresando al perfil de Rodri en Netflix…');
        // El perfil de Rodri (avatar de Luffy) está en la primera posición y seleccionado
        await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
        await sleep(config.netflix.profileLoadMs || 6000, job);
        progress('ready', 'Perfil seleccionado con éxito.');
        return { ok: true, message: 'Listo, ingresé a tu perfil Rodri en Netflix.' };
    } finally {
        currentJob = null;
    }
}

async function openNetflixSearch(onProgress = () => {}) {
    if (currentJob) throw new Error('Ya hay una automatización de TV en curso.');
    const config = getConfig();
    assertConfigured(config, { powerOn: false, needsSearch: true });
    const job = { cancelled: false };
    currentJob = job;
    const progress = (stage, message) => onProgress({ stage, message });
    try {
        progress('search_nav', 'Abriendo la barra lateral de Netflix…');
        // 1. Ir a la izquierda para abrir menú (cae sobre Inicio)
        await sendButtons(['left'], config.netflix.keyDelayMs || 350);
        await sleep(600, job);
        // 2. Subir uno para colocarse sobre Búsqueda (Lupa)
        progress('search_nav', 'Seleccionando Búsqueda…');
        await sendButtons(['up'], config.netflix.keyDelayMs || 350);
        await sleep(400, job);
        // 3. Presionar OK para abrir el buscador con teclado
        progress('search_open', 'Accediendo al buscador…');
        await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
        await sleep(config.netflix.searchLoadMs || 1500, job);
        progress('search_ready', 'Buscador abierto y teclado listo.');
        return { ok: true, message: 'Listo, abrí el buscador de Netflix. ¿Qué serie o película querés ver?' };
    } finally {
        currentJob = null;
    }
}

async function playNetflix(options = {}, onProgress = () => {}) {
    if (currentJob) throw new Error('Ya hay una automatización de TV en curso.');
    const config = getConfig();
    const powerOn = options.powerOn === true;
    let title = String(options.title || '').trim();
    assertConfigured(config, { powerOn, needsSearch: Boolean(title) });

    const job = { cancelled: false };
    currentJob = job;
    const progress = (stage, message) => onProgress({ stage, message });
    try {
        if (powerOn) {
            progress('power', 'Encendiendo la televisión…');
            await sendButtons(['power'], config.netflix.keyDelayMs || 350);
            progress('boot', `Esperando ${Math.round(config.netflix.bootWaitMs / 1000)} segundos a que inicie la TV…`);
            await sleep(config.netflix.bootWaitMs, job);
        }

        if (config.netflix.pressNetflixAfterBoot) {
            progress('netflix', 'Abriendo Netflix…');
            await sendButtons(['netflix'], config.netflix.keyDelayMs || 350);
            await sleep(config.netflix.appWaitMs, job);
        }

        // Si no hay título, el objetivo es entrar al perfil
        if (!title) {
            progress('profile', 'Ingresando al perfil de Rodri…');
            await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
            await sleep(config.netflix.profileLoadMs || 6000, job);
            progress('ready', 'Netflix listo en el perfil de Rodri.');
            return { title: '', message: 'Listo, ingresé a tu perfil Rodri en Netflix.' };
        }

        // Si hay título, navegar a la búsqueda y escribir
        progress('search_nav', `Abriendo buscador para “${title}”…`);
        await sendButtons(['left'], config.netflix.keyDelayMs || 350);
        await sleep(600, job);
        await sendButtons(['up'], config.netflix.keyDelayMs || 350);
        await sleep(400, job);
        await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
        await sleep(config.netflix.searchLoadMs || 1500, job);

        progress('search_type', `Escribiendo “${title}” en el teclado…`);
        const playFirst = options.playFirst !== false;
        await sendButtons(buildNetflixSearchSequence(title, playFirst), config.netflix.keyDelayMs || 350);
        await sleep(config.netflix.resultLoadMs || 2500, job);

        if (playFirst && config.netflix.pressPlayAfterResult) {
            progress('play', `Reproduciendo “${title}”…`);
            await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
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
        if (options.skipOpenSearch !== true) {
            progress('search_nav', `Dirigiéndome al buscador de Netflix…`);
            // 1. Ir a la izquierda
            await sendButtons(['left'], config.netflix.keyDelayMs || 350);
            await sleep(600, job);
            // 2. Subir a Búsqueda
            await sendButtons(['up'], config.netflix.keyDelayMs || 350);
            await sleep(400, job);
            // 3. Entrar a Búsqueda
            await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
            await sleep(config.netflix.searchLoadMs || 1500, job);
        }

        progress('search_type', `Escribiendo “${query}” en el teclado…`);
        const playFirst = options.playFirst !== false;
        await sendButtons(
            buildNetflixSearchSequence(query, playFirst),
            config.netflix.keyDelayMs || 350
        );
        await sleep(config.netflix.resultLoadMs || 2500, job);

        if (playFirst && config.netflix.pressPlayAfterResult) {
            progress('play', `Reproduciendo el primer resultado de “${query}”…`);
            await sendButtons(['ok'], config.netflix.keyDelayMs || 350);
            return { message: `Listo, reproduciendo el primer resultado de ${query}.` };
        }

        return { message: `Te muestro los resultados de ${query} en Netflix.` };
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
    let hadActive = false;
    if (currentJob) {
        currentJob.cancelled = true;
        currentJob.cancelWait?.();
        currentJob = null;
        hadActive = true;
    }
    if (activeBridgeProcess) {
        try {
            activeBridgeProcess.kill('SIGKILL');
            executionManager.unregisterChildProcess(activeBridgeProcess);
        } catch (e) {}
        activeBridgeProcess = null;
        hadActive = true;
    }
    return hadActive;
}

function repeat(button, count) {
    return Array.from({ length: Math.max(0, count) }, () => button);
}

function getVolButton(config, isUp) {
    if (isUp) {
        if (config.codes['volup']) return 'volup';
        if (config.codes['vol_up']) return 'vol_up';
        return null;
    } else {
        if (config.codes['voldown']) return 'voldown';
        if (config.codes['vol_down']) return 'vol_down';
        return null;
    }
}

function getTvState() {
    try {
        if (fs.existsSync(TV_STATE_PATH)) return JSON.parse(fs.readFileSync(TV_STATE_PATH, 'utf8'));
    } catch (e) {}
    return { volume: 20, muted: false };
}

function saveTvState(state) {
    try {
        fs.mkdirSync(path.dirname(TV_STATE_PATH), { recursive: true });
        fs.writeFileSync(TV_STATE_PATH, JSON.stringify(state, null, 2));
    } catch (e) {}
}

async function getVolume() {
    const state = getTvState();
    return {
        ok: true,
        volume: state.volume,
        muted: state.muted,
        estimated: true,
        message: `El último volumen estimado de la televisión es ${state.volume}%. El control infrarrojo no permite leer el nivel real.`
    };
}

async function setVolume(percent) {
    const config = getConfig();
    const upBtn = getVolButton(config, true);
    const downBtn = getVolButton(config, false);
    if (!upBtn || !downBtn) {
        return {
            ok: false,
            message: 'Primero necesito aprender los botones de volumen del control remoto. Por favor enseñame el botón de subir y bajar volumen desde el panel o por comando.'
        };
    }
    const target = Math.max(0, Math.min(100, Math.round(Number(percent))));
    const state = getTvState();
    const diff = target - state.volume;
    if (diff !== 0) {
        const button = diff > 0 ? upBtn : downBtn;
        const count = Math.abs(diff);
        await sendButtons(repeat(button, count), 180);
    }
    state.volume = target;
    saveTvState(state);
    return {
        ok: true,
        volume: target,
        message: `Ajusté el volumen de la televisión al ${target}%.`
    };
}

async function adjustVolume(delta) {
    if (!Number.isFinite(Number(delta))) return { ok: false, message: 'El cambio de volumen debe ser numérico.' };
    delta = Math.round(Number(delta));
    const config = getConfig();
    const upBtn = getVolButton(config, true);
    const downBtn = getVolButton(config, false);
    if (!upBtn || !downBtn) {
        return {
            ok: false,
            message: 'Primero necesito aprender los botones de volumen del control remoto. Por favor enseñame el botón de subir y bajar volumen.'
        };
    }
    const state = getTvState();
    const target = Math.max(0, Math.min(100, state.volume + delta));
    const count = Math.abs(target - state.volume);
    const button = delta > 0 ? upBtn : downBtn;
    await sendButtons(repeat(button, count), 180);
    state.volume = target;
    saveTvState(state);
    const actionWord = delta > 0 ? 'Subí' : 'Bajé';
    return {
        ok: true,
        volume: state.volume,
        message: `${actionWord} el volumen de la televisión a ${state.volume}%.`
    };
}

function calibrateVolume(actual) {
    const target = Math.max(0, Math.min(100, Math.round(Number(actual))));
    const state = getTvState();
    state.volume = target;
    saveTvState(state);
    return {
        ok: true,
        volume: target,
        message: `Calibré el volumen de la televisión en ${target}%.`
    };
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
    buildNetflixSearchSequence,
    getVolume,
    setVolume,
    adjustVolume,
    calibrateVolume,
    enterNetflixProfile,
    openNetflixSearch
};
