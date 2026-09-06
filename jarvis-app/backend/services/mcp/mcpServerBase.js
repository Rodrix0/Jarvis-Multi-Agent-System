/**
 * Model Context Protocol (MCP) - Base Server Class
 * Proporciona el ciclo de vida, registro de herramientas con esquema formal,
 * validación de parámetros y procesamiento estándar de métodos JSON-RPC.
 */

const { McpProtocol, MCP_ERROR_CODES } = require('./mcpProtocol');

class McpServerBase {
    constructor(name, version = '1.0.0') {
        this.name = name;
        this.version = version;
        this.tools = new Map();
        this.initialized = false;
    }

    /**
     * Registra una herramienta en este servidor MCP.
     */
    registerTool(definition) {
        if (!definition.name || typeof definition.handler !== 'function') {
            throw new Error(`[McpServer: ${this.name}] La herramienta requiere un nombre y una función handler.`);
        }

        this.tools.set(definition.name, {
            name: definition.name,
            description: definition.description || '',
            inputSchema: definition.inputSchema || {
                type: 'object',
                properties: {},
                required: []
            },
            handler: definition.handler
        });
    }

    /**
     * Retorna la lista de herramientas registradas en formato estándar MCP (tools/list).
     */
    listTools() {
        return [...this.tools.values()].map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }));
    }

    /**
     * Procesa un request JSON-RPC 2.0 entrante.
     */
    async handleRequest(rpcRequest) {
        const validation = McpProtocol.validateRequest(rpcRequest);
        if (!validation.valid) {
            return McpProtocol.createError(rpcRequest?.id || null, MCP_ERROR_CODES.INVALID_REQUEST, validation.error);
        }

        const { id, method, params = {} } = rpcRequest;

        try {
            switch (method) {
                case 'initialize': {
                    this.initialized = true;
                    return McpProtocol.createResponse(id, {
                        protocolVersion: '2024-11-05',
                        serverInfo: {
                            name: this.name,
                            version: this.version
                        },
                        capabilities: {
                            tools: { listChanged: false }
                        }
                    });
                }

                case 'ping': {
                    return McpProtocol.createResponse(id, {});
                }

                case 'tools/list': {
                    return McpProtocol.createResponse(id, {
                        tools: this.listTools()
                    });
                }

                case 'tools/call': {
                    const { name, arguments: args = {} } = params;
                    if (!name) {
                        return McpProtocol.createError(id, MCP_ERROR_CODES.INVALID_PARAMS, 'Se requiere el parámetro "name" de la herramienta.');
                    }

                    const tool = this.tools.get(name);
                    if (!tool) {
                        return McpProtocol.createError(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Herramienta desconocida "${name}" en servidor MCP [${this.name}].`);
                    }

                    // Ejecución segura de la herramienta
                    try {
                        const result = await tool.handler(args);
                        return McpProtocol.createResponse(id, McpProtocol.createToolResult(result, false));
                    } catch (execErr) {
                        return McpProtocol.createResponse(id, McpProtocol.createToolResult(`Error al ejecutar [${name}]: ${execErr.message}`, true));
                    }
                }

                default: {
                    return McpProtocol.createError(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Método no soportado: "${method}".`);
                }
            }
        } catch (err) {
            return McpProtocol.createError(id, MCP_ERROR_CODES.INTERNAL_ERROR, `Error interno del servidor MCP: ${err.message}`);
        }
    }
}

module.exports = McpServerBase;
