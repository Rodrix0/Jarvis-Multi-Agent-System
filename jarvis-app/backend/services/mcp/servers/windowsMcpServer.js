/**
 * Windows MCP Server
 * Expone el control del sistema operativo Windows, audio, ventanas,
 * procesos y UI Automation bajo el protocolo estándar MCP.
 */

const McpServerBase = require('../mcpServerBase');
const windowsControl = require('../../windowsControlService');
const uiAutomationService = require('../../windows/uiAutomationService');

class WindowsMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-windows-mcp', '1.0.0');
        this._initTools();
    }

    _initTools() {
        // 1. Audio: setVolume
        this.registerTool({
            name: 'windows_set_volume',
            description: 'Ajusta el volumen de Windows al porcentaje especificado (0-100).',
            inputSchema: {
                type: 'object',
                properties: {
                    percent: { type: 'number', description: 'Nivel de volumen de 0 a 100' }
                },
                required: ['percent']
            },
            handler: async ({ percent }) => {
                const res = await windowsControl.audio.setVolume(percent);
                return res.message || `Volumen ajustado al ${percent}%`;
            }
        });

        // 2. Audio: toggleMute
        this.registerTool({
            name: 'windows_toggle_mute',
            description: 'Silencia o reactiva el sonido principal de Windows.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await windowsControl.audio.toggleMute();
                return res.message || 'Silencio alternado con éxito.';
            }
        });

        // 3. Ventanas: minimizeActive
        this.registerTool({
            name: 'windows_minimize_window',
            description: 'Minimiza la ventana activa del usuario en Windows.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await windowsControl.windowTab.minimizeActive();
                return res.message || 'Ventana minimizada.';
            }
        });

        // 4. Ventanas: maximizeActive
        this.registerTool({
            name: 'windows_maximize_window',
            description: 'Maximiza la ventana activa en Windows a pantalla completa.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await windowsControl.windowTab.maximizeActive();
                return res.message || 'Ventana maximizada.';
            }
        });

        // 5. Ventanas: closeWindow
        this.registerTool({
            name: 'windows_close_window',
            description: 'Cierra la ventana activa actual.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await windowsControl.windowTab.closeWindow();
                return res.message || 'Ventana cerrada.';
            }
        });

        // 6. UI Automation: listWindows
        this.registerTool({
            name: 'windows_list_windows',
            description: 'Lista las ventanas abiertas en el escritorio con títulos y HWND.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const windows = await uiAutomationService.listWindows();
                return windows.slice(0, 10).map(w => ({ hwnd: w.Hwnd, title: w.Title, class: w.ClassName }));
            }
        });

        // 7. UI Automation: inspectControls
        this.registerTool({
            name: 'windows_ui_inspect',
            description: 'Inspecciona controles semánticos (botones, campos de texto) sin usar coordenadas fijas.',
            inputSchema: {
                type: 'object',
                properties: {
                    windowTitle: { type: 'string', description: 'Título o parte del título de la ventana' }
                },
                required: ['windowTitle']
            },
            handler: async ({ windowTitle }) => {
                const win = await uiAutomationService.findWindow(windowTitle);
                if (!win) throw new Error(`No se encontró la ventana "${windowTitle}".`);
                const elements = await uiAutomationService.inspectWindowElements(win.Hwnd);
                return {
                    window: win.Title,
                    elementCount: elements.length,
                    elements: elements.slice(0, 10)
                };
            }
        });

        // 8. Display: screenshot
        this.registerTool({
            name: 'windows_take_screenshot',
            description: 'Toma una captura de pantalla completa del monitor principal.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await windowsControl.display.takeScreenshot();
                return res.message || 'Captura de pantalla guardada en el Escritorio.';
            }
        });
    }
}

module.exports = new WindowsMcpServer();
