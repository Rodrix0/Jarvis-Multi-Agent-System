const { execSync } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'windowControl.ps1');

function runAction(action, tabNumber = 0, timeout = 4000) {
    const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${SCRIPT_PATH}" -Action "${action}" -TabNumber ${tabNumber}`;
    return execSync(cmd, { timeout }).toString().trim();
}

class WindowTabService {
    minimizeActive() {
        try {
            const out = runAction('minimize');
            return { ok: true, action: 'minimize', message: 'Ventana minimizada.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    minimizeAll() {
        try {
            const out = runAction('minimize_all');
            return { ok: true, action: 'minimize_all', message: 'Mostrando el escritorio.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    maximizeActive() {
        try {
            const out = runAction('maximize');
            return { ok: true, action: 'maximize', message: 'Ventana maximizada.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    goToTab(number = 1) {
        try {
            const num = Math.min(9, Math.max(1, parseInt(number, 10) || 1));
            const out = runAction('go_to_tab', num);
            return { ok: true, action: 'go_to_tab', index: num, message: `Cambiado a la pestaña ${num}.`, raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    nextTab() {
        try {
            const out = runAction('next_tab');
            return { ok: true, action: 'next_tab', message: 'Siguiente pestaña.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    prevTab() {
        try {
            const out = runAction('prev_tab');
            return { ok: true, action: 'prev_tab', message: 'Pestaña anterior.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    closeTab() {
        try {
            const out = runAction('close_tab');
            return { ok: true, action: 'close_tab', message: 'Pestaña cerrada.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    newTab() {
        try {
            const out = runAction('new_tab');
            return { ok: true, action: 'new_tab', message: 'Nueva pestaña abierta.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    closeWindow() {
        try {
            const out = runAction('close_window');
            return { ok: true, action: 'close_window', message: 'Ventana cerrada.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    nextWindow() {
        try {
            const out = runAction('next_window');
            return { ok: true, action: 'next_window', message: 'Siguiente ventana.', raw: out };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}

const windowTabService = new WindowTabService();
module.exports = windowTabService;
