const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SANDBOX_DIR = path.join(__dirname, '..', '..', 'data', 'sandbox');

class SandboxService {
    constructor() {
        if (!fs.existsSync(SANDBOX_DIR)) {
            fs.mkdirSync(SANDBOX_DIR, { recursive: true });
        }
    }

    async executeSandboxedScript(scriptContent, timeoutMs = 10000) {
        const scriptId = `script_${Date.now()}.js`;
        const scriptPath = path.join(SANDBOX_DIR, scriptId);
        fs.writeFileSync(scriptPath, scriptContent, 'utf8');

        return new Promise((resolve) => {
            const child = spawn('node', [scriptPath], {
                timeout: timeoutMs,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());

            child.on('exit', (code) => {
                // Limpiar archivo temporal
                try { fs.unlinkSync(scriptPath); } catch (e) {}
                if (code === 0) {
                    resolve({ ok: true, output: stdout.trim() });
                } else {
                    resolve({ ok: false, code: 'ERR_SANDBOX_FAILED', error: stderr.trim() || `Exit code ${code}` });
                }
            });

            child.on('error', (err) => {
                try { fs.unlinkSync(scriptPath); } catch (e) {}
                resolve({ ok: false, code: 'ERR_SANDBOX_SPAWN', error: err.message });
            });
        });
    }
}

const sandboxService = new SandboxService();
module.exports = sandboxService;
