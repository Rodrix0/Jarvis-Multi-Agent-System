const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const executionManager = require('../core/executionManager');

const PYTHON_PATH = path.join(__dirname, '..', '..', '..', 'python_engine', 'venv', 'Scripts', 'python.exe');
const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'python_engine', 'aiwa_tv_control.py');

class AiwaTvService {
    runCommand(args, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const pythonExe = fs.existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python';
            const child = spawn(pythonExe, [SCRIPT_PATH, ...args], { windowsHide: true });
            
            executionManager.registerChildProcess(child);

            let stdout = '';
            let stderr = '';

            const timer = setTimeout(() => {
                child.kill();
                reject(new Error('Tiempo de espera agotado al conectar con la Smart TV.'));
            }, timeoutMs);

            child.stdout.on('data', d => { stdout += d.toString(); });
            child.stderr.on('data', d => { stderr += d.toString(); });

            child.on('error', err => {
                clearTimeout(timer);
                executionManager.unregisterChildProcess(child);
                reject(err);
            });

            child.on('close', code => {
                clearTimeout(timer);
                executionManager.unregisterChildProcess(child);
                try {
                    const parsed = JSON.parse(stdout.trim());
                    if (parsed.ok) return resolve(parsed);
                    return reject(new Error(parsed.error || stderr.trim() || 'Error en comunicación con la TV.'));
                } catch (e) {
                    if (code === 0) return resolve({ ok: true, raw: stdout.trim() });
                    return reject(new Error(stderr.trim() || 'Respuesta inválida de la TV.'));
                }
            });
        });
    }

    async getVolume() {
        try {
            const result = await this.runCommand(['get-volume']);
            return {
                ok: true,
                volume: result.volume,
                muted: result.muted,
                message: `El volumen de la televisión está al ${result.volume}%.`
            };
        } catch (error) {
            console.error('[AiwaTvService] Error al consultar volumen:', error.message);
            return { ok: false, message: `No pude consultar el volumen de la tele: ${error.message}` };
        }
    }

    async setVolume(percent) {
        const target = Math.max(0, Math.min(100, Math.round(Number(percent))));
        try {
            const result = await this.runCommand(['set-volume', '--percent', String(target)]);
            return {
                ok: true,
                volume: result.volume,
                muted: result.muted,
                message: `Puse el volumen de la televisión al ${target}%.`
            };
        } catch (error) {
            console.error('[AiwaTvService] Error al ajustar volumen:', error.message);
            return { ok: false, message: `No pude ajustar el volumen de la tele: ${error.message}` };
        }
    }

    async adjustVolume(delta) {
        try {
            const result = await this.runCommand(['adjust-volume', '--delta', String(delta)]);
            const actionWord = delta > 0 ? 'Subí' : 'Bajé';
            return {
                ok: true,
                volume: result.volume,
                previousVolume: result.previousVolume,
                message: `${actionWord} el volumen de la televisión al ${result.volume}%.`
            };
        } catch (error) {
            console.error('[AiwaTvService] Error al cambiar volumen:', error.message);
            return { ok: false, message: `No pude cambiar el volumen de la tele: ${error.message}` };
        }
    }

    async toggleMute() {
        try {
            const result = await this.runCommand(['toggle-mute']);
            return {
                ok: true,
                muted: result.muted,
                message: result.muted ? 'Silencié la televisión.' : 'Reactivé el sonido de la televisión.'
            };
        } catch (error) {
            console.error('[AiwaTvService] Error al silenciar/reactivar:', error.message);
            return { ok: false, message: `No pude cambiar el silencio de la tele: ${error.message}` };
        }
    }
}

const aiwaTvService = new AiwaTvService();
module.exports = aiwaTvService;
