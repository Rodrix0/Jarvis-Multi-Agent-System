const { execSync } = require('child_process');

class ClipboardService {
    readClipboard() {
        try {
            const text = execSync('powershell.exe -NoProfile -Command "Get-Clipboard"', { timeout: 4000 }).toString().trim();
            return {
                ok: true,
                text,
                message: text ? `Contenido del portapapeles: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"` : 'El portapapeles está vacío.'
            };
        } catch (err) {
            return { ok: false, code: 'ERR_CLIPBOARD_READ', message: err.message };
        }
    }

    writeClipboard(text) {
        const clean = String(text || '').replace(/"/g, '`"');
        try {
            execSync(`powershell.exe -NoProfile -Command "Set-Clipboard -Value \\"${clean}\\""`, { timeout: 4000 });
            return { ok: true, message: 'Texto copiado al portapapeles con éxito.' };
        } catch (err) {
            return { ok: false, code: 'ERR_CLIPBOARD_WRITE', message: err.message };
        }
    }
}

const clipboardService = new ClipboardService();
module.exports = clipboardService;
