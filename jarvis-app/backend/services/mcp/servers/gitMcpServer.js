/**
 * Git MCP Server
 * Expone operaciones de control de versiones Git sobre el repositorio del proyecto bajo el protocolo MCP.
 */

const { exec } = require('child_process');
const path = require('path');
const McpServerBase = require('../mcpServerBase');

class GitMcpServer extends McpServerBase {
    constructor() {
        super('jarvis-git-mcp', '1.0.0');
        this.repoPath = path.resolve(__dirname, '../../..'); // Raíz del proyecto
        this._initTools();
    }

    _runGit(args) {
        return new Promise((resolve, reject) => {
            exec(`git ${args}`, { cwd: this.repoPath, windowsHide: true }, (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(stderr || err.message));
                }
                resolve(stdout.trim());
            });
        });
    }

    _initTools() {
        // 1. git_status
        this.registerTool({
            name: 'git_status',
            description: 'Consulta el estado del repositorio Git (archivos modificados, staged y no rastreados).',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const output = await this._runGit('status --short');
                return output || 'El árbol de trabajo está limpio (sin modificaciones).';
            }
        });

        // 2. git_log
        this.registerTool({
            name: 'git_log',
            description: 'Consulta los últimos commits del historial del repositorio.',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Cantidad de commits a mostrar (default 5)' }
                }
            },
            handler: async ({ limit = 5 }) => {
                const count = Math.min(20, Math.max(1, limit));
                const output = await this._runGit(`log -n ${count} --oneline`);
                return output || 'No hay commits registrados.';
            }
        });

        // 3. git_diff
        this.registerTool({
            name: 'git_diff',
            description: 'Muestra las diferencias (diff) de los cambios no guardados en el repositorio.',
            inputSchema: {
                type: 'object',
                properties: {
                    staged: { type: 'boolean', description: 'Si es true, muestra los cambios en stage' }
                }
            },
            handler: async ({ staged = false }) => {
                const flag = staged ? '--staged' : '';
                const output = await this._runGit(`diff ${flag} --stat`);
                return output || 'Sin diferencias pendientes.';
            }
        });

        // 4. git_branch
        this.registerTool({
            name: 'git_branch',
            description: 'Lista las ramas disponibles del repositorio y la rama actual.',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => {
                const output = await this._runGit('branch');
                return output || 'master';
            }
        });
    }
}

module.exports = new GitMcpServer();
