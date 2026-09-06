/**
 * Browser MCP Server
 * Expone la navegación web autónoma mediante Playwright y Chrome bajo el protocolo MCP.
 */

const McpServerBase = require('../mcpServerBase');
const browserService = require('../../browser/browserService');

class BrowserMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-browser-mcp', '1.0.0');
        this._initTools();
    }

    _initTools() {
        // 1. openPage
        this.registerTool({
            name: 'browser_open',
            description: 'Navega a un sitio web o aplicación web en el navegador autónomo Chrome.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL de destino (ej: https://wikipedia.org)' }
                },
                required: ['url']
            },
            handler: async ({ url }) => {
                const res = await browserService.openPage(url);
                return `Página "${res.title}" cargada en ${res.url}`;
            }
        });

        // 2. click
        this.registerTool({
            name: 'browser_click',
            description: 'Hace clic en un elemento web por selector CSS o texto.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Selector CSS o texto del elemento' }
                },
                required: ['selector']
            },
            handler: async ({ selector }) => {
                const res = await browserService.click(selector);
                return `Clic realizado en ${res.selector}`;
            }
        });

        // 3. write
        this.registerTool({
            name: 'browser_type',
            description: 'Escribe texto en un campo de texto o formulario web.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Selector del campo' },
                    text: { type: 'string', description: 'Texto a escribir' }
                },
                required: ['selector', 'text']
            },
            handler: async ({ selector, text }) => {
                await browserService.write(selector, text);
                return `Texto escrito en ${selector}.`;
            }
        });

        // 4. getText
        this.registerTool({
            name: 'browser_get_text',
            description: 'Extrae el texto visible de un elemento o de toda la página web.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Selector CSS opcional (default body)' }
                }
            },
            handler: async ({ selector }) => {
                const res = await browserService.getText(selector || 'body');
                return res.text;
            }
        });

        // 5. scroll
        this.registerTool({
            name: 'browser_scroll',
            description: 'Desplaza la página web verticalmente hacia abajo o arriba.',
            inputSchema: {
                type: 'object',
                properties: {
                    direction: { type: 'string', enum: ['down', 'up', 'bottom', 'top'] },
                    amount: { type: 'number', description: 'Píxeles a desplazar (ej: 400)' }
                }
            },
            handler: async ({ direction = 'down', amount = 400 }) => {
                await browserService.scroll(direction, amount);
                return `Desplazamiento vertical ${direction} (${amount}px) completado.`;
            }
        });

        // 6. close
        this.registerTool({
            name: 'browser_close',
            description: 'Cierra la sesión del navegador autónomo y libera memoria.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                await browserService.close();
                return 'Navegador autónomo cerrado.';
            }
        });
    }
}

module.exports = new BrowserMcpServer();
