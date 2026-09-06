/**
 * Model Context Protocol (MCP) - JSON-RPC 2.0 Specification Engine
 * Define los tipos, estructuras de mensajes y códigos de error estándar
 * del protocolo MCP para comunicación desacoplada de herramientas y recursos.
 */

const MCP_ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    SERVER_NOT_INITIALIZED: -32002,
    TOOL_EXECUTION_ERROR: -32000
};

class McpProtocol {
    /**
     * Construye un request estándar JSON-RPC 2.0.
     */
    static createRequest(id, method, params = {}) {
        return {
            jsonrpc: '2.0',
            id: id !== undefined ? id : Date.now(),
            method,
            params
        };
    }

    /**
     * Construye una respuesta exitosa estándar JSON-RPC 2.0 con contenido MCP.
     */
    static createResponse(id, result) {
        return {
            jsonrpc: '2.0',
            id,
            result
        };
    }

    /**
     * Construye un resultado de ejecución de herramienta estándar MCP (tools/call).
     */
    static createToolResult(content, isError = false) {
        let normalizedContent = [];

        if (Array.isArray(content)) {
            normalizedContent = content;
        } else if (typeof content === 'string') {
            normalizedContent = [{ type: 'text', text: content }];
        } else if (content && typeof content === 'object') {
            normalizedContent = [{ type: 'text', text: JSON.stringify(content, null, 2) }];
        } else {
            normalizedContent = [{ type: 'text', text: String(content) }];
        }

        return {
            content: normalizedContent,
            isError
        };
    }

    /**
     * Construye una respuesta de error estándar JSON-RPC 2.0.
     */
    static createError(id, code, message, data = null) {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code,
                message,
                data
            }
        };
    }

    /**
     * Valida que un objeto entrante sea un request JSON-RPC 2.0 bien formado.
     */
    static validateRequest(msg) {
        if (!msg || typeof msg !== 'object') {
            return { valid: false, error: 'El mensaje debe ser un objeto JSON.' };
        }
        if (msg.jsonrpc !== '2.0') {
            return { valid: false, error: 'Versión jsonrpc inválida. Se requiere "2.0".' };
        }
        if (typeof msg.method !== 'string' || !msg.method.trim()) {
            return { valid: false, error: 'Campo "method" ausente o inválido.' };
        }
        return { valid: true };
    }
}

module.exports = {
    McpProtocol,
    MCP_ERROR_CODES
};
