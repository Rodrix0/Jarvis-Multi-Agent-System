const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const SpeechQueue = require('./core/speechQueue');
const python = [path.resolve(__dirname, '../../python_engine/voice_venv/Scripts/python.exe'), path.resolve(__dirname, '../../../.venv/Scripts/python.exe')].find(p => fs.existsSync(p)) || 'python';

function play(text, voice, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return resolve({ cancelled: true });
        const bargeIn = require('./bargeInService');
        const speechId = bargeIn.notifySpeechStarted(text, { voice });
        // Use the same offline voice for both short and long replies.
        const local = process.platform === 'win32' && process.env.JARVIS_TTS_LOCAL !== '0';
        const child = spawn(local ? 'powershell.exe' : python, local
            ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts/speakLocal.ps1')]
            : [path.join(__dirname, '../scripts/edge_tts_speak.py')],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '', settled = false;
        const kill = () => {
            if (process.platform === 'win32' && child.pid) {
                const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                killer.on('error', () => {});
            }
            try { child.kill(); } catch (_) {}
        };
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', kill);
            bargeIn.notifySpeechEnded(speechId);
            if (signal.aborted) resolve({ cancelled: true });
            else if (error) reject(error);
            else resolve({ spoken: true });
        };
        const timer = setTimeout(() => { kill(); finish(new Error('La salida de voz no terminó dentro del plazo.')); }, Math.min(1200000, Math.max(30000, text.length * 130)));
        signal.addEventListener('abort', kill, { once: true });
        child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
        child.stdin.on('error', error => { if (!signal.aborted) finish(error); });
        child.on('error', finish);
        child.on('close', code => finish(code === 0 ? null : new Error(stderr.trim() || 'Falló la reproducción de voz.')));
        child.stdin.end(text, 'utf8');
    });
}
const queue = new SpeechQueue(play);
module.exports = { speak: (text, voice) => queue.speak(text, voice), stop: () => queue.stop(), isPlaying: () => queue.isPlaying() };
