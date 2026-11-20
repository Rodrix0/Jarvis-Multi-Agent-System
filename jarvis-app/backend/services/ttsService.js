const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const SpeechQueue = require('./core/speechQueue');
const python = [path.resolve(__dirname, '../../python_engine/voice_venv/Scripts/python.exe'), path.resolve(__dirname, '../../../.venv/Scripts/python.exe')].find(p => fs.existsSync(p)) || 'python';

function supertonicRuntime() {
    const home = process.env.USERPROFILE || require('os').homedir();
    const roaming = process.env.APPDATA || path.join(home, 'AppData/Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
    const executable = process.env.JARVIS_SUPERTONIC_PYTHON || path.join(roaming, 'OmniVoice/engines/supertonic3/supertonic3/.venv/Scripts/python.exe');
    const modelDir = process.env.JARVIS_SUPERTONIC_MODEL_DIR || path.join(local, 'OmniVoice/hf_cache/models--Supertone--supertonic-3/snapshots/724fb5abbf5502583fb520898d45929e62f02c0b');
    return { executable, modelDir, available: fs.existsSync(executable) && fs.existsSync(path.join(modelDir, 'onnx')) && fs.existsSync(path.join(modelDir, 'voice_styles/M3.json')) };
}

function runSpeech(text, signal, engine, runtime) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return resolve({ cancelled: true });
        const neural = engine === 'supertonic3';
        const windows = engine === 'windows';
        const child = spawn(neural ? runtime.executable : windows ? 'powershell.exe' : python, neural
            ? [path.join(__dirname, '../scripts/speakSupertonic.py')]
            : windows
            ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts/speakLocal.ps1')]
            : [path.join(__dirname, '../scripts/edge_tts_speak.py')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: neural
            ? { ...process.env, JARVIS_SUPERTONIC_MODEL_DIR: runtime.modelDir, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' }
            : process.env });
        let stderr = '', stdout = '', started = false, settled = false, timeoutError;
        const kill = () => {
            if (process.platform === 'win32' && child.pid) {
                // Kill the tree while its root still exists: venv launchers can own a Python child.
                const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                killer.on('error', () => { try { child.kill(); } catch (_) {} });
                killer.on('close', code => { if (code !== 0) { try { child.kill(); } catch (_) {} } });
            } else { try { child.kill(); } catch (_) {} }
        };
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', kill);
            if (signal.aborted) resolve({ cancelled: true });
            else if (error) { error.audioStarted = started; reject(error); }
            else resolve({ spoken: true, engine, ...(neural ? { voice: 'M3' } : {}) });
        };
        const timer = setTimeout(() => { timeoutError = new Error('La salida de voz no terminó dentro del plazo.'); kill(); }, Math.min(1200000, Math.max(45000, text.length * 180)));
        signal.addEventListener('abort', kill, { once: true });
        if (signal.aborted) kill();
        child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
        child.stdout.on('data', data => {
            stdout = (stdout + data.toString()).slice(-4000);
            if (stdout.includes('"event": "playing"')) started = true;
        });
        child.stdin.on('error', error => { stderr = error.message; });
        child.on('error', finish);
        child.on('close', code => finish(timeoutError || (code === 0 ? null : new Error(stderr.trim() || 'Falló la reproducción de voz.'))));
        child.stdin.end(text, 'utf8');
    });
}

async function play(text, voice, signal) {
    if (signal.aborted) return { cancelled: true };
    const local = process.platform === 'win32' && process.env.JARVIS_TTS_LOCAL !== '0';
    const runtime = local ? supertonicRuntime() : null;
    const neural = local && process.env.JARVIS_TTS_ENGINE !== 'windows' && runtime.available;
    const bargeIn = require('./bargeInService');
    const speechId = bargeIn.notifySpeechStarted(text, { voice: neural ? 'M3' : voice });
    try {
        try { return await runSpeech(text, signal, neural ? 'supertonic3' : local ? 'windows' : 'edge', runtime); }
        catch (error) {
            // Recover before playback only; never repeat a partially spoken reply.
            if (!neural || signal.aborted || error.audioStarted) throw error;
            console.warn('[TTS] M3 no disponible; usando voz local de respaldo:', error.message);
            return await runSpeech(text, signal, 'windows', null);
        }
    } finally { bargeIn.notifySpeechEnded(speechId); }
}
const queue = new SpeechQueue(play);
module.exports = { speak: (text, voice) => queue.speak(text, voice), stop: () => queue.stop(), isPlaying: () => queue.isPlaying() };
