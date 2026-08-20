const { spawn } = require('child_process');

let activeProcess = null;

const POWERSHELL_TTS = `
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Volume = 100
$speaker.Rate = 1
$requestedVoice = [Console]::In.ReadLine()
$spokenText = [Console]::In.ReadToEnd()
$available = $speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($requestedVoice -and ($available -contains $requestedVoice)) {
    $speaker.SelectVoice($requestedVoice)
} else {
    try { $speaker.SelectVoice('Microsoft Helena Desktop') } catch {}
}
$speaker.Speak($spokenText)
$speaker.Dispose()
`;

function stop() {
    if (!activeProcess) return false;
    const processToStop = activeProcess;
    activeProcess = null;
    processToStop.kill();
    return true;
}

function speak(text, voice = '') {
    stop();
    const safeText = String(text || '').trim().slice(0, 12000);
    if (!safeText) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', POWERSHELL_TTS
        ], { windowsHide: true });
        activeProcess = child;
        let stderr = '';
        const timeout = setTimeout(() => {
            if (activeProcess === child) activeProcess = null;
            child.kill();
            reject(new Error('La salida de voz excedió el tiempo permitido.'));
        }, Math.min(120000, Math.max(15000, safeText.length * 90)));

        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', error => {
            clearTimeout(timeout);
            if (activeProcess === child) activeProcess = null;
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (activeProcess === child) activeProcess = null;
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || 'Windows no pudo reproducir la respuesta.'));
        });
        child.stdin.end(`${String(voice || '').replace(/[\r\n]/g, '')}\n${safeText}`);
    });
}

module.exports = { speak, stop };
