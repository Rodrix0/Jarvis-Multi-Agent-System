class ToolRegistryService {
    constructor() {
        this.tools = new Map(); // toolName -> { version, level, inputs, outputs, timeoutMs, health, status }
        this.initDefaultTools();
    }

    registerTool(toolDef) {
        if (!toolDef.name) throw new Error('Tool definition requires a name.');
        this.tools.set(toolDef.name, {
            version: toolDef.version || 1,
            level: toolDef.level || 'L1',
            inputs: toolDef.inputs || {},
            outputs: toolDef.outputs || {},
            timeoutMs: toolDef.timeoutMs || 30000,
            health: 'AVAILABLE', // 'AVAILABLE', 'DEGRADED', 'OFFLINE', 'DISABLED', 'CIRCUIT_OPEN'
            ...toolDef
        });
    }

    setToolHealth(toolName, health) {
        const tool = this.tools.get(toolName);
        if (tool) {
            tool.health = health;
        }
    }

    getTool(toolName) {
        return this.tools.get(toolName);
    }

    getAvailableTools() {
        const list = [];
        for (const [name, tool] of this.tools.entries()) {
            if (tool.health === 'AVAILABLE' || tool.health === 'DEGRADED') {
                list.push({ name, ...tool });
            }
        }
        return list;
    }

    initDefaultTools() {
        this.registerTool({ name: 'file.search', level: 'L0', version: 2, inputs: { query: 'string', extension: 'string?' }, outputs: { files: 'array' } });
        this.registerTool({ name: 'file.copy', level: 'L1', version: 1, inputs: { source: 'string', destination: 'string' } });
        this.registerTool({ name: 'file.move', level: 'L2', version: 1, inputs: { source: 'string', destination: 'string' } });
        this.registerTool({ name: 'file.delete', level: 'L3', version: 1, inputs: { filePath: 'string' } });
        this.registerTool({ name: 'audio.set-volume', level: 'L1', version: 1, inputs: { percent: 'number' } });
        this.registerTool({ name: 'display.screenshot', level: 'L1', version: 1, inputs: {} });
        this.registerTool({ name: 'communication.send-email', level: 'L2', version: 1, inputs: { recipient: 'string', subject: 'string', body: 'string' } });
        this.registerTool({ name: 'communication.send-whatsapp', level: 'L2', version: 1, inputs: { recipient: 'string', message: 'string' } });
        this.registerTool({ name: 'tv.search', level: 'L1', version: 1, inputs: { platform: 'string', query: 'string' } });
    }
}

const toolRegistryService = new ToolRegistryService();
module.exports = toolRegistryService;
