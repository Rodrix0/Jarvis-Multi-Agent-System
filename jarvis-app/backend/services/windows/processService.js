const { execFileSync } = require('child_process');
function powershell(script, timeout) {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout, windowsHide: true, encoding: 'utf8' }).trim();
}
const securityPolicyService = require('../core/securityPolicyService');

class ProcessService {
    closeApplication(appName) {
        const clean = String(appName || '').replace(/['"]/g, '').trim();
        const procName = clean.endsWith('.exe') ? clean : `${clean}.exe`;

        const sec = securityPolicyService.validateProcessKill(procName);
        if (!sec.allowed) return { ok: false, code: sec.code, message: sec.reason };

        const script = `
            $p = Get-Process -Name '${clean.replace('.exe', '')}' -ErrorAction SilentlyContinue
            if ($p) {
                $p.CloseMainWindow() | Out-Null
                Write-Output "CLOSED"
            } else {
                Write-Output "NOT_FOUND"
            }
        `;

        try {
            const out = powershell(script, 6000);
            if (out.includes('NOT_FOUND')) {
                return { ok: false, code: 'ERR_PROCESS_NOT_RUNNING', message: `No se encontró la aplicación ${appName} en ejecución.` };
            }
            return { ok: true, message: `Se envió la orden de cierre ordenado a ${appName}.` };
        } catch (err) {
            return { ok: false, code: 'ERR_CLOSE_FAILED', message: err.message };
        }
    }

    killProcess(processNameOrPid) {
        const clean = String(processNameOrPid || '').replace(/['"]/g, '').trim();
        const sec = securityPolicyService.validateProcessKill(clean);
        if (!sec.allowed) return { ok: false, code: sec.code, message: sec.reason };

        try {
            if (/^\d+$/.test(clean)) {
                execFileSync('taskkill.exe', ['/PID', clean, '/F'], { timeout: 5000, windowsHide: true });
            } else {
                const img = clean.endsWith('.exe') ? clean : `${clean}.exe`;
                execFileSync('taskkill.exe', ['/IM', img, '/F'], { timeout: 5000, windowsHide: true });
            }
            return { ok: true, message: `Proceso ${clean} terminado forzosamente.` };
        } catch (err) {
            return { ok: false, code: 'ERR_KILL_FAILED', message: `No se pudo forzar el cierre de ${clean}: ${err.message}` };
        }
    }

    getTopResourceConsumers() {
        const script = `
            Get-Process | Where-Object { $_.WorkingSet -gt 0 } | 
            Sort-Object -Property WorkingSet -Descending | 
            Select-Object -First 5 -Property ProcessName, @{Label='CPU_Seconds';Expression={[math]::Round($_.CPU, 1)}}, @{Label='RAM_MB';Expression={[math]::Round($_.WorkingSet / 1MB, 1)}} | 
            ConvertTo-Json -Compress
        `;
        try {
            const out = powershell(script, 8000);
            const list = JSON.parse(out);
            const array = Array.isArray(list) ? list : [list];
            const summary = array.map(p => `• ${p.ProcessName}: ${p.RAM_MB || 0} MB RAM (${p.CPU_Seconds || 0}s CPU)`).join('\n');
            return {
                ok: true,
                processes: array,
                summary,
                message: `Las aplicaciones que más recursos consumen son:\n${summary}`
            };
        } catch (err) {
            return { ok: false, code: 'ERR_METRICS_FAILED', message: err.message };
        }
    }
}

const processService = new ProcessService();
module.exports = processService;
