const { execFile } = require('child_process');
const path = require('path');
const script = path.join(__dirname, '../../scripts/desktopControls.ps1');
function control(device, operation, value = 0) {
    if (!Number.isFinite(Number(value))) return Promise.resolve({ ok: false, message: 'El valor debe ser un número.' });
    return new Promise(resolve => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
            '-Device', device, '-Operation', operation, '-Value', String(Number(value))],
        { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (error, stdout) => {
            try {
                const result = JSON.parse(stdout.trim());
                if (error) result.ok = false;
                if (result.ok) {
                    const key = device === 'audio' ? 'volume' : 'brightness';
                    const expected = operation === 'set' ? Number(value) : result.previous + Number(value);
                    if (['set', 'adjust'].includes(operation) && Math.abs(result[key] - Math.max(0, Math.min(100, expected))) > 1) {
                        return resolve({ ...result, ok: false, message: 'Windows no confirmó el nivel solicitado.' });
                    }
                    result.evidence = { ...result };
                }
                resolve(result);
            } catch {
                resolve({ ok: false, message: error?.message || 'Windows no devolvió el estado del dispositivo.' });
            }
        });
    });
}
module.exports = control;
