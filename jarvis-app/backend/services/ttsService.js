const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getPythonPath() {
    const candidates = [
        path.resolve(__dirname, '../../../.venv/Scripts/python.exe'),
        path.resolve(__dirname, '../../.venv/Scripts/python.exe'),
        'C:\\Users\\Rodrigo\\Desktop\\IA\\.venv\\Scripts\\python.exe',
        process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe') : null,
        'python'
    ].filter(Boolean);

    for (const p of candidates) {
        if (p === 'python' || fs.existsSync(p)) return p;
    }
    return 'python';
}

const PYTHON_PATH = getPythonPath();
const EDGE_TTS_SCRIPT = path.join(__dirname, '..', 'scripts', 'edge_tts_speak.py');

let activeProcess = null;
let currentSpeechId = null;

function getBargeInService() {
    try {
        return require('./bargeInService');
    } catch (e) {
        return null;
    }
}

function isPlaying() {
    return activeProcess !== null;
}

function stop() {
    if (!activeProcess) return false;
    const processToStop = activeProcess;
    activeProcess = null;
    const pid = processToStop.pid;
    try {
        processToStop.kill('SIGKILL');
    } catch (e) {}

    // En Windows aseguramos la terminación completa del árbol de procesos si hace falta
    if (process.platform === 'win32' && pid) {
        try {
            const { exec } = require('child_process');
            exec(`taskkill /pid ${pid} /T /F`, () => {});
        } catch (e) {}
    }

    const bargeIn = getBargeInService();
    if (bargeIn && currentSpeechId) {
        bargeIn.notifySpeechEnded(currentSpeechId);
    }
    currentSpeechId = null;
    return true;
}

function speak(text, voice = 'es-AR-TomasNeural') {
    stop();
    const safeText = String(text || '').trim().slice(0, 15000);
    if (!safeText) return Promise.resolve();

    const bargeIn = getBargeInService();
    if (bargeIn) {
        currentSpeechId = bargeIn.notifySpeechStarted(safeText, { voice });
    }

    return new Promise((resolve, reject) => {
        const pythonExecutable = fs.existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python';
        const useLocal = process.platform === 'win32' && (safeText.length <= 300 || process.env.JARVIS_TTS_LOCAL === '1');
        const executable = useLocal ? 'powershell.exe' : pythonExecutable;
        const args = useLocal ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts/speakLocal.ps1')] : [EDGE_TTS_SCRIPT];
        const child = spawn(executable, args, {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        activeProcess = child;
        let stderr = '';

        const timeout = setTimeout(() => {
            if (activeProcess === child) activeProcess = null;
            try { child.kill('SIGKILL'); } catch (e) {}
            if (bargeIn && currentSpeechId) bargeIn.notifySpeechEnded(currentSpeechId);
            currentSpeechId = null;
            reject(new Error('La salida de voz neuronal excedió el tiempo permitido.'));
        }, Math.min(120000, Math.max(15000, safeText.length * 100)));

        child.stderr.on('data', data => { stderr += data.toString(); });

        child.on('error', error => {
            clearTimeout(timeout);
            if (activeProcess === child) activeProcess = null;
            if (bargeIn && currentSpeechId) bargeIn.notifySpeechEnded(currentSpeechId);
            currentSpeechId = null;
            reject(error);
        });

        child.on('close', code => {
            clearTimeout(timeout);
            if (activeProcess === child) activeProcess = null;
            if (bargeIn && currentSpeechId) bargeIn.notifySpeechEnded(currentSpeechId);
            currentSpeechId = null;
            if (code === 0) {
                resolve();
            } else {
                // Si fue cancelado manualmente no lo tratamos como error fatal
                if (stderr.includes('SIGKILL') || stderr.includes('KeyboardInterrupt')) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || 'Error al sintetizar voz con Edge-TTS.'));
                }
            }
        });

        // Enviar el texto en UTF-8 nativo
        child.stdin.write(safeText, 'utf8');
        child.stdin.end();
    });
}

module.exports = { speak, stop, isPlaying };

