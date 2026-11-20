/**
 * UI Automation Service for Windows
 * Permite interactuar semánticamente con ventanas, botones, campos de texto y controles
 * mediante Microsoft UI Automation nativo, utilizando coordenadas dinámicas únicamente
 * como fallback inteligente.
 */

const { execFile } = require('child_process');
const path = require('path');

const BRIDGE_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'uiAutomationBridge.ps1');

class UiAutomationService {
    constructor() {
        this.scriptPath = BRIDGE_SCRIPT;
    }

    /**
     * Ejecuta una acción en el puente PowerShell y parsea el JSON resultante.
     */
    _runBridge(args, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            const psArgs = [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.scriptPath,
                ...args
            ];

            execFile('powershell.exe', psArgs, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    return reject(new Error(`[UIAutomation] Error ejecutando comando: ${error.message} (${stderr || ''})`));
                }
                try {
                    const raw = (stdout || '').trim();
                    // Extraer únicamente el bloque JSON si hubiera algún mensaje previo
                    const jsonStart = raw.indexOf('{');
                    const jsonEnd = raw.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        const parsed = JSON.parse(raw.substring(jsonStart, jsonEnd + 1));
                        return resolve(parsed);
                    }
                    return resolve({ ok: false, error: `No se obtuvo respuesta JSON del puente UI Automation. Raw: '${raw}' | Stderr: '${stderr || ''}'`, raw });
                } catch (parseErr) {
                    return reject(new Error(`[UIAutomation] Error parseando respuesta JSON: ${parseErr.message}. Raw: ${stdout}`));
                }
            });
        });
    }

    /**
     * Lista todas las ventanas abiertas en el escritorio interactivo actual.
     */
    async listWindows() {
        const res = await this._runBridge(['-Action', 'list-windows']);
        if (!res.ok) throw new Error(res.error || 'Error listando ventanas.');
        return res.windows || [];
    }

    /**
     * Busca una ventana por título (subcadena o regex).
     */
    async findWindow(titleOrPattern) {
        const res = await this._runBridge(['-Action', 'find-window', '-TitlePattern', titleOrPattern instanceof RegExp ? titleOrPattern.source : String(titleOrPattern || '')]);
        if (!res.ok) throw new Error(res.error || `Error buscando ventana '${titleOrPattern}'.`);
        return res.matched ? res.window : null;
    }

    /**
     * Resuelve el target de una ventana (puede ser HWND numérico, objeto ventana o string de título).
     */
    async _resolveHwnd(windowTarget) {
        if (!windowTarget) {
            const foreground = await this._runBridge(['-Action', 'foreground-window']);
            if (!foreground.ok || !foreground.hwnd) throw new Error('No encontré una ventana activa.');
            return foreground.hwnd;
        }
        if (typeof windowTarget === 'number') return windowTarget;
        if (typeof windowTarget === 'object' && (windowTarget.Hwnd || windowTarget.hwnd)) {
            return windowTarget.Hwnd || windowTarget.hwnd;
        }
        if (typeof windowTarget === 'string') {
            const found = await this.findWindow(windowTarget);
            if (!found) throw new Error(`No se encontró ninguna ventana activa con el título: '${windowTarget}'.`);
            return found.Hwnd || found.hwnd;
        }
        throw new Error(`Tipo de ventana destino inválido: ${typeof windowTarget}`);
    }

    /**
     * Busca un botón específico dentro de una ventana por su nombre visible o AutomationId.
     */
    async findButton(windowTarget, nameOrPattern, options = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const args = ['-Action', 'find-elements', '-Hwnd', String(hwnd), '-ControlType', 'Button'];
        if (nameOrPattern) args.push('-NamePattern', String(nameOrPattern));
        if (options.automationId) args.push('-AutomationId', String(options.automationId));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error buscando botón '${nameOrPattern}'.`);
        return (res.elements && res.elements.length > 0) ? res.elements[0] : null;
    }

    /**
     * Busca un campo de texto editable (Edit) dentro de una ventana.
     */
    async findTextBox(windowTarget, nameOrPattern = '', options = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const args = ['-Action', 'find-elements', '-Hwnd', String(hwnd), '-ControlType', 'Edit'];
        if (nameOrPattern) args.push('-NamePattern', String(nameOrPattern));
        if (options.automationId) args.push('-AutomationId', String(options.automationId));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error buscando campo de texto '${nameOrPattern}'.`);
        return (res.elements && res.elements.length > 0) ? res.elements[0] : null;
    }

    /**
     * Hace clic en un elemento. Intenta InvokePattern / TogglePattern primero,
     * y utiliza coordenadas del centro de su BoundingRectangle como fallback.
     */
    async clickElement(windowTarget, elementTarget, options = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const name = typeof elementTarget === 'string' ? elementTarget : (elementTarget?.name || '');
        const autoId = (typeof elementTarget === 'object' && elementTarget?.automationId) ? elementTarget.automationId : (options.automationId || '');
        const cType = options.controlType || (typeof elementTarget === 'object' && elementTarget?.controlType) || 'Any';

        const args = ['-Action', 'click-element', '-Hwnd', String(hwnd)];
        if (name) args.push('-NamePattern', String(name));
        if (autoId) args.push('-AutomationId', String(autoId));
        if (cType) args.push('-ControlType', String(cType));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error haciendo clic en elemento '${name || autoId}'.`);
        return res;
    }

    /**
     * Escribe texto en un campo de texto (ValuePattern directo o SetFocus + SendKeys).
     */
    async setText(windowTarget, elementTarget, text, options = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const name = typeof elementTarget === 'string' ? elementTarget : (elementTarget?.name || '');
        const autoId = (typeof elementTarget === 'object' && elementTarget?.automationId) ? elementTarget.automationId : (options.automationId || '');

        const args = ['-Action', 'set-text', '-Hwnd', String(hwnd), '-Text', String(text)];
        if (name) args.push('-NamePattern', String(name));
        if (autoId) args.push('-AutomationId', String(autoId));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error escribiendo texto en '${name || autoId}'.`);
        return res;
    }

    /**
     * Selecciona una opción en una lista, menú o pestaña (SelectionItemPattern).
     */
    async selectOption(windowTarget, optionName, options = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const args = ['-Action', 'select-option', '-Hwnd', String(hwnd), '-Option', String(optionName)];

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error seleccionando opción '${optionName}'.`);
        return res;
    }

    /**
     * Espera a que aparezca una ventana hasta alcanzar el timeout.
     */
    async waitForWindow(titleOrPattern, timeoutMs = 8000, intervalMs = 500) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const win = await this.findWindow(titleOrPattern);
            if (win) return win;
            await new Promise(r => setTimeout(r, intervalMs));
        }
        return null;
    }

    /**
     * Espera a que aparezca un elemento específico en la ventana.
     */
    async waitForElement(windowTarget, criteria, timeoutMs = 8000, intervalMs = 500) {
        const start = Date.now();
        const hwnd = await this._resolveHwnd(windowTarget);
        const name = typeof criteria === 'string' ? criteria : criteria.name;
        const cType = criteria.controlType || 'Any';
        const autoId = criteria.automationId || '';

        while (Date.now() - start < timeoutMs) {
            const args = ['-Action', 'find-elements', '-Hwnd', String(hwnd), '-ControlType', cType];
            if (name) args.push('-NamePattern', String(name));
            if (autoId) args.push('-AutomationId', String(autoId));

            try {
                const res = await this._runBridge(args);
                if (res.ok && res.elements && res.elements.length > 0) {
                    return res.elements[0];
                }
            } catch (_) {}

            await new Promise(r => setTimeout(r, intervalMs));
        }
        return null;
    }
    /**
     * Mueve y/o redimensiona una ventana a nuevas coordenadas en pantalla.
     */
    async moveWindow(windowTarget, bounds = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const args = ['-Action', 'move-window', '-Hwnd', String(hwnd)];
        if (bounds.x !== undefined) args.push('-X', String(bounds.x));
        if (bounds.y !== undefined) args.push('-Y', String(bounds.y));
        if (bounds.width !== undefined) args.push('-Width', String(bounds.width));
        if (bounds.height !== undefined) args.push('-Height', String(bounds.height));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || 'Error moviendo ventana.');
        return res;
    }

    /**
     * Busca una colección de elementos que coincidan con los criterios dados.
     */
    async findElements(windowTarget, criteria = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const name = criteria.name || '';
        const cType = criteria.controlType || 'Any';
        const autoId = criteria.automationId || '';

        const args = ['-Action', 'find-elements', '-Hwnd', String(hwnd), '-ControlType', cType];
        if (name) args.push('-NamePattern', String(name));
        if (autoId) args.push('-AutomationId', String(autoId));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || 'Error buscando elementos.');
        return res.elements || [];
    }

    /**
     * Verificador de Pantalla y Evidencia Operacional (Sección 6, 97)
     * Comprueba si un estado esperado se cumplió en pantalla y genera evidencia operacional.
     * Niveles:
     *   - Level 1: UI Tree / Accessibility (UI Automation)
     *   - Level 2: Screenshot VLM / OCR Fallback
     */
    async verifyScreenState(expectedState = {}, timeoutMs = 5000) {
        const start = Date.now();
        const evidence = {
            verified: false,
            level: 'accessibility',
            action: expectedState.action || 'verify',
            observedEvidence: null,
            durationMs: 0
        };

        // 1. Verificación de cierre de ventana (dialog_closed / window_closed)
        if (expectedState.windowClosed) {
            while (Date.now() - start < timeoutMs) {
                const win = await this.findWindow(expectedState.windowClosed);
                if (!win) {
                    evidence.verified = true;
                    evidence.observedEvidence = `Ventana '${expectedState.windowClosed}' cerrada exitosamente.`;
                    evidence.durationMs = Date.now() - start;
                    return evidence;
                }
                await new Promise(r => setTimeout(r, 400));
            }
            evidence.observedEvidence = `Ventana '${expectedState.windowClosed}' sigue activa tras ${timeoutMs}ms.`;
            evidence.durationMs = Date.now() - start;
            return evidence;
        }

        // 2. Verificación de presencia de elemento (element_present)
        if (expectedState.elementPresent && expectedState.window) {
            const found = await this.waitForElement(expectedState.window, expectedState.elementPresent, timeoutMs);
            if (found) {
                evidence.verified = true;
                evidence.observedEvidence = `Elemento encontrado en '${expectedState.window}': ${found.name || found.automationId}`;
            } else {
                evidence.observedEvidence = `Elemento no encontrado en '${expectedState.window}' tras timeout.`;
            }
            evidence.durationMs = Date.now() - start;
            return evidence;
        }

        evidence.durationMs = Date.now() - start;
        return evidence;
    }

    /**
     * Obtiene el texto de un elemento dentro de una ventana (ValuePattern, TextPattern o Name).
     */
    async getText(windowTarget, criteria = {}) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const name = typeof criteria === 'string' ? criteria : (criteria.name || '');
        const autoId = criteria.automationId || '';
        const cType = criteria.controlType || (typeof criteria === 'string' ? 'Any' : (criteria.controlType || 'Any'));

        const args = ['-Action', 'get-text', '-Hwnd', String(hwnd)];
        if (name) args.push('-NamePattern', String(name));
        if (autoId) args.push('-AutomationId', String(autoId));
        if (cType) args.push('-ControlType', String(cType));

        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || 'Error leyendo texto del elemento.');
        return res.text || '';
    }

    /**
     * Cierra una ventana usando WindowPattern.Close() con fallback a WM_CLOSE.
     */
    async closeWindow(windowTarget) {
        const hwnd = await this._resolveHwnd(windowTarget);
        const args = ['-Action', 'close-window', '-Hwnd', String(hwnd)];
        const res = await this._runBridge(args);
        if (!res.ok) throw new Error(res.error || `Error cerrando ventana HWND ${hwnd}.`);
        return res;
    }
}

const uiAutomationService = new UiAutomationService();
module.exports = uiAutomationService;
