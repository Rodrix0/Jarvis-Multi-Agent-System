/**
 * MCP Router & Hub Service for Jarvis (Ítem 10)
 * Hub central que gestiona y desacopla la comunicación con los servidores MCP:
 *   - Windows MCP
 *   - Browser MCP
 *   - Files MCP
 *   - Git MCP
 *   - Memory MCP
 *   - Home MCP
 *   - Servidores MCP externos (stdio / http)
 *
 * Implementa el protocolo estándar JSON-RPC 2.0 y permite a Jarvis
 * o a clientes externos consumir herramientas de manera interoperable.
 */

const { McpProtocol, MCP_ERROR_CODES } = require('./mcpProtocol');
const windowsMcpServer = require('./servers/windowsMcpServer');
const browserMcpServer = require('./servers/browserMcpServer');
const filesMcpServer = require('./servers/filesMcpServer');
const gitMcpServer = require('./servers/gitMcpServer');
const memoryMcpServer = require('./servers/memoryMcpServer');
const homeMcpServer = require('./servers/homeMcpServer');

class McpRouterService {
    constructor() {
        this.servers = new Map();
        this._initNativeServers();
    }

    /**
     * Registra un servidor MCP en el Hub.
     */
    registerServer(serverId, serverInstance) {
        if (!serverInstance || typeof serverInstance.handleRequest !== 'function') {
            throw new Error(`[McpRouter] El servidor "${serverId}" debe implementar handleRequest().`);
        }
        this.servers.set(serverId.toLowerCase(), serverInstance);
    }

    /**
     * Obtiene un servidor MCP por su ID.
     */
    getServer(serverId) {
        return this.servers.get(serverId.toLowerCase()) || null;
    }

    /**
     * Lista todos los servidores MCP registrados.
     */
    listServers() {
        return [...this.servers.entries()].map(([id, s]) => ({
            id,
            name: s.name,
            version: s.version,
            toolCount: typeof s.listTools === 'function' ? s.listTools().length : 0
        }));
    }

    /**
     * Recopila todas las herramientas expuestas por todos los servidores MCP.
     */
    async listAllTools() {
        const allTools = [];
        for (const [serverId, server] of this.servers.entries()) {
            const req = McpProtocol.createRequest(Date.now(), 'tools/list');
            const res = await server.handleRequest(req);
            if (res.result && Array.isArray(res.result.tools)) {
                for (const tool of res.result.tools) {
                    allTools.push({
                        ...tool,
                        server: serverId,
                        namespacedName: `${serverId}:${tool.name}`
                    });
                }
            }
        }
        return allTools;
    }

    /**
     * Ejecuta una llamada a herramienta (tools/call) localizando el servidor correspondiente.
     */
    async callTool(toolName, args = {}, serverHint = null) {
        let targetServerId = serverHint ? serverHint.toLowerCase() : null;
        let actualToolName = toolName;

        // Si viene con prefijo namespace (ej: "git:git_status")
        if (toolName.includes(':')) {
            const parts = toolName.split(':');
            targetServerId = parts[0].toLowerCase();
            actualToolName = parts[1];
        }

        // Si no se especificó servidor, buscar cuál de los servidores contiene la herramienta
        if (!targetServerId) {
            for (const [sId, s] of this.servers.entries()) {
                if (typeof s.listTools === 'function') {
                    const tools = s.listTools();
                    if (tools.some(t => t.name === actualToolName)) {
                        targetServerId = sId;
                        break;
                    }
                }
            }
        }

        if (!targetServerId) {
            return McpProtocol.createError(
                Date.now(),
                MCP_ERROR_CODES.METHOD_NOT_FOUND,
                `No se encontró ningún servidor MCP que maneje la herramienta "${toolName}".`
            );
        }

        const server = this.getServer(targetServerId);
        if (!server) {
            return McpProtocol.createError(
                Date.now(),
                MCP_ERROR_CODES.METHOD_NOT_FOUND,
                `Servidor MCP "${targetServerId}" no encontrado.`
            );
        }

        const rpcRequest = McpProtocol.createRequest(Date.now(), 'tools/call', {
            name: actualToolName,
            arguments: args
        });

        return server.handleRequest(rpcRequest);
    }

    /**
     * Procesa un request JSON-RPC 2.0 entrante de un cliente externo.
     */
    async handleClientRequest(rpcRequest) {
        const validation = McpProtocol.validateRequest(rpcRequest);
        if (!validation.valid) {
            return McpProtocol.createError(rpcRequest?.id || null, MCP_ERROR_CODES.INVALID_REQUEST, validation.error);
        }

        const { id, method, params = {} } = rpcRequest;

        switch (method) {
            case 'initialize': {
                return McpProtocol.createResponse(id, {
                    protocolVersion: '2024-11-05',
                    serverInfo: {
                        name: 'jarvis-mcp-hub',
                        version: '1.0.0'
                    },
                    capabilities: {
                        tools: { listChanged: false },
                        servers: this.listServers()
                    }
                });
            }

            case 'ping': {
                return McpProtocol.createResponse(id, {});
            }

            case 'tools/list': {
                const tools = await this.listAllTools();
                return McpProtocol.createResponse(id, { tools });
            }

            case 'tools/call': {
                const { name, arguments: args = {} } = params;
                return this.callTool(name, args);
            }

            default: {
                return McpProtocol.createError(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Método "${method}" no soportado en MCP Router.`);
            }
        }
    }

    /**
     * Inicialización de los 6 servidores MCP nativos de Jarvis.
     */
    _initNativeServers() {
        this.registerServer('windows', windowsMcpServer);
        this.registerServer('browser', browserMcpServer);
        this.registerServer('files', filesMcpServer);
        this.registerServer('git', gitMcpServer);
        this.registerServer('memory', memoryMcpServer);
        this.registerServer('home', homeMcpServer);
    }
}

const mcpRouterService = new McpRouterService();
module.exports = mcpRouterService;
