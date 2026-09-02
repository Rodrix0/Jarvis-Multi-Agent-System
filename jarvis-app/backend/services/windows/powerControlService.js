const { execSync } = require('child_process');

class PowerControlService {
    getBatteryStatus() {
        const script = `
            try {
                $b = Get-CimInstance -ClassName Win32_Battery
                if ($b) {
                    [PSCustomObject]@{
                        Percent = $b.EstimatedChargeRemaining
                        Status = $b.BatteryStatus
                        Charging = ($b.BatteryStatus -eq 2)
                    } | ConvertTo-Json
                } else {
                    Write-Output "NO_BATTERY"
                }
            } catch { Write-Output "NO_BATTERY" }
        `;
        try {
            const out = execSync(`powershell.exe -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 6000 }).toString().trim();
            if (out.includes('NO_BATTERY')) {
                return { ok: true, hasBattery: false, message: 'La PC está conectada a corriente continua de escritorio (sin batería).' };
            }
            const data = JSON.parse(out);
            return {
                ok: true,
                hasBattery: true,
                percent: data.Percent,
                charging: data.Charging,
                message: `La batería está al ${data.Percent}% (${data.Charging ? 'Cargando' : 'Descargando'}).`
            };
        } catch (err) {
            return { ok: true, hasBattery: false, message: 'No se detectó batería en este equipo.' };
        }
    }

    lockWorkstation() {
        try {
            execSync('rundll32.exe user32.dll,LockWorkStation', { timeout: 3000 });
            return { ok: true, message: 'Sesión de Windows bloqueada.' };
        } catch (err) {
            return { ok: false, code: 'ERR_LOCK_FAILED', message: err.message };
        }
    }

    suspendSystem() {
        try {
            execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { timeout: 3000 });
            return { ok: true, message: 'El equipo ha entrado en suspensión.' };
        } catch (err) {
            return { ok: false, code: 'ERR_SUSPEND_FAILED', message: err.message };
        }
    }

    shutdownSystem() {
        try {
            execSync('shutdown.exe /s /t 2 /c "Apagado ordenado por Jarvis OS"', { timeout: 5000 });
            return { ok: true, message: 'La computadora se apagará en 2 segundos.' };
        } catch (err) {
            return { ok: false, code: 'ERR_SHUTDOWN_FAILED', message: err.message };
        }
    }

    restartSystem() {
        try {
            execSync('shutdown.exe /r /t 2 /c "Reinicio ordenado por Jarvis OS"', { timeout: 5000 });
            return { ok: true, message: 'La computadora se reiniciará en 2 segundos.' };
        } catch (err) {
            return { ok: false, code: 'ERR_RESTART_FAILED', message: err.message };
        }
    }
}

const powerControlService = new PowerControlService();
module.exports = powerControlService;
