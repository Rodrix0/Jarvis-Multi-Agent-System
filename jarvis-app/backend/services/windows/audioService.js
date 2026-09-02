const { execSync } = require('child_process');

class AudioService {
    setVolume(percent) {
        const val = Math.min(100, Math.max(0, parseInt(percent, 10) || 50));
        const script = `
            $obj = New-Object -ComObject WScript.Shell
            1..50 | ForEach-Object { $obj.SendKeys([char]174) }
            $steps = [math]::Round(${val} / 2)
            1..$steps | ForEach-Object { $obj.SendKeys([char]175) }
        `;
        try {
            execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 5000 });
            return { ok: true, volume: val, message: `Volumen ajustado al ${val}%.` };
        } catch (err) {
            return { ok: false, code: 'ERR_AUDIO_VOLUME', message: err.message };
        }
    }

    toggleMute() {
        const script = `$obj = New-Object -ComObject WScript.Shell; $obj.SendKeys([char]173)`;
        try {
            execSync(`powershell.exe -NoProfile -Command "${script}"`, { timeout: 3000 });
            return { ok: true, message: 'Silencio alternado con éxito.' };
        } catch (err) {
            return { ok: false, code: 'ERR_AUDIO_MUTE', message: err.message };
        }
    }
}

const audioService = new AudioService();
module.exports = audioService;
