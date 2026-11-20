const { spawnSync } = require('child_process');
const encoding = '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ';
class ClipboardService {
    readClipboard() {
        const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', encoding + '$value = Get-Clipboard -Raw -ErrorAction Stop; if ($null -ne $value) { [Console]::Write($value) }'], { windowsHide: true, timeout: 4000, encoding: 'utf8' });
        if (res.error || res.status !== 0) return { ok: false, message: res.error?.message || res.stderr || 'No pude leer el portapapeles.' };
        const text = res.stdout || '';
        return { ok: true, text, message: text || 'El portapapeles está vacío.' };
    }
    writeClipboard(text) {
        const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', encoding + '$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value -ErrorAction Stop'], { input: String(text ?? ''), windowsHide: true, timeout: 4000, encoding: 'utf8' });
        return res.error || res.status !== 0 ? { ok: false, message: res.error?.message || res.stderr || 'No pude escribir en el portapapeles.' } : { ok: true, message: 'Texto copiado al portapapeles.' };
    }
}
module.exports = new ClipboardService();
