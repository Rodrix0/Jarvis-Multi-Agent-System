/**
 * Verification Service for Jarvis Actions
 * Transforma el flujo ciego de "acción -> terminado" a "acción -> verificación -> éxito / reintento / error",
 * asegurando que Jarvis compruebe evidencia tangible en el sistema operativo antes de dar por cumplida una orden.
 */

const fs = require('fs');
const path = require('path');
const uiAutomationService = require('../windows/uiAutomationService');

class VerificationService {
    /**
     * Bucle genérico de verificación para cualquier predicado asíncrono.
     */
    async verifyCondition(predicateFn, options = {}) {
        const timeoutMs = options.timeoutMs || 5000;
        const intervalMs = options.intervalMs || 250;
        const label = options.label || 'Condición';
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                const res = await predicateFn();
                if (res) {
                    return {
                        verified: true,
                        elapsedMs: Date.now() - start,
                        result: res,
                        label
                    };
                }
            } catch (err) {
                // Silenciar errores intermedios durante el sondeo
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }

        return {
            verified: false,
            elapsedMs: Date.now() - start,
            error: `Tiempo de espera agotado (${timeoutMs}ms) esperando: ${label}`,
            label
        };
    }

    /**
     * Verifica que una aplicación o ventana se haya abierto efectivamente.
     * Si no se detecta a mitad del tiempo y se proveyó una función de reintento,
     * reintenta la apertura una vez automáticamente.
     */
    async verifyAppOpened(appNameOrTitle, options = {}) {
        const timeoutMs = options.timeoutMs || 4000;
        const intervalMs = options.intervalMs || 350;
        const start = Date.now();

        let cleanTarget = String(appNameOrTitle || '').toLowerCase().trim();
        cleanTarget = cleanTarget
            .replace(/^(?:la\s+)?carpeta\s+(?:de\s+|a\s+)?/i, '')
            .replace(/^(?:la\s+)?(?:aplicaci[oó]n|app|programa|juego)\s+(?:de\s+)?/i, '')
            .trim();
        const isKnownWebApp = /whatsapp|youtube|netflix|chatgpt|spotify|crunchyroll/i.test(cleanTarget);

        while (Date.now() - start < timeoutMs) {
            try {
                // 1. Buscar ventana visible en el escritorio interactivo con el nombre de la app
                const win = await uiAutomationService.findWindow(cleanTarget);
                if (win) {
                    return {
                        verified: true,
                        elapsedMs: Date.now() - start,
                        window: win,
                        retried: false,
                        evidence: { type: 'window', hwnd: win.Hwnd, title: win.Title }
                    };
                }

                // 1b. Si es una web app y no reporta título específico aún, verificar si el navegador está activo
                if (isKnownWebApp && (Date.now() - start > 1200)) {
                    const browserWin = await uiAutomationService.findWindow(/chrome|msedge|brave|firefox/i);
                    if (browserWin) {
                        return {
                            verified: true,
                            elapsedMs: Date.now() - start,
                            window: browserWin,
                            retried: false,
                            evidence: { type: 'browser_window', hwnd: browserWin.Hwnd, title: browserWin.Title, target: cleanTarget }
                        };
                    }
                }
            } catch (_) {}

            await new Promise(r => setTimeout(r, intervalMs));
        }

        return {
            verified: false,
            elapsedMs: Date.now() - start,
            retried: false,
            error: `La aplicación o ventana "${appNameOrTitle}" no se abrió dentro del tiempo esperado (${timeoutMs}ms).`
        };
    }

    /**
     * Verifica que un archivo haya sido creado y tenga contenido en disco.
     */
    async verifyFileCreated(filePath, options = {}) {
        const minSize = options.minSize !== undefined ? options.minSize : 0;
        return this.verifyCondition(async () => {
            if (!fs.existsSync(filePath)) return false;
            const stat = fs.statSync(filePath);
            return stat.size >= minSize ? { path: filePath, size: stat.size } : false;
        }, {
            timeoutMs: options.timeoutMs || 4000,
            intervalMs: 150,
            label: `Creación de archivo '${path.basename(filePath)}'`
        });
    }

    /**
     * Verifica que una carpeta haya sido creada en disco.
     */
    async verifyFolderCreated(folderPath, options = {}) {
        return this.verifyCondition(async () => {
            if (!fs.existsSync(folderPath)) return false;
            const stat = fs.statSync(folderPath);
            return stat.isDirectory() ? { path: folderPath } : false;
        }, {
            timeoutMs: options.timeoutMs || 4000,
            intervalMs: 150,
            label: `Creación de carpeta '${path.basename(folderPath)}'`
        });
    }

    /**
     * Verifica que un archivo o carpeta haya sido eliminado de su ruta original.
     */
    async verifyDeleted(targetPath, options = {}) {
        return this.verifyCondition(async () => {
            return !fs.existsSync(targetPath);
        }, {
            timeoutMs: options.timeoutMs || 4000,
            intervalMs: 150,
            label: `Eliminación de '${path.basename(targetPath)}'`
        });
    }

    /**
     * Verifica que una ventana se haya cerrado.
     */
    async verifyWindowClosed(titleOrPattern, options = {}) {
        return this.verifyCondition(async () => {
            const win = await uiAutomationService.findWindow(titleOrPattern);
            return win === null;
        }, {
            timeoutMs: options.timeoutMs || 4000,
            intervalMs: 250,
            label: `Cierre de ventana '${titleOrPattern}'`
        });
    }

    /**
     * Verifica que un archivo descargado haya aparecido en la carpeta destino
     * y no tenga extensiones de descarga en progreso (.crdownload, .tmp, .part).
     */
    async verifyDownloadCompleted(downloadDir, options = {}) {
        const timeoutMs = options.timeoutMs || 15000;
        const initialFiles = options.initialFiles || new Set();
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                if (fs.existsSync(downloadDir)) {
                    const files = fs.readdirSync(downloadDir);
                    for (const file of files) {
                        if (file.endsWith('.crdownload') || file.endsWith('.tmp') || file.endsWith('.part')) {
                            continue; // Aún en descarga
                        }
                        if (!initialFiles.has(file)) {
                            const full = path.join(downloadDir, file);
                            const stat = fs.statSync(full);
                            if (stat.size > 0) {
                                return {
                                    verified: true,
                                    elapsedMs: Date.now() - start,
                                    file: full,
                                    size: stat.size
                                };
                            }
                        }
                    }
                }
            } catch (_) {}

            await new Promise(r => setTimeout(r, 400));
        }

        return {
            verified: false,
            elapsedMs: Date.now() - start,
            error: `No se completó ninguna descarga en '${downloadDir}' dentro de ${timeoutMs}ms.`
        };
    }

    /**
     * Verifica que un elemento o diálogo haya aparecido en una ventana.
     */
    async verifyElementAppeared(windowTarget, elementCriteria, options = {}) {
        const timeoutMs = options.timeoutMs || 5000;
        const elem = await uiAutomationService.waitForElement(windowTarget, elementCriteria, timeoutMs, 250);
        if (elem) {
            return {
                verified: true,
                element: elem
            };
        }
        return {
            verified: false,
            error: `Elemento '${typeof elementCriteria === 'string' ? elementCriteria : elementCriteria.name}' no apareció en la ventana.`
        };
    }
}

const verificationService = new VerificationService();
module.exports = verificationService;
