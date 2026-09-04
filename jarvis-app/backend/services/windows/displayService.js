const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'takeScreenshot.ps1');

class DisplayService {
    setBrightness(percent) {
        const val = Math.min(100, Math.max(0, parseInt(percent, 10) || 50));
        const script = `
            try {
                $b = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
                if ($b) {
                    $b.WmiSetBrightness(1, ${val})
                    Write-Output "OK"
                } else {
                    Write-Output "NOT_SUPPORTED"
                }
            } catch {
                Write-Output "NOT_SUPPORTED"
            }
        `;
        try {
            const buffer = Buffer.from(script, 'utf16le');
            const base64 = buffer.toString('base64');
            const out = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64}`, { timeout: 6000 }).toString().trim();
            if (out.includes('NOT_SUPPORTED')) {
                return { ok: false, code: 'ERR_BRIGHTNESS_UNSUPPORTED', message: 'El monitor actual no soporta ajuste de brillo por software (WMI).' };
            }
            return { ok: true, brightness: val, message: `Brillo de pantalla ajustado al ${val}%.` };
        } catch (err) {
            return { ok: false, code: 'ERR_BRIGHTNESS_FAILED', message: err.message };
        }
    }

    takeScreenshot(destinationDir = null) {
        const desktop = destinationDir || process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
        if (!fs.existsSync(desktop)) {
            fs.mkdirSync(desktop, { recursive: true });
        }
        const filename = `Captura_${Date.now()}.png`;
        const filePath = path.join(desktop, filename);

        try {
            execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -FilePath "${filePath}"`, { timeout: 10000 });
            return { ok: true, filePath, filename, message: `Captura de pantalla guardada en el Escritorio: ${filename}` };
        } catch (err) {
            return { ok: false, code: 'ERR_SCREENSHOT_FAILED', message: err.message };
        }
    }
}

const displayService = new DisplayService();
module.exports = displayService;
