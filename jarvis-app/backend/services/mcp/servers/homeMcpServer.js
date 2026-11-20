/**
 * Home MCP Server
 * Expone el control de dispositivos inteligentes del hogar (Smart TV, BroadLink IR) bajo el protocolo MCP.
 */

const McpServerBase = require('../mcpServerBase');
const tvService = require('../../tvService');

class HomeMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-home-mcp', '1.0.0');
        this._initTools();
    }

    _initTools() {
        // 1. home_tv_set_volume
        this.registerTool({
            name: 'home_tv_set_volume',
            description: 'Ajusta el volumen absoluto de la Smart TV (0-100).',
            inputSchema: {
                type: 'object',
                properties: {
                    percent: { type: 'number', description: 'Nivel de volumen' }
                },
                required: ['percent']
            },
            handler: async ({ percent }) => {
                const res = await tvService.setVolume(percent);
                return res.message || `Volumen de TV ajustado al ${percent}%.`;
            }
        });

        // 2. home_tv_adjust_volume
        this.registerTool({
            name: 'home_tv_adjust_volume',
            description: 'Sube o baja el volumen de la TV según el delta proporcionado.',
            inputSchema: {
                type: 'object',
                properties: {
                    delta: { type: 'number', description: 'Puntos a subir (+) o bajar (-)' }
                },
                required: ['delta']
            },
            handler: async ({ delta }) => {
                const res = await tvService.adjustVolume(delta);
                return res.message || `Volumen de TV modificado por ${delta}.`;
            }
        });

        // 3. home_tv_toggle_mute
        this.registerTool({
            name: 'home_tv_toggle_mute',
            description: 'Silencia o reactiva el sonido de la Smart TV.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const res = await tvService.toggleMute();
                return res.message || 'Silencio de TV alternado.';
            }
        });

        // 4. home_tv_status
        this.registerTool({
            name: 'home_tv_status',
            description: 'Consulta el estado de disponibilidad del dispositivo BroadLink / TV.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const available = await tvService.isAvailable();
                return available ? 'Dispositivo BroadLink / TV en línea y disponible.' : 'Dispositivo BroadLink fuera de línea.';
            }
        });
    }
}

module.exports = new HomeMcpServer();
