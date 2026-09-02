const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

class DisplayService {
    setBrightness(percent) {
        const val = Math.min(100, Math.max(0, parseInt(percent, 10) || 50));
        const script = `
            try {
                $b = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods
                if ($b) { $b.WmiSetBrightness(1, ${val}); Write-Output "OK" } else { Write-Output "NOT_SUPPORTED" }
            } catch { Write-Output "NOT_SUPPORTED" }
        `;
        try {
            const out = execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 6000 }).toString().trim();
            if (out.includes('NOT_SUPPORTED')) {
                return { ok: false, code: 'ERR_BRIGHTNESS_UNSUPPORTED', message: 'El monitor o pantalla actual no soporta ajuste de brillo por software (WMI).' };
            }
            return { ok: true, brightness: val, message: `Brillo de pantalla ajustado al ${val}%.` };
        } catch (err) {
            return { ok: false, code: 'ERR_BRIGHTNESS_FAILED', message: err.message };
        }
    }

    takeScreenshot(destinationDir = null) {
        const desktop = destinationDir || process.env.JARVIS_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
        fs.mkdirSync(desktop, { recursive: true });
        const filename = `Captura_${Date.now()}.png`;
        const filePath = path.join(desktop, filename);

        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
            $bitmap.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose()
            $bitmap.Dispose()
        `;

        try {
            execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 8000 });
            return { ok: true, filePath, filename, message: `Captura de pantalla guardada en el Escritorio: ${filename}` };
        } catch (err) {
            return { ok: false, code: 'ERR_SCREENSHOT_FAILED', message: err.message };
        }
    }
}

const displayService = new DisplayService();
module.exports = displayService;
