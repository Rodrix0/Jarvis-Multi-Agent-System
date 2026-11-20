/**
 * Memory MCP Server
 * Expone la consulta y almacenamiento de preferencias, perfil y memoria episódica bajo el protocolo MCP.
 */

const McpServerBase = require('../mcpServerBase');
const profileService = require('../../memory/profileService');

class MemoryMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-memory-mcp', '1.0.0');
        this._initTools();
    }

    _initTools() {
        // 1. memory_store_preference
        this.registerTool({
            name: 'memory_store_preference',
            description: 'Guarda una preferencia o dato relevante en el perfil persistente del usuario.',
            inputSchema: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: 'Categoría (ej: entertainment, general, tech)' },
                    data: { type: 'object', description: 'Datos clave-valor de la preferencia' }
                },
                required: ['category', 'data']
            },
            handler: async ({ category, data }) => {
                profileService.updateProfile(category, data, { explicit: true });
                return `Preferencia registrada en categoría "${category}".`;
            }
        });

        // 2. memory_get_profile
        this.registerTool({
            name: 'memory_get_profile',
            description: 'Obtiene el perfil consolidado y las preferencias registradas del usuario.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const profile = profileService.getProfile();
                return JSON.stringify(profile, null, 2);
            }
        });
    }
}

module.exports = new MemoryMcpServer();
