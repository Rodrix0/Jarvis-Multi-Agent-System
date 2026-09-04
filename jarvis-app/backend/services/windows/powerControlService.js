const { execSync } = require('child_process');

function runPowerShell(script, timeout = 6000) {
    const buffer = Buffer.from(script, 'utf16le');
    const base64 = buffer.toString('base64');
    return execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${base64}`, { timeout }).toString().trim();
}

class PowerControlService {
    getBatteryStatus() {
        const script = `
            try {
                $b = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop
                if ($b) {
                    $pct = $b.EstimatedChargeRemaining
                    if ($null -eq $pct) { $pct = 100 }
                    $st = $b.BatteryStatus
                    $charging = ($st -eq 2 -or $st -eq 6 -or $st -eq 7 -or $st -eq 8)
                    [PSCustomObject]@{
                        Percent = $pct
                        Status = $st
                        Charging = $charging
                    } | ConvertTo-Json -Compress
                } else {
                    Write-Output "NO_BATTERY"
                }
            } catch {
                Write-Output "NO_BATTERY"
            }
        `;
        try {
            const out = runPowerShell(script);
            if (!out || out.includes('NO_BATTERY')) {
                return { ok: true, hasBattery: false, message: 'La PC está conectada a corriente continua (sin batería o PC de escritorio).' };
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
            return { ok: true, hasBattery: false, message: 'No se pudo obtener el estado de la batería.' };
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
