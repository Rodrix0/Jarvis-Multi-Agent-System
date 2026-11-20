const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'takeScreenshot.ps1');

class DisplayService {
    async runBrightness(operation, value) {
        const result = await require('./desktopControls')('brightness', operation, value);
        if (result.ok) result.message = 'Brillo al ' + result.brightness + '%.';
        return result;
    }
    getBrightness() { return this.runBrightness('get'); }
    setBrightness(percent) { return this.runBrightness('set', percent); }
    adjustBrightness(delta) { return this.runBrightness('adjust', delta); }

    takeScreenshot(destinationDir = null) {
        const desktop = destinationDir || process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
        if (!fs.existsSync(desktop)) {
            fs.mkdirSync(desktop, { recursive: true });
        }
        const filename = `Captura_${Date.now()}.png`;
        const filePath = path.join(desktop, filename);

        try {
            execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',SCRIPT_PATH,'-FilePath',filePath], { timeout: 10000, windowsHide: true });
            return { ok: true, filePath, filename, message: `Captura de pantalla guardada en el Escritorio: ${filename}` };
        } catch (err) {
            return { ok: false, code: 'ERR_SCREENSHOT_FAILED', message: err.message };
        }
    }
}

const displayService = new DisplayService();
module.exports = displayService;
