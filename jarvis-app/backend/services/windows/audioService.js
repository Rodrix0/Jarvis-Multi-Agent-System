const { execSync } = require('child_process');

function runPowerShell(script, timeout = 6000) {
    const buffer = Buffer.from(script, 'utf16le');
    const base64 = buffer.toString('base64');
    return execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64}`, { timeout }).toString().trim();
}

class AudioService {
    setVolume(percent) {
        const val = Math.min(100, Math.max(0, parseInt(percent, 10) || 50));
        const script = `
            $wsh = New-Object -ComObject WScript.Shell
            1..50 | ForEach-Object { $wsh.SendKeys([char]174) }
            $steps = [math]::Round(${val} / 2)
            if ($steps -gt 0) {
                1..$steps | ForEach-Object { $wsh.SendKeys([char]175) }
            }
        `;
        try {
            runPowerShell(script);
            return { ok: true, volume: val, message: `Volumen ajustado al ${val}%.` };
        } catch (err) {
            return { ok: false, code: 'ERR_AUDIO_VOLUME', message: err.message };
        }
    }

    toggleMute() {
        const script = `
            $wsh = New-Object -ComObject WScript.Shell
            $wsh.SendKeys([char]173)
        `;
        try {
            runPowerShell(script);
            return { ok: true, message: 'Silencio alternado con éxito.' };
        } catch (err) {
            return { ok: false, code: 'ERR_AUDIO_MUTE', message: err.message };
        }
    }
}

const audioService = new AudioService();
module.exports = audioService;
